import { createHash, randomUUID } from 'node:crypto';
import { versaoPagamentoGuia } from '../guides/ConfirmacaoPagamentoClienteService.js';
import { exigir, texto } from './solicitacoesPolicy.js';
import { hash, json } from './solicitacoesProjection.js';
import { mensagemNoSegmento } from './solicitacoesEscopoWhatsapp.js';
import { SolicitacoesRepository } from './SolicitacoesRepository.js';

const SISTEMA = 'WHATSAPP_SUPORTE';
export const ORIGENS_SUPORTE = Object.freeze(['HANDOFF_MENSAGEM', 'RECALCULO_GUIA', 'DOCUMENTO_INDISPONIVEL']);

export function chaveOrigemRecalculo(guia, manual = false) {
  const identidade = [guia.portalClientId, guia.id, guia.hash || null, guia.vencimento];
  if (manual) identidade.push(versaoPagamentoGuia(guia));
  return 'recalculo_whatsapp:' + createHash('sha256').update(JSON.stringify(identidade)).digest('hex');
}

// Pass only to the existing handoff owner. Its transaction now retries DB-only
// serialization/uniqueness races; aoEncaminhar still receives that same tx.
export function clienteHandoffSuporte(client) {
  const repository = new SolicitacoesRepository(client);
  return new Proxy(client, { get(target, property) {
    return property === '$transaction' ? work => repository.transacao(work) : Reflect.get(target, property);
  } });
}

// Internal adapter only. The handoff owns the transaction (including pause and
// reservation); this function neither opens a transaction nor performs transport.
export async function registrarOrigemWhatsapp({ client: tx, conversaId, mensagemId, origem = { tipo: 'HANDOFF_MENSAGEM' }, motivo, agora }) {
  exigir(ORIGENS_SUPORTE.includes(origem?.tipo), 'origem_suporte_invalida');
  const conversa = await tx.conversaWhatsapp.findUnique({ where: { id: texto(conversaId, 'conversa') } });
  const mensagem = await tx.mensagemWhatsapp.findUnique({ where: { id: texto(mensagemId, 'mensagem') }, include: { contexto: true } });
  exigir(conversa && !conversa.excluidaEm && conversa.portalClientId && !String(conversa.chaveEscopo).startsWith('legado:'), 'origem_conversa_invalida', 409);
  exigir(mensagem?.direcao === 'in' && mensagemNoSegmento(mensagem, conversa), 'origem_mensagem_invalida', 409);
  let identidade = { tipo: origem.tipo, conversaId, mensagemId, portalClientId: conversa.portalClientId };
  if (origem.tipo === 'RECALCULO_GUIA') {
    const guideId = texto(origem.guideId, 'guia');
    const guia = await tx.guide.findFirst({ where: { id: guideId, portalClientId: conversa.portalClientId } });
    exigir(guia, 'origem_guia_invalida', 409);
    const chave = texto(origem.chave, 'origem_chave');
    exigir(/^recalculo_whatsapp:[a-f0-9]{64}$/.test(chave), 'origem_chave_invalida');
    if (chave === chaveOrigemRecalculo(guia, true)) {
      exigir(guia.status === 'PROCESSED' && guia.liberadaCliente && !guia.baixada && !guia.clienteConfirmouEm && guia.paymentStatus !== 'PAID', 'origem_guia_alterada', 409);
    } else {
      // A failed automatic recalculation can already have changed the PDF. Its
      // persisted reservation proves the old revision; current text proves none.
      const reserva = (await tx.appSetting.findUnique({ where: { key: chave } }))?.value;
      exigir(reserva?.status === 'CONFERENCIA_NECESSARIA' && reserva.guideId === guideId
        && reserva.companyId === conversa.portalClientId && reserva.mensagemId === mensagemId
        && Object.hasOwn(reserva, 'hash') && reserva.vencimento && reserva.versaoPagamento
        && chaveOrigemRecalculo({ id: guideId, portalClientId: reserva.companyId, hash: reserva.hash, vencimento: reserva.vencimento }) === chave,
      'origem_revisao_nao_comprovada', 409);
    }
    identidade = { tipo: origem.tipo, conversaId, portalClientId: conversa.portalClientId, guideId, chave };
  } else if (origem.tipo === 'DOCUMENTO_INDISPONIVEL') {
    // A missing document is the reason for the handoff, not proof of its contents.
    identidade.documentId = texto(origem.documentId, 'documento');
  }
  const chave = hash(identidade);
  const fingerprint = hash({ sistema: SISTEMA, identidade });
  const anterior = await tx.solicitacaoComando.findUnique({ where: { sistemaId_chave: { sistemaId: SISTEMA, chave } } });
  if (anterior) {
    exigir(anterior.fingerprint === fingerprint, 'origem_divergente', 409);
    const existente = await tx.encaminhamentoSuporte.findUnique({ where: { id: anterior.solicitacaoId } });
    exigir(existente?.conversaId === conversaId && existente.portalClientId === conversa.portalClientId, 'origem_alterada', 409);
    const vinculos = await tx.solicitacaoMensagem.findMany({ where: { solicitacaoId: existente.id } });
    for (const id of new Set([existente.mensagemId, ...vinculos.map(v => v.mensagemId)].filter(Boolean))) {
      const original = await tx.mensagemWhatsapp.findUnique({ where: { id }, include: { contexto: true } });
      exigir(mensagemNoSegmento(original, conversa), 'origem_alterada', 409);
    }
    return existente;
  }
  const ancora = await tx.encaminhamentoSuporte.findUnique({ where: { mensagemId } });
  const row = await tx.encaminhamentoSuporte.create({ data: {
    id: randomUUID(), conversaId, mensagemId: ancora ? null : mensagemId, portalClientId: conversa.portalClientId,
    contratoVersao: 1, revisao: 1, estado: 'AGUARDANDO', origem: origem.tipo, origemDados: identidade,
    titulo: texto(motivo, 'motivo', 500).slice(0, 200), motivo,
    resumo: String(mensagem.corpo || 'Mensagem sem texto').slice(0, 1500), createdAt: agora, updatedAt: agora,
  } });
  await tx.solicitacaoMensagem.create({ data: { solicitacaoId: row.id, mensagemId, sistemaId: SISTEMA, createdAt: agora } });
  await tx.solicitacaoEvento.create({ data: { id: randomUUID(), solicitacaoId: row.id, revisao: 1, tipo: 'CRIADA', sistemaId: SISTEMA, ocorridoEm: agora, depois: json(row) } });
  await tx.solicitacaoComando.create({ data: { id: randomUUID(), sistemaId: SISTEMA, chave, fingerprint, solicitacaoId: row.id, resultado: json(row), createdAt: agora } });
  await tx.eventoPushAtendimento.create({ data: { id: `suporte:${row.id}`, conversaId, tipo: 'SUPORTE', createdAt: agora, expiraEm: new Date(agora.getTime() + 2 * 3600000) } });
  return row;
}
