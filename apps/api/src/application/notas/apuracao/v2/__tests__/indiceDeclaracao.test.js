import { detectarDeclaracaoExistente } from '../FechamentoService.js';

// Fixtures sintéticas no contrato oficial CONSDECLARACAO13 (consultado em 13/10/2026).
// https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-sn/pgdasd/servicos/consultar_declaracao_por_ano_pa/
const pa = '2026-09';
const periodo = { periodoApuracao: 202609, operacoes: [{ tipoOperacao: 'Original', indiceDeclaracao: { numeroDeclaracao: '00000000202609001' } }] };
const ausencia = { codigo: '[EntradaIncorreta-PGDASD-MSG_ISN_005]', texto: 'Não há declaração transmitida para o período informado.' };
const resposta = dados => ({ status: 200, dados: JSON.stringify(dados), mensagens: [{ codigo: 'Sucesso-PGDASD' }] });

test.each([
  { anoCalendario: 2026, periodo },
  { anoCalendario: 2026, periodos: [{ ...periodo, periodoApuracao: 202608 }, periodo] },
])('reconhece declaração na competência pelo contrato oficial: %j', dados => {
  expect(detectarDeclaracaoExistente(resposta(dados), pa)).toBe(true);
});

test.each([
  {}, { periodo: {} }, { periodo: { ...periodo, periodoApuracao: 202608 } },
  { anoCalendario: 2025, periodo }, { periodos: [] }, { periodos: [periodo, periodo] },
  { periodo: { ...periodo, operacoes: [] } },
  { periodo: { ...periodo, operacoes: [{ tipoOperacao: 'Geração de DAS', indiceDeclaracao: null, indiceDas: { numeroDas: '1' } }] } },
  { declaracoes: [{ numeroDeclaracao: 'D1', periodoApuracao: 202608 }] },
])('não autoriza transmissão por estrutura incompleta ou período alheio: %j', dados => {
  expect(() => detectarDeclaracaoExistente(resposta(dados), pa)).toThrow(expect.objectContaining({ code: 'CONSULTA_DECLARACAO_FALHOU' }));
});

test('negativa exige código oficial exato e dados vazios', () => {
  expect(detectarDeclaracaoExistente({ status: 200, dados: '', mensagens: [ausencia] }, pa)).toBe(false);
  expect(detectarDeclaracaoExistente({ status: 400, dados: null, mensagens: [ausencia] }, pa)).toBe(false);
});

test.each([
  { dados: '{}', mensagens: [ausencia] },
  { dados: '', mensagens: [{ texto: ausencia.texto }] },
  { dados: '', mensagens: [ausencia, { codigo: 'Erro-PGDASD-MSG_ISN_001' }] },
  { dados: '', mensagens: [ausencia], status: 500 },
  { ...resposta({ periodo }), mensagens: [ausencia] },
  { ...resposta({ periodo }), status: 503 },
  { dados: 'inválido', mensagens: [] },
])('recusa mensagem ambígua, negativa contraditória e falha técnica: %j', indice => {
  expect(() => detectarDeclaracaoExistente(indice, pa)).toThrow(expect.objectContaining({ code: 'CONSULTA_DECLARACAO_FALHOU' }));
});
