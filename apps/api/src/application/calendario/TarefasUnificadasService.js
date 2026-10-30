import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '../../infrastructure/db/prisma.js';
import { normalizarTarefaCalendario, expandirTarefaCalendario, aplicarAcaoTarefaCalendario, encontrarTarefaCalendario, responsavelPodeVerSerie } from '../../../../../packages/shared/src/tarefasCalendario.js';
import { carregarEscopo, interno } from '../solicitacoes/solicitacoesPolicy.js';
import { escopoDasSolicitacoes } from '../solicitacoes/solicitacoesEscopoWhatsapp.js';
import { dataAgenda } from '../../../../../packages/shared/src/agenda.js';
export class TarefaCalendarioError extends Error {
  constructor(message, status = 400, code) { super(message); this.status = status; this.code = code; }
}

// Explicit DTO: never serialize a Prisma relation or caller-supplied origin.
export function tarefaDto(row) {
  return Object.fromEntries(['id', 'userId', 'responsavelId', 'titulo', 'descricao', 'config',
    'empresasIds', 'subtarefas', 'versoes', 'estados', 'excluidaEm', 'createdAt', 'updatedAt']
    .filter(key => row[key] !== undefined).map(key => [key, row[key]]));
}

export async function validarResponsavelTarefa(tx, tarefa, origem = null) {
  if (!tarefa.responsavelId) return;
  const user = await tx.user.findUnique({ where: { id: tarefa.responsavelId } });
  if (!interno(user)) throw new TarefaCalendarioError('Responsável inválido.');
  const escopo = await carregarEscopo(tx, { canal: 'INTERNO', atorId: user.id });
  validarEmpresas(tarefa, escopo.empresas);
  if (origem) {
    const fontes = await escopoDasSolicitacoes(tx, escopo);
    if (!fontes.solicitacaoIds.includes(origem.solicitacaoId)) throw new TarefaCalendarioError('Responsável fora do escopo.');
  }
}

export async function projetarTarefas(tx, contexto, rows) {
  if (!rows.length) return [];
  const links = await tx.solicitacaoTarefa.findMany({ where: { tarefaId: { in: rows.map(r => r.id) } } });
  const byId = new Map();
  if (links.length) {
    const escopo = await carregarEscopo(tx, { canal: 'INTERNO', atorId: contexto.userId });
    const fontes = await escopoDasSolicitacoes(tx, escopo);
    for (const link of links) if (fontes.solicitacaoIds.includes(link.solicitacaoId)) byId.set(link.tarefaId, link);
  }
  return rows.map(row => ({ ...tarefaDto(row), ...(byId.has(row.id)
    ? { solicitacaoOrigem: { id: byId.get(row.id).solicitacaoId, podeAbrir: true } } : {}) }));
}

// Called only for already authorized solicitation rows; batch prevents N+1.
export async function projetarVinculosSolicitacoes(tx, escopo, itens) {
  if (!itens.length) return itens;
  const links = await tx.solicitacaoTarefa.findMany({ where: { solicitacaoId: { in: itens.map(r => r.id) } }, include: { tarefa: true } });
  const byId = new Map(links.filter(l => l.tarefa && podeVerTarefa(l.tarefa, escopo.atorId, escopo.empresas)).map(l => [l.solicitacaoId, l]));
  return itens.map(item => {
    const link = byId.get(item.id);
    return { ...item, ...(link ? { tarefa: { id: link.tarefaId, podeAbrir: true,
      estado: estadoVinculoTarefa(link.tarefa), ciclosCancelados: Object.keys(link.tarefa.estados || {}).filter(k => link.tarefa.estados[k].canceladaEm) } } : {}) };
  });
}

export function estadoVinculoTarefa(tarefa) {
  if (tarefa.excluidaEm) return 'EXCLUIDA';
  if (tarefa.config.recorrencia === 'AVULSA' && tarefa.estados?.[tarefa.config.dataInicio]?.canceladaEm) return 'CANCELADA';
  return 'ATIVA';
}

