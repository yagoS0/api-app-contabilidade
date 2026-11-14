import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { conferirContextoCicloFiscal } from '../fiscal/automacaoCicloFiscalContext.js';
import { computeGuideComplianceMap } from './guideCompliance.js';
import { conferirParcelasParaEnvio } from './GuiaParcelaEnvioGuard.js';
import { reservarSemEntregaExterna } from './EntregaExternaGuiaService.js';
import { registrarEnvio, marcarEnviando } from './EnvioGuiaService.js';
import { destinatariosDeEnvio } from '../whatsapp/ContatoWhatsappService.js';
import { carregarCanal, enviarGuiaPorWhatsapp } from '../whatsapp/EnvioGuiaWhatsappService.js';
import { enviarGuiasExatasDoCiclo } from './GuideCompanyEmailService.js';

import { comporLeituraCicloEnvioGuias } from '../../composition/leituraCicloEnvioGuias.js';
import { fail, hash, keyOf, stateBase, warning, selecionarGuiasNaJanela } from '../../modules/operations/public.js';

const clone = value => JSON.parse(JSON.stringify(value));
export const revisaoDocumentoEnvio = g => hash([g.id, g.portalClientId, g.competencia, g.tipo, String(g.valor ?? ''),
  g.vencimento, g.status, g.hash, g.pdfBytes?.length ? createHash('sha256').update(Buffer.from(g.pdfBytes)).digest('hex') : null,
  g.storageKey, g.parcelamentoId, g.numeroParcela, g.extracted]);
