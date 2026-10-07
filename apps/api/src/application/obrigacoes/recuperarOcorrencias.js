import { prisma } from '../../infrastructure/db/prisma.js';
import { ObrigacaoError, dataCivil } from './ObrigacoesService.js';
import { cicloDaOcorrencia, cicloPermitido } from './agendaSerie.js';

export async function listarExcluidas({portalIds, inicio, fim}, db=prisma) {
  const de=dataCivil(inicio), ate=dataCivil(fim);
  if(ate<de || ate-de>366*86400000) throw new ObrigacaoError('periodo_invalido','Escolha um período de até um ano.');
  const rows=await db.ocorrenciaObrigacao.findMany({where:{canceladaEm:{not:null},obrigacao:{portalClientId:{in:portalIds},ativa:true},OR:[{dataInicio:{lte:ate},dataFim:{gte:de}},{dataInicio:null,dataVencimento:{gte:de,lte:ate}}]},include:{obrigacao:{include:{portalClient:{select:{razao:true}}}}},orderBy:[{canceladaEm:'desc'},{id:'asc'}],take:501});
  if(rows.length>500) throw new ObrigacaoError('periodo_extenso','Há muitas exclusões. Escolha um período menor.');
  const iso=d=>d?.toISOString().slice(0,10);
  return rows.map(o=>({id:o.id,regraId:o.obrigacao.regraId,companyId:o.obrigacao.portalClientId,empresa:o.obrigacao.portalClient.razao,titulo:o.agendaConfig?.titulo || o.obrigacao.nome,dataInicio:iso(o.dataInicio || o.dataVencimento),dataFim:iso(o.dataFim || o.dataVencimento),canceladaEm:o.canceladaEm.toISOString(),restauravel:!o.foraDaRecorrencia && cicloPermitido(o.obrigacao,cicloDaOcorrencia(o,o.obrigacao))}));
}

export async function restaurarOcorrencias({portalIds,ids,userId}, db=prisma) {
  if(!Array.isArray(ids) || !ids.length || ids.length>500 || ids.some(id=>typeof id!=='string') || new Set(ids).size!==ids.length) throw new ObrigacaoError('ids_invalidos','Selecione até 500 ocorrências distintas.');
  return db.$transaction(async tx=>{
    const where={id:{in:ids},obrigacao:{portalClientId:{in:portalIds}}};
    const alvos=await tx.ocorrenciaObrigacao.findMany({where,include:{obrigacao:true}});
    if(alvos.length!==ids.length) throw new ObrigacaoError('nao_encontrada','Ocorrência não encontrada.',404);
    for(const id of [...new Set(alvos.map(o=>o.obrigacaoId))].sort()) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
    const atuais=await tx.ocorrenciaObrigacao.findMany({where,include:{obrigacao:true}});
    if(atuais.length!==ids.length || atuais.some(o=>!o.canceladaEm || !o.obrigacao.ativa || o.foraDaRecorrencia || !cicloPermitido(o.obrigacao,cicloDaOcorrencia(o,o.obrigacao)))) throw new ObrigacaoError('restauracao_indisponivel','A série mudou ou possui um corte de exclusão. Atualize a agenda.',409);
    for(const o of atuais) await tx.ocorrenciaObrigacao.update({where:{id:o.id},data:{canceladaEm:null,canceladaPorId:null,agendaConfig:{...o.agendaConfig,restauracoes:[...(o.agendaConfig?.restauracoes || []),{em:new Date().toISOString(),por:userId,canceladaEm:o.canceladaEm.toISOString(),canceladaPorId:o.canceladaPorId}]}}});
    return {restauradas:atuais.length};
  },{timeout:30000});
}