async function validarEdicaoVinculada(tx, contexto, tarefa, dados, patch) {
  if (!['EDITAR', 'EDITAR_SERIE'].includes(dados.acao)) return;
  const link = await tx.solicitacaoTarefa.findUnique({ where: { tarefaId: tarefa.id } });
  const after = { ...tarefa, ...patch };
  if (link) {
    const models = [after, ...(after.versoes || []).map(v => v.dados), ...Object.values(after.estados || {}).map(s => s.alteracoes).filter(Boolean)];
    if (models.some(m => link.empresaOrigemId ? m.empresasIds?.length !== 1 || m.empresasIds[0] !== link.empresaOrigemId : m.empresasIds?.length)) {
      throw new TarefaCalendarioError('A empresa vinculada deve ser preservada.', 409);
    }
    if (Object.hasOwn(dados.alteracoes || {}, 'responsavelId') || Object.hasOwn(dados.alteracoes || {}, 'empresasIds')) {
      const escopo = await carregarEscopo(tx, { canal: 'INTERNO', atorId: contexto.userId });
      const fontes = await escopoDasSolicitacoes(tx, escopo);
      if (!fontes.solicitacaoIds.includes(link.solicitacaoId)) throw new TarefaCalendarioError('Alteração indisponível.', 404);
    }
  }
  if (Object.hasOwn(dados.alteracoes || {}, 'responsavelId') || Object.hasOwn(dados.alteracoes || {}, 'empresasIds')) {
    const effective = encontrarTarefaCalendario(after, dados.cicloChave);
    await validarResponsavelTarefa(tx, { ...after, responsavelId: effective.responsavelId }, link);
  }
}

