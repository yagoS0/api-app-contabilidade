import fs from 'node:fs/promises';
import path from 'node:path';
import {configuration,json} from './common.mjs';
const cfg=await configuration(process.argv[2]),seed=JSON.parse(await fs.readFile(path.join(cfg.output,'seed.json'),'utf8'));
const cases=JSON.parse(await fs.readFile(new URL('./cases.json',import.meta.url),'utf8')).cases;
const competencia=process.argv[3]||'2026-11';if(!['2026-11','2026-12'].includes(competencia))throw Error('Competência fora do ensaio');
const {PrismaClient}=await import('@prisma/client'),db=new PrismaClient();
const {seedAtividadePgdasd}=await import('../../src/application/notas/apuracao/v2/seeds/AtividadePgdasdSeeds.js');
try{
 const marker=await db.appSetting.findUnique({where:{key:'fs12_test_fixture'}});if(marker?.value?.runId!==cfg.runId)throw Error('Banco fora do ensaio');
 const catalogue=await seedAtividadePgdasd(db);if(catalogue.created+catalogue.updated!==catalogue.total)throw Error('Catálogo não concluído');
 const evidence=[];
 for(const company of seed.companies){
  const scenario=cases.find(c=>c.id===company.caseId);if(!scenario)throw Error('Cenário ausente');
  const invoiceId=company.id+'-synthetic-nfse-'+competencia;
  if(scenario.receitaAtual>0){
   const existing=await db.portalInvoice.findUnique({where:{id:invoiceId}});if(existing)throw Error('Insumo já existe; preservar primeira evidência');
   const invoice=await db.portalInvoice.create({data:{id:invoiceId,clientId:company.id,type:'NFSE',numero:'SYNTHETIC-1',competencia:new Date(competencia+'-20T00:00:00Z'),total:scenario.receitaAtual,papel:'EMIT',status:'EMITIDA',statusEfetivo:'autorizada',emitenteDoc:company.cnpj,emitenteNome:'SYNTHETIC ONLY',tomadorDoc:'11111111000191',itens:{create:[{codigoServico:'0101',descricao:'Insumo sintético FS12',valor:scenario.receitaAtual,tipoReceita:scenario.sujeitoFatorR?'SERVICO_FATOR_R':'SERVICO_ANEXO_III',sujeitoFatorR:scenario.sujeitoFatorR,classificadoEm:new Date()}]}}});
   evidence.push({caseId:company.caseId,invoiceId:invoice.id,scope:'Insumo inicial sintético; não cria resultado de cálculo/apuração'});
  }
 }
 await json(path.join(cfg.output,'initial-facts-'+competencia+'.json'),{evidence,limitations:['Não cria FS12 confirmada, apuração/snapshot, declaração, RBT oficial ou tentativa concluída.','Receita passada e extratos devem entrar por fronteira documental/rotas reais, conforme fixtures próprias.','Classificação sintética é insumo de teste; auditoria real pode exigir ajustes explícitos e seu resultado deve ser preservado.']});
}finally{await db.$disconnect();}
