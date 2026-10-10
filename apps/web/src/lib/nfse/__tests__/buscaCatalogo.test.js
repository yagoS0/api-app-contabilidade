import { buscarCatalogo, itemDoCatalogo } from '../buscaCatalogo';
const itens = [
  { codigo: '1.1401.11.00', descricao: 'Serviços de gestão de negócios' },
  { codigo: '1.1406.11.00', descricao: 'Serviços de campanhas publicitárias' },
  { codigo: '000001', descricao: 'Tributação integral', detalhe: 'CST 000' },
];
test.each(['gestao de', 'GESTÃO DE', 'gestao   negocios'])('busca textual sem acentos: %s', termo => {
  expect(buscarCatalogo(itens, termo).itens).toEqual([itens[0]]);
});
test.each(['1140611', '1.1406.11', '11406 publicitarias'])('código parcial com ou sem pontos: %s', termo => {
  expect(buscarCatalogo(itens, termo).itens).toEqual([itens[1]]);
});
test('preserva zeros, limita resultados e não transforma descrição em código', () => {
  expect(itemDoCatalogo(itens, '114061100')).toBe(itens[1]);
  expect(itemDoCatalogo(itens, '1')).toBeUndefined();
  expect(itemDoCatalogo(itens, 'Tributação integral')).toBeUndefined();
  expect(buscarCatalogo(itens, 'CST 000').itens[0].codigo).toBe('000001');
  expect(buscarCatalogo(itens, '', 1)).toEqual({ itens: [itens[0]], total: 3 });
  expect(buscarCatalogo(itens, 'inexistente').total).toBe(0);
});
