import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
const url=new URL(process.env.DATABASE_URL||'');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_governance_test'))throw Error('Somente PostgreSQL descartável loopback _governance_test.');
let redes=0;
const bloquear=()=>{redes++;throw Error('Rede externa proibida');};
globalThis.fetch=http.request=http.get=https.request=https.get=bloquear;
const {prisma:db}=await import('../src/infrastructure/db/prisma.js');
const {criarRepositorioTesteIa}=await import('../src/application/whatsapp/TesteIaWhatsappRepository.js');
const {criarTesteIaWhatsapp}=await import('../src/application/whatsapp/TesteIaWhatsappService.js');
const {processarEventoWhatsapp}=await import('../src/application/whatsapp/ProcessarEventoWhatsappService.js');
const {responderTesteWhatsapp}=await import('../src/application/assistente/AssistenteTesteWhatsappService.js');
const run=randomUUID(),telefone='5500000000000',repo=criarRepositorioTesteIa(db);
let user,empresa,conversa,contato,canal,modelo=0,envios=0;const ids=[];
let agora=new Date();
const servico=criarTesteIaWhatsapp({repo,agora:()=>agora,habilitado:()=>true,envioHabilitado:()=>true,
 resolverCanal:async()=>({phoneNumberId:'123456',wabaId:'654321'}),
 responder:args=>responderTesteWhatsapp({...args,assistente:{responder:async op=>{
   modelo++;assert.equal((await op.executar('emitir_nota',{destino:'terceiro'})).ok,false);
   assert.equal((await op.executar('registrar_atendimento',{campos:[{campo:'responsavelNome',acao:'set',valor:'Pessoa Fictícia'}]})).teste,true);
   return {texto:'Atendemos online. O contador fictício pode explicar as modalidades.',stopReason:'end_turn',usage:{input_tokens:50,output_tokens:20}};
 }}}),
 enviar:async({revalidar,correlacao})=>{
   const s=await revalidar();assert.equal(s.telefone,telefone);envios++;
   if(envios===1){
     assert.equal((await servico.interceptar({providerMessageId:`${run}-quote-real`,telefone,canalProvedorId:'123456',wabaProvedorId:'654321',tipo:'text',corpo:'Resposta operacional',respostaAProviderMessageId:`${run}-real-out`})).isolado,false);
     const precoce={object:'whatsapp_business_account',entry:[{id:'654321',changes:[{field:'messages',value:{metadata:{phone_number_id:'123456'},messages:[{id:`run-quote-antes-ack-${run}`,from:telefone,type:'text',timestamp:String(Math.floor(+agora/1000)),text:{body:'Paguei a guia'},context:{id:`${run}-out-1`}}]}}]}]};
     await processarEventoWhatsapp(precoce,{testeIa:servico});
     assert.equal((await repo.classificacao({providerMessageId:`run-quote-antes-ack-${run}`,canalProvedorId:'123456',wabaProvedorId:'654321'})).estado,'resposta_citada_isolada');
     assert.equal((await servico.interceptar({providerMessageId:`${run}-comum-pre-ack`,telefone,canalProvedorId:'123456',wabaProvedorId:'654321',tipo:'text',corpo:'Mensagem comum'})).isolado,false);
   }
   assert.equal((await servico.interceptarStatus({correlacaoTeste:correlacao,providerMessageId:`${run}-out-${envios}`,canalProvedorId:'123456',wabaProvedorId:'654321',status:'read'})).isolado,true);
   if(envios===1){
     const key='whatsapp:teste-ia:saida:'+createHash('sha256').update(`${run}-out-1`).digest('hex');
     await db.appSetting.delete({where:{key}}); // simula callback persistido, índice perdido
     assert.equal((await servico.interceptar({providerMessageId:`${run}-quote-sem-indice`,telefone,canalProvedorId:'123456',wabaProvedorId:'654321',tipo:'text',corpo:'Texto recuperável',respostaAProviderMessageId:`${run}-out-1`})).isolado,true);
   }
   return {wamid:`${run}-out-${envios}`};
 }});
