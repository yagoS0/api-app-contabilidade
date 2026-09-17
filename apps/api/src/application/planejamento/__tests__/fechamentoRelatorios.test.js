jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../../notas/apuracao/v2/FechamentoService.js',()=>({whereFaturamentoEmit:()=>({papel:'EMIT',statusEfetivo:'autorizada'})}));
import { obterClientesAnalise } from '../ClientesAnaliseService.js';
import { montarClientes } from '../../../../../../packages/shared/src/analise/clientes.js';
const nota=(mes,total=100)=>({id:mes,competencia:mes,total,tomadorDoc:'12345678000195',tomadorNome:'Cliente'});
test('meses sem fechamento ficam fora do acumulado e não inferem recorrência nem comparação',()=>{
 const r=montarClientes({notas:[nota('2026-05',9000),nota('2026-06'),nota('2026-07'),nota('2026-08')],de:'2026-08',ate:'2026-08',hoje:'2026-09-16',competenciasFechadas:['2026-06','2026-08']});
 expect(r.resumo.total).toBe(100);expect(r.clientes[0].acumulado).toBe(200);expect(r.resumo.anterior).toBeNull();expect(r.clientes[0].anterior).toBeNull();expect(r.clientes[0].recorrente).toBeNull();expect(r.resumo.taxaRecorrencia).toBeNull();expect(r.clientes[0].disparidade).toBeNull();expect(r.ponte.expansao).toBeNull();expect(r.serie.find(m=>m.mes==='2026-07').valor).toBeNull();
});
test('reabertura impede nova consulta de clientes antes da leitura de notas',async()=>{
 const client={companyMonthlyCircular:{findMany:jest.fn(async()=>[])},portalInvoice:{findMany:jest.fn()}};
 await expect(obterClientesAnalise({portalClientId:'empresa',de:'2026-08',ate:'2026-08',client})).rejects.toMatchObject({code:'CONTABILIDADE_ABERTA',mesesSemFechamento:['2026-08']});expect(client.portalInvoice.findMany).not.toHaveBeenCalled();expect(client.companyMonthlyCircular.findMany.mock.calls[0][0].where.portalClientId).toBe('empresa');
});
test('mês atual fechado não é parcial pelo calendário',()=>{const r=montarClientes({notas:[nota('2026-09')],de:'2026-09',ate:'2026-09',hoje:'2026-09-16',competenciasFechadas:['2026-09']});expect(r.parcial).toBe(false);});
