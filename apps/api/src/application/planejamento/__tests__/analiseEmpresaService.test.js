jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../../notas/apuracao/v2/FechamentoService.js',()=>({whereFaturamentoEmit:()=>({papel:'EMIT',statusEfetivo:'autorizada'})}));
import { obterAnaliseEmpresa } from '../AnaliseEmpresaService.js';
test('cinco leituras em lote, todas escopadas; sem mutações',async()=>{
 const client=Object.fromEntries(['accountingEntry','portalInvoice','guide','chartOfAccount','companyMonthlyCircular'].map(k=>[k,{findMany:jest.fn(async()=>[])}]));
 const r=await obterAnaliseEmpresa({portalClientId:'empresa-a',de:'2026-01',ate:'2026-08',comparar:'ano',client,agora:new Date('2026-09-10T12:00:00Z')});
 expect(r.ok).toBe(true);expect(r.demonstracao).toBe(false);expect(r.atual.indicadores.resultado).toBeNull();
 for(const x of Object.values(client))expect(x.findMany).toHaveBeenCalledTimes(1);
 expect(client.accountingEntry.findMany.mock.calls[0][0].where.portalClientId).toBe('empresa-a');
 expect(client.portalInvoice.findMany.mock.calls[0][0].where).toMatchObject({clientId:'empresa-a',papel:'EMIT',statusEfetivo:'autorizada'});
 expect(client.guide.findMany.mock.calls[0][0].where.portalClientId).toBe('empresa-a');
 expect(client.chartOfAccount.findMany.mock.calls[0][0].where.OR).toEqual([{portalClientId:'empresa-a'},{portalClientId:null}]);
});
test('período inválido é recusado antes de consultar',async()=>{await expect(obterAnaliseEmpresa({portalClientId:'a',de:'2026-09',ate:'2025-01',client:{}})).rejects.toThrow('PERIODO_INVALIDO');});
