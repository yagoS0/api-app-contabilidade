import { createHash } from 'node:crypto';
import { criarConsultorDeFeriados, ehFimDeSemana, paraISO } from '../obrigacoes/diaUtil.js';
import { hojeSaoPaulo } from './calendarioAvisosGuia.js';

const invalid = () => Object.assign(new Error('Confira as datas e os feriados do envio de guias.'), { code: 'CALENDARIO_ENVIO_INVALIDO' });

function civil(value) {
  const text = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : value;
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw invalid();
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw invalid();
  return date;
}

function anteriorUtil(date, holiday, incluir = false) {
  const result = new Date(date);
  if (!incluir) result.setUTCDate(result.getUTCDate() - 1);
  for (let i = 0; i < 366; i++) {
    if (!ehFimDeSemana(result) && !holiday(paraISO(result))) return result;
    result.setUTCDate(result.getUTCDate() - 1);
  }
  throw invalid();
}

// Calendário exclusivo do envio inicial/parcial. Não altera a agenda de lembretes.
// Datas nominais são preservadas; apenas a data operacional é antecipada.
export function calendarioEnvioGuias({ mesOperacional, vencimento = null, feriados, municipio = null }) {
  if (typeof mesOperacional !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mesOperacional) || !Array.isArray(feriados)) throw invalid();
  const normalized = feriados.map(f => {
    if (!f || !['NACIONAL', 'MUNICIPAL'].includes(f.abrangencia)) throw invalid();
    if (f.abrangencia === 'MUNICIPAL' && (typeof f.municipio !== 'string' || !f.municipio.trim())) throw invalid();
    return { data: paraISO(civil(f.data)), abrangencia: f.abrangencia, municipio: f.municipio || null };
  });
  const holiday = criarConsultorDeFeriados(normalized, municipio);
  const cutoffDate = paraISO(anteriorUtil(civil(`${mesOperacional}-13`), holiday, true));
  const nominal = vencimento === null ? null : paraISO(civil(vencimento));
  const advanceDate = nominal && nominal < cutoffDate
    ? paraISO(anteriorUtil(anteriorUtil(anteriorUtil(civil(nominal), holiday, true), holiday), holiday)) : null;
  const revision = normalized.map(f => [f.data, f.abrangencia, f.municipio]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { cutoffDate, advanceDate, vencimento: nominal, timezone: 'America/Sao_Paulo',
    holidayRevision: createHash('sha256').update(JSON.stringify([municipio, revision])).digest('hex') };
}

export function decidirEnvioGuias({ expectationKnown, missingCount, availableCount, hasPriorDelivery = false, calendar, now = new Date() }) {
  if (typeof expectationKnown !== 'boolean' || !Number.isSafeInteger(missingCount) || missingCount < 0
    || !Number.isSafeInteger(availableCount) || availableCount < 0 || !calendar) throw invalid();
  const today = hojeSaoPaulo(now);
  civil(calendar.cutoffDate);
  if (calendar.advanceDate) civil(calendar.advanceDate);
  if (!availableCount) return { kind: expectationKnown ? 'WAIT' : 'REVIEW', eligibleAt: null };
  if (expectationKnown && missingCount === 0) return { kind: hasPriorDelivery ? 'COMPLEMENT' : 'COMPLETE', eligibleAt: today };
  if (today >= calendar.cutoffDate) return { kind: hasPriorDelivery ? 'COMPLEMENT' : 'PARTIAL_DEADLINE', eligibleAt: calendar.cutoffDate };
  if (calendar.advanceDate && today >= calendar.advanceDate) return { kind: hasPriorDelivery ? 'COMPLEMENT' : 'PARTIAL_DUE', eligibleAt: calendar.advanceDate };
  return { kind: expectationKnown ? 'WAIT' : 'REVIEW', eligibleAt: calendar.advanceDate || calendar.cutoffDate };
}
