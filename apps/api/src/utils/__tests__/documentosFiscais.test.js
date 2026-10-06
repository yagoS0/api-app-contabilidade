import { normalizarDocumento, cnpjTemFormato, cnpjTemDvValido, documentoTemFormato, formatarDocumento } from '@contabilidade/shared/documentos-fiscais';
import { companyCreateSchema } from '../../application/validators/companySchemas.js';

it('preserva o exemplo oficial alfanumérico e confere o DV por ASCII menos 48', () => {
  expect(normalizarDocumento('12.abc.345/01de-35')).toBe('12ABC34501DE35');
  expect(cnpjTemDvValido('12.ABC.345/01DE-35')).toBe(true);
  expect(formatarDocumento('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
});
it.each(['12ABC34501DE34', '12ABC34501DE3A', '12ÁBC34501DE35', '12ABC34501DE35!', '00000000000000'])('recusa DV/formato inválido: %s', valor => {
  expect(cnpjTemDvValido(valor)).toBe(false);
});
it('preserva documentos numéricos, zeros iniciais e CPF', () => {
  expect(cnpjTemDvValido('04.252.011/0001-10')).toBe(true);
  expect(normalizarDocumento('04.252.011/0001-10')).toBe('04252011000110');
  expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
  expect(documentoTemFormato('52998224725')).toBe(true);
  expect(cnpjTemFormato('04252011000110')).toBe(true);
});
it('não transforma entrada inválida em outra identidade válida', () => {
  expect(normalizarDocumento('!12ABC34501DE35')).toBe('!12ABC34501DE35');
  expect(documentoTemFormato('!12ABC34501DE35')).toBe(false);
  expect(normalizarDocumento('ß')).toBe('ß');
});

it('aceita o novo documento no cadastro de empresa e recusa o DV errado', () => {
  const validar = cnpj => companyCreateSchema.safeParse({ ownerEmail: 'teste@example.com',
    company: { razaoSocial: 'EMPRESA DE TESTE', cnpj } });
  expect(validar('12.ABC.345/01DE-35').success).toBe(true);
  expect(validar('12.ABC.345/01DE-34').success).toBe(false);
});
