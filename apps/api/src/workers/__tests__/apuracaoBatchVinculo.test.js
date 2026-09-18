jest.mock('../../infrastructure/db/prisma.js',()=>({prisma:{apuracaoSnapshot:{findMany:jest.fn()},apuracaoBatchJob:{create:jest.fn(),findUnique:jest.fn(),update:jest.fn()},apuracaoBatchItem:{createMany:jest.fn(),findMany:jest.fn(),updateMany:jest.fn(),update:jest.fn()}}}));
jest.mock('../../application/notas/apuracao/v2/FechamentoService.js',()=>({transmitirFechamento:jest.fn()}));
import {prisma} from '../../infrastructure/db/prisma.js';
import {transmitirFechamento} from '../../application/notas/apuracao/v2/FechamentoService.js';
import {criarBatchJob,runApuracaoBatchOnce} from '../apuracaoBatchWorker.js';
beforeEach(()=>{jest.resetAllMocks();prisma.apuracaoBatchJob.create.mockResolvedValue({id:'j1'});prisma.apuracaoBatchItem.updateMany.mockResolvedValue({count:1});transmitirFechamento.mockResolvedValue({snapshot:{}});});
it('lote captura a simulação aprovada e exclui snapshots antigos sem vínculo',async()=>{
 prisma.apuracaoSnapshot.findMany.mockResolvedValue([{portalClientId:'a',idempotencyKey:'fech:v1:aprovado'},{portalClientId:'b',idempotencyKey:'antigo'}]);
 expect(await criarBatchJob({portalClientIds:['a','b'],competencia:'2026-07',userId:'u1'})).toMatchObject({totalEmpresas:1,ignoradas:1});
 expect(prisma.apuracaoBatchJob.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({resumo:{calculosAprovados:{a:'fech:v1:aprovado'}}})}));
});
function preparar(){prisma.apuracaoBatchJob.findUnique.mockResolvedValue({id:'j1',triggeredBy:'u1',resumo:{calculosAprovados:{a:'token-aprovado'}}});prisma.apuracaoBatchItem.findMany.mockResolvedValueOnce([{id:'i1',portalClientId:'a',competencia:'2026-07',tentativas:0}]).mockResolvedValue([{status:'ok'}]);}
it('worker usa token aprovado na criação, nunca a simulação mais recente',async()=>{
 preparar();await runApuracaoBatchOnce('j1');expect(transmitirFechamento).toHaveBeenCalledWith({portalClientId:'a',competencia:'2026-07',calculoId:'token-aprovado',userId:'u1'});expect(prisma.apuracaoSnapshot.findMany).not.toHaveBeenCalled();
});
it('item reservado por outro executor não transmite novamente',async()=>{
 preparar();prisma.apuracaoBatchItem.updateMany.mockResolvedValue({count:0});await runApuracaoBatchOnce('j1');expect(transmitirFechamento).not.toHaveBeenCalled();
});
it('timeout com resultado incerto não agenda repetição',async()=>{
 preparar();transmitirFechamento.mockRejectedValue(Object.assign(new Error('timeout'),{code:'TRANSMISSAO_RESULTADO_INCERTO'}));await runApuracaoBatchOnce('j1');expect(prisma.apuracaoBatchItem.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'erro'})}));
});
