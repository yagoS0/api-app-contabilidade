import { prisma } from '../../infrastructure/db/prisma.js';
import { normalizarE164 } from './telefone.js';
import { garantirIdentidadeWhatsapp } from './IdentidadeComunicacaoService.js';
import { Prisma } from '@prisma/client';

/** Não envia, não concede papel, não confirma representante. Execução repetida conserva IDs. */
export async function backfillIdentidadeComunicacao({ aplicar = false, client = prisma } = {}) {
  if(aplicar && typeof client.$transaction==='function') return client.$transaction(tx=>backfillIdentidadeComunicacao({aplicar:true,client:tx}),{timeout:60000});
  const [contatos, conversas, atendimentos, vigencias, casosPrevios] = await Promise.all([
    client.contatoWhatsapp.findMany({ where: { telefoneE164: { not: null } }, select: { id:true,telefoneE164:true,waId:true,vinculoNumeroId:true,ativo:true } }),
    client.conversaWhatsapp.findMany({ select: { id:true,telefoneE164:true,vinculoNumeroId:true,canalId:true,atendidaPor:true,atendidaDesde:true } }),
    client.atendimentoResponsavelWhatsapp.findMany({ select: { id:true,telefoneE164:true,vinculoNumeroId:true,canalId:true,canal:true,atendidaPor:true,atendidaDesde:true } }),
    client.vinculoNumeroInterlocutor.findMany({select:{id:true,telefoneE164:true,geracao:true,encerrouEm:true,interlocutorId:true}}),
    client.atendimentoLead.findMany({where:{encerradoEm:null},select:{id:true,interlocutorId:true,conversa:{select:{telefoneE164:true,vinculoNumero:{select:{interlocutorId:true}}}}}}),
  ]);
  // Números do cadastro vêm antes dos aliases observados em mensagens.
  const numeros = [...new Set([...contatos,...conversas,...atendimentos].map(c=>c.telefoneE164).filter(Boolean))];
  const relatorio = { aplicar, numeros:numeros.length, vinculosCriados:0, conversasAssociadas:0, contatosAssociados:0, casosAssociados:0, conflitos:[] };
  const conversasMigradas=new Set(), sessoesMigradas=new Set(), corteMigracao=new Date();
  const pausasPorPessoa=new Map();
  const aliases=new Map();
  const candidatosAtuais=contatos.filter(c=>c.ativo && (!c.vinculoNumeroId || !vigencias.find(v=>v.id===c.vinculoNumeroId)?.encerrouEm));
  for(const contato of candidatosAtuais.filter(c=>c.waId)) {if(!aliases.has(contato.waId)) aliases.set(contato.waId,[]);aliases.get(contato.waId).push(contato);}
  for(const [alias,origens] of aliases) {
    const candidatos=[...origens,...candidatosAtuais.filter(c=>c.telefoneE164===alias)];
    if(new Set(candidatos.map(c=>c.telefoneE164)).size>1) relatorio.conflitos.push({tipo:'ALIAS_AMBIGUO',registroIds:[...new Set(candidatos.map(c=>c.id))]});
  }
  const casosPorPessoa=new Map();
  for(const caso of casosPrevios) {
    const telefone=caso.conversa.telefoneE164, referencias=aliases.get(telefone)||[];
    const numeroCanonico=new Set(referencias.map(c=>c.telefoneE164)).size===1?referencias[0].telefoneE164:telefone;
    const pessoa=caso.interlocutorId || caso.conversa.vinculoNumero?.interlocutorId || vigencias.find(v=>v.telefoneE164===numeroCanonico && !v.encerrouEm)?.interlocutorId || numeroCanonico;
    if(!casosPorPessoa.has(pessoa)) casosPorPessoa.set(pessoa,[]);casosPorPessoa.get(pessoa).push(caso.id);
  }
  for(const registros of casosPorPessoa.values()) if(registros.length>1) relatorio.conflitos.push({tipo:'CASOS_ATIVOS_DUPLICADOS',registroIds:registros});
  for (const numero of numeros) {
    if (normalizarE164(numero) !== numero) { relatorio.conflitos.push({tipo:'TELEFONE_FORA_DO_PADRAO',registroIds:[...contatos,...conversas].filter(c=>c.telefoneE164===numero).map(c=>c.id)}); continue; }
    const anteriores=vigencias.filter(v=>v.telefoneE164===numero),vigente=anteriores.find(v=>!v.encerrouEm);
    if(anteriores.length && (!vigente || vigente.geracao>1)) {
      const semIdentidade=[...contatos,...conversas,...atendimentos].filter(c=>c.telefoneE164===numero && !c.vinculoNumeroId).map(c=>c.id);
      if(semIdentidade.length) relatorio.conflitos.push({tipo:'HISTORICO_APOS_REUSO',registroIds:semIdentidade});
      continue;
    }
    if (!aplicar) continue;
    const existente = await client.vinculoNumeroInterlocutor.findFirst({where:{telefoneE164:numero,encerrouEm:null}});
    const identidade = await garantirIdentidadeWhatsapp({telefone:numero,canalId:'principal',client});
    const vinculo = identidade.vinculoNumero;
    // A pausa legada acompanha a pessoa no segundo canal. Reexecução não
    // ressuscita uma atribuição antiga depois de a equipe liberar o atendimento.
    const pausas=[...conversas,...atendimentos].filter(c=>c.telefoneE164===numero && !c.vinculoNumeroId && (c.atendidaPor || c.atendidaDesde));
    if(pausas.length) pausasPorPessoa.set(vinculo.interlocutorId,[...(pausasPorPessoa.get(vinculo.interlocutorId)||[]),...pausas]);
    if (!existente && vinculo.telefoneE164 === numero) {
      relatorio.vinculosCriados++;
      await client.vinculoNumeroInterlocutor.updateMany({where:{id:vinculo.id,verificadoEm:null},data:{origem:'CADASTRO_LEGADO'}});
    }
    if (identidade.interlocutor.estado === 'EM_REVISAO') relatorio.conflitos.push({tipo:'ALIAS_AMBIGUO',interlocutorId:identidade.interlocutor.id});
    const corte=corteMigracao;
    const idsParaMigrar=conversas.filter(c=>c.telefoneE164===numero && !c.vinculoNumeroId).map(c=>c.id);
    const atualizados = await client.conversaWhatsapp.updateMany({where:{id:{in:idsParaMigrar},vinculoNumeroId:null},data:{vinculoNumeroId:vinculo.id,canalId:'principal',automacaoInvalidadaEm:corte}});
    relatorio.conversasAssociadas+=atualizados.count;
    if(atualizados.count) {
      const migradas=await client.conversaWhatsapp.findMany({where:{id:{in:idsParaMigrar},vinculoNumeroId:vinculo.id,automacaoInvalidadaEm:corte},select:{id:true}});
      for(const c of migradas) conversasMigradas.add(c.id);
    }
    // Só primeira geração pode aproveitar registros ainda não migrados.
    if (vinculo.geracao===1) {
      const contatosAtualizados = await client.contatoWhatsapp.updateMany({where:{telefoneE164:numero,vinculoNumeroId:null},data:{vinculoNumeroId:vinculo.id}});
      relatorio.contatosAssociados+=contatosAtualizados.count;
    }
    for (const atendimento of atendimentos.filter(a=>a.telefoneE164===numero && !a.vinculoNumeroId)) {
      const outro = await client.atendimentoResponsavelWhatsapp.findFirst({where:{canalId:'principal',vinculoNumeroId:vinculo.id,NOT:{id:atendimento.id}}});
      if (outro) {relatorio.conflitos.push({tipo:'SESSOES_DUPLICADAS',registroIds:[outro.id,atendimento.id]});continue;}
      const atualizada=await client.atendimentoResponsavelWhatsapp.updateMany({where:{id:atendimento.id,vinculoNumeroId:null},data:{vinculoNumeroId:vinculo.id,canalId:'principal',versao:{increment:1},automacaoInvalidadaEm:corte,
        userId:null,portalClientId:null,conversaId:null,aguardandoSelecao:true,expiraEm:null,pedidoPendente:null,coletaPendenteConversaId:null,interacaoPendente:Prisma.DbNull,empresaIdsOferecidos:Prisma.DbNull}});
      if(atualizada.count) sessoesMigradas.add(atendimento.id);
    }
  }
  if (!aplicar) return relatorio;
  for(const [interlocutorId,pausas] of pausasPorPessoa) {
    const pausa=pausas.sort((a,b)=>new Date(b.atendidaDesde||0)-new Date(a.atendidaDesde||0))[0];
    await client.interlocutorComunicacao.updateMany({where:{id:interlocutorId,atendidaPor:null,atendidaDesde:null},data:{
      atendidaPor:pausa.atendidaPor || null,atendidaDesde:pausa.atendidaDesde || corteMigracao,
    }});
  }
  if(conversasMigradas.size || sessoesMigradas.size) {
    const contexto={OR:[{conversaId:{in:[...conversasMigradas]}},{atendimentoId:{in:[...sessoesMigradas]}}]};
    await client.acaoPendenteWhatsapp.updateMany({where:{...contexto,status:'pendente'},data:{status:'cancelada'}});
    await client.turnoIaWhatsapp.updateMany({where:{...contexto,status:{in:['pendente','falhou','processando']}},data:{status:'ignorado',motivo:'MIGRACAO_IDENTIDADE',reservaToken:null,leaseAte:null,concluidoEm:corteMigracao}});
    const rascunhos=await client.rascunhoEmissaoWhatsapp.findMany({where:contexto});
    for(const r of rascunhos) if(!['CONCLUIDO','CANCELADO','EQUIPE'].includes(r.estado?.status)) {
      const estado={...r.estado,status:'PAUSADO'};delete estado.codigo;
      await client.rascunhoEmissaoWhatsapp.updateMany({where:{id:r.id,versao:r.versao},data:{estado,versao:{increment:1}}});
    }
  }
  const casos = await client.atendimentoLead.findMany({where:{interlocutorId:null},include:{conversa:{include:{vinculoNumero:true}}}});
  const agrupados = new Map();
  for (const caso of casos) {
    const id = caso.conversa.vinculoNumero?.interlocutorId;
    if (!id) continue;
    if (!agrupados.has(id)) agrupados.set(id,[]);
    agrupados.get(id).push(caso);
  }
  for (const [interlocutorId, lista] of agrupados) {
    const ativos = lista.filter(c=>!c.encerradoEm);
    const jaAtivo = await client.atendimentoLead.findFirst({where:{interlocutorId,encerradoEm:null}});
    const conflito = ativos.length + (jaAtivo?1:0) > 1;
    if (conflito) {
      relatorio.conflitos.push({tipo:'CASOS_ATIVOS_DUPLICADOS',interlocutorId,registroIds:[...ativos.map(c=>c.id),...(jaAtivo?[jaAtivo.id]:[])]});
      await client.interlocutorComunicacao.update({where:{id:interlocutorId},data:{estado:'EM_REVISAO'}});
    }
    for (const caso of lista.filter(c=>!conflito || c.encerradoEm)) {
      await client.atendimentoLead.update({where:{id:caso.id},data:{interlocutorId}});
      relatorio.casosAssociados++;
    }
  }
  return relatorio;
}
