import { prisma } from '../../infrastructure/db/prisma.js';
import { expandirAgenda, normalizarAgenda, dataAgenda, encontrarOcorrenciaDaTarefa, ocorrenciasDaTarefa, prepararEdicaoSerieTarefa, ocorrenciasDoEstadoDaTarefa } from '../../../../../packages/shared/src/agenda.js';
import { ObrigacaoError, normalizarEntrada, sincronizarOcorrencias } from '../obrigacoes/ObrigacoesService.js';
import { criarRegra, empresasDoEscopo } from '../obrigacoes/RegrasObrigacaoService.js';

function validarConfigTarefa(dados) {
  const config = normalizarAgenda(dados);
  if (config.horaFim && config.horaFim <= config.horaInicio) throw new Error('O horário final deve ser posterior ao inicial.');
  return config;
}

export function entradaTarefa(dados) {
  const titulo = String(dados.titulo || '').trim();
  if (!titulo || titulo.length > 200) throw new ObrigacaoError('titulo_invalido', 'Informe um título de até 200 caracteres.');
  try { return { titulo, descricao: String(dados.descricao || '').trim().slice(0, 10000) || null, config: validarConfigTarefa(dados.config) }; }
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
    if ((Object.keys(t.estados || {}).length || t.config.versoes?.length || t.config.encerradaAPartirDe) && JSON.stringify(entrada.config) !== JSON.stringify(normalizarAgenda(t.config))) throw new ObrigacaoError('historico_existente', 'Edite a ocorrência no calendário para preservar o histórico desta série.', 409);
    entrada.config = { ...t.config, ...entrada.config };
    return tx.tarefaAgenda.update({ where: { id }, data: entrada });
  });
}
export async function alterarTarefa({ userId, id, cicloChave, acao, alteracoes }, db = prisma) {
  if (!['CONCLUIR', 'REABRIR', 'EXCLUIR', 'EXCLUIR_SERIE', 'EDITAR', 'EDITAR_SERIE'].includes(acao)) throw new ObrigacaoError('acao_invalida', 'Ação inválida.');
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
    const t = await tx.tarefaAgenda.findFirst({ where: { id, userId, excluidaEm: null } });
    if (!t) throw new ObrigacaoError('tarefa_nao_encontrada', 'Tarefa não encontrada.', 404);
    if (acao === 'EXCLUIR_SERIE') return tx.tarefaAgenda.update({ where: { id }, data: { excluidaEm: new Date() } });
    const anterior = t.estados?.[cicloChave] || {};
    if (anterior.canceladaEm) throw new ObrigacaoError('ocorrencia_cancelada', 'Esta ocorrência foi excluída.', 409);
    let oc;
    try { oc = encontrarOcorrenciaDaTarefa(t, cicloChave); }
    catch { throw new ObrigacaoError('ocorrencia_invalida', 'Ocorrência inválida.'); }
    if (!oc) throw new ObrigacaoError('ocorrencia_invalida', 'Ocorrência não encontrada.', 404);
    if (acao === 'EDITAR_SERIE') {
      let dados;
      try { validarConfigTarefa({ ...oc, ...alteracoes }); dados = prepararEdicaoSerieTarefa(t, cicloChave, alteracoes || {}); }
      catch (e) { throw new ObrigacaoError('agenda_invalida', e.message); }
      return tx.tarefaAgenda.update({ where: { id }, data: dados });
    }
    let patch;
    if (acao === 'EDITAR') {
      try { const c = validarConfigTarefa({ ...oc, ...anterior.alteracoes, ...alteracoes, repetirAte: null });
        const titulo = String(alteracoes?.titulo || oc.titulo).trim();
        if (!titulo || titulo.length > 200) throw new Error('Informe um título de até 200 caracteres.');
        patch = { alteracoes: { dataInicio: c.dataInicio, dataFim: c.dataFim, horaInicio: c.horaInicio, horaFim: c.horaFim, prioridade: c.prioridade, titulo, descricao: String(alteracoes?.descricao ?? oc.descricao ?? '').slice(0, 10000) } }; }
      catch (e) { throw new ObrigacaoError('agenda_invalida', e.message); }
    } else patch = acao === 'EXCLUIR' ? { canceladaEm: new Date().toISOString() } : { concluidaEm: acao === 'CONCLUIR' ? new Date().toISOString() : null };
    return tx.tarefaAgenda.update({ where: { id }, data: { estados: { ...t.estados, [cicloChave]: { ...anterior, ...patch } } } });
  });
}

