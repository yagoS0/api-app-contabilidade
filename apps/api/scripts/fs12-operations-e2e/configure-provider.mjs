import fs from 'node:fs/promises';
import path from 'node:path';
import {configuration,loopback} from './common.mjs';
const cfg=await configuration(process.argv[2]),provider=JSON.parse(await fs.readFile(path.join(cfg.output,'provider.json'),'utf8'));loopback(provider.origin);
const {PrismaClient}=await import('@prisma/client'),db=new PrismaClient();
try{await db.$transaction(async tx=>{const marker=await tx.appSetting.findUnique({where:{key:'fs12_test_fixture'}});if(marker?.value?.runId!==cfg.runId)throw Error('Banco não pertence a este ensaio');const row=await tx.appSetting.findUnique({where:{key:'serpro_runtime_settings'}});if(!row?.value?.certOriginalName?.startsWith('synthetic-'))throw Error('Certificado não sintético');await tx.appSetting.update({where:{key:'serpro_runtime_settings'},data:{value:{...row.value,baseUrl:provider.origin,authUrl:provider.origin+'/token'}}});});}finally{await db.$disconnect();}
