import { lerInssManual } from '../operacoes/OperationsManualInss.js';
import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { conferirContextoCicloFiscal } from '../fiscal/automacaoCicloFiscalContext.js';
import { lerAutomacaoEmpresa } from '../fiscal/serpro/CompanyAutomationService.js';
import { computeGuideComplianceMap } from './guideCompliance.js';
import { calendarioEnvioGuias, decidirEnvioGuias } from './calendarioEnvioGuias.js';
import { mesOperacionalDaCompetencia } from '../accounting/parcelamento/pendenciasParcelamento.js';
import { bloqueioEnvioParcela, conferirParcelasParaEnvio, SELECT_PARCELA_ENVIO } from './GuiaParcelaEnvioGuard.js';
import { reservarSemEntregaExterna, documentoValido } from './EntregaExternaGuiaService.js';
import { registrarEnvio, marcarEnviando } from './EnvioGuiaService.js';
import { destinatariosDeEnvio } from '../whatsapp/ContatoWhatsappService.js';
import { carregarCanal, enviarGuiaPorWhatsapp } from '../whatsapp/EnvioGuiaWhatsappService.js';
import { enviarGuiasExatasDoCiclo } from './GuideCompanyEmailService.js';

const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyOf = (company, competencia) => `envio_guias_ciclo:${company}:${competencia}`;
const clone = value => JSON.parse(JSON.stringify(value));
const labels = { das: 'DAS', inss: 'INSS', parcDas: 'Parcelamento' };
export const revisaoDocumentoEnvio = g => hash([g.id, g.portalClientId, g.competencia, g.tipo, String(g.valor ?? ''),
  g.vencimento, g.status, g.hash, g.pdfBytes?.length ? createHash('sha256').update(Buffer.from(g.pdfBytes)).digest('hex') : null,
  g.storageKey, g.parcelamentoId, g.numeroParcela, g.extracted]);