export function createCicloEnvioGuiasService(deps = {}) {
  const db = deps.db || prisma, now = deps.now || (() => new Date());
  if (db !== prisma && !deps.compliance) throw fail('ENVIO_GUIAS_DEPENDENCIA_INVALIDA', 'A projeção de obrigações deve usar o mesmo banco.');
  const compliance = deps.compliance || computeGuideComplianceMap, contatos = deps.contatos || destinatariosDeEnvio;
  const canal = deps.canal || carregarCanal, email = deps.email || enviarGuiasExatasDoCiclo, whatsapp = deps.whatsapp || enviarGuiaPorWhatsapp;
  const load = comporLeituraCicloEnvioGuias({ db, now, compliance, contatos, canal, revisaoDocumentoEnvio });
  async function mutate(portalClientId, competencia, fn) {
    const key = keyOf(portalClientId, competencia);
    return db.$transaction(async tx => {
      await tx.appSetting.upsert({ where: { key }, create: { key, value: stateBase(portalClientId, competencia) }, update: {} });
      const row = await tx.appSetting.findUnique({ where: { key } });
      const lock = await tx.appSetting.updateMany({ where: { key, value: { equals: row.value } }, data: { value: row.value } });
      if (lock.count !== 1) throw fail('ENVIO_GUIAS_CONCORRENTE', 'Outra execução alterou este ciclo.');
      const next = clone(row.value), result = await fn(next, tx);
      next.revision += 1;
      await tx.appSetting.update({ where: { key }, data: { value: clone(next) } });
      return result;
    }, { isolationLevel: 'Serializable' });
  }
  async function execute({ portalClientId, competencia, scheduledAt, assertActive }) {
    const context = await conferirContextoCicloFiscal(db, { requireCompany: true, portalClientId });
    if (!context || !scheduledAt || typeof assertActive !== 'function') throw fail('ENVIO_GUIAS_AGENDA_OBRIGATORIA', 'O envio exige uma janela automática reservada.');
    assertActive();
    const snapshot = await load(portalClientId, competencia);
    if (!snapshot.dto.enabled || snapshot.dto.paused) return snapshot.dto;
    const selected = selecionarGuiasNaJanela(snapshot);
    const owner = randomUUID(), startedAt = now().toISOString();
    const claimed = await mutate(portalClientId, competencia, state => {
      for (const w of state.warnings) {
        if (!w.resolvedAt && snapshot.dto.expectation.state === 'KNOWN' && !snapshot.dto.expectation.missing.length && ['EXPECTATIVA_A_CONFERIR', 'PARTIAL_DEADLINE', 'PARTIAL_DUE', 'COMPLEMENT'].includes(w.code)) { w.resolvedAt = now().toISOString(); w.resolution = 'Cobertura documental conferida no ciclo'; }
      }
      for (const w of snapshot.dto.warnings) if (!state.warnings.some(old => old.id === w.id)) state.warnings.push(w);
      if (['PARTIAL_DEADLINE', 'PARTIAL_DUE', 'COMPLEMENT'].includes(snapshot.dto.decision.kind)) {
        const w = warning(snapshot.dto.decision.kind, snapshot.dto.decision.kind === 'COMPLEMENT' ? 'Envio complementar de novas guias; confira as faltantes.' : 'Envio parcial: ainda há guias ou obrigações a conferir.', now());
        if (!state.warnings.some(old => old.id === w.id)) state.warnings.push(w);
      }
      const fresh = selected.filter(item => !state.attempts.some(a => a.guideId === item.guide.id && a.channel === item.target.channel));
      for (const item of fresh) state.attempts.push({ id: randomUUID(), owner, guideId: item.guide.id, documentRevision: item.documentRevision,
        channel: item.target.channel, destination: item.target.destination, configHash: snapshot.configHash, agendaHash: snapshot.agendaHash, releaseOrigin: 'AUTOMACAO', releaseActorId: snapshot.config.updatedBy || null, status: 'STARTED', startedAt });
      if (fresh.length) state.lastAttempt = { id: owner, status: 'STARTED', startedAt };
      return fresh;
    });
    const guard = async item => {
      assertActive();
      await conferirContextoCicloFiscal(db, { requireCompany: true, portalClientId });
      const current = await load(portalClientId, competencia);
      if (!current.regimeKnown || !current.dto.enabled || current.dto.paused || current.dto.calendar.holidayRevision !== snapshot.dto.calendar.holidayRevision || current.configHash !== snapshot.configHash || current.agendaHash !== snapshot.agendaHash) throw fail('ENVIO_GUIAS_CONFIG_ALTERADA', 'A configuração mudou durante o envio.');
      if (hash(current.dto.expectation) !== hash(snapshot.dto.expectation)) throw fail('ENVIO_GUIAS_COBERTURA_ALTERADA', 'As obrigações ou os documentos esperados mudaram durante o preparo. Confira a cobertura antes de enviar.');
      const guide = current.guides.find(g => g.id === item.guide.id);
      if (current.dto.items.find(g => g.guideId === item.guide.id)?.reason) throw fail('ENVIO_GUIAS_REVISAO_NECESSARIA', 'Confira a guia antes do envio.');
      if (!guide || guide.status !== 'PROCESSED' || guide.paymentStatus === 'PAID' || revisaoDocumentoEnvio(guide) !== item.documentRevision) throw fail('ENVIO_GUIAS_DOCUMENTO_ALTERADO', 'A guia mudou durante o preparo.');
      await conferirParcelasParaEnvio([guide], { client: db });
      const destinations = item.target.channel === 'EMAIL' ? current.destinations.emails : current.destinations.telefones.map(c => c.telefoneE164);
      if (!destinations.includes(item.target.destination)) throw fail('ENVIO_GUIAS_DESTINO_ALTERADO', 'O destinatário mudou durante o preparo.');
      if (item.target.channel === 'WHATSAPP' && (!current.channel.disponivel || hash(current.channel) !== hash(snapshot.channel))) throw fail('ENVIO_GUIAS_CANAL_ALTERADO', 'O canal mudou durante o preparo.');
      const reservation = current.persisted.attempts.find(a => a.owner === owner && a.guideId === guide.id && a.channel === item.target.channel && a.destination === item.target.destination);
      if (!reservation || reservation.status !== 'STARTED') throw fail('ENVIO_GUIAS_RESERVA_ALTERADA', 'Confira a tentativa de envio.');
      return guide;
    };
    const finish = async (items, status, message, proof = null) => mutate(portalClientId, competencia, state => {
      for (const item of items) {
        const attempt = state.attempts.find(a => a.owner === owner && a.guideId === item.guide.id && a.channel === item.target.channel && a.destination === item.target.destination);
        if (attempt?.status === 'STARTED') Object.assign(attempt, { status, message, finishedAt: now().toISOString(), proof });
      }
      if (status !== 'SENT') { const w = warning(status, message, now(), items[0]?.guide.id); if (!state.warnings.some(old => old.id === w.id)) state.warnings.push(w); }
      state.lastAttempt = { id: owner, status: state.attempts.some(a => a.owner === owner && a.status !== 'SENT') ? 'REVIEW' : 'SENT', startedAt, finishedAt: now().toISOString() };
    });
    const emailItems = claimed.filter(i => i.target.channel === 'EMAIL');
    const emailGroups = new Map();
    for (const guideId of new Set(emailItems.map(i => i.guide.id))) {
      const group = emailItems.filter(i => i.guide.id === guideId);
      const key = JSON.stringify(group.map(i => i.target.destination).sort());
      emailGroups.set(key, [...(emailGroups.get(key) || []), ...group]);
    }
    for (const emailItems of emailGroups.values()) {
      try {
        const result = await email({ portalClientId, releaseActorId: snapshot.config.updatedBy || null, guides: [...new Map(emailItems.map(i => [i.guide.id, i.guide])).values()], destinos: [...new Set(emailItems.map(i => i.target.destination))],
          beforeDispatch: async () => { for (const item of emailItems) await guard(item); } }, { db });
        if (!['sent', 'partial'].includes(result?.status)) throw fail('ENVIO_GUIAS_INCONCLUSIVO', 'Confira o resultado do envio por e-mail.');
        for (const item of emailItems) {
          const outcome = result.outcomes?.find(o => o.destination === item.target.destination);
          const status = outcome?.status || (result.status === 'sent' ? 'SENT' : 'UNCERTAIN');
          await finish([item], status, status === 'SENT' ? null : 'Provedor não confirmou este destinatário. Confira a tentativa.', result.providerReference || null);
        }
      } catch (error) { await finish(emailItems, error.dispatched ? 'UNCERTAIN' : 'REVIEW', 'E-mail não concluído. Confira o histórico antes de repetir.'); }
    }
    for (const item of claimed.filter(i => i.target.channel === 'WHATSAPP')) {
      try {
        const currentGuide = await guard(item);
        const reservation = await reservarSemEntregaExterna(db, [currentGuide], async tx => {
          if (await tx.envioGuia.findFirst({ where: { guideId: item.guide.id, canal: 'WHATSAPP', destino: item.target.destination } })) throw fail('ENVIO_GUIAS_TENTATIVA_EXISTENTE', 'Já existe tentativa para esta guia e destinatário.');
          const released = await tx.guide.updateMany({ where: { id: currentGuide.id, portalClientId, updatedAt: currentGuide.updatedAt, status: 'PROCESSED' }, data: { liberadaCliente: true, liberadaEm: now(), liberadaPor: snapshot.config.updatedBy || null } });
          if (released.count !== 1) throw fail('ENVIO_GUIAS_DOCUMENTO_ALTERADO', 'A guia mudou antes da liberação.');
          const { envio } = await registrarEnvio({ guideId: item.guide.id, canal: 'WHATSAPP', destino: item.target.destination, tx });
          const reserved = await marcarEnviando(envio.id, tx);
          if (!reserved.reservado) throw fail('ENVIO_GUIAS_CONCORRENTE', 'Outra execução reservou a guia.');
          return { envio, ...reserved };
        });
        const result = await whatsapp({ guide: currentGuide, contato: item.target.contact, canal: snapshot.channel,
          automacao: { reservation, beforeDispatch: () => guard(item) } });
        await finish([item], result?.enviada === true ? 'SENT' : 'REVIEW', result?.enviada === true ? null : 'WhatsApp não concluído. Confira a tentativa antes de repetir.', result?.envioId || null);
      } catch { await finish([item], 'UNCERTAIN', 'WhatsApp interrompido. Confira o histórico antes de repetir.'); }
    }
    return (await load(portalClientId, competencia)).dto;
  }
  return { ler: async ({ portalClientId, competencia }) => (await load(portalClientId, competencia)).dto, executar: execute };
}
export const lerCicloEnvioGuias = (input, deps) => createCicloEnvioGuiasService(deps).ler(input);
export const executarCicloEnvioGuias = (input, deps) => createCicloEnvioGuiasService(deps).executar(input);
