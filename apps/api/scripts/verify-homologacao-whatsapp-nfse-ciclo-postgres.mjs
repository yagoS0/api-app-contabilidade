// Ensaio descartável: nenhuma emissão, mensagem real ou leitura de credenciais.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
import { preflightHomologacao, ambienteDoHarness } from './lib/preflight-homologacao-whatsapp-nfse.js';

// The wrapper already performs explicit consent validation. Direct execution requires it too.
const internal = process.argv[2] === '--internal' && process.argv[3] === 'ciclo';
const checked = preflightHomologacao({databaseUrl:process.env.DATABASE_URL,
  ambiente:process.env.NFSE_ENV,baseUrl:process.env.NFSE_BASE_URL,transporte:'fake',
  confirmacao:internal ? 'BANCO_DESCARTAVEL_SEM_REDE_EXTERNA' : process.env.HOMOLOGACAO_CONFIRMACAO});
const cleanEnv = ambienteDoHarness(checked,process.env,join(tmpdir(),`altan-cycle-no-env-${randomUUID()}`));
for (const name of Object.keys(process.env)) delete process.env[name];
Object.assign(process.env,cleanEnv);

const url = new URL(process.env.DATABASE_URL || 'invalid:');
assert.equal(url.hostname,'127.0.0.1');
assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
assert.match(url.pathname, /^\/[a-zA-Z0-9_]+_governance_test$/);
assert.equal(url.search, ''); assert.equal(url.hash, '');
url.hostname = '127.0.0.1';
process.env.DATABASE_URL = process.env.DIRECT_URL = url.toString();
process.env.DOTENV_CONFIG_PATH = join(tmpdir(), `altan-no-env-${randomUUID()}`);
assert.equal(existsSync(process.env.DOTENV_CONFIG_PATH), false);
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'fatal' });
// The allowlist above already removed inherited secrets; retain its explicit homologation settings.
assert.equal(process.env.NFSE_ENV, 'homolog');
assert.equal(new URL(process.env.NFSE_BASE_URL).hostname, checked.fiscalHost);
for (const flag of readFileSync(new URL('../src/config.js', import.meta.url), 'utf8').match(/INTEGRACAO_[A-Z0-9_]+/g) || []) process.env[flag] = '0';
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw Error('Rede externa proibida'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = tls.connect = deny;
net.Socket.prototype.connect = deny;
syncBuiltinESMExports();
// Apenas o engine nativo Prisma acessa a URL loopback validada.
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { enviarDanfseWhatsapp } = await import('../src/application/whatsapp/EnvioDanfseWhatsappService.js');
const { gerarDanfseDaNota } = await import('../src/application/nfse/danfse/danfseDaNotaDoPortal.js');
const { WhatsappCloudClient } = await import('../src/application/whatsapp/WhatsappCloudClient.js');
const { autorizarEmissaoDoCliente } = await import('../src/application/nfse/autorizacaoEmissaoDoCliente.js');
const { default: pdfParse } = await import('pdf-parse/lib/pdf-parse.js');

const { criarPendencia, confirmarEExecutar, DEPS_PADRAO } = await import('../src/application/assistente/AcoesPendentesService.js');
const { TIPOS } = await import('../src/application/assistente/confirmacaoPendente.js');
const { encerrarPoolEmissaoLocks } = await import('../src/infrastructure/db/prismaEmissaoLocks.js');
const prefix=`cycle-${randomUUID()}`;
const key=('33045572'+String(Date.now())+'1'.repeat(50)).slice(0,50);
// Consistent fictitious example only: this 5% rate does not assert real tax treatment.
const xml=readFileSync(new URL('../../../docs/leiaute-nfse/nfse-nacional-substituicao.xml',import.meta.url),'utf8').replace(/<!--[\s\S]*?-->/g,'').replaceAll('33045572200000000000191000000000001826011111111110',key).replaceAll('198.00','1.00').replace('<vISSQN>9.90</vISSQN>','<vISSQN>0.05</vISSQN>').replace('<cStat>101</cStat>','<cStat>100</cStat>').replace(/<subst>[\s\S]*?<\/subst>/,'').replace(/<\/nro\s+>/g,'</nro>').replaceAll('<tpAmb>1</tpAmb>','<tpAmb>2</tpAmb>');
assert.match(xml,/<tpAmb>2<\/tpAmb>/);assert.doesNotMatch(xml,/<tpAmb>1<\/tpAmb>/);
assert.match(xml,/<vBC>1\.00<\/vBC>/);assert.match(xml,/<pAliqAplic>5\.00<\/pAliqAplic>/);assert.match(xml,/<vISSQN>0\.05<\/vISSQN>/);assert.match(xml,/<vLiq>1\.00<\/vLiq>/);
assert.match(xml,/<cStat>100<\/cStat>/);assert.doesNotMatch(xml,/<subst>|<chSubstda>/);
const report={at:new Date().toISOString(),passed:false,steps:[],limits:['NfseService.issue/sendEvent fake; no tax authority/certificate/real emission.', 'Cloud fetchImpl fake; no Meta receipt/delivery.', 'Real action executors, authorization, PostgreSQL, PDF generation and delivery persistence.'],operationalImpact:'Nenhum: fixtures isoladas R19/R20, sem alteração de regra fiscal.'};
report.limits.push('XML sintético tpAmb=2 e assinatura fabricada não validada; PDF sem validade jurídica.');
let issues=0,cancellations=0,posts=0,uploads=0,uncertainIssue=false,uncertainCloud=false,uncertainCancellation=false;
let currentKey=key;
const noLog={info(){},warn(){},error(){}};
const ok=step=>{report.steps.push(step);console.log('PASS '+step);};
try {
 const [database]=await db.$queryRaw`SELECT current_database() AS name`;assert.equal(database.name,url.pathname.slice(1));
 const owner=await db.client.create({data:{name:prefix,email:prefix+'@example.invalid',login:prefix,passwordHash:'SEM-LOGIN'}});
 const legacy=await db.company.create({data:{clientId:owner.id,razaoSocial:'SINTETICA SEM VALIDADE FISCAL',cnpj:prefix,atividades:[]}});
 const portal=await db.portalClient.create({data:{companyId:legacy.id,cnpj:prefix,razao:'SINTETICA',emissaoClienteLiberada:true}});
 const user=await db.user.create({data:{email:prefix+'-user@example.invalid',passwordHash:'SEM-LOGIN',accountType:'CLIENT',status:'active'}});
 await db.companyClientUser.create({data:{companyId:portal.id,userId:user.id,role:'CLIENT_ADMIN',status:'ACTIVE'}});
 const canal=await db.canalWhatsapp.create({data:{chave:prefix,finalidade:'SUPORTE',ativo:true}});
 const conversa=await db.conversaWhatsapp.create({data:{canalId:canal.id,portalClientId:portal.id,telefoneE164:'5521000000000',chaveEscopo:prefix,escopoVerificado:true}});
 await db.contatoWhatsapp.create({data:{portalClientId:portal.id,userId:user.id,nome:'SINTETICO',telefoneE164:conversa.telefoneE164,ativo:true,permissoesAssistente:['EMISSAO_NFSE','CANCELAMENTO_NFSE','NOTAS_DANFSE']}});
 const deps={...DEPS_PADRAO,resolveLegacyCompanyId:async()=>legacy.id,NfseService:{
  issue:async({data,antesDeEnviar,autorizarEnvioFinal})=>{
   assert.equal(Number(data.valorServicos),1);assert.equal(data.companyId,legacy.id);
   const pending=await db.serviceInvoice.create({data:{companyId:legacy.id,tomadorDoc:'00000000000',tomadorNome:'SINTETICO',valorServicos:1,status:'pending'}});
   await antesDeEnviar(pending.id);await autorizarEnvioFinal();issues++;
   if(uncertainIssue)return {status:'falha_envio',invoiceId:pending.id,indeterminado:true};
   const nfse=await db.serviceInvoice.update({where:{id:pending.id},data:{status:'issued',numeroNfse:'18',chaveAcesso:currentKey,xml:xml.replaceAll(key,currentKey)}});
   return {status:'issued',nfse};
  },
  sendEvent:async args=>{assert.equal(args.companyId,legacy.id);assert.equal(args.chaveAcesso,currentKey);assert.equal(args.tipoEvento,'e101101');cancellations++;if(uncertainCancellation)throw Object.assign(Error('Timeout sintético'),{camada:'TRANSPORTE'});return {status:'accepted'};}
 }};
 const create=(tipo,payload)=>criarPendencia({conversaId:conversa.id,portalClientId:portal.id,userId:user.id,tipo,payload,corpo:'TESTE SINTETICO SEM ATO FISCAL',client:db});
 const confirm=acaoId=>confirmarEExecutar({acaoId,conversaId:conversa.id,portalClientId:portal.id,userId:user.id,client:db,deps,log:noLog});
 const emission=await create(TIPOS.EMITIR_NFSE,{valorServicos:1});
 const issued=await confirm(emission.acao.id);assert.equal(issued.resultado.status,'issued');assert.equal(issues,1);
 const invoice=await db.serviceInvoice.findUnique({where:{id:issued.resultado.nfseId}});assert.equal(invoice.chaveAcesso,key);assert.equal(invoice.xml,xml);assert.equal(Number(invoice.valorServicos),1);
 assert.match(invoice.xml,/<vServ>1\.00<\/vServ>/,'XML emitted fixture must declare exactly R$1 in the service amount field');
 assert.equal((await confirm(emission.acao.id)).executou,false);assert.equal(issues,1);
 ok('confirmarEExecutar + executor real emite R$1 na fronteira fake, vincula invoice/XML e recusa replay');
 const input=()=>db.mensagemWhatsapp.create({data:{conversaId:conversa.id,direcao:'in',tipo:'text',corpo:'DANFSE SINTETICO',providerMessageId:'test-'+randomUUID()}});
 const conferirAcesso=async()=>assert.equal((await autorizarEmissaoDoCliente({portalClientId:portal.id,userId:user.id,client:db})).ok,true);
 const cloud=new WhatsappCloudClient({config:{habilitada:true,token:'SINTETICO',phoneNumberId:'SINTETICO',versao:'v21.0',log:noLog},conferirConsentimento:async()=>{},fetchImpl:async(address,options)=>{
  if(String(address).endsWith('/media')){uploads++;return {ok:true,status:200,json:async()=>({id:'fake-media-'+uploads})};}
  assert.ok(String(address).endsWith('/messages'));const payload=JSON.parse(options.body);assert.equal(payload.to,conversa.telefoneE164);assert.equal(payload.type,'document');posts++;
  if(uncertainCloud)throw Object.assign(Error('Timeout fake'),{name:'AbortError'});
  return {ok:true,status:200,json:async()=>({messages:[{id:prefix+'-out-'+posts}]})};
 }});
 const gerar=args=>gerarDanfseDaNota({...args,client:db});
 const send=(msg,extra={})=>enviarDanfseWhatsapp({conversa,notaId:invoice.id,mensagemEntradaId:msg.id,client:db,cloud,conferirAcesso,gerar,...extra});
 const first=await input();const delivered=await send(first,{acaoId:emission.acao.id});
 const message=await db.mensagemWhatsapp.findUnique({where:{providerMessageId:delivered.wamid}});assert.ok(message);
 const file=await db.arquivoWhatsapp.findUnique({where:{mensagemId:message.id}});assert.ok(file.conteudo.length>1000);assert.equal(file.sha256,createHash('sha256').update(file.conteudo).digest('hex'));
 const pdf=await pdfParse(Buffer.from(file.conteudo));assert.equal(pdf.numpages,1);assert.match(pdf.text,/Valor da Operação\s*\/\s*Serviço\s*(?:R\$\s*)?1,00/,'PDF service amount label must be followed by R$1');assert.ok(pdf.text.replace(/\s/g,'').includes(key),'PDF must contain the issued invoice access key');
 assert.match(pdf.text,/SEM VALIDADE JURÍDICA/,'Homologation PDF must clearly state that it has no legal validity');
 assert.match(pdf.text,/ISSQN Apurado\s*(?:R\$\s*)?0,05/);assert.match(pdf.text,/NFS-e Gerada/);assert.doesNotMatch(pdf.text,/Substituição Gerada/);
 await send(first,{acaoId:emission.acao.id});assert.equal(posts,1);assert.equal(issues,1);
 ok('DANFSe real do mesmo invoice/XML de R$1; entrega fake persiste arquivo/hash/correlação e replay não envia');
 uncertainCloud=true;await assert.rejects(send(await input()));const postsAfterUnknown=posts;uncertainCloud=false;
 await assert.rejects(send(await input()));assert.equal(posts,postsAfterUnknown);
 assert.equal((await db.serviceInvoice.findUnique({where:{id:invoice.id}})).status,'issued');
 ok('resultado incerto de entrega bloqueia novo POST sem mudar a emissão');
 const cancellation=await create(TIPOS.CANCELAR_NFSE,{notaId:invoice.id,chaveAcesso:key,numero:'18',cMotivo:'1',justificativa:'Teste sintético sem validade fiscal'});
 const cancelled=await confirm(cancellation.acao.id);assert.equal(cancelled.resultado.status,'accepted');assert.equal(cancellations,1);
 const after=await db.serviceInvoice.findUnique({where:{id:invoice.id}});assert.equal(after.status,'cancelled');assert.equal(after.chaveAcesso,key);assert.equal(after.xml,xml);
 await confirm(cancellation.acao.id);assert.equal(cancellations,1);assert.equal(issues,1);
 ok('cancelamento pelo executor real usa mesma chave; repositório real atualiza mesma nota e replay não repete evento');
 currentKey=key.slice(0,-1)+'3';
 const concurrentEmission=await create(TIPOS.EMITIR_NFSE,{valorServicos:1});const concurrentIssued=await confirm(concurrentEmission.acao.id);
 assert.equal(concurrentIssued.resultado.status,'issued');
 const otherConversation=await db.conversaWhatsapp.create({data:{canalId:canal.id,portalClientId:portal.id,telefoneE164:conversa.telefoneE164,chaveEscopo:prefix+'-second-thread',escopoVerificado:true}});
 const concurrentPayload={notaId:concurrentIssued.resultado.nfseId,chaveAcesso:currentKey,numero:'18',cMotivo:'1',justificativa:'Concorrência sintética entre fios'};
 const one=await create(TIPOS.CANCELAR_NFSE,concurrentPayload);
 const two=await criarPendencia({conversaId:otherConversation.id,portalClientId:portal.id,userId:user.id,tipo:TIPOS.CANCELAR_NFSE,payload:concurrentPayload,corpo:'TESTE SINTETICO CONCORRENTE',client:db});
 const beforeConcurrent=cancellations;
 const race=await Promise.allSettled([confirm(one.acao.id),confirmarEExecutar({acaoId:two.acao.id,conversaId:otherConversation.id,portalClientId:portal.id,userId:user.id,client:db,deps,log:noLog})]);
 assert.equal(cancellations-beforeConcurrent,1,'Different conversations cannot send the same cancellation twice');
 assert.equal(race.filter(r=>r.status==='fulfilled'&&r.value.executou===true).length,1);
 assert.equal((await db.serviceInvoice.findUnique({where:{id:concurrentIssued.resultado.nfseId}})).status,'cancelled');
 ok('duas ações pendentes de fios diferentes cancelam mesma chave uma única vez em PostgreSQL');
 currentKey=key.slice(0,-1)+'2';
 const another=await create(TIPOS.EMITIR_NFSE,{valorServicos:1});const anotherIssued=await confirm(another.acao.id);
 assert.equal(anotherIssued.resultado.status,'issued');
 uncertainCancellation=true;
 const cancelPayload={notaId:anotherIssued.resultado.nfseId,chaveAcesso:currentKey,numero:'18',cMotivo:'1',justificativa:'Teste sintético de timeout'};
 const uncertainCancel=await create(TIPOS.CANCELAR_NFSE,cancelPayload);const cancelResult=await confirm(uncertainCancel.acao.id);
 assert.equal(cancelResult.resultado.indeterminado,true);assert.equal(cancellations,3);
 await confirm(uncertainCancel.acao.id);assert.equal(cancellations,3);
 assert.equal((await db.serviceInvoice.findUnique({where:{id:anotherIssued.resultado.nfseId}})).status,'issued');
 ok('cancelamento incerto conserva nota issued e replay da mesma ação não repete evento');
 // Characterize, do not execute, a new action after uncertainty. This is a product limitation.
 let newCancelBlocked=false;
 try {
  const newCancel=await create(TIPOS.CANCELAR_NFSE,cancelPayload);
  await db.acaoPendenteWhatsapp.update({where:{id:newCancel.acao.id},data:{status:'cancelada'}});
  report.finding='Nova ação de cancelamento da mesma chave incerta foi criada; fixture cancelada sem executar evento. Deve ser bloqueada até conciliação.';
 } catch(error) {if(error.code!=='NFSE_RESULTADO_INDETERMINADO')throw error;newCancelBlocked=true;}
 uncertainIssue=true;const unknown=await create(TIPOS.EMITIR_NFSE,{valorServicos:1});const uncertain=await confirm(unknown.acao.id);assert.equal(uncertain.resultado.indeterminado,true);
 await confirm(unknown.acao.id);assert.equal(issues,4);await assert.rejects(create(TIPOS.EMITIR_NFSE,{valorServicos:1}),{code:'NFSE_RESULTADO_INDETERMINADO'});
 ok('segunda emissão sintética incerta preserva tentativa e bloqueia replay/novo pedido');
 assert.equal(networkAttempts,0);report.ids={portalId:portal.id,invoiceId:invoice.id,emissionActionId:emission.acao.id,cancelActionId:cancellation.acao.id,key};report.pdf={sha256:file.sha256,pages:pdf.numpages};
 assert.equal(newCancelBlocked,true,'Novo cancelamento da mesma chave incerta deve ser recusado');
 ok('nova ação de cancelamento da mesma chave incerta recusada até conciliação');report.passed=true;
} catch(error){report.error={code:error.code==='ERR_ASSERTION'?'HOMOLOG_CICLO_ASSERTION':'HOMOLOG_CICLO_FALHOU',causeCode:/^[A-Z][A-Z0-9_]{1,80}$/.test(error.code||'')?error.code:null};process.exitCode=1;console.error(report.error.code);}
finally {report.counts={issues,cancellations,posts,uploads,networkAttempts};await encerrarPoolEmissaoLocks();await db.$disconnect();console.log(JSON.stringify(report));}
