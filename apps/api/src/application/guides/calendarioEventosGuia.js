import { ajustarParaDiaUtil, criarConsultorDeFeriados, deISO, paraISO, ehFimDeSemana } from '../obrigacoes/diaUtil.js';
import { resolverAgendaTributo, MAX_DIAS_UTEIS } from '../fiscal/serpro/AgendaEventosPolicy.js';
import { resolverTributosDaGuia } from './tributosDaGuia.js';

export const FUSO_EVENTOS_GUIA = 'America/Sao_Paulo';
const falha = motivo => ({ status: 'A_CONFERIR', motivo, eventos: [] });
const horaValida = hora => Number.isInteger(hora) && hora >= 0 && hora <= 23;
function civil(value) {
  // Date Prisma represents the document's stored civil UTC date, not today's timezone.
  const iso = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : value;
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const data = deISO(iso);
  return Number.isFinite(data.getTime()) && paraISO(data) === iso ? iso : null;
}
const calendarioValido = (feriados, municipio) => Array.isArray(feriados)
  && typeof municipio === 'string' && Boolean(municipio.trim())
  && feriados.every(f => f && ['NACIONAL', 'MUNICIPAL'].includes(f.abrangencia)
    && civil(f.data) && (f.abrangencia !== 'MUNICIPAL' || typeof f.municipio === 'string' && Boolean(f.municipio.trim())));

// Only the existing Guide source is supported. No accessory deadline or day-20 fallback.
// Future validated rules/authorized settings need their own evidence adapter first.
export function referenciaVencimentoGuia(guia, revisao) {
  const dataCivil = civil(guia?.vencimento);
  if (!guia?.id || !guia.portalClientId || !guia.hash || guia.status !== 'PROCESSED'
    || typeof revisao !== 'string' || !revisao || !/^\d{4}-(0[1-9]|1[0-2])$/.test(guia.competencia || '') || !dataCivil) return null;
  return { origem: 'DOCUMENTO', guideId: guia.id, companyId: guia.portalClientId,
    competencia: guia.competencia, revisao, hash: guia.hash, dataCivil,
    parcelaId: guia.parcela?.id || null, parcelamentoId: guia.parcelamentoId || null };
}

function deslocar(dataCivil, quantidade, feriado) {
  let dia = deISO(dataCivil);
  const sentido = Math.sign(quantidade);
  for (let i = 0; i < Math.abs(quantidade); i++) {
    dia.setUTCDate(dia.getUTCDate() + sentido);
    dia = ajustarParaDiaUtil(dia, sentido < 0 ? 'ANTECIPAR' : 'POSTERGAR', feriado);
    if (ehFimDeSemana(dia) || feriado(paraISO(dia))) return null;
  }
  return paraISO(dia);
}

/** Pure preview. Events are NOT authorization, claims, timestamps or provider calls.
 * estado is supplied from existing payment/recalculation guards, never browser input.
 * Payment hour comes from its separate authorized schedule, not the after reminder.
 */
