import { extrairCnpjDoSubject } from '../inspectPfx.js';

it('extrai CNPJ alfanumérico do CN sem remover letras', () => {
  expect(extrairCnpjDoSubject(['EMPRESA DE TESTE:12ABC34501DE35'])).toBe('12ABC34501DE35');
});
it('não aceita DV novo inválido nem documento como substring de outro identificador', () => {
  expect(extrairCnpjDoSubject(['EMPRESA:12ABC34501DE34'])).toBeNull();
  expect(extrairCnpjDoSubject(['X12ABC34501DE35'])).toBeNull();
  expect(extrairCnpjDoSubject(['1122233300018100'])).toBeNull();
});
it('preserva a extração de CNPJ numérico', () => {
  expect(extrairCnpjDoSubject(['EMPRESA:11222333000181'])).toBe('11222333000181');
});
