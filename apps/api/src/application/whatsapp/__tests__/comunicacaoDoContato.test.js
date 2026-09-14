import { empresasParaComunicacao } from '../comunicacaoDoContato.js';
import { empresasAutorizadas } from '../selecaoEmpresaWhatsapp.js';
import { resolverVinculoTelefone } from '../vinculoTelefone.js';

const numero = '5521999990000';
const contato = (empresa, extra = {}) => ({ id: `contato-${empresa}`, portalClientId: empresa, ativo: true,
  telefoneE164: numero, portalClient: { razao: `Empresa ${empresa}`, cnpj: empresa }, ...extra });
const resolver = contatos => resolverVinculoTelefone(numero, contatos);

test('contatos ativos do mesmo número permitem comunicação nas duas empresas sem conta no portal', () => {
  const vinculo = resolver([contato('a'), contato('b')]);
  expect(empresasParaComunicacao(vinculo).empresas.map(e => e.portalClientId)).toEqual(['a', 'b']);
  expect(empresasParaComunicacao(vinculo).userId).toBeNull();
  expect(empresasAutorizadas(vinculo).empresas).toEqual([]);
});

test('contas diferentes não impedem a comunicação do escritório pelo número cadastrado', () => {
  const vinculo = resolver([contato('a', { userId: 'u1' }), contato('b', { userId: 'u2' })]);
  expect(empresasParaComunicacao(vinculo).empresas).toHaveLength(2);
  expect(empresasAutorizadas(vinculo).bloqueado).toBe(true);
});

test('contato inativo ou telefone diferente não entra nas empresas de comunicação', () => {
  const vinculo = resolver([contato('a'), contato('b', { ativo: false }), contato('c', { telefoneE164: '5521888880000' })]);
  expect(empresasParaComunicacao(vinculo).empresas.map(e => e.portalClientId)).toEqual(['a']);
});

test('não usa aproximação de telefone nem contato ambíguo dentro da empresa', () => {
  expect(empresasParaComunicacao({ ...resolver([contato('a')]), leitura: 'NONO_DIGITO' }).bloqueado).toBe(true);
  expect(empresasParaComunicacao(resolver([contato('a'), contato('a', { id: 'duplicado' })])).bloqueado).toBe(true);
});
