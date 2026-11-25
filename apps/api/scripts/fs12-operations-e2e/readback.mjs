import fs from 'node:fs/promises';
import path from 'node:path';
import { configuration,request,json } from './common.mjs';
const cfg=await configuration(process.argv[2]);Object.assign(process.env,cfg.env);
const seed=JSON.parse(await fs.readFile(path.join(cfg.output,'seed.json'),'utf8'));
const login=await request(cfg.apiUrl+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:seed.email,password:cfg.syntheticPassword})});
if(!login.accessToken||login.user?.id!==seed.userId||login.user?.accountType!=='FIRM')throw Error('Autenticação real não comprovada');
const {PrismaClient}=await import('@prisma/client'),db=new PrismaClient();
const evidence=[];
try{for(const company of seed.companies){
 const url=cfg.apiUrl+`/firm/companies/${encodeURIComponent(company.id)}/fechamento/${company.competencia}/aptidao`;
 let api;try{api={ok:true,result:await request(url,{headers:{authorization:`Bearer ${login.accessToken}`}})};}catch(error){api={ok:false,status:error.status,message:error.message};}
 const keys=[`operations_calculation:${company.id}:${company.competencia}`,`operations:v1:${company.id}:${company.competencia}`];
 const [snapshot,settings,revisoes]=await Promise.all([db.apuracaoSnapshot.findUnique({where:{portalClientId_competencia:{portalClientId:company.id,competencia:company.competencia}}}),db.appSetting.findMany({where:{key:{in:keys}}}),db.apuracaoFs12Revisao.findMany({where:{portalClientId:company.id,competencia:company.competencia}})]);
 evidence.push({company,api,pg:{snapshot,settings,revisoes}});
}await json(path.join(cfg.output,`readback-${Date.now()}.json`),{at:new Date().toISOString(),authenticatedUserId:seed.userId,evidence,limitation:'Leitura API/PG real; não substitui interação navegador nem prova de todos os casos.'});}finally{await db.$disconnect();}
