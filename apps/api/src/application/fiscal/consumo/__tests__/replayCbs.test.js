import { inspecionarArquivoCbs, lerJsonExato, reprocessarArquivoCbs } from '../ReplayCbsService.js';
const identidade = { cnpjBase: '12345678', ticket: 'abc', recurso: 'DEBITOS' };
const raw = valor => Buffer.from(`{"ni":"12345678","tiqueteSolicitacao":"abc","geradoEm":"2026-10-12T00:00:00Z","apuracao":[{"pa":"10/2026","debitos":[{"cbs":{"apurado":${valor},"saldoDevedor":0}}]}]}`);

test('inspeção conserva 18 dígitos decimais sem arredondamento e não calcula saldo oficial', () => {
  const r = inspecionarArquivoCbs(raw('9999999999999999.99'), identidade);
  expect(r.amostra[0].valores['cbs.apurado']).toEqual({ centavos: '999999999999999999', valido: true });
  expect(r.totaisOficiais).toBeNull();
  expect(r.cobertura).toBe('NAO_VALIDADA');
  expect(r.valoresInvalidos).toBe(0);
  expect(inspecionarArquivoCbs(raw('9999999999999999.99'), identidade)).toEqual(r);
});
test.each(['1.001', '1e2', '-1', '10000000000000000', 'null', '"2.00"', '[]', '{}', '{"outro":1}'])('valor monetário fora do contrato permanece sem normalizar: %s', valor => {
  const r = inspecionarArquivoCbs(raw(valor), identidade);
  expect(r.valoresInvalidos).toBeGreaterThan(0);
  expect(r.amostra[0].valores['cbs.apurado'].centavos).toBeNull();
});
test('campos desconhecidos e caminhos com ponto não fabricam valores monetários conhecidos', () => {
  const doc = JSON.parse(raw('1')); doc.apuracao[0].debitos[0].cbs['apurado.outro'] = 9;
  const r = inspecionarArquivoCbs(Buffer.from(JSON.stringify(doc)), identidade);
  expect(r.valoresInvalidos).toBe(1);
  expect(r.amostra[0].valores['cbs.apurado.outro']).toBeUndefined();
  expect(r.amostra[0].valores['cbs.apurado'].centavos).toBe('100');
});
test.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '[1,]', '{"a":}', '01', 'true false', '"sem fim', '{"a":1,}', '[NaN]', '[Infinity]'])('parser recusa JSON ambíguo/inválido %s', texto => {
  expect(() => lerJsonExato(Buffer.from(texto))).toThrow('Arquivo JSON inválido');
});
test('profundidade excessiva, UTF8 inválido e tamanho excedido recusados', () => {
  for (const b of [Buffer.from('['.repeat(66) + '0' + ']'.repeat(66)), Buffer.from([255]), Buffer.alloc(10 * 1024 * 1024 + 1)]) expect(() => lerJsonExato(b)).toThrow();
});
test('chave __proto__ é dado e não altera protótipo; strings escapadas válidas', () => {
  const r = lerJsonExato(Buffer.from('{"__proto__":{"polluted":true},"s":"a\\\"b\\n","n":null,"v":false}'));
  expect(Object.getPrototypeOf(r)).toBeNull();
  expect({}.polluted).toBeUndefined();
  expect(r.s).toBe('a"b\n'); expect(r.n).toBeNull(); expect(r.v).toBe(false);
});
test('amostra limitada não elimina contagem e nunca soma itens ou competências repetidos', () => {
  const doc = JSON.parse(raw('1.50')); doc.apuracao[0].debitos = Array.from({ length: 110 }, () => ({ cbs: { apurado: 1, saldoDevedor: 1 } }));
  const r = inspecionarArquivoCbs(Buffer.from(JSON.stringify(doc)), identidade);
  expect(r.quantidadeItens).toBe(110); expect(r.amostra).toHaveLength(100); expect(r.truncada).toBe(true); expect(r.totaisOficiais).toBeNull();
});
test('reprocessamento não aceita filtros externos', async () => {
  await expect(reprocessarArquivoCbs({}, 'empresa', 'coleta', { ambiente: 'PRODUCAO', cursor: 'x' }, {})).rejects.toMatchObject({ status: 400 });
});
