import { createRealApi } from '../real/realApi';
const original=global.fetch;
beforeEach(()=>{global.fetch=jest.fn().mockResolvedValue({ok:true,status:200,text:async()=>JSON.stringify({ok:true,fonte:'MINHA_RECEITA',bruto:{razao_social:'TESTE'}})});});
afterEach(()=>{global.fetch=original;});
test('emissor encaminha CNPJ para backend da empresa',async()=>{
  const r=await createRealApi().consultarCnpj('11222333000181',{companyId:'pc'});expect(r.ok).toBe(true);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/client/companies/pc/consulta-cnpj'),expect.objectContaining({method:'POST',body:JSON.stringify({cnpj:'11222333000181'})}));
});
test('sem empresa não consulta',async()=>{
  expect((await createRealApi().consultarCnpj('11222333000181')).ok).toBe(false);expect(global.fetch).not.toHaveBeenCalled();
});
test('erro de rede retorna falha controlada, sem fallback público pelo browser',async()=>{
  global.fetch.mockRejectedValue(new Error('rede'));expect((await createRealApi().consultarCnpj('11222333000181',{companyId:'pc'})).ok).toBe(false);expect(global.fetch).toHaveBeenCalledTimes(1);
});