const entrada=(id,texto,n)=>({providerMessageId:`${run}-in-${n}`,telefone,canalProvedorId:'123456',wabaProvedorId:'654321',tipo:'text',corpo:`/teste-ia ${id} ${texto}`,ocorridaEmProvedor:agora.toISOString()});
const snapshot=async()=>{
 const tables=await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('AppSetting','_prisma_migrations') ORDER BY tablename`;
 const out={};
 for(const {tablename:t} of tables){
   if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t))throw Error('Nome inesperado');
   out[t]=(await db.$queryRawUnsafe(`SELECT count(*)::text AS n, md5(coalesce(string_agg(row_to_json(x)::text, '' ORDER BY row_to_json(x)::text),'')) AS hash FROM "${t}" x`))[0];
 }
 return out;
};
try {
 user=await db.user.create({data:{email:`${run}@example.invalid`,passwordHash:'fixture-inutilizavel',role:'admin',status:'active',accountType:'FIRM'}});
 empresa=await db.portalClient.create({data:{razao:'EMPRESA FICTÍCIA TESTE ISOLAMENTO',cnpj:`99${String(Date.now()).slice(-12)}`}});
 contato=await db.contatoWhatsapp.create({data:{portalClientId:empresa.id,nome:'Contato sintético já vinculado',telefoneE164:telefone}});
 canal=await db.canalWhatsapp.create({data:{id:run,chave:run,phoneNumberId:'123456',wabaId:'654321',finalidade:'COMERCIAL'}});
 conversa=await db.conversaWhatsapp.create({data:{telefoneE164:telefone,chaveEscopo:run,portalClientId:empresa.id,atendidaPor:user.id,atendidaDesde:agora,canalId:canal.id}});
 await db.mensagemWhatsapp.create({data:{conversaId:conversa.id,direcao:'out',tipo:'text',corpo:'Saída operacional sintética preexistente',providerMessageId:`${run}-real-out`,autor:'HUMANO'}});
 const antes=await snapshot();
 const sessao=await servico.ativar({user,telefone,canalId:'comercial',envioReal:true,confirmacao:'TESTE_ISOLADO_COM_ENVIO_AO_NUMERO_INTERNO'});ids.push(sessao.id);
 const m=entrada(sessao.id,'Olá',1);
 const resultados=await Promise.all([servico.interceptar(m),servico.interceptar(m),servico.interceptar(entrada(sessao.id,'Quero abrir empresa de consultoria',2))]);
 assert.equal(resultados.filter(r=>r.estado==='duplicado').length,1);
 assert.equal(modelo,0);assert.equal((await repo.ler(sessao.id)).eventos.length,2);
 assert.equal((await repo.listar(agora)).some(s=>s.id===sessao.id),true);
 await Promise.all([servico.processarSessao(sessao.id),servico.processarSessao(sessao.id)]);
 await servico.processarSessao(sessao.id);
 await servico.interceptar(entrada(sessao.id,'Vocês atendem online?',3));await servico.processarSessao(sessao.id);
 assert.equal(modelo,1);assert.equal(envios,3);
 assert.equal((await servico.consultar({user,id:sessao.id})).quarentenas.some(q=>q.quarentena.texto==='Texto recuperável'),true);
 assert.equal((await repo.ler(sessao.id)).contexto.dados.responsavelNome,'Pessoa Fictícia');
 await servico.interceptar(entrada(sessao.id,'Falar com o contador',4));await servico.processarSessao(sessao.id);
 await servico.interceptar(entrada(sessao.id,'Paguei a guia',5));await servico.processarSessao(sessao.id);
 assert.equal((await repo.ler(sessao.id)).eventos.at(-1).estado,'pausa_local');assert.equal(envios,4);
 const payload={object:'whatsapp_business_account',entry:[{id:'654321',changes:[{field:'messages',value:{metadata:{phone_number_id:'123456'},messages:[{id:`${run}-webhook`,from:telefone,type:'text',timestamp:String(Math.floor(+agora/1000)),text:{body:'/teste-ia inválido'}}]}}]}]};
 await processarEventoWhatsapp(payload,{testeIa:servico});
 payload.entry[0].changes[0].value.messages[0].text.body='Paguei minha guia real';
 await processarEventoWhatsapp(payload,{testeIa:servico});
 assert.equal((await servico.interceptar({...m,providerMessageId:`run-normal-${run}`,corpo:'Mensagem comum'})).isolado,false);
 await servico.encerrar({user,id:sessao.id});
 assert.equal((await servico.interceptar(entrada(sessao.id,'Paguei',6))).estado,'expirado');
 const desligado=criarTesteIaWhatsapp({repo,habilitado:()=>false});
 assert.equal((await desligado.interceptarStatus({providerMessageId:`${run}-out-1`,status:'delivered',canalProvedorId:'123456',wabaProvedorId:'654321'})).isolado,true);
 payload.entry[0].changes[0].value.messages[0]={id:`${run}-reply`,from:telefone,type:'text',timestamp:String(Math.floor(+agora/1000)),text:{body:'Paguei a guia'},context:{id:`${run}-out-1`}};
 await processarEventoWhatsapp(payload,{testeIa:desligado});
 payload.entry[0].changes[0].value.messages[0]={id:`run-quote-antes-ack-${run}`,from:telefone,type:'text',timestamp:String(Math.floor(+agora/1000)),text:{body:'Paguei a guia'}};
 await processarEventoWhatsapp(payload,{testeIa:desligado});
 assert.deepEqual(await repo.listar(agora),[]);
 assert.deepEqual(await snapshot(),antes);assert.equal(redes,0);
 process.stdout.write(`PASS: fila concorrente, replay webhook, menu→IA→handoff, transporte/recibo isolado, flags OFF; ${Object.keys(antes).length} tabelas operacionais invariantes; zero rede externa.\n`);
} finally {
 for(const id of ids)await db.appSetting.deleteMany({where:{key:`whatsapp:teste-ia:v1:${id}`}});
 // Banco descartável: só recibos pertencentes à execução, sem limpar outras sessões.
 const rows=await db.appSetting.findMany({where:{key:{startsWith:'whatsapp:teste-ia:'}}});
 for(const row of rows)if(ids.includes(row.value?.id))await db.appSetting.delete({where:{key:row.key}});
 const invalidKey='whatsapp:teste-ia:entrada:'+createHash('sha256').update(JSON.stringify(['654321','123456',`${run}-webhook`])).digest('hex');
 await db.appSetting.deleteMany({where:{key:invalidKey}});
 if(conversa)await db.conversaWhatsapp.delete({where:{id:conversa.id}});
 if(canal)await db.canalWhatsapp.delete({where:{id:canal.id}});
 if(contato)await db.contatoWhatsapp.delete({where:{id:contato.id}});
 if(empresa)await db.portalClient.delete({where:{id:empresa.id}});
 if(user)await db.user.delete({where:{id:user.id}});
 await db.$disconnect();
}
