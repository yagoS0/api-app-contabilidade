import { ajustarParaDiaUtil, criarConsultorDeFeriados, deISO, paraISO } from '../obrigacoes/diaUtil.js';

export function hojeSaoPaulo(agora = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora);
  return ['year', 'month', 'day'].map(k => p.find(x => x.type === k).value).join('-');
}

// Regra solicitada pelo escritório: antecipar vencimentos não úteis e contar um dia ÚTIL em cada lado.
// O PDF e sua data nominal são preservados; este calendário governa os avisos.
export function calendarioAvisosGuia(vencimento, feriados = [], municipio = null) {
  // Datas civis/ISO e Date do Prisma: rejeitar coerção e rollover (ex.: 30/02).
  if (!(vencimento instanceof Date) && (typeof vencimento !== 'string'
    || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(vencimento))) return null;
  const data = new Date(vencimento);
  if (!Number.isFinite(data.getTime())) return null;
  if (typeof vencimento === 'string') {
    const civil = vencimento.slice(0, 10);
    const verificada = new Date(`${civil}T00:00:00.000Z`);
    if (!Number.isFinite(verificada.getTime()) || verificada.toISOString().slice(0, 10) !== civil) return null;
  }
  const feriado = criarConsultorDeFeriados(feriados, municipio);
  const civilUTC = data.toISOString().slice(0, 10);
  const convertida = deISO(civilUTC);
  if (paraISO(convertida) !== civilUTC) return null;
  const util = ajustarParaDiaUtil(convertida, 'ANTECIPAR', feriado);
  const anterior = new Date(util); anterior.setUTCDate(anterior.getUTCDate() - 1);
  const posterior = new Date(util); posterior.setUTCDate(posterior.getUTCDate() + 1);
  return { vencimento: paraISO(util), antes: paraISO(ajustarParaDiaUtil(anterior, 'ANTECIPAR', feriado)), depois: paraISO(ajustarParaDiaUtil(posterior, 'POSTERGAR', feriado)) };
}

export function faseAvisoGuia(vencimento, agora, feriados = [], municipio = null) {
  const calendario = calendarioAvisosGuia(vencimento, feriados, municipio);
  const hoje = hojeSaoPaulo(agora);
  return calendario?.antes === hoje ? 'ANTES' : calendario?.vencimento === hoje ? 'NO_VENCIMENTO' : calendario?.depois === hoje ? 'DEPOIS' : null;
}