export async function converterTarefaEmObrigacao({ userId, id, cicloChave, regra, portalIds }, db = prisma) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
    const tarefa = await tx.tarefaAgenda.findFirst({ where: { id, userId, excluidaEm: null } });
    if (!tarefa) throw new ObrigacaoError('tarefa_nao_encontrada', 'Tarefa não encontrada.', 404);
    let selecionada;
    try { selecionada = encontrarOcorrenciaDaTarefa(tarefa, cicloChave); }
    catch { throw new ObrigacaoError('ocorrencia_invalida', 'Ocorrência inválida.'); }
    if (!selecionada) throw new ObrigacaoError('ocorrencia_invalida', 'Ocorrência não encontrada.', 404);
    if (!regra?.agendaConfig) throw new ObrigacaoError('agenda_invalida', 'Informe a configuração da obrigação.');
    let inicio;
    try { inicio = prepararEdicaoSerieTarefa(tarefa, cicloChave, regra.agendaConfig).config.versoes.at(-1).aPartirDe; }
    catch (e) { throw new ObrigacaoError('agenda_invalida', e.message); }
    for (const [chave, estado] of Object.entries(tarefa.estados || {})) {
      if (ocorrenciasDoEstadoDaTarefa(tarefa, chave).some(oc => oc.dataFim >= inicio) && (estado.concluidaEm || estado.canceladaEm || (estado.alteracoes && chave !== cicloChave))) throw new ObrigacaoError('historico_futuro', 'Há ocorrências concluídas, excluídas ou editadas neste período. Escolha uma ocorrência posterior a esse histórico para convertê-la em obrigação.', 409);
    }
    const empresas = await empresasDoEscopo({ portalIds, escopo: regra.escopo, filtros: regra.filtros }, tx);
    if (!empresas.length) throw new ObrigacaoError('escopo_vazio', 'Nenhuma empresa da sua carteira corresponde à seleção.');
    const resultado = await criarRegra({ portalIds, dados: { ...regra, tipo: 'OBRIGACAO' }, criadoPorId: userId }, tx);
    await tx.tarefaAgenda.update({ where: { id }, data: { config: { ...tarefa.config, encerradaAPartirDe: inicio } } });
    return resultado;
  }, { timeout: 30000 });
}

/** Vínculo compartilhado exige escolha explícita e preserva tarefas com histórico. */
export async function vincularTarefasEmpresas({ userId, portalIds, dados }, db = prisma) {
  const ids = [...new Set(Array.isArray(dados.empresasIds) ? dados.empresasIds : [])];
  if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== 'string' || !portalIds.includes(id))) throw new ObrigacaoError('empresas_invalidas', 'Selecione até 100 empresas da sua carteira.', 400);
  if (dados.compartilhar !== true) throw new ObrigacaoError('confirmacao_necessaria', 'Confirme que a tarefa ficará visível à equipe autorizada dessas empresas.');
  const entrada = entradaTarefa(dados), c = entrada.config;
  const limpo = normalizarEntrada({ nome:entrada.titulo, descricao:entrada.descricao, tipo:'TAREFA', periodicidade:c.recorrencia, agendaConfig:c, dataInicio:c.dataInicio, dataFim:c.dataFim, diaVencimento:Number(c.dataFim.slice(8)), mesReferencia:Number(c.dataInicio.slice(5,7)), ajusteDiaUtil:'MANTER', defasagemMeses:0 });
  return db.$transaction(async tx => {
    if (dados.tarefaId) {
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${dados.tarefaId}))`;
      const t = await tx.tarefaAgenda.findFirst({where:{id:dados.tarefaId,userId,excluidaEm:null}});
      if (!t) throw new ObrigacaoError('tarefa_nao_encontrada','Tarefa não encontrada.',404);
      if ((t.config.recorrencia !== 'AVULSA' || c.recorrencia !== 'AVULSA') && t.config.dataInicio < new Date().toISOString().slice(0,10)) throw new ObrigacaoError('recorrencia_passada','Esta série já começou. Crie uma nova tarefa empresarial; as ocorrências pessoais anteriores serão preservadas.',409);
      if (c.dataInicio !== t.config.dataInicio) throw new ObrigacaoError('inicio_diferente','Para vincular a série inteira, mantenha a data inicial original ou crie uma nova tarefa empresarial.',409);
      if (Object.keys(t.estados || {}).length || t.config.versoes?.length || t.config.encerradaAPartirDe) throw new ObrigacaoError('historico_existente','Esta tarefa já tem histórico. Crie uma nova tarefa vinculada às empresas; o histórico pessoal será preservado.',409);
    }
    const empresas = await tx.portalClient.findMany({where:{id:{in:ids}},select:{id:true}});
    if (empresas.length !== ids.length) throw new ObrigacaoError('empresas_invalidas','Uma empresa selecionada não está mais disponível.',404);
    const tarefas = [];
    for (const portalClientId of ids) {
      const tarefa = await tx.obrigacao.create({data:{...limpo,portalClientId,criadoPorId:userId}});
      await sincronizarOcorrencias(tarefa.id,tx,{transacionada:true});
      tarefas.push(tarefa);
    }
    if (dados.tarefaId) await tx.tarefaAgenda.update({where:{id:dados.tarefaId},data:{excluidaEm:new Date()}});
    return {tarefas};
  }, {timeout:30000});
}
