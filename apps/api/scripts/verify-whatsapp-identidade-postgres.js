import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid');
const alvoLocal=url.hostname==='127.0.0.1' && url.port==='55443' && url.pathname==='/comunicacao_v2_check' && url.username==='lead_test' && url.password==='lead_test';
const alvoCi=url.hostname==='127.0.0.1' && url.port==='55439' && url.pathname==='/whatsapp_delivery_check' && url.username==='whatsapp_check' && url.password==='ci_test_only';
if (!alvoLocal && !alvoCi) throw new Error('Use exclusivamente o banco descartável autorizado local ou da CI.');
globalThis.fetch = () => {throw new Error('Rede externa proibida neste teste.');};
const { prisma } = await import('../src/infrastructure/db/prisma.js');
const { garantirIdentidadeWhatsapp, conferirIdentidadeVigente, conferirIdentificacao } = await import('../src/application/whatsapp/IdentidadeComunicacaoService.js');
const { listarInboxWhatsapp, lerHistoricoIdentidade, registrarLeituraIdentidade, salvarNotaInterna } = await import('../src/application/whatsapp/InboxWhatsappService.js');
const { resolverVinculoPorTelefone } = await import('../src/application/whatsapp/ContatoWhatsappService.js');
const { backfillIdentidadeComunicacao } = await import('../src/application/whatsapp/BackfillIdentidadeComunicacaoService.js');
const { associarNumeroConferido } = await import('../src/application/whatsapp/AssociacaoNumeroComunicacaoService.js');
const { filtroSegmentosDoCanal } = await import('../src/application/whatsapp/CanalWhatsappService.js');
const rollback = new Error('ROLLBACK_IDENTIDADE_TESTE');
let checks=0;
try {
  await prisma.$transaction(async tx => {
    const prefixo=`identidade-test-${randomUUID()}`, telefone='552199123'+String(Date.now()).slice(-4);
    const empresas=[];
    for(let n=0;n<3;n++) empresas.push(await tx.portalClient.create({data:{id:`${prefixo}-e${n}`,razao:`${prefixo} Empresa ${n}`,cnpj:`77${String(Date.now()).slice(-10)}0${n}`}}));
    const ident=await garantirIdentidadeWhatsapp({telefone,client:tx});
    const c=[];
    for (let n=0;n<3;n++) {
      await tx.contatoWhatsapp.create({data:{nome:`${prefixo} Pessoa`,portalClientId:empresas[n].id,telefoneE164:telefone,vinculoNumeroId:ident.vinculoNumero.id,ativo:true}});
      c.push(await tx.conversaWhatsapp.create({data:{telefoneE164:telefone,chaveEscopo:`empresa:${prefixo}-${n}`,portalClientId:empresas[n].id,escopoVerificado:true,canalId:'principal',vinculoNumeroId:ident.vinculoNumero.id}}));
    }
    const neutra=await tx.conversaWhatsapp.create({data:{telefoneE164:telefone,chaveEscopo:`sem-empresa:${prefixo}`,canalId:'principal',vinculoNumeroId:ident.vinculoNumero.id}});
    const msg=[];
    for (let n=0;n<3;n++) msg.push(await tx.mensagemWhatsapp.create({data:{conversaId:c[n].id,direcao:'in',providerMessageId:`${prefixo}-${n}`,tipo:'text',corpo:`Guia ${n}`,registradaEm:new Date(Date.now()-5000+n*1000)}}));
    await tx.mensagemWhatsapp.create({data:{conversaId:neutra.id,direcao:'in',providerMessageId:`${prefixo}-neutra`,tipo:'text',corpo:'Mensagem geral privada'}});
    const visiveis=empresas.map(e=>e.id);
    const lista=await listarInboxWhatsapp({visiveis,operadorId:'test',q:prefixo,limite:1,client:tx});
    assert.equal(lista.conversas.length,1);assert.equal(lista.temMais,false);assert.equal(lista.conversas[0].relacionamento.tipo,'CLIENTE');assert.equal(lista.conversas[0].empresas.length,3);checks++;
    const telefoneLead=telefone.slice(0,-1)+(telefone.at(-1)==='9'?'8':'9');
    const novoLead=await garantirIdentidadeWhatsapp({telefone:telefoneLead,client:tx});
    const conversaLead=await tx.conversaWhatsapp.create({data:{telefoneE164:telefoneLead,nomePerfilProvedor:`${prefixo} Lead`,chaveEscopo:`sem-empresa:${prefixo}-lead`,canalId:'principal',vinculoNumeroId:novoLead.vinculoNumero.id}});
    const onboarding=await tx.onboarding.create({data:{origem:'ABERTURA'}});
    await tx.atendimentoLead.create({data:{conversaId:conversaLead.id,interlocutorId:novoLead.interlocutor.id,onboardingId:onboarding.id}});
    const pagina1=await listarInboxWhatsapp({visiveis,operadorId:'test',q:prefixo,limite:1,client:tx});
    assert.equal(pagina1.temMais,true);
    const pagina2=await listarInboxWhatsapp({visiveis,operadorId:'test',q:prefixo,limite:1,cursor:pagina1.proximoCursor,client:tx});
    assert.equal(pagina2.temMais,false);assert.equal(pagina2.conversas.length,1);assert.notEqual(pagina1.conversas[0].interlocutorId,pagina2.conversas[0].interlocutorId);checks++;
    const leads=await listarInboxWhatsapp({visiveis,operadorId:'test',q:prefixo,relacionamento:'LEAD',client:tx});assert.equal(leads.conversas.length,1);assert.equal(leads.conversas[0].solicitacaoComercial.origem,'ABERTURA');checks++;
    const historico=await lerHistoricoIdentidade({conversaId:c[0].id,visiveis,client:tx});
    assert.equal(historico.mensagens.length,4);assert.equal((await tx.conversaWhatsapp.findUnique({where:{id:c[0].id}})).lidaAteEm,null);checks++;
    const parcial=await lerHistoricoIdentidade({conversaId:c[0].id,visiveis:[empresas[0].id],client:tx});
    assert.equal(parcial.mensagens.length,1);assert.equal(parcial.conversa.capacidades.escoposNotas.some(e=>e.escopo==='PESSOA'),false);checks++;
    await assert.rejects(()=>salvarNotaInterna({conversaId:c[0].id,visiveis:[empresas[0].id],autor:{id:'test'},texto:'privado',escopo:'PESSOA',chaveIdempotencia:'nota-pessoa-negada',client:tx}),e=>e.code==='escopo_nota_nao_autorizado');checks++;
    const notaArgs={conversaId:c[0].id,visiveis,autor:{id:'test',name:'Equipe'},texto:'Somente equipe',escopo:'PESSOA',chaveIdempotencia:'nota-pessoa-idempotente',client:tx};
    const nota=await salvarNotaInterna(notaArgs);assert.equal((await salvarNotaInterna(notaArgs)).nota.id,nota.nota.id);
    assert.equal(await tx.mensagemWhatsapp.count({where:{conversaId:{in:[...c.map(x=>x.id),neutra.id]}}}),4);checks++;
    await registrarLeituraIdentidade({conversaId:c[0].id,mensagemId:msg[1].id,visiveis,client:tx});
    const depois=await listarInboxWhatsapp({visiveis,operadorId:'test',q:prefixo,naoLidas:true,client:tx});assert.equal(depois.conversas[0].naoLidas,2);checks++;
    const out=await tx.canalWhatsapp.create({data:{id:`${prefixo}-comercial`,chave:`${prefixo}-comercial`,finalidade:'COMERCIAL'}});
    await tx.conversaWhatsapp.create({data:{telefoneE164:telefone,chaveEscopo:`sem-empresa:${prefixo}-canal2`,canalId:out.id,vinculoNumeroId:ident.vinculoNumero.id}});
    const dois=await listarInboxWhatsapp({visiveis,operadorId:'test',q:prefixo,relacionamento:'CLIENTE',client:tx});assert.equal(dois.conversas[0].canais.length,2);assert.equal(dois.conversas[0].canais.find(s=>s.id===out.id).janela.situacao,'NUNCA_ABERTA');checks++;
    // O wa_id observado pode diferir do cadastro. Dentro da mesma vigência/canal,
    // ele abre a janela do contato canônico; nunca a de outro remetente empresarial.
    const alias=`552188${String(Date.now()).slice(-7)}`;
    await tx.contatoWhatsapp.updateMany({where:{vinculoNumeroId:ident.vinculoNumero.id},data:{waId:alias}});
    const segmentoAlias=await tx.conversaWhatsapp.create({data:{telefoneE164:alias,chaveEscopo:`sem-empresa:${prefixo}-alias`,canalId:'principal',vinculoNumeroId:ident.vinculoNumero.id}});
    const mensagemAlias=await tx.mensagemWhatsapp.create({data:{conversaId:segmentoAlias.id,direcao:'in',providerMessageId:`${prefixo}-alias`,tipo:'text',corpo:'Janela pelo alias observado',registradaEm:new Date(Date.now()+1000)}});
    const ultima=await tx.mensagemWhatsapp.findFirst({where:{direcao:'in',conversa:filtroSegmentosDoCanal(c[0])},orderBy:{registradaEm:'desc'}});
    assert.equal(ultima.id,mensagemAlias.id);assert.equal(filtroSegmentosDoCanal(c[0]).telefoneE164,undefined);checks++;
    const titular=await conferirIdentificacao({vinculoNumeroId:ident.vinculoNumero.id,versao:1,acao:'NOVO_TITULAR',evidencia:'Conferência sintética de troca',atorId:'test',nome:'Novo titular fictício',client:tx});
    assert.notEqual(titular.interlocutor.id,ident.interlocutor.id);assert.equal(titular.vinculoNumero.geracao,2);
    assert.equal(await tx.contatoWhatsapp.count({where:{vinculoNumeroId:titular.vinculoNumero.id}}),0);
    await assert.rejects(()=>conferirIdentidadeVigente({vinculoNumeroId:ident.vinculoNumero.id,client:tx}),e=>e.code==='IDENTIDADE_ALTERADA');checks++;
    assert.equal((await resolverVinculoPorTelefone(telefone,{client:tx})).situacao,'DESCONHECIDO');checks++;
    const novo=await garantirIdentidadeWhatsapp({telefone,client:tx});assert.equal(novo.vinculoNumero.id,titular.vinculoNumero.id);checks++;
    const conversaTitular=await tx.conversaWhatsapp.create({data:{telefoneE164:telefone,chaveEscopo:`sem-empresa:${prefixo}-novotitular`,canalId:'principal',vinculoNumeroId:novo.vinculoNumero.id}});
    const historicoTitular=await lerHistoricoIdentidade({conversaId:conversaTitular.id,visiveis,client:tx});assert.equal(historicoTitular.mensagens.length,0);assert.equal(historicoTitular.notasInternas.length,0);assert.equal(historicoTitular.conversa.relacionamento.tipo,'A_IDENTIFICAR');assert.equal(historicoTitular.conversa.janela.situacao,'NUNCA_ABERTA');checks++;
    assert.equal(await tx.eventoIdentidadeComunicacao.count({where:{interlocutorId:ident.interlocutor.id}}),1);checks++;
    // Histórico ainda não migrado não pode ser ligado ao novo titular pelo telefone.
    const legadoReuso=await tx.conversaWhatsapp.create({data:{telefoneE164:telefone,chaveEscopo:`sem-empresa:${prefixo}-legado-reuso`}});
    const sessaoReuso=await tx.atendimentoResponsavelWhatsapp.create({data:{telefoneE164:telefone}});
    // Uma migração nova corta os comandos preparados com o contexto legado.
    const telefoneLegado=`552177${String(Date.now()).slice(-7)}`;
    const legado=await tx.conversaWhatsapp.create({data:{telefoneE164:telefoneLegado,chaveEscopo:`sem-empresa:${prefixo}-legado`,portalClientId:empresas[0].id}});
    const sessaoLegado=await tx.atendimentoResponsavelWhatsapp.create({data:{telefoneE164:telefoneLegado,portalClientId:empresas[0].id,conversaId:legado.id,aguardandoSelecao:false,pedidoPendente:'emitir nota',interacaoPendente:{id:'menu-antigo'},empresaIdsOferecidos:[empresas[0].id],expiraEm:new Date(Date.now()+60000)}});
    const acao=await tx.acaoPendenteWhatsapp.create({data:{conversaId:legado.id,portalClientId:empresas[0].id,tipo:'EMITIR_NFSE',payload:{},textoDeConfirmacao:'Exemplo',codigo:'ABCD',expiraEm:new Date(Date.now()+60000)}});
    const turno=await tx.turnoIaWhatsapp.create({data:{conversaId:legado.id,mensagemId:randomUUID()}});
    const rascunho=await tx.rascunhoEmissaoWhatsapp.create({data:{conversaId:legado.id,portalClientId:empresas[0].id,userId:'test',estado:{status:'RESUMO',codigo:'ABCD'},ultimaMensagemEm:new Date(),expiraEm:new Date(Date.now()+60000)}});
    const pre=await backfillIdentidadeComunicacao({client:tx});assert.ok(pre.conflitos.some(c=>c.tipo==='HISTORICO_APOS_REUSO'&&c.registroIds.includes(legadoReuso.id)));assert.equal((await tx.conversaWhatsapp.findUnique({where:{id:legado.id}})).vinculoNumeroId,null);checks++;
    const migracao=await backfillIdentidadeComunicacao({aplicar:true,client:tx});
    assert.equal(await tx.contatoWhatsapp.count({where:{vinculoNumeroId:titular.vinculoNumero.id}}),0);checks++;
    assert.ok(migracao.conflitos.some(c=>c.tipo==='HISTORICO_APOS_REUSO'));assert.equal((await tx.conversaWhatsapp.findUnique({where:{id:legadoReuso.id}})).vinculoNumeroId,null);assert.equal((await tx.atendimentoResponsavelWhatsapp.findUnique({where:{id:sessaoReuso.id}})).vinculoNumeroId,null);checks++;
    const migrada=await tx.conversaWhatsapp.findUnique({where:{id:legado.id}}),sessaoMigrada=await tx.atendimentoResponsavelWhatsapp.findUnique({where:{id:sessaoLegado.id}});
    assert.ok(migrada.automacaoInvalidadaEm);assert.equal(migrada.lidaAteEm,null);assert.equal(sessaoMigrada.versao,2);assert.equal(sessaoMigrada.aguardandoSelecao,true);assert.equal(sessaoMigrada.pedidoPendente,null);assert.equal(sessaoMigrada.interacaoPendente,null);assert.equal(sessaoMigrada.expiraEm,null);
    assert.equal((await tx.acaoPendenteWhatsapp.findUnique({where:{id:acao.id}})).status,'cancelada');assert.equal((await tx.turnoIaWhatsapp.findUnique({where:{id:turno.id}})).motivo,'MIGRACAO_IDENTIDADE');assert.deepEqual((await tx.rascunhoEmissaoWhatsapp.findUnique({where:{id:rascunho.id}})).estado,{status:'PAUSADO'});checks++;
    await backfillIdentidadeComunicacao({aplicar:true,client:tx});
    assert.equal((await tx.conversaWhatsapp.findUnique({where:{id:legado.id}})).automacaoInvalidadaEm.getTime(),migrada.automacaoInvalidadaEm.getTime());assert.equal((await tx.atendimentoResponsavelWhatsapp.findUnique({where:{id:sessaoLegado.id}})).versao,2);assert.equal((await tx.rascunhoEmissaoWhatsapp.findUnique({where:{id:rascunho.id}})).versao,2);checks++;
    const anotacaoArgs={conversaId:conversaTitular.id,visiveis,autor:{id:'test',name:'Equipe'},texto:'Conferência do novo número',escopo:'PESSOA',chaveIdempotencia:'nota-associacao-idempotente',client:tx};
    const anotacao=await salvarNotaInterna(anotacaoArgs);
    await associarNumeroConferido({vinculoOrigemId:novo.vinculoNumero.id,interlocutorDestinoId:novoLead.interlocutor.id,versao:1,versaoDestino:1,evidencia:'Mesmo representante conferido em canal conhecido — exemplo sintético',atorId:'test',client:tx});
    assert.equal((await tx.vinculoNumeroInterlocutor.findUnique({where:{id:novo.vinculoNumero.id}})).interlocutorId,novoLead.interlocutor.id);
    assert.equal((await salvarNotaInterna(anotacaoArgs)).nota.id,anotacao.nota.id);
    assert.equal(await tx.contatoWhatsapp.count({where:{vinculoNumeroId:novo.vinculoNumero.id}}),0);checks++;
    // O inventário deve antecipar conflitos de alias e de casos antes de aplicar.
    const telefoneConflito=`552166${String(Date.now()).slice(-7)}`;
    await tx.contatoWhatsapp.create({data:{nome:'Contato ambíguo sintético',portalClientId:empresas[0].id,telefoneE164:telefoneConflito,waId:telefoneLegado,ativo:true}});
    await tx.contatoWhatsapp.create({data:{nome:'Contato canônico sintético',portalClientId:empresas[1].id,telefoneE164:telefoneLegado,ativo:true}});
    const casoDuplicado=await tx.conversaWhatsapp.create({data:{telefoneE164:telefoneLead,chaveEscopo:`sem-empresa:${prefixo}-caso-duplicado`,canalId:'principal',vinculoNumeroId:novoLead.vinculoNumero.id}});
    await tx.atendimentoLead.create({data:{conversaId:casoDuplicado.id}});
    const inventario=await backfillIdentidadeComunicacao({client:tx});assert.ok(inventario.conflitos.some(c=>c.tipo==='ALIAS_AMBIGUO'));assert.ok(inventario.conflitos.some(c=>c.tipo==='CASOS_ATIVOS_DUPLICADOS'));checks++;
    throw rollback;
  },{timeout:60000});
} catch(err) {if(err!==rollback) throw err;}
finally {await prisma.$disconnect();}
console.log(JSON.stringify({ok:true,checks,redeExterna:false,transacaoRevertida:true}));
