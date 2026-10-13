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

// Retorno observado no CONSDECLARACAO13 de produção em 13/10/2026 (sem dados de contribuinte).
const ausenciaSemDeclaracoes = { codigo: '[Aviso-PGDASD-MSG_ISN_027]', texto: 'Não há declarações transmitidas para os parâmetros informados.' };
test('negativa explícita MSG_ISN_027 com dados vazios é ausência, não resposta incompleta', () => {
  expect(detectarDeclaracaoExistente({ status: 200, dados: '', mensagens: [ausenciaSemDeclaracoes] }, pa)).toBe(false);
});
test.each([
  { status: 200, dados: JSON.stringify({ periodo }), mensagens: [ausenciaSemDeclaracoes] },
  { status: 503, dados: '', mensagens: [ausenciaSemDeclaracoes] },
  { status: 200, dados: '', mensagens: [ausenciaSemDeclaracoes, { codigo: 'Erro-PGDASD' }] },
  { status: 200, dados: '', mensagens: [{ texto: ausenciaSemDeclaracoes.texto }] },
  { status: 200, dados: '{}', mensagens: [ausenciaSemDeclaracoes] },
])('MSG_ISN_027 não libera dados contraditórios ou erro técnico %#', indice => {
  expect(() => detectarDeclaracaoExistente(indice, pa)).toThrow(expect.objectContaining({ code: 'CONSULTA_DECLARACAO_FALHOU' }));
});

test.each([undefined, 400, 404, 422])('MSG_ISN_027 exige HTTP 200, recebido %s', status => {
  expect(() => detectarDeclaracaoExistente({ status, dados: '', mensagens: [ausenciaSemDeclaracoes] }, pa)).toThrow(expect.objectContaining({ code: 'CONSULTA_DECLARACAO_FALHOU' }));
});
