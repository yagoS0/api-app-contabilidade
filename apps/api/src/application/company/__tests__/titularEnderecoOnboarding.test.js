import { validateAndNormalizeCompanyProfile } from '../companyProfile.js';

const base = () => ({ razaoSocial: 'Empresa de teste', cnpj: '11222333000181', regimeTributario: 'SIMPLES', cnaePrincipal: '7020400',
  endereco: { rua: 'Rua A', semNumero: true, bairro: 'Centro', cidade: 'Recife', uf: 'PE', cep: '50000000', inscricaoImobiliaria: '000AB-12', iptuDesconhecido: false, legado: 'Texto original preservado' },
  titular: { nome: 'Ana Teste', cpf: '529.982.247-25' }, socios: [] });

test('titular é separado dos sócios e endereço conserva IPTU como texto', () => {
  const r = validateAndNormalizeCompanyProfile(base());
  expect(r.ok).toBe(true);
  expect(r.data.titular).toEqual({ nome: 'Ana Teste', cpf: '52998224725' });
  expect(r.data.socios).toEqual([]);
  expect(r.data.endereco).toMatchObject({ numero: 'S/N', semNumero: true, inscricaoImobiliaria: '000AB-12', legado: 'Texto original preservado' });
});
test.each([{ titular: { nome: 'Ana', cpf: '11111111111' } }, { socios: [{ nome: 'Bia' }] }])('recusa identificação inválida ou conflito com quadro societário: %j', patch => {
  expect(validateAndNormalizeCompanyProfile({ ...base(), ...patch })).toMatchObject({ ok: false, error: 'company_titular_invalid' });
});

test('correção explícita do número conserva titular, IPTU e texto legado', () => {
  const original = validateAndNormalizeCompanyProfile(base()).data;
  const corrigida = validateAndNormalizeCompanyProfile({ ...base(), endereco: { ...original.endereco, semNumero: false, numero: '123' } });
  expect(corrigida.ok).toBe(true);
  expect(corrigida.data.endereco).toMatchObject({ numero: '123', semNumero: false, inscricaoImobiliaria: '000AB-12', legado: 'Texto original preservado' });
  expect(corrigida.data.titular).toEqual(original.titular);
  expect(validateAndNormalizeCompanyProfile({ ...base(), endereco: corrigida.data.endereco }).data.endereco).toEqual(corrigida.data.endereco);
});
