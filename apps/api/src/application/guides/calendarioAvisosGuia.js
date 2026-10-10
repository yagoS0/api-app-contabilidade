import { ajustarParaDiaUtil, criarConsultorDeFeriados, deISO, paraISO } from '../obrigacoes/diaUtil.js';

export function hojeSaoPaulo(agora = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora);
  return ['year', 'month', 'day'].map(k => p.find(x => x.type === k).value).join('-');
}

// Regra solicitada pelo escritório: antecipar vencimentos não úteis e contar um dia ÚTIL em cada lado.
// O PDF e sua data nominal são preservados; este calendário governa os avisos.
export function calendarioAvisosGuia(vencimento, feriados = [], municipio = null) {
  if (!vencimento || !Number.isFinite(new Date(vencimento).getTime())) return null;
  const feriado = criarConsultorDeFeriados(feriados, municipio);
  const util = ajustarParaDiaUtil(deISO(new Date(vencimento).toISOString().slice(0, 10)), 'ANTECIPAR', feriado);
  const anterior = new Date(util); anterior.setUTCDate(anterior.getUTCDate() - 1);
  const posterior = new Date(util); posterior.setUTCDate(posterior.getUTCDate() + 1);
  return { vencimento: paraISO(util), antes: paraISO(ajustarParaDiaUtil(anterior, 'ANTECIPAR', feriado)), depois: paraISO(ajustarParaDiaUtil(posterior, 'POSTERGAR', feriado)) };
}

export function faseAvisoGuia(vencimento, agora, feriados = [], municipio = null) {
  const calendario = calendarioAvisosGuia(vencimento, feriados, municipio);
  const hoje = hojeSaoPaulo(agora);
  return calendario?.antes === hoje ? 'ANTES' : calendario?.depois === hoje ? 'DEPOIS' : null;
}
