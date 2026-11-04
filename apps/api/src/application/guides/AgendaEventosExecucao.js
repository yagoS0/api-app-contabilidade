import { conferirVigenciaDocumentoAcompanhamento } from './VigenciaDocumentoAcompanhamento.js';
import { createHash } from 'node:crypto';
import { lerAgendaEventosEmpresa } from '../fiscal/serpro/AgendaEventosService.js';
import { calendarioEventosGuia, eventoNaHora } from './calendarioEventosGuia.js';
import { versaoPagamentoGuia } from './ConfirmacaoPagamentoClienteService.js';
import { lerRegistroRecalculo } from './RegistroRecalculoGuia.js';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail = code => { throw Object.assign(new Error('Confira a agenda relativa, habilitações e documento.'), { code }); };
// Snapshot contains parameters, adoption and existing selections. No writes or network.
export async function prepararEventosAcompanhamento(db, guia, agora) {
  const state = await db.$transaction(async tx => ({
    vigencia: await conferirVigenciaDocumentoAcompanhamento(tx, guia),
    policy: await lerAgendaEventosEmpresa(tx, guia.portalClientId),
    tracking: (await tx.appSetting.findUnique({ where: { key: `acompanhamento_guias_config:${guia.portalClientId}` } }))?.value,
    agenda: (await tx.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } }))?.value?.rotinas?.avisos_guias_whatsapp,
    rotina: await tx.companyRotina.findUnique({ where: { portalClientId_rotina: { portalClientId: guia.portalClientId, rotina: 'avisos_guias_whatsapp' } } }),
    feriados: await tx.feriado.findMany({ orderBy: { id: 'asc' } }),
  }), { isolationLevel: 'RepeatableRead' });
  if (state.policy.executionMode !== 'RELATIVO_V1' || !state.policy.relativeConsumerReady) fail('EVENT_MODE_CHANGED');
  if (!state.agenda?.enabled || !state.rotina?.enabled || !state.tracking?.enabled
    || state.tracking.politica !== 'D2_D0_D2_V1') fail('ACOMPANHAMENTO_DESLIGADO');
  if (!state.vigencia.vigente) fail(state.vigencia.reason);
  const calendar = calendarioEventosGuia({ guia, revisao: versaoPagamentoGuia(guia),
    globalPolicy: { schemaVersion: 1, tributos: state.policy.effective }, companyPolicy: { schemaVersion: 1 },
    feriados: state.feriados, municipio: guia.portalClient?.municipio,
    estado: { documentoVigente: state.vigencia.vigente,
      pagamentoConfirmado: Boolean(guia.baixada || guia.clienteConfirmouEm || guia.paymentConfirmedAt || guia.paymentStatus === 'PAID'), recalculada: Boolean(lerRegistroRecalculo(guia)) },
    horaConsultaPagamento: state.agenda.hour });
  if (!['PREVIA','PARCIAL','ENCERRADO'].includes(calendar.status)) fail('EVENT_CALENDAR_INVALID');
  return { fingerprint: hash(state), calendar, events: (calendar.eventos || []).filter(e => eventoNaHora(e, agora)),
    mode: state.policy.executionMode };
}
export async function conferirEventoAcompanhamento(db, guia, agora, expected) {
  const current = await prepararEventosAcompanhamento(db, guia, agora);
  if (current.fingerprint !== expected.fingerprint) fail('CONFIGURACAO_ALTERADA');
  const event = current.events.find(e => e.tipo === expected.tipo && e.fase === expected.fase);
  if (!event) fail('FORA_DO_DIA_DO_AVISO');
  return event;
}
