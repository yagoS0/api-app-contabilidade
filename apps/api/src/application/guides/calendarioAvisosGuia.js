import { ajustarParaDiaUtil, criarConsultorDeFeriados, deISO, paraISO, ehFimDeSemana } from '../obrigacoes/diaUtil.js';

export function hojeSaoPaulo(agora = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora);
  return ['year', 'month', 'day'].map(k => p.find(x => x.type === k).value).join('-');
}

// Sem política explícita, conservar D−1/D0/D+1. O contrato novo usa dois dias úteis de cada lado.
// O PDF e sua data nominal são preservados; este calendário governa os avisos.
export const POLITICA_ACOMPANHAMENTO_GUIAS = 'D2_D0_D2_V1';

export function calendarioAvisosGuia(vencimento, feriados = [], municipio = null, politica = null) {
  if (politica !== null && politica !== POLITICA_ACOMPANHAMENTO_GUIAS) return null;
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
  const civilUTC = politica && typeof vencimento === 'string' ? vencimento.slice(0, 10) : data.toISOString().slice(0, 10);
  const convertida = deISO(civilUTC);
  if (paraISO(convertida) !== civilUTC) return null;
  const util = ajustarParaDiaUtil(convertida, 'ANTECIPAR', feriado);
  const indisponivel = dia => ehFimDeSemana(dia) || feriado(paraISO(dia));
  if (politica && indisponivel(util)) return null;
  const deslocar = sentido => {
    let dia = new Date(politica ? convertida : util);
    for (let i = 0; i < (politica ? 2 : 1); i++) {
      dia.setUTCDate(dia.getUTCDate() + sentido);
      dia = ajustarParaDiaUtil(dia, sentido < 0 ? 'ANTECIPAR' : 'POSTERGAR', feriado);
      if (politica && indisponivel(dia)) return null;
    }
    return paraISO(dia);
  };
  const antes = deslocar(-1), depois = deslocar(1);
  if (!antes || !depois) return null;
  return { vencimento: paraISO(util), antes, depois,
    ...(politica ? { politica, vencimentoNominal: civilUTC, vencimentoComunicacao: paraISO(util) } : {}) };
}

export function faseAvisoGuia(vencimento, agora, feriados = [], municipio = null, politica = null) {
  const calendario = calendarioAvisosGuia(vencimento, feriados, municipio, politica);
  const hoje = hojeSaoPaulo(agora);
  return calendario?.antes === hoje ? 'ANTES' : calendario?.vencimento === hoje ? 'NO_VENCIMENTO' : calendario?.depois === hoje ? 'DEPOIS' : null;
}
