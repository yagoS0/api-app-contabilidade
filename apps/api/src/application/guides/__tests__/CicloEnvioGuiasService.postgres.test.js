import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createCicloEnvioGuiasService } from '../CicloEnvioGuiasService.js';
import { enviarGuiasExatasDoCiclo } from '../GuideCompanyEmailService.js';
import { comAutomacaoCicloFiscal, comAutomacaoEmpresa } from '../../fiscal/automacaoCicloFiscalContext.js';

const url=process.env.TEST_CICLO_PG_URL;
(url?test:test.skip)('PostgreSQL: serviço, reserva exata e transporte fictício concorrentes; reinício preserva identidade e não repete',async()=>{
 const parsed=new URL(url);
 if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.endsWith('_governance_test'))throw new Error('Banco descartável loopback obrigatório.');
 const pg=new PrismaClient({datasources:{db:{url}}});
 const id=`envio-test-${randomUUID()}`,clientId=randomUUID(),companyId=randomUUID(),guideId=randomUUID();
 const cnpj=(BigInt(`0x${randomUUID().replace(/-/g,'')}`)%100000000000000n).toString().padStart(14,'0');
 const monthlyKey=`operations_manual_inss:v1:${id}:2026-10`;
 const key=`envio_guias_ciclo:${id}:2026-10`,configKey=`envio_guias_config:${id}`,scheduledAt='2026-11-13T11:00:00Z';
 const agenda={rotinas:{simples_envio_guias:{enabled:true,frequency:'DAILY',hour:8}}};
 // Only shared settings are replaced with local fixture reads; all cycle, guide and ledger mutations use PostgreSQL.
 const db=new Proxy(pg,{get(target,prop){if(prop==='appSetting')return {...target.appSetting,findUnique:args=>args.where.key==='serpro_runtime_settings'?Promise.resolve({value:agenda}):args.where.key==='automacao_ciclo_fiscal'?Promise.resolve(null):target.appSetting.findUnique(args)};const value=target[prop];return typeof value==='function'?value.bind(target):value;}});
 const transport=jest.fn(async message=>{await message.beforeDispatch();return {id:'fake-provider-reference'};});
 const projection=async()=>new Map([[id,{das:{required:true,ok:true},inss:{required:false,ok:true},parcDas:{required:false,ok:true},guiasParcelamentoMes:[]}]]);
 const deps={db,now:()=>new Date(scheduledAt),compliance:projection,contatos:async()=>({emails:['destino@example.test'],telefones:[]}),canal:async()=>({disponivel:false}),
  email:(input)=>enviarGuiasExatasDoCiclo(input,{db,email:{send:transport},validateTo:async()=>{},pdf:async guide=>Buffer.from(guide.pdfBytes)})};
 const execute=()=>comAutomacaoCicloFiscal({version:0,scheduledAt},()=>comAutomacaoEmpresa(id,()=>createCicloEnvioGuiasService(deps).executar({portalClientId:id,competencia:'2026-10',scheduledAt,assertActive(){}}),db,{scheduledAt}),db);
 try {
  await pg.client.create({data:{id:clientId,name:'ENVIO SINTETICO',email:`${clientId}@example.test`,login:clientId,passwordHash:'fixture-sem-login'}});
  await pg.company.create({data:{id:companyId,clientId,cnpj,razaoSocial:'ENVIO SINTETICO',atividades:[],regimeTributario:'SIMPLES'}});
  await pg.portalClient.create({data:{id,companyId,cnpj,razao:'ENVIO SINTETICO',status:'ATIVA',hasProlabore:false,temFolha:false}});
  await pg.regimeHistorico.create({data:{companyId,regime:'SIMPLES',vigenciaInicio:new Date('2020-01-01')}});
  await pg.appSetting.create({data:{key:monthlyKey,value:{state:{applicable:false,responsible:'Contador fictício',dueDate:null,note:'Teste',reason:'Sem obrigação nesta competência fictícia'},changedAt:scheduledAt,changedBy:'test-accountant'}}});
  await pg.appSetting.create({data:{key:configKey,value:{enabled:true,selectionToken:'synthetic-selection'}}});
  await pg.guide.create({data:{id:guideId,portalClientId:id,competencia:'2026-10',tipo:'SIMPLES',status:'PROCESSED',valor:'100.00',hash:randomUUID(),pdfBytes:Buffer.from('%PDF-test-only'),vencimento:new Date('2026-11-20'),emailStatus:'PENDING'}});
  const concurrent=await Promise.allSettled([execute(),execute()]);
  expect(concurrent.some(r=>r.status==='fulfilled')).toBe(true);
  for(const r of concurrent.filter(r=>r.status==='rejected')) expect(['P2034','P2002','ENVIO_GUIAS_CONCORRENTE']).toContain(r.reason.code);
  expect(transport).toHaveBeenCalledTimes(1);
  const persisted=await pg.appSetting.findUnique({where:{key}});
  expect(persisted.value.attempts).toHaveLength(1);expect(persisted.value.attempts[0]).toMatchObject({guideId,status:'SENT',channel:'EMAIL',destination:'destino@example.test'});
  const ledger=await pg.envioGuia.findMany({where:{guideId},include:{historicoTentativas:true}});
  expect(ledger).toHaveLength(1);expect(ledger[0].status).toBe('enviado');expect(ledger[0].historicoTentativas).toHaveLength(1);
  await execute();expect(transport).toHaveBeenCalledTimes(1);
  const savedGuide=await pg.guide.findUnique({where:{id:guideId}});
  expect(savedGuide.paymentStatus).not.toBe('PAID');expect(savedGuide.liberadaCliente).toBe(true);expect(savedGuide.liberadaEm).toBeTruthy();
  // A new revision under the same guide requires review, never a silent resend.
  await pg.guide.update({where:{id:guideId},data:{hash:randomUUID()}});
  await execute();expect(transport).toHaveBeenCalledTimes(1);
 } finally {
  try {await pg.envioGuiaTentativa.deleteMany({where:{envioGuia:{guideId}}});await pg.envioGuia.deleteMany({where:{guideId}});await pg.guide.deleteMany({where:{id:guideId,portalClientId:id}});await pg.appSetting.deleteMany({where:{key:{in:[key,configKey,monthlyKey]}}});await pg.portalClient.deleteMany({where:{id,razao:'ENVIO SINTETICO'}});await pg.client.deleteMany({where:{id:clientId,name:'ENVIO SINTETICO'}});}finally{await pg.$disconnect();}
 }
},30000);
