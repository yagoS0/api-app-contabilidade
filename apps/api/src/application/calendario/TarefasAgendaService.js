import { prisma } from '../../infrastructure/db/prisma.js';
import { expandirAgenda, normalizarAgenda, dataAgenda, somarDiasAgenda, ocorrenciasDaTarefa } from '../../../../../packages/shared/src/agenda.js';
import { ObrigacaoError } from '../obrigacoes/ObrigacoesService.js';

export function entradaTarefa(dados) {
  const titulo = String(dados.titulo || '').trim();
  if (!titulo || titulo.length > 200) throw new ObrigacaoError('titulo_invalido', 'Informe um título de até 200 caracteres.');
  try { return { titulo, descricao: String(dados.descricao || '').trim().slice(0, 10000) || null, config: normalizarAgenda(dados.config) }; }
  catch (e) { throw new ObrigacaoError('agenda_invalida', e.message); }
}
export function itensDaTarefa(tarefa, inicio, fim) {
  return ocorrenciasDaTarefa(tarefa, inicio, fim);
}
export async function listarTarefas({ userId, inicio, fim }, db = prisma) {
  try { dataAgenda(inicio); dataAgenda(fim); expandirAgenda({ dataInicio: inicio }, inicio, fim); }
  catch (e) { throw new ObrigacaoError('periodo_invalido', e.message); }
  const tarefas = await db.tarefaAgenda.findMany({ where: { userId, excluidaEm: null }, orderBy: { createdAt: 'desc' } });
  const ocultos = await db.agendaOcultacao.findMany({ where: { userId }, select: { chave: true } });
  return { tarefas, itens: tarefas.flatMap(t => itensDaTarefa(t, inicio, fim)), ocultos: ocultos.map(o => o.chave) };
}
export async function salvarTarefa({ userId, id, dados }, db = prisma) {
  const entrada = entradaTarefa(dados);
  if (!id) return db.tarefaAgenda.create({ data: { ...entrada, userId } });
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
    const t = await tx.tarefaAgenda.findFirst({ where: { id, userId, excluidaEm: null } });
    if (!t) throw new ObrigacaoError('tarefa_nao_encontrada', 'Tarefa não encontrada.', 404);
    if (Object.keys(t.estados || {}).length && JSON.stringify(entrada.config) !== JSON.stringify(normalizarAgenda(t.config))) throw new ObrigacaoError('historico_existente', 'Edite a ocorrência no calendário para preservar o histórico desta série.', 409);
    return tx.tarefaAgenda.update({ where: { id }, data: entrada });
  });
}
export async function alterarTarefa({ userId, id, cicloChave, acao, alteracoes }, db = prisma) {
  if (!['CONCLUIR', 'REABRIR', 'EXCLUIR', 'EXCLUIR_SERIE', 'EDITAR'].includes(acao)) throw new ObrigacaoError('acao_invalida', 'Ação inválida.');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
    const t = await tx.tarefaAgenda.findFirst({ where: { id, userId, excluidaEm: null } });
    if (!t) throw new ObrigacaoError('tarefa_nao_encontrada', 'Tarefa não encontrada.', 404);
    if (acao === 'EXCLUIR_SERIE') return tx.tarefaAgenda.update({ where: { id }, data: { excluidaEm: new Date() } });
    let referencia;
    try { referencia = dataAgenda(String(cicloChave).length === 7 ? `${cicloChave}-01` : cicloChave); }
    catch { throw new ObrigacaoError('ocorrencia_invalida', 'Ocorrência inválida.'); }
    const oc = expandirAgenda(t.config, referencia, somarDiasAgenda(referencia, 31)).find(o => o.cicloChave === cicloChave);
    if (!oc) throw new ObrigacaoError('ocorrencia_invalida', 'Ocorrência não encontrada.', 404);
    const anterior = t.estados?.[cicloChave] || {};
    if (anterior.canceladaEm) throw new ObrigacaoError('ocorrencia_cancelada', 'Esta ocorrência foi excluída.', 409);
    let patch;
    if (acao === 'EDITAR') {
      try { const c = normalizarAgenda({ ...oc, ...anterior.alteracoes, ...alteracoes, repetirAte: null });
        const titulo = String(alteracoes?.titulo || anterior.alteracoes?.titulo || t.titulo).trim();
        if (!titulo || titulo.length > 200) throw new Error('Informe um título de até 200 caracteres.');
        patch = { alteracoes: { dataInicio: c.dataInicio, dataFim: c.dataFim, horaInicio: c.horaInicio, horaFim: c.horaFim, prioridade: c.prioridade, titulo, descricao: String(alteracoes?.descricao ?? anterior.alteracoes?.descricao ?? t.descricao ?? '').slice(0, 10000) } }; }
      catch (e) { throw new ObrigacaoError('agenda_invalida', e.message); }
    } else patch = acao === 'EXCLUIR' ? { canceladaEm: new Date().toISOString() } : { concluidaEm: acao === 'CONCLUIR' ? new Date().toISOString() : null };
    return tx.tarefaAgenda.update({ where: { id }, data: { estados: { ...t.estados, [cicloChave]: { ...anterior, ...patch } } } });
  });
}
