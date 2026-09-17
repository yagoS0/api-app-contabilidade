import { prisma } from '../../infrastructure/db/prisma.js';
import { erroIdentidade } from './IdentidadeComunicacaoService.js';

/** União explícita e auditada do histórico. Nunca copia contatos, RBAC, permissões ou consentimento. */
export async function associarNumeroConferido({ vinculoOrigemId, interlocutorDestinoId, versao, versaoDestino, evidencia, atorId, client=prisma }) {
  if (!Number.isInteger(versao) || !Number.isInteger(versaoDestino) || !String(evidencia || '').trim() || !atorId) throw erroIdentidade('CONFERENCIA_INVALIDA');
  const executar=async tx=>{
    const origem=await tx.vinculoNumeroInterlocutor.findUnique({where:{id:vinculoOrigemId},include:{interlocutor:{include:{numeros:true}}}});
    const destino=await tx.interlocutorComunicacao.findUnique({where:{id:interlocutorDestinoId}});
    if (!origem || origem.encerrouEm || !destino || destino.estado!=='ATIVO' || origem.interlocutorId===destino.id) throw erroIdentidade('ASSOCIACAO_INVALIDA');
    if (origem.interlocutor.numeros.length!==1) throw erroIdentidade('IDENTIDADE_COM_VARIOS_NUMEROS','Esta identidade tem mais de um número. A associação exige revisão individual dos históricos.');
    const ids=[origem.interlocutorId,destino.id].sort();
    const quando=new Date();
    // Ordem estável evita deadlock em duas tentativas inversas de associação.
    for(const id of ids){const esperada=id===destino.id?versaoDestino:versao;
      const r=await tx.interlocutorComunicacao.updateMany({where:{id,versao:esperada},data:{versao:{increment:1},atendidaDesde:quando}});
      if(!r.count) throw erroIdentidade('IDENTIDADE_ALTERADA');
    }
    const ativos=await tx.atendimentoLead.count({where:{interlocutorId:{in:ids},encerradoEm:null}});
    if(ativos>1) throw erroIdentidade('CASOS_COMERCIAIS_CONFLITANTES','Há uma solicitação ativa em cada contato. Resolva qual será atendida antes de reunir os históricos.');
    await tx.eventoIdentidadeComunicacao.create({data:{interlocutorId:destino.id,vinculoNumeroId:origem.id,versaoAnterior:versaoDestino,acao:'ASSOCIAR_NUMERO',atorId,evidencia:String(evidencia).trim().slice(0,2000),dados:{interlocutorOrigemId:origem.interlocutorId,versaoOrigem:versao}}});
    await tx.vinculoNumeroInterlocutor.update({where:{id:origem.id},data:{interlocutorId:destino.id,verificadoEm:quando,verificadoPor:atorId,evidencia:String(evidencia).trim().slice(0,2000)}});
    await tx.atendimentoLead.updateMany({where:{interlocutorId:origem.interlocutorId},data:{interlocutorId:destino.id,versao:{increment:1}}});
    // Preservar a chave mantém um retry antigo idempotente depois da associação.
    const notas=await tx.notaInternaAtendimento.findMany({where:{interlocutorId:origem.interlocutorId},select:{id:true,chaveIdempotencia:true}});
    const colisao=notas.length && await tx.notaInternaAtendimento.findFirst({where:{interlocutorId:destino.id,chaveIdempotencia:{in:notas.map(n=>n.chaveIdempotencia)}}});
    if(colisao) throw erroIdentidade('ASSOCIACAO_NOTAS_CONFLITANTES','Os históricos contêm referências de notas conflitantes. O escritório precisa revisar antes de associar.');
    await tx.notaInternaAtendimento.updateMany({where:{interlocutorId:origem.interlocutorId},data:{interlocutorId:destino.id}});
    const segmentos=await tx.conversaWhatsapp.findMany({where:{vinculoNumero:{interlocutorId:destino.id}},select:{id:true}});
    await tx.conversaWhatsapp.updateMany({where:{id:{in:segmentos.map(s=>s.id)}},data:{automacaoInvalidadaEm:quando,atendidaDesde:quando}});
    await tx.atendimentoResponsavelWhatsapp.updateMany({where:{vinculoNumero:{interlocutorId:destino.id}},data:{versao:{increment:1},aguardandoSelecao:true,expiraEm:null,automacaoInvalidadaEm:quando,atendidaDesde:quando}});
    await tx.acaoPendenteWhatsapp.updateMany({where:{conversaId:{in:segmentos.map(s=>s.id)},status:'pendente'},data:{status:'cancelada'}});
    await tx.turnoIaWhatsapp.updateMany({where:{conversaId:{in:segmentos.map(s=>s.id)},status:{in:['pendente','falhou','processando']}},data:{status:'ignorado',motivo:'IDENTIDADE_ASSOCIADA',reservaToken:null,leaseAte:null,concluidoEm:quando}});
    return {interlocutorId:destino.id,vinculoNumeroId:origem.id,versao:versaoDestino+1};
  };
  return typeof client.$transaction==='function'?client.$transaction(executar):executar(client);
}
