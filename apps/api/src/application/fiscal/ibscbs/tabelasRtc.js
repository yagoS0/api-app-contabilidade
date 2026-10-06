import { TABELAS_RTC } from './tabelasRtc.data.js';

export { TABELAS_RTC };
const csts = new Map(TABELAS_RTC.csts.map(r => [r.codigo, r]));
const classes = new Map(TABELAS_RTC.classificacoes.map(r => [r.codigo, r]));
const operacoes = new Set(TABELAS_RTC.operacoes.map(r => r.codigo));

export function classificacaoRtc(codigo) {
  return classes.get(codigo) || null;
}

// Valida o domínio publicado, não o direito a um benefício fiscal.
// O Anexo VIII orienta a escolha, mas não restringe estas tabelas.
// No cadastro, campos ausentes podem ser completados depois; o pré-voo exige os três.
export function validarCodigosRtc({ cIndOp, cst, cClassTrib, competencia }) {
  const erros = [];
  const erro = (campo, codigo, motivo) => erros.push({ campo, codigo, motivo });
  if (cIndOp && !operacoes.has(cIndOp)) {
    erro('ibscbsCIndOp', 'NFSE_IBSCBS_INDOP_INVALIDO', 'O indicador da operação não consta no Anexo C v1.01 da NFS-e Nacional.');
  }
  if (cst && !csts.has(cst)) {
    erro('ibscbsCst', 'NFSE_IBSCBS_CST_INVALIDO', 'O CST não consta na tabela oficial de IBS/CBS versionada no sistema.');
  }
  const classe = classes.get(cClassTrib);
  if (cClassTrib && !classe) {
    erro('ibscbsCClassTrib', 'NFSE_IBSCBS_CLASSIFICACAO_INVALIDA', 'A classificação tributária não consta na tabela oficial de IBS/CBS versionada no sistema.');
  } else if (classe) {
    if (!classe.nfse) erro('ibscbsCClassTrib', 'NFSE_IBSCBS_CLASSIFICACAO_NAO_NFSE', 'A classificação tributária não permite NFS-e na tabela oficial (indNfse).');
    if (cst && csts.has(cst) && classe.cst !== cst) {
      erro('ibscbsCst', 'NFSE_IBSCBS_CST_INCOMPATIVEL', `A classificação ${cClassTrib} corresponde ao CST ${classe.cst} na tabela oficial.`);
    }
  }
  // Cadastro sem competência não usa a data do servidor para rejeitar um perfil histórico.
  // O snapshot contém a vigência publicada, não um histórico completo de revisões da tabela.
  if (competencia) {
    const dia = competencia instanceof Date ? competencia.toISOString().slice(0, 10) : String(competencia).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
      for (const [campo, linha] of [['ibscbsCst', csts.get(cst)], ['ibscbsCClassTrib', classe]]) {
        if (linha && ((linha.inicio && dia < linha.inicio) || (linha.fim && dia > linha.fim))) {
          erro(campo, 'NFSE_IBSCBS_FORA_VIGENCIA', `O código ${linha.codigo} está fora da vigência publicada para a competência ${dia}.`);
        }
      }
    }
  }
  return erros;
}
