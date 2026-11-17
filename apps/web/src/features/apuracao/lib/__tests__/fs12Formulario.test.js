import { valorFolhaInformado, referenciasFolha, respostaFs12Valida, formatarCentavosFs12, serieDoRascunhoFs12, rascunhoDaConfirmacaoFs12 } from '../fs12Formulario';
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

test.each([0, 1, 90, 100, 123456789, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER])('centavos %s sobrevivem à apresentação e reedição sem arredondamento', valor => {
  const r = rascunhoDaConfirmacaoFs12({ serie: [{ mes: '2026-10', valorCentavos: valor }] });
  expect(valorFolhaInformado(r['2026-10'])).toBe(valor);
  const inteiro = BigInt(valor) / 100n;
  const fracao = String(BigInt(valor) % 100n).padStart(2, '0');
  expect(formatarCentavosFs12(valor)).toBe(`R$\u00a0${inteiro.toLocaleString('pt-BR')},${fracao}`);
});
test('limite de centavos não arredonda nem aceita soma além do inteiro seguro', () => {
  expect(valorFolhaInformado('90071992547409,91')).toBe(Number.MAX_SAFE_INTEGER);
  expect(valorFolhaInformado('90071992547409,92')).toBeNull();
  expect(formatarCentavosFs12(Number.MAX_SAFE_INTEGER)).toBe('R$\u00a090.071.992.547.409,91');
  expect(formatarCentavosFs12(-1)).toBeNull();
  expect(serieDoRascunhoFs12(['2026-09', '2026-10'], { '2026-09': '90071992547409,91', '2026-10': '0,01' }))
    .toMatchObject({ completa: false, totalCentavos: null });
});
test('série incompleta não oferece total e zero explícito completo oferece zero', () => {
  expect(serieDoRascunhoFs12(['2026-10'], {})).toMatchObject({ informados: 0, completa: false, totalCentavos: null });
  expect(serieDoRascunhoFs12(['2026-10'], { '2026-10': '0' })).toMatchObject({ informados: 1, completa: true, totalCentavos: 0 });
});
