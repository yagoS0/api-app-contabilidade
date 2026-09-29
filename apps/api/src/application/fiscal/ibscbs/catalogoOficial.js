import classificacao from './classificacaoTributaria.data.js';
import indicadores from './indicadoresOperacao.data.js';

// O Anexo VIII sugere correlações. A existência, vigência e aplicabilidade dos
// códigos são conferidas nas tabelas oficiais próprias, sem inferir benefícios.
export const CATALOGO_IBSCBS = Object.freeze({
  versao: classificacao.versao,
  fonte: classificacao.fonte,
  sha256: classificacao.sha256,
  indicadoresVersao: indicadores.versao,
  indicadoresFonte: indicadores.fonte,
  indicadoresSha256: indicadores.sha256,
});
const csts = new Map(classificacao.csts.map(c => [c.Cst, c]));
const classes = new Map(classificacao.classificacoes.map(c => [c.CodClassTrib, c]));
const operacoes = new Set(indicadores.operacoes.map(c => c.codigo));
const dia = v => String(v ?? '').slice(0, 10);
const vigente = (item, data) => (!item.DthIniVig || dia(item.DthIniVig) <= data)
  && (!item.DthFimVig || dia(item.DthFimVig) >= data);

export function classificacaoPorCodigo(codigo) { return classes.get(codigo) ?? null; }

export function validarCodigosIbscbs({ cst, cClassTrib, cIndOp, documento = 'NFSE', dataReferencia = new Date().toISOString().slice(0, 10) }) {
  const erros = [];
  const data = dia(dataReferencia instanceof Date ? (Number.isNaN(dataReferencia.getTime()) ? '' : dataReferencia.toISOString()) : dataReferencia);
  const instante = Date.parse(`${data}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || Number.isNaN(instante) || new Date(instante).toISOString().slice(0,10) !== data) {
    return [{ campo: 'dataReferencia', codigo: 'NFSE_IBSCBS_DATA_INVALIDA', motivo: 'Informe uma data válida para conferir a vigência dos códigos IBS/CBS.' }];
  }
  const situacao = csts.get(cst);
  const classe = classes.get(cClassTrib);
  if (!situacao || !vigente(situacao, data)) erros.push({ campo: 'ibscbsCst', codigo: 'NFSE_IBSCBS_CST_INVALIDO', motivo: `CST IBS/CBS ${cst ?? ''} inexistente ou fora da vigência na tabela oficial.` });
  if (!classe || !vigente(classe, data)) erros.push({ campo: 'ibscbsCClassTrib', codigo: 'NFSE_IBSCBS_CLASSIFICACAO_INVALIDA', motivo: `Classificação IBS/CBS ${cClassTrib ?? ''} inexistente ou fora da vigência na tabela oficial.` });
  else {
    if (classe.Cst !== cst) erros.push({ campo: 'ibscbsCst', codigo: 'NFSE_IBSCBS_CST_DIVERGENTE', motivo: `A classificação ${cClassTrib} pertence ao CST ${classe.Cst}.` });
    const atributoDocumento = { NFSE: 'IndNfse', NFE: 'IndNfe', NFCE: 'IndNfce' }[documento];
    if (!atributoDocumento || classe[atributoDocumento] !== true) erros.push({ campo: 'ibscbsCClassTrib', codigo: 'NFSE_IBSCBS_DOCUMENTO_INCOMPATIVEL', motivo: `A tabela oficial não permite a classificação ${cClassTrib} para ${documento}.` });
  }
  if (documento === 'NFSE' && !operacoes.has(cIndOp)) erros.push({ campo: 'ibscbsCIndOp', codigo: 'NFSE_IBSCBS_OPERACAO_INVALIDA', motivo: `Indicador ${cIndOp ?? ''} não consta no Anexo C de produção da NFS-e.` });
  return erros;
}
