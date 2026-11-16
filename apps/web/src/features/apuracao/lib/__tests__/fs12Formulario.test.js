import { valorFolhaInformado, referenciasFolha, respostaFs12Valida } from '../fs12Formulario';
test.each([null, undefined, '', ' ', false, NaN, Infinity, '-1', '1.001', '1e3', {}, '9007199254740991'])('não promove %s a zero/valor fiscal', valor => {
  expect(valorFolhaInformado(valor)).toBeNull();
});
test.each([[0, 0], ['0', 0], ['0,00', 0], ['12,34', 1234], ['12.30', 1230]])('preserva valor explícito %s', (valor, centavos) => {
  expect(valorFolhaInformado(valor)).toBe(centavos);
});
test('memória não apaga duplicatas nem transforma agregado em série', () => {
  expect(referenciasFolha([{ pa: '2026-10', valor: 0 }, { pa: '2026-10', valor: 10 }], '2026-10').situacao).toBe('DUPLICADA');
  expect(referenciasFolha({ fs12Manual: 1200 }, '2026-10').situacao).toBe('AUSENTE');
  expect(referenciasFolha([{ pa: '2026-10', valor: 0 }], '2026-10')).toEqual({ situacao: 'NAO_CONFERIDA', valor: 0 });
});
test('resposta vazia ou de outro contexto não valida a tela', () => {
  expect(respostaFs12Valida(null, 'p', '2026-11')).toBe(false);
  expect(respostaFs12Valida({ ok: true, fs12: { portalClientId: 'outra' } }, 'p', '2026-11')).toBe(false);
});
