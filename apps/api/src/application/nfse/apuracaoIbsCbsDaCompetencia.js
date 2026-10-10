import { regimeDaCompetencia, diaFiscal } from './regimeDaCompetencia.js';
export function apuracaoIbsCbsDaCompetencia({ company, competencia, regime }) {
  const dia = diaFiscal(typeof competencia === 'string' && /^\d{4}-\d{2}$/.test(competencia) ? competencia + '-01' : competencia);
  if (dia && dia < '2027-01-01') return { ok: true, aplicavel: false };
  if (!['SIMPLES', 'SIMPLES_NACIONAL'].includes(regime)) return { ok: true, aplicavel: false };
  const historico = regimeDaCompetencia({ historico: company?.regimeHistorico, competencia });
  if (!historico.ok) return historico;
  if (!historico.apuracaoIbsCbs) return { ok: false, codigo: 'NFSE_IBSCBS_OPCAO_PENDENTE', message: 'Confirme a apuração de IBS/CBS no histórico: dentro do DAS ou regime regular (Simples híbrido).' };
  return { ok: true, aplicavel: true, apuracao: historico.apuracaoIbsCbs,
    regApIBSCBSSN: historico.apuracaoIbsCbs === 'REGULAR' ? '3' : '1',
    vigenciaInicio: historico.vigenciaInicio, vigenciaFim: historico.vigenciaFim };
}
