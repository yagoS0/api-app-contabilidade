import { randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { normalizarTarefaCalendario, expandirTarefaCalendario, aplicarAcaoTarefaCalendario } from '../../../../../packages/shared/src/tarefasCalendario.js';
import { dataAgenda } from '../../../../../packages/shared/src/agenda.js';
export class TarefaCalendarioError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const idsDaTarefa = t => [...new Set([...(t.empresasIds || []), ...(t.versoes || []).flatMap(v=>v.dados?.empresasIds || []), ...Object.values(t.estados || {}).flatMap(s=>s.alteracoes?.empresasIds || [])])];
export function podeVerTarefa(t, userId, portalIds) {
  const ids = idsDaTarefa(t);
  return ids.length ? ids.every(id=>portalIds.includes(id)) : t.userId === userId;
}
function validarEmpresas(t, portalIds) {
  if (idsDaTarefa(t).some(id=>!portalIds.includes(id))) throw new TarefaCalendarioError('Empresa não encontrada na sua carteira.',404);
}
function entrada(dados) {
  try { return normalizarTarefaCalendario({ ...dados, subtarefas: (dados.subtarefas || []).map(s=>({ ...s, id: s.id || randomUUID() })) }); }
  catch(e) { throw new TarefaCalendarioError(e.message); }
}
export async function listarTarefasUnificadas({ userId, portalIds, inicio, fim, companyId }, db = prisma) {
  try {
    dataAgenda(inicio); dataAgenda(fim);
    if (fim < inicio || (+new Date(fim)-+new Date(inicio))/86400000 > 740) throw new Error('Consulte um intervalo de até dois anos.');
  } catch(e) { throw new TarefaCalendarioError(e.message); }
  if (companyId && !portalIds.includes(companyId)) throw new TarefaCalendarioError('Empresa não encontrada.',404);
  const rows = await db.tarefaCalendario.findMany({ where: { excluidaEm: null, OR: [{ userId }, { empresasIds: { hasSome: portalIds } }, { versoes: { not: [] } }, { estados: { not: {} } }] }, orderBy: { createdAt:'desc' } });
  const visible = rows.filter(t=>podeVerTarefa(t,userId,portalIds));
  const empresas = await db.portalClient.findMany({ where: { id:{in:portalIds} }, select:{id:true,razao:true} });
  const nomesEmpresas = Object.fromEntries(empresas.map(e=>[e.id,e.razao]));
  const tarefas = visible.filter(t=>!companyId || idsDaTarefa(t).includes(companyId));
  return { tarefas, itens: tarefas.flatMap(t=>expandirTarefaCalendario({...t,nomesEmpresas},inicio,fim)).filter(i=>!companyId || i.empresasIds.includes(companyId)) };
}
export async function criarTarefaUnificada({ userId, portalIds, dados }, db = prisma) {
  const data = entrada(dados); validarEmpresas(data,portalIds);
  return db.tarefaCalendario.create({ data:{ ...data,userId } });
}
export async function acaoTarefaUnificada({ userId, portalIds, id, dados }, db = prisma) {
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
    const tarefa = await tx.tarefaCalendario.findFirst({ where:{id,excluidaEm:null} });
    if (!tarefa || !podeVerTarefa(tarefa,userId,portalIds)) throw new TarefaCalendarioError('Tarefa não encontrada.',404);
    let patch;
    try { patch = aplicarAcaoTarefaCalendario(tarefa,dados); } catch(e) { throw new TarefaCalendarioError(e.message); }
    validarEmpresas({...tarefa,...patch},portalIds);
    return tx.tarefaCalendario.update({ where:{id},data:patch });
  },{timeout:30000});
}
