import { diaFiscal } from './regimeDaCompetencia.js';
import { BASES_PARAMETROS, caminhoParametros } from './parametrosMunicipaisClient.js';

const dia = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v) ? diaFiscal(v.slice(0, 10)) : null;
// ResultadoConsultaAliquotas, o mesmo contrato usado pela conferência do contador.
// Uma alíquota não comprova convênio, deduções ou cadastro histórico do contribuinte.
export function parametrosMunicipaisDaCompetencia({ consultas = [], companyId, ambiente, municipio, codigoServico, competencia }) {
  const pendente = codigo => ({ estado: 'PENDENTE', pendencias: [codigo], validacaoMunicipalCompleta: false });
  if (!diaFiscal(competencia) || !companyId || !BASES_PARAMETROS[ambiente] || !/^\d{7}$/.test(municipio || '') || !/^\d{9}$/.test(codigoServico || '')) return pendente('PARAMETROS_ESCOPO_INVALIDO');
  const caminho = caminhoParametros({ municipio, codigoServico, recurso: 'servico' });
  const registros = consultas.filter(r => r.companyId === companyId && r.ambiente === ambiente && r.municipio === municipio
    && r.codigoServico === codigoServico && r.recurso === 'servico' && r.caminho === caminho
    && r.origem === BASES_PARAMETROS[ambiente] && r.status === 'RECEBIDO_PARA_CONFERENCIA' && r.httpStatus === 200);
  if (!registros.length) return pendente('PARAMETROS_MUNICIPAIS_POR_COMPETENCIA');
  const candidatos = [];
  for (const r of registros) {
    const chave = codigoServico.replace(/^(..)(..)(..)(...)$/, '$1.$2.$3.$4');
    const lista = r.resposta?.aliquotas?.[chave];
    if (!Array.isArray(lista) || !lista.length) return pendente('PARAMETROS_CONTRATO_NAO_RECONHECIDO');
    const vigentes = [];
    for (const v of lista) {
      const inicio = dia(v?.DtIni), fim = v?.DtFim == null ? null : dia(v.DtFim);
      if (!inicio || (v.DtFim != null && !fim) || (fim && fim < inicio)) return pendente('PARAMETROS_VIGENCIA_INVALIDA');
      if (inicio <= competencia && (!fim || fim >= competencia)) vigentes.push({ v, inicio, fim });
    }
    if (vigentes.length > 1) return pendente('PARAMETROS_VIGENCIA_AMBIGUA');
    if (vigentes.length) candidatos.push({ ...vigentes[0], referencia: r.id });
  }
  if (!candidatos.length) return pendente('PARAMETROS_SEM_VIGENCIA');
  const primeiro = candidatos[0];
  if (candidatos.some(c => JSON.stringify([c.v.Aliq,c.v.Incidencia,c.inicio,c.fim]) !== JSON.stringify([primeiro.v.Aliq,primeiro.v.Incidencia,primeiro.inicio,primeiro.fim]))) return pendente('PARAMETROS_RESPOSTAS_DIVERGENTES');
  if (typeof primeiro.v.Aliq !== 'number' || !Number.isFinite(primeiro.v.Aliq) || primeiro.v.Aliq < 0 || primeiro.v.Aliq > 100 || typeof primeiro.v.Incidencia !== 'string') return pendente('PARAMETROS_CONTRATO_NAO_RECONHECIDO');
  return { estado: 'HISTORICO_LOCALIZADO', fonte: 'ADN', referencias: candidatos.map(c => c.referencia), competencia,
    municipio, codigoServico, ambiente, aliquotaIss: primeiro.v.Aliq, incidencia: primeiro.v.Incidencia,
    vigenciaInicio: primeiro.inicio, vigenciaFim: primeiro.fim,
    pendencias: ['CONVENIO_POR_COMPETENCIA', 'ADMISSAO_AJUSTES_POR_COMPETENCIA'], validacaoMunicipalCompleta: false };
}
