// Fixtures sintéticas do formato publicado de TRANSDECLARACAO11 (saída).
// Não são recibos reais nem evidência de homologação FS12.
export const retornoTransmitido = {
  status: 200, mensagens: [], dados: JSON.stringify([{
    idDeclaracao: 'DECLARACAO-FIXTURE-001', dataHoraTransmissao: '20261020123000',
    valoresDevidos: [{ codigoTributo: 1010, valor: 60 }],
  }]),
};
export const retornoFiscal = { status: 400, mensagens: [{ codigo: 'EntradaIncorreta-PGDASD-FIXTURE', texto: 'Atividade inválida (fixture).' }], dados: null };
export const parametros = { contribuinteCnpj: '00000000000100', contratanteCnpj: '00000000000200', competencia: '2026-10',
  atividades: [{ idAtividade: 1, valorInterno: 1000 }], folhasSalario: [], receitasBrutasAnteriores: [] };