function validInput(company, competencia) {
  if (typeof company !== 'string' || !company || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw fail('ENVIO_GUIAS_PERIODO_INVALIDO', 'Confira a empresa e a competência.', 422);
}
function stateBase(company, competencia) { return { portalClientId: company, competencia, revision: 0, attempts: [], warnings: [] }; }
function warning(code, message, now, guideId = null) { return { id: hash([code, guideId]), code, message, guideId, createdAt: now.toISOString(), resolvedAt: null }; }

export function createCicloEnvioGuiasService(deps = {}) {
  const db = deps.db || prisma, now = deps.now || (() => new Date());
  if (db !== prisma && !deps.compliance) throw fail('ENVIO_GUIAS_DEPENDENCIA_INVALIDA', 'A projeção de obrigações deve usar o mesmo banco.');
  const compliance = deps.compliance || computeGuideComplianceMap, contatos = deps.contatos || destinatariosDeEnvio;
  const canal = deps.canal || carregarCanal, email = deps.email || enviarGuiasExatasDoCiclo, whatsapp = deps.whatsapp || enviarGuiaPorWhatsapp;
  async function load(portalClientId, competencia) {
    validInput(portalClientId, competencia);
    const portal = await db.portalClient.findUnique({ where: { id: portalClientId } });
    if (!portal || portal.status !== 'ATIVA') throw fail('ENVIO_GUIAS_EMPRESA_INDISPONIVEL', 'A empresa não está ativa para envio automático.');
    const legacy = portal.companyId ? await db.company.findUnique({ where: { id: portal.companyId } }) : null;
    const config = (await db.appSetting.findUnique({ where: { key: `envio_guias_config:${portalClientId}` } }))?.value || { enabled: false };
    const settings = (await db.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } }))?.value;
    const agenda = settings?.rotinas?.simples_envio_guias;
    const automation = await lerAutomacaoEmpresa(db, portalClientId);
    const history = portal.companyId ? await db.regimeHistorico.findMany({ where: { companyId: portal.companyId } }) : [];
    const start = `${competencia}-01`, end = new Date(Date.UTC(Number(competencia.slice(0, 4)), Number(competencia.slice(5)), 0)).toISOString().slice(0, 10);
    const civil = v => new Date(v).toISOString().slice(0, 10);
    const relevant = history.filter(h => civil(h.vigenciaInicio) <= end && (!h.vigenciaFim || civil(h.vigenciaFim) >= start));
    const currentParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: 'numeric' }).formatToParts(now()).map(p => [p.type, p.value]));
    const latestCompetence = new Date(Date.UTC(Number(currentParts.year), Number(currentParts.month) - 2, 1)).toISOString().slice(0, 7);
    const regimeKnown = history.length ? relevant.length === 1 && relevant[0].regime === 'SIMPLES' && civil(relevant[0].vigenciaInicio) <= start && (!relevant[0].vigenciaFim || civil(relevant[0].vigenciaFim) >= end)
      : competencia === latestCompetence && String(legacy?.regimeTributario || legacy?.tipoTributario || '').toUpperCase() === 'SIMPLES';
    const mesOperacional = mesOperacionalDaCompetencia(competencia);
    const feriados = await db.feriado.findMany();
    const calendar = calendarioEnvioGuias({ mesOperacional, feriados, municipio: portal.municipio });
    const projection = (await compliance([{ portalId: portalClientId, hasProlabore: portal.hasProlabore, temFolha: portal.temFolha, empresaZerada: portal.empresaZerada, legacy: { ...legacy, regimeTributario: regimeKnown ? 'SIMPLES' : null, tipoTributario: regimeKnown ? 'SIMPLES' : null } }], competencia)).get(portalClientId);
    const monthlyRow = await db.appSetting.findUnique({ where: { key: `operations_manual_inss:v1:${portalClientId}:${competencia}` } });
    const monthlyInss = monthlyRow ? await lerInssManual(db, portalClientId, competencia) : null;
    const monthlyEvidence = monthlyInss?.applicabilitySource === 'month' && Boolean(monthlyInss.changedBy && monthlyInss.changedAt) && !monthlyInss.applicabilityConflict;
    if (monthlyEvidence && projection) projection.inss = { ...projection.inss, required: monthlyInss.applicable, ok: ['NOT_APPLICABLE', 'DOCUMENT_AVAILABLE', 'DOCUMENT_ABSENT'].includes(monthlyInss.status) };
    const required = Object.entries(labels).filter(([key]) => projection?.[key]?.required);
    const missing = required.filter(([key]) => !projection[key].ok).map(([obligationKey, label]) => ({ obligationKey, label, reason: 'Documento válido ainda não confirmado.' }));
    if (projection?.guiasParcelamentoMes?.length) missing.push({ obligationKey: 'parcelamento', label: 'Parcelamento', reason: 'Confira as parcelas esperadas nesta competência.' });
    // Cadastro atual de folha não prova matriz trabalhista nem a sua vigência histórica.
    const resolvedCount = required.filter(([key]) => projection[key].ok).length;
    const absenceConfirmedCount = required.filter(([key]) => projection[key].ok && (projection[key].state === 'vazio' || key === 'inss' && monthlyEvidence && monthlyInss.status === 'DOCUMENT_ABSENT')).length;
    const availableCount = resolvedCount - absenceConfirmedCount;
    const expectationKnown = Boolean(projection?.expectativaParcelamentoInconclusiva === false && regimeKnown && history.length > 0 && monthlyEvidence && portal.temFolha === false);
    const guides = await db.guide.findMany({ where: { portalClientId, competencia },
      include: { parcelamento: SELECT_PARCELA_ENVIO.parcelamento, parcela: SELECT_PARCELA_ENVIO.parcela }, orderBy: { id: 'asc' } });
    const destinations = await contatos(portalClientId), channel = await canal();
    const envios = guides.length ? await db.envioGuia.findMany({ where: { guideId: { in: guides.map(g => g.id) } } }) : [];
    const persisted = (await db.appSetting.findUnique({ where: { key: keyOf(portalClientId, competencia) } }))?.value || stateBase(portalClientId, competencia);
    const items = [], eligible = [];
    for (const guide of guides) {
      if (guide.status === 'VAZIO') continue;
      let reason = null;
      if (!documentoValido(guide) || guide.status !== 'PROCESSED' || guide.paymentStatus === 'PAID' || !(Number(guide.valor) > 0) || !guide.hash || !(guide.pdfBytes?.length || guide.storageKey)) reason = 'Confira o documento vigente, o valor e o pagamento.';
      if ((guide.parcelamentoId || guide.extracted?.indicacaoParcelamentoId) && !guide.vencimento) reason = 'Confira o vencimento da parcela.';
      if (!guide.parcelamentoId && !guide.extracted?.indicacaoParcelamentoId && guides.filter(g => g.status === 'PROCESSED' && !g.parcelamentoId && !g.extracted?.indicacaoParcelamentoId && g.tipo === guide.tipo && g.competencia === guide.competencia).length > 1) reason = 'Há mais de uma versão deste tipo de guia. Confira qual documento deve ser enviado.';
      const blocked = bloqueioEnvioParcela(guide); if (blocked) reason = blocked.message;
      try { await conferirParcelasParaEnvio([guide], { client: db }); } catch (error) { reason = error.message; }
      let itemCalendar;
      try { itemCalendar = calendarioEnvioGuias({ mesOperacional, vencimento: guide.vencimento, feriados, municipio: portal.municipio }); } catch { reason = 'Confira o vencimento da guia.'; }
      if (!regimeKnown) reason = 'Confira o regime tributário da competência.';
      const documentRevision = revisaoDocumentoEnvio(guide), channels = [];
      const targets = [...destinations.emails.map(destination => ({ channel: 'EMAIL', destination })), ...destinations.telefones.map(contact => ({ channel: 'WHATSAPP', destination: contact.telefoneE164, contact }))];
      for (const target of targets) {
        const previous = persisted.attempts.filter(a => a.guideId === guide.id && a.channel === target.channel);
        const ledger = envios.filter(e => e.guideId === guide.id && (e.canal === target.channel || e.canal === 'EXTERNO'));
        const matching = ledger.find(e => e.destino === target.destination || e.destino == null || e.canal === 'EXTERNO');
        let state = 'PENDING', message = reason;
        if (previous.some(a => a.documentRevision !== documentRevision)) message = 'O documento mudou após uma tentativa. Confira o histórico antes de reenviar.';
        else if (previous.length) {
          const exact = previous.find(a => a.destination === target.destination && a.documentRevision === documentRevision);
          state = exact?.status || 'REVIEW'; message = exact?.message || (state === 'SENT' ? null : 'Confira a tentativa anterior; não haverá repetição automática.');
          // The cycle preserves provider acceptance history; current delivery truth comes from its ledger.
          if (state === 'SENT' && matching?.canal === target.channel && ['falhou', 'indeterminado', 'enviando'].includes(matching.status)) {
            state = matching.status === 'indeterminado' ? 'UNCERTAIN' : matching.status === 'enviando' ? 'STARTED' : 'REVIEW';
            message = matching.erroMensagemUsuario || 'O provedor não confirmou a entrega. Confira a tentativa antes de repetir.';
          }
        } else if (ledger.length || target.channel === 'EMAIL' && ['SENT', 'ERROR', 'SENDING'].includes(guide.emailStatus)) {
          state = 'REVIEW';
          message = 'Histórico de envio preservado. Confira o destinatário e a revisão do documento; não haverá repetição automática.';
        }
        if (target.channel === 'WHATSAPP' && !channel.disponivel) message = channel.mensagem || 'Canal WhatsApp indisponível.';
        if (message && state === 'PENDING') state = 'REVIEW';
        const entry = { channel: target.channel, destinationLabel: target.destination, state, reason: message, attemptId: previous.find(a => a.destination === target.destination)?.id || null };
        channels.push(entry);
        if (state === 'PENDING') eligible.push({ guide, documentRevision, target, calendar: itemCalendar });
      }
      if (!targets.length) reason = 'Cadastre um destinatário autorizado para receber guias.';
      items.push({ guideId: guide.id, tipo: guide.parcelamentoId ? 'PARCELAMENTO' : guide.tipo, competencia: guide.competencia, vencimento: guide.vencimento,
        documentRevision, state: reason || channels.some(c => ['REVIEW', 'UNCERTAIN'].includes(c.state)) ? 'REVIEW' : channels.some(c => c.state === 'STARTED') ? 'STARTED' : channels.every(c => c.state === 'SENT') && channels.length ? 'SENT' : 'PENDING', reason, channels });
    }
    for (const item of items) if (item.reason && guides.find(g => g.id === item.guideId)?.paymentStatus !== 'PAID' && !missing.some(m => m.guideId === item.guideId)) missing.push({ obligationKey: 'documento', guideId: item.guideId, label: item.tipo, reason: item.reason });
    const prior = persisted.attempts.some(a => a.status === 'SENT');
    const advance = eligible.map(e => e.calendar?.advanceDate).filter(Boolean).sort()[0] || null;
    const decision = decidirEnvioGuias({ expectationKnown, missingCount: missing.length, availableCount: new Set(eligible.map(e => e.guide.id)).size, hasPriorDelivery: prior, calendar: { ...calendar, advanceDate: advance }, now: now() });
    const agendaValid = agenda?.enabled === true && agenda.frequency === 'DAILY' && Number.isInteger(agenda.hour) && agenda.hour >= 0 && agenda.hour <= 23;
    const enabled = config.enabled === true && agendaValid;
    const paused = automation.globalAutomationPolicy.paused || automation.automationPolicy.paused;
    const warnings = persisted.warnings.filter(w => !w.resolvedAt);
    if (!expectationKnown) warnings.push(warning('EXPECTATIVA_A_CONFERIR', 'A cobertura completa das obrigações precisa de conferência; não será declarada completa.', now()));
    return { portal, config, agenda, regimeKnown, configHash: hash(config), agendaHash: hash(agenda ?? null), destinations, channel, guides, eligible, persisted,
      dto: { ok: true, portalClientId, competencia, mesOperacional, enabled, paused, revision: persisted.revision,
        status: !enabled ? 'DISABLED' : paused ? 'PAUSED' : (persisted.attempts.some(a => ['STARTED', 'UNCERTAIN', 'REVIEW'].includes(a.status)) || items.some(item => item.channels.some(c => ['REVIEW', 'UNCERTAIN', 'STARTED'].includes(c.state)))) ? 'REVIEW' : decision.kind,
        cutoffDate: calendar.cutoffDate, calendar, expectation: { state: expectationKnown ? 'KNOWN' : 'REVIEW', requiredCount: required.length, availableCount, absenceConfirmedCount, resolvedCount, missing },
        decision, items, warnings: [...new Map(warnings.map(w => [w.id, w])).values()], lastAttempt: persisted.lastAttempt || null } };
  }
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
    const eligibleKinds = ['COMPLETE', 'PARTIAL_DEADLINE', 'PARTIAL_DUE', 'COMPLEMENT'];
    const selected = eligibleKinds.includes(snapshot.dto.decision.kind) ? snapshot.eligible.filter(e => snapshot.dto.expectation.state === 'KNOWN' && !snapshot.dto.expectation.missing.length || snapshot.dto.decision.eligibleAt >= snapshot.dto.cutoffDate || e.calendar.advanceDate && e.calendar.advanceDate <= snapshot.dto.decision.eligibleAt) : [];
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