export async function obterTarefaUnificada({ userId, portalIds, id, cicloChave }, db = prisma) {
  const escopo = await carregarEscopo(db, { canal: 'INTERNO', atorId: userId });
  portalIds = portalIds.filter(id => escopo.empresas.includes(id));
  const row = await db.tarefaCalendario.findUnique({ where: { id } });
  if (!row || !podeVerTarefa(row, userId, portalIds)) throw new TarefaCalendarioError('Tarefa não encontrada.', 404);
  const tarefa = (await projetarTarefas(db, { userId, portalIds }, [row]))[0];
  if (cicloChave !== undefined) {
    try {
      // Validate even for deleted/cancelled occurrences, without recreating them.
      const estados = { ...row.estados, [cicloChave]: { ...row.estados?.[cicloChave], canceladaEm: null } };
      const oc = encontrarTarefaCalendario({ ...tarefa, excluidaEm: null, estados }, cicloChave);
      if (!oc) throw new TarefaCalendarioError('Ocorrência não encontrada.', 404);
      tarefa.ciclo = { chave: cicloChave, estado: row.excluidaEm ? 'EXCLUIDA' : row.estados?.[cicloChave]?.canceladaEm ? 'CANCELADA' : 'ATIVA' };
    } catch (e) { throw e instanceof TarefaCalendarioError ? e : new TarefaCalendarioError(e.message); }
  }
  return tarefa;
}
export const idsDaTarefa = t => [...new Set([...(t.empresasIds || []), ...(t.versoes || []).flatMap(v=>v.dados?.empresasIds || []), ...Object.values(t.estados || {}).flatMap(s=>s.alteracoes?.empresasIds || [])])];
export function podeVerTarefa(t, userId, portalIds) {
  const ids = idsDaTarefa(t);
  return ids.length ? ids.every(id=>portalIds.includes(id)) : t.userId === userId || responsavelPodeVerSerie(t, userId);
}
function validarEmpresas(t, portalIds) {
  if (idsDaTarefa(t).some(id=>!portalIds.includes(id))) throw new TarefaCalendarioError('Empresa não encontrada na sua carteira.',404);
}
function entrada(dados) {
  try { return normalizarTarefaCalendario({ ...dados, subtarefas: (dados.subtarefas || []).map(s=>({ ...s, id: s.id || randomUUID() })) }); }
  catch(e) { throw new TarefaCalendarioError(e.message); }
}
export async function listarTarefasUnificadas({ userId, portalIds, inicio, fim, companyId }, db = prisma) {
  const escopo = await carregarEscopo(db, { canal: 'INTERNO', atorId: userId });
  portalIds = portalIds.filter(id => escopo.empresas.includes(id));
  try {
    dataAgenda(inicio); dataAgenda(fim);
    if (fim < inicio || (+new Date(fim)-+new Date(inicio))/86400000 > 740) throw new Error('Consulte um intervalo de até dois anos.');
  } catch(e) { throw new TarefaCalendarioError(e.message); }
  if (companyId && !portalIds.includes(companyId)) throw new TarefaCalendarioError('Empresa não encontrada.',404);
  const rows = await db.tarefaCalendario.findMany({ where: { excluidaEm: null, OR: [{ userId }, { responsavelId: userId }, { empresasIds: { hasSome: portalIds } }, { versoes: { not: [] } }, { estados: { not: {} } }] }, orderBy: { createdAt:'desc' } });
  const visible = rows.filter(t=>podeVerTarefa(t,userId,portalIds));
  const empresas = await db.portalClient.findMany({ where: { id:{in:portalIds} }, select:{id:true,razao:true} });
  const nomesEmpresas = Object.fromEntries(empresas.map(e=>[e.id,e.razao]));
  const tarefas = await projetarTarefas(db, { userId, portalIds }, visible.filter(t=>!companyId || idsDaTarefa(t).includes(companyId)));
  return { tarefas, itens: tarefas.flatMap(t=>expandirTarefaCalendario({...t,nomesEmpresas},inicio,fim)).filter(i=>!companyId || i.empresasIds.includes(companyId)) };
}
export async function criarTarefaUnificada({ userId, portalIds, dados }, db = prisma) {
  const escopo = await carregarEscopo(db, { canal: 'INTERNO', atorId: userId });
  portalIds = portalIds.filter(id => escopo.empresas.includes(id));
  const data = entrada(dados); validarEmpresas(data,portalIds);
  await validarResponsavelTarefa(db, data);
  const tarefa = await db.tarefaCalendario.create({ data:{ ...data,userId } });
  return tarefaDto(tarefa);
}
export async function acaoTarefaUnificada({ userId, portalIds, id, dados }, db = prisma) {
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
    const escopo = await carregarEscopo(tx, { canal: 'INTERNO', atorId: userId });
    portalIds = portalIds.filter(id => escopo.empresas.includes(id));
    const tarefa = await tx.tarefaCalendario.findFirst({ where:{id,excluidaEm:null} });
    if (!tarefa || !podeVerTarefa(tarefa,userId,portalIds)) throw new TarefaCalendarioError('Tarefa não encontrada.',404);
    if (dados.acao === 'DUPLICAR') {
      if (!/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(dados.intencaoId || '')) {
        throw new TarefaCalendarioError('Identifique a tentativa de duplicação.');
      }
      // A identidade é derivada no servidor e não depende de campos editáveis da cópia.
      // O mesmo pedido recupera o resultado mesmo depois de uma resposta perdida.
      const copiaId = `copia-${createHash('sha256').update(JSON.stringify([userId,id,dados.cicloChave,dados.intencaoId])).digest('hex')}`;
      const existente = await tx.tarefaCalendario.findUnique({where:{id:copiaId}});
      if (existente) {
        if (existente.userId !== userId || !podeVerTarefa(existente,userId,portalIds)) throw new TarefaCalendarioError('Cópia não disponível.',404);
        if (existente.excluidaEm || Object.values(existente.estados || {}).some(s=>s.canceladaEm)) throw new TarefaCalendarioError('A cópia desta tentativa foi excluída. Você pode iniciar uma nova duplicação; a cópia anterior continuará excluída.',409,'CALENDAR_COPY_DELETED');
        return (await projetarTarefas(tx, { userId, portalIds }, [existente]))[0];
      }
      let ocorrencia;
      try { ocorrencia = encontrarTarefaCalendario(tarefa, dados.cicloChave); }
      catch(e) { throw new TarefaCalendarioError(e.message); }
      if (!ocorrencia) throw new TarefaCalendarioError('Ocorrência não encontrada.',404);
      // Copia somente o modelo efetivo desta ocorrência, nunca estados ou evidências.
      const copia = entrada({ titulo: `${ocorrencia.titulo.slice(0,192)} (cópia)`, descricao: ocorrencia.descricao,
        empresasIds: ocorrencia.empresasIds, responsavelId: ocorrencia.responsavelId ?? null,
        subtarefas: ocorrencia.subtarefas.map(s=>({id:randomUUID(),titulo:s.titulo})),
        config: {...ocorrencia.config,recorrencia:'AVULSA',repetirAte:null,repetirQuantidade:null,
          dataVencimento:ocorrencia.dataVencimento} });
      validarEmpresas(copia,portalIds);
      await validarResponsavelTarefa(tx, copia);
      return tarefaDto(await tx.tarefaCalendario.create({data:{...copia,id:copiaId,userId,estados:{},versoes:[]}}));
    }
    let patch;
    try { patch = aplicarAcaoTarefaCalendario(tarefa,dados); } catch(e) { throw new TarefaCalendarioError(e.message); }
    validarEmpresas({...tarefa,...patch},portalIds);
    await validarEdicaoVinculada(tx, { userId, portalIds }, tarefa, dados, patch);
    return (await projetarTarefas(tx, { userId, portalIds }, [await tx.tarefaCalendario.update({ where:{id},data:patch })]))[0];
  },{timeout:30000});
}
