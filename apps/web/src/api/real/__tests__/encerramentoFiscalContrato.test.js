import { createRealApi } from '../realApi';
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;});
test('conferência comum não encerra; intenção confirmada envia só campos contratados',async()=>{
 global.fetch=jest.fn(async()=>({ok:true,status:200,json:async()=>({ok:true})}));const api=createRealApi();
 await api.conferirTransmissaoFechamento('company/id','2026-12');
 expect(global.fetch.mock.calls[0][1].body).toBeUndefined();
 await api.conferirTransmissaoFechamento('company/id','2026-12',{encerrarSemDespacho:true,confirmEncerramentoSemDespacho:true,confirmCompetencia:'2026-12',autorId:'ignored'});
 const [url,options]=global.fetch.mock.calls[1];expect(String(url)).toContain('/company%2Fid/fechamento/2026-12/conferir-transmissao');
 expect(JSON.parse(options.body)).toEqual({encerrarSemDespacho:true,confirmEncerramentoSemDespacho:true,confirmCompetencia:'2026-12'});
});
test.each([{encerrarSemDespacho:true},{encerrarSemDespacho:true,confirmEncerramentoSemDespacho:true,confirmCompetencia:'2026-11'}])('confirmação incompleta não chama transporte %j',async options=>{
 global.fetch=jest.fn();await expect(createRealApi().conferirTransmissaoFechamento('a','2026-12',options)).rejects.toThrow('Confirme explicitamente');expect(global.fetch).not.toHaveBeenCalled();
});