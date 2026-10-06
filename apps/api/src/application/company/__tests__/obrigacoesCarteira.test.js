jest.mock('../../../infrastructure/db/prisma.js',()=>({prisma:{}}));
jest.mock('../../guides/guideCompliance.js',()=>({computeGuideComplianceMap:jest.fn(async()=>new Map([['a',{das:{required:true,state:'gerada'}}]]))}));
import { reconciliarObrigacoesCarteira } from '../FluxoCarteiraService.js';
import { normalizarEntrada } from '../../obrigacoes/ObrigacoesService.js';
import { MODELOS_OBRIGACOES_CARTEIRA } from '../../../../../../packages/shared/src/accounting/fluxoCarteira.js';

const findMany=value=>({findMany:jest.fn(async()=>value)});
function banco({fechado=true}={}){
  return {
    portalClient:findMany([{id:'a',companyId:'legado',razao:'Alfa'}]),company:findMany([{id:'legado',regimeTributario:'SIMPLES'}]),
    carteiraTarefa:findMany([]),apuracaoSnapshot:findMany([{portalClientId:'a',estado:'calculada'}]),
    companyMonthlyCircular:findMany(fechado?[{portalClientId:'a',fechadoContabilEm:'2026-10-06'}]:[]),
    accountingEntry:findMany([{id:'e',portalClientId:'a',status:'EXPORTADO',lines:[]}]),portalInvoice:findMany([]),
    ocorrenciaObrigacao:{...findMany([]),updateMany:jest.fn(async()=>({count:1}))},
  };
}
const oc=(chave,status='PENDENTE')=>({id:chave,competenciaRef:'2026-09',status,updatedAt:'versao',obrigacao:{portalClientId:'a',verificador:'CARTEIRA_'+chave.toUpperCase()}});

test('modelos usam a validação nativa de obrigações e separam regimes sem prazos pré-gravados',()=>{
  for(const modelo of MODELOS_OBRIGACOES_CARTEIRA){
    expect(modelo.diaVencimento).toBeUndefined();
    expect(normalizarEntrada({nome:modelo.titulo,verificador:modelo.verificador,periodicidade:'MENSAL',diaVencimento:20}).verificador).toBe(modelo.verificador);
  }
  expect(MODELOS_OBRIGACOES_CARTEIRA.filter(m=>m.verificador==='CARTEIRA_APURAR').map(m=>m.filtros.regimes)).toEqual([['SIMPLES'],['LUCRO_PRESUMIDO']]);
});

test('fechamento conclui obrigação por empresa, exportação não confirma importação no ERP',async()=>{
  const db=banco();
  expect(await reconciliarObrigacoesCarteira([oc('contabilizar'),oc('importar')],db)).toBe(1);
  expect(db.ocorrenciaObrigacao.updateMany).toHaveBeenCalledTimes(1);
  expect(db.ocorrenciaObrigacao.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'contabilizar',updatedAt:'versao'}),data:expect.objectContaining({status:'CONCLUIDA',fonteConclusao:'AUTOMATICA'})}));
  expect(db.ocorrenciaObrigacao.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({obrigacao:expect.objectContaining({OR:expect.any(Array)})})}));
});

test('reabrir mês invalida conclusão automática da obrigação sem marcar importação',async()=>{
  const db=banco({fechado:false});
  await reconciliarObrigacoesCarteira([oc('contabilizar','CONCLUIDA')],db);
  expect(db.ocorrenciaObrigacao.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:{status:'PENDENTE',concluidaEm:null,fonteConclusao:null}}));
});
