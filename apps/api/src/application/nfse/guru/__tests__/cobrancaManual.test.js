import { normalizarCobrancaManual } from '../cobrancaManual.js';

const dados = { transacaoId: 'venda-sintetica', referenciaOrigem: 'Registro manual sintético',
  valorCentavos: 12345, moeda: 'BRL', situacaoPagamento: 'DESCONHECIDO' };

test('preserva unidade monetária e desconhecimento sem inventar produto, pagamento ou nota', () => {
  expect(normalizarCobrancaManual(dados)).toEqual(dados);
});
test.each([0, -1, 1.23, '100', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('recusa centavos inválidos: %s', valorCentavos => {
  expect(() => normalizarCobrancaManual({ ...dados, valorCentavos })).toThrow('guru_valor_invalido');
});
test.each([{ api_token: 'segredo-sintetico' }, { modo: 'EMISSAO' }, { companyId: 'outra' }, { servico: {} }, { status: 'approved' }])('não aceita payload externo/fiscal/campos extras', extra => {
  expect(() => normalizarCobrancaManual({ ...dados, ...extra })).toThrow('guru_campos_invalidos');
});
test.each([{ transacaoId: '' }, { referenciaOrigem: 'x'.repeat(501) }, { transacaoId: 'a\nb' },
  { moeda: 'brl' }, { situacaoPagamento: 'PAGO' }])('recusa identidade, evidência ou estado inválido', override => {
  expect(() => normalizarCobrancaManual({ ...dados, ...override })).toThrow();
});