export function calendarioEventosGuia({ guia, revisao, globalPolicy, companyPolicy,
  feriados, municipio, estado, horaConsultaPagamento } = {}) {
  const referencia = referenciaVencimentoGuia(guia, revisao);
  if (!referencia) return falha('VENCIMENTO_DOCUMENTAL_A_CONFERIR');
  if (!calendarioValido(feriados, municipio)) return falha('CALENDARIO_A_CONFERIR');
  if (typeof estado?.pagamentoConfirmado !== 'boolean' || typeof estado?.recalculada !== 'boolean'
    || typeof estado?.documentoVigente !== 'boolean') return falha('ESTADO_GUIA_A_CONFERIR');
  if (estado.pagamentoConfirmado) return { status: 'ENCERRADO', referencia, eventos: [] };
  if (!estado.documentoVigente) return falha('DOCUMENTO_SUBSTITUIDO');
  const composicao = resolverTributosDaGuia(guia);
  if (composicao.status !== 'IDENTIFIED') return { ...falha('COMPOSICAO_A_CONFERIR'), referencia, composicao };
  const feriado = criarConsultorDeFeriados(feriados, municipio);
  const d0 = ajustarParaDiaUtil(deISO(referencia.dataCivil), 'ANTECIPAR', feriado);
  if (ehFimDeSemana(d0) || feriado(paraISO(d0))) return falha('CALENDARIO_A_CONFERIR');
  let politicas;
  try { politicas = composicao.tributos.map(t => resolverAgendaTributo(globalPolicy, companyPolicy, t)); }
  catch { return falha('CONFIGURACAO_A_CONFERIR'); }
  const eventos = [], pendencias = [];
  for (const [marco, fase, sentido] of [['before', 'ANTES', -1], ['onDue', 'NO_VENCIMENTO', 0], ['after', 'DEPOIS', 1]]) {
    const ativos = politicas.filter(p => p.participation[`lembretes.${marco}`].enabled);
    if (!ativos.length) continue;
    if (ativos.some(p => !p.participation[`lembretes.${marco}`].complete)) {
      pendencias.push({ fase, motivo: 'CONFIGURACAO_INCOMPLETA' }); continue;
    }
    const candidatos = ativos.map(p => {
      const config = p.parameters.lembretes[marco];
      const dataCivil = sentido ? deslocar(referencia.dataCivil, sentido * config.businessDays, feriado) : paraISO(d0);
      return { tributo: p.tributo, dataCivil, hour: config.hour };
    });
    if (candidatos.some(c => !c.dataCivil)) { pendencias.push({ fase, motivo: 'CALENDARIO_A_CONFERIR' }); continue; }
    candidatos.sort((a, b) => a.dataCivil.localeCompare(b.dataCivil) || a.hour - b.hour || a.tributo.localeCompare(b.tributo));
    eventos.push({ tipo: 'LEMBRETE', fase, dataCivil: candidatos[0].dataCivil, hour: candidatos[0].hour,
      timezone: FUSO_EVENTOS_GUIA, tributosParticipantes: ativos.map(p => p.tributo).sort(), referencia });
  }
  // Recalculation suppresses the fiscal query, not reminders for the current document.
  // Existing claims/revision checks still prevent replay of a previously sent phase.
  if (!estado.recalculada) {
    const pagamento = deslocar(referencia.dataCivil, 2, feriado);
    if (pagamento && horaValida(horaConsultaPagamento)) eventos.push({ tipo: 'CONSULTA_PAGAMENTO', fase: 'PAGAMENTO_D2',
      dataCivil: pagamento, hour: horaConsultaPagamento, timezone: FUSO_EVENTOS_GUIA, referencia });
    else pendencias.push({ fase: 'PAGAMENTO_D2', motivo: pagamento ? 'HORARIO_CONSULTA_A_CONFERIR' : 'CALENDARIO_A_CONFERIR' });
  }
  return { status: pendencias.length ? 'PARCIAL' : 'PREVIA', referencia, composicao, eventos, pendencias };
}

// Independent capture preview only; callers still need a validated family/capability and claim.
export function dataCapturaGuia({ referencia, businessDaysBefore, hour, feriados, municipio } = {}) {
  if (referencia?.origem !== 'DOCUMENTO' || !referencia.guideId || !referencia.companyId || !referencia.revisao
    || !referencia.hash || !civil(referencia.dataCivil) || !calendarioValido(feriados, municipio)
    || !Number.isInteger(businessDaysBefore) || businessDaysBefore < 1 || businessDaysBefore > MAX_DIAS_UTEIS || !horaValida(hour)) return null;
  const dataCivil = deslocar(referencia.dataCivil, -businessDaysBefore, criarConsultorDeFeriados(feriados, municipio));
  return dataCivil ? { dataCivil, hour, timezone: FUSO_EVENTOS_GUIA } : null;
}

// First minute only, matching routineSchedule's <60000ms window; no catch-up.
export function eventoNaHora(evento, instante) {
  if (!evento || evento.timezone !== FUSO_EVENTOS_GUIA || !civil(evento.dataCivil) || !horaValida(evento.hour)
    || !(instante instanceof Date) || !Number.isFinite(instante.getTime())) return false;
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_EVENTOS_GUIA,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instante);
  const parte = tipo => partes.find(p => p.type === tipo)?.value;
  return evento.dataCivil === ['year', 'month', 'day'].map(parte).join('-')
    && evento.hour === Number(parte('hour')) && Number(parte('minute')) === 0;
}
