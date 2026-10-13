import { createRealApi } from '../realApi';
import { consultarCnpj } from '../../../features/onboarding/lib/brasilApi';
const original=global.fetch;
beforeEach(()=>{global.fetch=jest.fn().mockResolvedValue({ok:true,status:200,json:async()=>({ok:true,fonte:'MINHA_RECEITA',bruto:{razao_social:'TESTE'}})});});
afterEach(()=>{global.fetch=original;});
test('consulta de emissor usa rota da empresa e só envia CNPJ',async()=>{
  await createRealApi().consultarCnpjCadastro('11222333000181',{companyId:'pc'});
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/firm/companies/pc/consulta-cnpj'),expect.objectContaining({method:'POST',body:JSON.stringify({cnpj:'11222333000181'})}));
});
test('consulta de cadastro usa rota central e preserva fonte',async()=>{
  const r=await consultarCnpj('11222333000181');expect(r.empresa.razaoSocial).toBe('TESTE');expect(r.fonte).toBe('MINHA_RECEITA');
  expect(global.fetch.mock.calls[0][0]).toContain('/firm/cadastro/consulta-cnpj');
  expect(global.fetch.mock.calls[0][0]).not.toContain('brasilapi');
});
test('cadastro efetivo tem rota própria',async()=>{
  await consultarCnpj('11222333000181',{cadastroEfetivo:true});expect(global.fetch.mock.calls[0][0]).toContain('/consulta-cnpj-completa');
});
test('link público leva token somente no cabeçalho da rota pública',async()=>{
  await consultarCnpj('11222333000181',{tokenPublico:'token-ficticio'});
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/public/onboarding/consulta-cnpj'),expect.objectContaining({headers:expect.objectContaining({Authorization:'Bearer token-ficticio'})}));
  expect(global.fetch.mock.calls[0][0]).not.toContain('token-ficticio');
});
test('falha de backend não consulta fornecedor pelo browser nem fabrica dados',async()=>{
  global.fetch.mockRejectedValue(new Error('rede'));expect((await consultarCnpj('11222333000181')).ok).toBe(false);expect(global.fetch).toHaveBeenCalledTimes(1);
});
