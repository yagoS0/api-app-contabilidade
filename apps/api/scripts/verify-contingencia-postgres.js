import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
const url = new URL(process.argv[2]);
const local = url.hostname === '127.0.0.1' && url.username === 'lead_test' && url.pathname === '/contingencia_check';
const ci = url.hostname === '127.0.0.1' && url.port === '55440' && url.pathname === '/lead_flow_check' && url.username === 'lead_test' && url.password === 'ci_test_only';
if (url.protocol !== 'postgresql:' || !(local || ci)) throw Error('Somente banco descartável local ou CI.');
process.env.DATABASE_URL = url.href;
const semRede = () => { throw Error('Provedores externos proibidos neste teste.'); };
globalThis.fetch = http.get = http.request = https.get = https.request = semRede;
const { prisma: db } = await import('../src/infrastructure/db/prisma.js');
const { consultaContingenciasComerciais, processarContingenciasComerciaisUmaVez } = await import('../src/application/onboarding/WatchdogComercialService.js');
const { podeNotificarInscricao, payloadPush } = await import('../src/application/whatsapp/AtendimentoPushService.js');
const { alterarAtendimentoHumano } = await import('../src/application/whatsapp/AtendimentoResponsavelWhatsappService.js');
const { resolverContingenciasComerciais } = await import('../src/application/onboarding/ContingenciaComercialService.js');
const agora = new Date();
const canal = await db.canalWhatsapp.create({data:{chave:`watchdog-${randomUUID()}`,finalidade:'COMERCIAL'}});
let numero = 1000;
const ids = new Set();
const client = { $queryRaw: async query => (await db.$queryRaw(query)).filter(r => ids.has(r.conversaId)), $transaction: db.$transaction.bind(db) };
async function fixture({idade=360000,saida=null,humano=false,pendente=false,fechado=false,finalidade='COMERCIAL',handoff=false}={}) {
 const p=await db.interlocutorComunicacao.create({data:{nome:'Sintético'}});
 const telefoneE164=`552199000${numero++}`;
 const v=await db.vinculoNumeroInterlocutor.create({data:{interlocutorId:p.id,telefoneE164}});
 const canalId=finalidade==='COMERCIAL'?canal.id:(await db.canalWhatsapp.create({data:{chave:randomUUID(),finalidade}})).id;
 const c=await db.conversaWhatsapp.create({data:{telefoneE164,vinculoNumeroId:v.id,canalId,chaveEscopo:`sem-empresa:${p.id}`,atendidaDesde:handoff?agora:null}});
 ids.add(c.id);
 const m=await db.mensagemWhatsapp.create({data:{conversaId:c.id,direcao:'in',tipo:'text',corpo:'Quero regularizar',providerMessageId:`wamid.${randomUUID()}`,registradaEm:new Date(agora-idade)}});
 if(saida)await db.mensagemWhatsapp.create({data:{conversaId:c.id,direcao:'out',tipo:'text',autor:'IA',corpo:'Sintética',statusEnvio:saida,registradaEm:new Date(agora-1000)}});
 const o=fechado?await db.onboarding.create({data:{origem:'INATIVA',status:'DESISTIU',dados:{}}}):null;
 const a=await db.atendimentoLead.create({data:{conversaId:c.id,interlocutorId:p.id,onboardingId:o?.id,triagem:{preatendimento:{estado:handoff?'ENCAMINHADO':'EM_CONVERSA',intencao:'INATIVA',...(handoff?{encaminhadoEm:agora.toISOString()}:{})},...(pendente?{contingenciaIa:{estado:'PENDENTE'}}:{})}}});
 if(humano){const u=await db.user.create({data:{email:`${randomUUID()}@test.invalid`,name:'Contador',passwordHash:'teste'}});await db.conversaWhatsapp.update({where:{id:c.id},data:{atendidaPor:u.id}});}
 return {c,m,a};
}
try {
 const atrasado=await fixture(); const falha=await fixture({idade:60000,saida:'falhou'});
 const incerto=await fixture({idade:60000,saida:'indeterminado',handoff:true});
 const esgotado=await fixture({idade:60000});
 await db.turnoIaWhatsapp.create({data:{conversaId:esgotado.c.id,mensagemId:esgotado.m.id,perfil:'LEAD',status:'falhou',tentativas:5}});
 await fixture({saida:'entregue'});await fixture({saida:'enviado'});await fixture({idade:10000});
 await fixture({idade:2*86400000});await fixture({pendente:true});await fixture({fechado:true});await fixture({finalidade:'PRINCIPAL'});await fixture({humano:true});
 const primeira=await fixture(); await db.atendimentoLead.delete({where:{id:primeira.a.id}});
 const quedaAntesSaida=await fixture({handoff:true});
 const novaNaFila=await fixture({handoff:true});
 await db.atendimentoLead.update({where:{id:novaNaFila.a.id},data:{triagem:{preatendimento:{estado:'ENCAMINHADO',encaminhadoEm:new Date(agora-720000).toISOString()}}}});
 const rows=await client.$queryRaw(consultaContingenciasComerciais({agora})); 
 assert.deepEqual(new Set(rows.map(r=>r.mensagemId)),new Set([atrasado.m.id,falha.m.id,incerto.m.id,esgotado.m.id,primeira.m.id,quedaAntesSaida.m.id]));
 const before=await db.mensagemWhatsapp.count({where:{direcao:'out'}});
 const resultado=await processarContingenciasComerciaisUmaVez({client,agora});
 assert.equal(resultado.encaminhados,6);assert.equal(resultado.falhas,0);
 assert.equal(await db.mensagemWhatsapp.count({where:{direcao:'out'}}),before);
 const caso=await db.atendimentoLead.findUnique({where:{id:atrasado.a.id}});
 assert.equal(caso.triagem.contingenciaIa.estado,'PENDENTE');assert.equal(caso.triagem.preatendimento.intencao,'INATIVA');
 assert.equal((await processarContingenciasComerciaisUmaVez({client,agora})).encontrados,0);
 const contador=await db.user.create({data:{email:`contador-${randomUUID()}@test.invalid`,name:'Contador sintético',passwordHash:'teste',role:'contador',status:'active',accountType:'FIRM'}});
 const visitante=await db.user.create({data:{email:`cliente-${randomUUID()}@test.invalid`,name:'Cliente sintético',passwordHash:'teste',role:'user',status:'active',accountType:'CLIENT'}});
 const inscricao={ativa:true,userId:contador.id,fila:true,minhas:true};
 const evento=await db.eventoPushAtendimento.findUnique({where:{id:`contingencia:${esgotado.a.id}:${esgotado.m.id}`}});
 assert.equal(evento.tipo,'COMERCIAL_CONTINGENCIA');
 assert.ok(payloadPush({evento,inscricao}).url.startsWith('/comercial/conversas?'));
 await db.conversaWhatsapp.update({where:{id:esgotado.c.id},data:{lidaAteEm:new Date()}});
 assert.equal(await podeNotificarInscricao({inscricao,evento},{client:db}),true,'Ler não silencia tarefa humana pendente');
 assert.equal(await podeNotificarInscricao({inscricao:{...inscricao,userId:visitante.id},evento},{client:db}),false,'Cliente não pode receber aviso do escritório');
 assert.equal(await podeNotificarInscricao({inscricao:{...inscricao,fila:false},evento},{client:db}),false,'Preferência de fila respeitada');
 let callbackAssumir=false;
 const assumido=await alterarAtendimentoHumano({conversa:await db.conversaWhatsapp.findUnique({where:{id:esgotado.c.id}}),atendidaPor:contador.id,atendidaDesde:new Date(),client:db,
  aoAlterar:async(tx,conversaIds)=>{callbackAssumir=true;assert.ok(conversaIds.includes(esgotado.c.id));assert.equal((await tx.conversaWhatsapp.findUnique({where:{id:esgotado.c.id}})).atendidaPor,contador.id);}});
 assert.equal(callbackAssumir,true);
 assert.equal(assumido.conversa.atendidaPor,contador.id);
 const turno=await db.turnoIaWhatsapp.findUnique({where:{mensagemId:esgotado.m.id}});
 assert.equal(turno.status,'ignorado');assert.equal(turno.motivo,'ASSUMIDA_POR_HUMANO');
 assert.equal(await podeNotificarInscricao({inscricao,evento},{client:db}),true,'Responsável recebe suas pendências');
 assert.equal(await podeNotificarInscricao({inscricao:{...inscricao,minhas:false},evento},{client:db}),false);
 const resumoAntes=(await db.atendimentoLead.findUnique({where:{id:esgotado.a.id}})).triagem.preatendimento;
 const devolvido=await alterarAtendimentoHumano({conversa:assumido.conversa,client:db,aoAlterar:async(tx,conversaIds)=>{
  const r=await resolverContingenciasComerciais({conversaIds,responsavelId:contador.id,client:tx});assert.equal(r.resolvidas,1);
 }});
 assert.equal(devolvido.conversa.atendidaPor,null);
 const casoResolvido=await db.atendimentoLead.findUnique({where:{id:esgotado.a.id}});
 assert.deepEqual(casoResolvido.triagem.preatendimento,resumoAntes);
 assert.equal(casoResolvido.triagem.contingenciaIa.estado,'RESOLVIDA');
 assert.equal(await podeNotificarInscricao({inscricao,evento},{client:db}),false,'Alerta antigo cancelado ao devolver');
 const recebidaEm=new Date(Date.now()+1000);
 const nova=await db.mensagemWhatsapp.create({data:{conversaId:esgotado.c.id,direcao:'in',tipo:'text',corpo:'Ainda preciso regularizar',providerMessageId:`wamid.${randomUUID()}`,registradaEm:recebidaEm}});
 const depois=new Date(recebidaEm.getTime()+360000);
 // Neste ciclo avançamos o relógio apenas para a conversa devolvida; os casos
 // sintéticos recentes da matriz anterior não fazem parte desse cenário.
 ids.clear(); ids.add(esgotado.c.id);
 assert.equal((await processarContingenciasComerciaisUmaVez({client,agora:depois})).encaminhados,1);
 const novoEvento=await db.eventoPushAtendimento.findUnique({where:{id:`contingencia:${esgotado.a.id}:${nova.id}`}});
 assert.ok(novoEvento);assert.notEqual(novoEvento.id,evento.id);
 assert.equal(await podeNotificarInscricao({inscricao,evento:novoEvento},{client:db}),true);
 assert.equal(await podeNotificarInscricao({inscricao,evento},{client:db}),false);
 assert.equal(await db.mensagemWhatsapp.count({where:{direcao:'out'}}),before,'Sem reenvio automático ou duplicata');
 console.log('PASS: 15 fluxos SQL reais; 6 handoffs; contexto preservado; repetição sem duplicatas e nenhum WhatsApp enviado.');
 console.log('PASS: aviso após leitura; permissão FIRM/contador; assumir cancela turno; callback transacional; resumo preservado; devolver resolve alerta; nova falha cria novo aviso.');
} finally { await db.$disconnect(); }


