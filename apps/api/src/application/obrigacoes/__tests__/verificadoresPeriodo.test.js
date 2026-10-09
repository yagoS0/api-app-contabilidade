jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{ocorrenciaObrigacao:{findMany:jest.fn(async()=>[])}}}));
import { prisma } from '../../../infrastructure/db/prisma.js';
import { aplicarVerificadores } from '../ObrigacoesService';

beforeEach(()=>jest.clearAllMocks());
test('reconcilia somente janelas sobrepostas, incluindo legadas pelo vencimento, sem retirar o escopo',async()=>{
 await aplicarVerificadores({portalIds:['a'],inicio:'2026-10-05',fim:'2026-10-11'});
 const where=prisma.ocorrenciaObrigacao.findMany.mock.calls[0][0].where;
 expect(where.obrigacao.portalClientId).toEqual({in:['a']});
 expect(where.AND).toEqual([{OR:[
  {dataInicio:{lte:new Date('2026-10-11')},dataFim:{gte:new Date('2026-10-05')}},
  {dataInicio:null,dataVencimento:{gte:new Date('2026-10-05'),lte:new Date('2026-10-11')}}
 ]}]);
 expect(where.OR).toHaveLength(2);
 expect(where.canceladaEm).toBeNull();
});
test('jobs sem período mantêm a reconciliação completa',async()=>{
 await aplicarVerificadores({portalIds:['a']});
 expect(prisma.ocorrenciaObrigacao.findMany.mock.calls[0][0].where.AND).toBeUndefined();
});
test.each([{inicio:'2026-02-30',fim:'2026-03-01'},{inicio:'2026-10-10'},{inicio:'2026-10-10',fim:'2026-10-01'}])('recusa período inválido antes de consultar %j',async(periodo)=>{
 await expect(aplicarVerificadores(periodo)).rejects.toThrow();
 expect(prisma.ocorrenciaObrigacao.findMany).not.toHaveBeenCalled();
});
