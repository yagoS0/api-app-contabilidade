import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { configuration, json, loopback } from './common.mjs';
const cfg=await configuration(process.argv[2]);Object.assign(process.env,cfg.env);
const provider=JSON.parse(await fs.readFile(path.join(cfg.output,'provider.json'),'utf8'));loopback(provider.origin);
const {PrismaClient}=await import('@prisma/client'),{default:bcrypt}=await import('bcryptjs'),{default:forge}=await import('node-forge');
const {encryptSecret,encryptBytes}=await import('../../src/utils/crypto.js');
const db=new PrismaClient();
const prefix=`fs12-test-${cfg.runId}`,password=cfg.syntheticPassword;
if(typeof password!=='string'||password.length<14)throw Error('Senha sintética explícita mínima14 caracteres');
// Dedicated database must be empty of business identities. No destructive cleanup.
if(await db.user.count()||await db.company.count()||await db.portalClient.count())throw Error('Seed exige banco sintético vazio; preservar dados existentes.');
const keypair=forge.pki.rsa.generateKeyPair(2048),cert=forge.pki.createCertificate();
cert.publicKey=keypair.publicKey;cert.serialNumber='01';cert.validity.notBefore=new Date(Date.now()-60000);cert.validity.notAfter=new Date(Date.now()+86400000*7);
const attrs=[{name:'commonName',value:'FS12 LOCAL SYNTHETIC ONLY:11111111000191'}];cert.setSubject(attrs);cert.setIssuer(attrs);cert.sign(keypair.privateKey,forge.md.sha256.create());
const pfxPass=randomBytes(24).toString('hex'),pfx=forge.pkcs12.toPkcs12Asn1(keypair.privateKey,[cert],pfxPass,{algorithm:'3des'});
const pfxBytes=Buffer.from(forge.asn1.toDer(pfx).getBytes(),'binary');
const settings={enabled:true,environment:'homolog',baseUrl:provider.origin,authUrl:provider.origin+'/token',consumerKey:'synthetic-key',consumerSecretEnc:await encryptSecret('synthetic-secret'),scope:'',timeoutMs:10000,
 certPfxBase64:(await encryptBytes(pfxBytes)).toString('base64'),certPasswordEnc:await encryptSecret(pfxPass),certStorageKey:'db:serpro-pfx',certDocument:'11111111000191',certOriginalName:'synthetic-only.pfx',certUploadedAt:new Date().toISOString(),certExpiresAt:cert.validity.notAfter.toISOString(),paymentConfirmationEnabled:false};
function cnpj(n){const base=('99000000'+String(n).padStart(4,'0')).split('').map(Number);const digit=digits=>{const w=digits.length===12?[5,4,3,2,9,8,7,6,5,4,3,2]:[6,5,4,3,2,9,8,7,6,5,4,3,2];const r=digits.reduce((s,d,i)=>s+d*w[i],0)%11;return r<2?0:11-r;};base.push(digit(base));base.push(digit(base));return base.join('');}
const ids=['T156.1','T156.2','T156.3','T156.4','T156.5','T156.6','T156.7','T156.8','T157.1','T157.2','T157.3','T157.4','T158.1','T158.2','T159.1','T159.2','T160'];
const result={runId:cfg.runId,userId:prefix+'-accountant',staffId:prefix+'-staff',email:prefix+'@example.test',staffEmail:prefix+'-staff@example.test',companies:[],limitations:['Série FS12 deve ser confirmada pelas rotas/UI reais, não inserida como prova fiscal por seed.','Receita/folha específicas de cada caso devem ser preparadas pelo controlador usando a matriz; seed mínimo não significa cenário concluído.']};
try{await db.$transaction(async tx=>{
 const hash=await bcrypt.hash(password,10);
 await tx.user.create({data:{id:result.userId,email:result.email,passwordHash:hash,name:'FS12 synthetic accountant',role:'contador',accountType:'FIRM',status:'active'}});
 await tx.user.create({data:{id:result.staffId,email:result.staffEmail,passwordHash:hash,name:'FS12 synthetic staff',role:'contador',accountType:'FIRM',status:'active'}});
 const clientId=prefix+'-client';await tx.client.create({data:{id:clientId,name:'FS12 TEST ONLY',email:prefix+'-client@example.test',login:prefix,passwordHash:hash}});
 for(let i=0;i<ids.length;i++){
  const caseId=ids[i],id=prefix+'-'+caseId.replace('.','-'),legacy=id+'-company',document=cnpj(i+1),opening=caseId==='T156.4'?'2026-11-15':'2020-01-01';
  await tx.company.create({data:{id:legacy,clientId,cnpj:document,razaoSocial:`FS12 TEST ${caseId}`,atividades:[],regimeTributario:'SIMPLES',dataAbertura:new Date(opening+'T00:00:00Z'),cnaePrincipal:'6201501',codigosServicoNacional:['010101']}});
  await tx.portalClient.create({data:{id,companyId:legacy,cnpj:document,razao:`FS12 TEST ${caseId}`,status:'ATIVA',temFolha:!['T156.5','T156.6'].includes(caseId)}});
  for(const [userId,role] of [[result.userId,'ACCOUNTANT'],[result.staffId,'STAFF']])await tx.companyFirmAccess.create({data:{companyId:id,userId,role,status:'ACTIVE'}});
  await tx.regimeHistorico.create({data:{companyId:legacy,regime:'SIMPLES',vigenciaInicio:new Date(opening+'T00:00:00Z'),impostos:['DAS']}});
  await tx.cadastroFiscal.create({data:{portalClientId:id,regime:'SIMPLES_NACIONAL',regimeApuracao:'COMPETENCIA',cnaePrincipal:'6201501',dataOpcaoSN:new Date(opening+'T00:00:00Z'),usaFatorR:caseId==='T156.7'}});
  await tx.appSetting.create({data:{key:`ciclo_simples_config:${id}`,value:{enabled:false,fontes:['NFSE']}}});
  await tx.appSetting.create({data:{key:`serpro_procuration_status:${id}`,value:{cnpj:document,procuradorCnpj:'11111111000191',status:'ATIVA',systems:['PGDAS-D'],checkedAt:new Date().toISOString(),validUntil:new Date(Date.now()+86400000).toISOString(),syntheticFixture:true}}});
  result.companies.push({caseId,id,legacy,cnpj:document,opening,competencia:'2026-11'});
 }
 await tx.appSetting.create({data:{key:'serpro_runtime_settings',value:settings}});
 await tx.appSetting.create({data:{key:'fs12_test_fixture',value:{runId:cfg.runId,userId:result.userId,at:new Date().toISOString()}}});
},{timeout:120000});await json(path.join(cfg.output,'seed.json'),result);
}finally{await db.$disconnect();}
