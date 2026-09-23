import { Router } from 'express';
import { prisma } from '../../infrastructure/db/prisma.js';
import { empresasVisiveis } from './empresasVisiveis.js';
import { ObrigacaoError, excluirOcorrencia } from '../../application/obrigacoes/ObrigacoesService.js';
import { vincularTarefasEmpresas, listarTarefas, salvarTarefa, alterarTarefa, converterTarefaEmObrigacao } from '../../application/calendario/TarefasAgendaService.js';
import { montarCalendarioDoMes, limitesDoMes } from '../../application/calendario/CalendarioFiscalService.js';
import { normalizarAgenda } from '../../../../../packages/shared/src/agenda.js';

export function createAgendaRouter({ log } = {}) {
  const router = Router();
  const rota = fn => async (req, res) => {
    try {
      const userId = req.auth?.user?.id;
      if (!userId) return res.status(401).json({ ok: false });
      return res.json({ ok: true, ...await fn(req, userId) });
    } catch (e) {
      if (!(e instanceof ObrigacaoError)) log?.error?.({ err: e.message }, 'Falha na agenda');
      return res.status(e.status || 500).json({ ok: false, message: e instanceof ObrigacaoError ? e.message : 'Não foi possível atualizar a agenda.' });
    }
  };
  router.post('/agenda/tarefas-empresas', rota(async (req, userId) => vincularTarefasEmpresas({userId, portalIds:await empresasVisiveis(req), dados:req.body || {}})));
  router.get('/agenda/tarefas', rota((req, userId) => listarTarefas({ userId, inicio: req.query.inicio, fim: req.query.fim })));
  router.post('/agenda/tarefas', rota(async (req, userId) => ({ tarefa: await salvarTarefa({ userId, dados: req.body || {} }) })));
  router.patch('/agenda/tarefas/:id', rota(async (req, userId) => ({ tarefa: await salvarTarefa({ userId, id: req.params.id, dados: req.body || {} }) })));
  router.post('/agenda/tarefas/:id/acao', rota(async (req, userId) => ({ tarefa: await alterarTarefa({ userId, id: req.params.id, cicloChave: req.body?.cicloChave, acao: req.body?.acao, alteracoes: req.body?.alteracoes }) })));
  router.post('/agenda/tarefas/:id/converter-obrigacao', rota(async (req, userId) => converterTarefaEmObrigacao({ userId, id: req.params.id, cicloChave: req.body?.cicloChave, regra: req.body?.regra, portalIds: await empresasVisiveis(req) })));
  router.post('/agenda/ocorrencias/excluir', rota(async (req, userId) => {
    const ids = [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])];
    if (!ids.length || ids.length > 500 || ids.some(id => typeof id !== 'string')) throw new ObrigacaoError('ids_invalidos', 'Selecione até 500 ocorrências.');
    const portalIds = await empresasVisiveis(req);
    return prisma.$transaction(async tx => {
      const alvos = await tx.ocorrenciaObrigacao.findMany({ where: { id: { in: ids }, obrigacao: { portalClientId: { in: portalIds } } }, select: { id: true, obrigacaoId: true } });
      if (alvos.length !== ids.length) throw new ObrigacaoError('nao_encontrada', 'Ocorrência não encontrada.', 404);
      // Ordenação comum evita deadlock ao excluir um ciclo de várias empresas.
      for (const id of [...new Set(alvos.map(o => o.obrigacaoId))].sort()) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
      let canceladas = 0;
      for (const id of ids) {
        const out = await excluirOcorrencia({ portalIds, ocorrenciaId: id, userId, incluirConcluidas: true }, { $transaction: fn => fn(tx) });
        canceladas += out.canceladas;
      }
      return { canceladas };
    }, { timeout: 30000 });
  }));
  router.post('/agenda/series/excluir', rota(async (req, userId) => {
    const { regraId, obrigacaoId } = req.body || {};
    if (Boolean(regraId) === Boolean(obrigacaoId)) throw new ObrigacaoError('serie_invalida', 'Selecione uma série.');
    const portalIds = await empresasVisiveis(req);
    return prisma.$transaction(async tx => {
      const where = regraId ? { regraId: String(regraId) } : { id: String(obrigacaoId) };
      const series = await tx.obrigacao.findMany({ where, select: { id: true, portalClientId: true } });
      const regra = regraId ? await tx.regraObrigacao.findUnique({ where: { id: String(regraId) } }) : null;
      if ((!series.length && (!regra || regra.criadoPorId !== userId)) || series.some(s => !portalIds.includes(s.portalClientId))) throw new ObrigacaoError('serie_nao_encontrada', 'Série não encontrada na sua carteira.', 404);
      for (const id of series.map(s => s.id).sort()) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
      if (regraId) await tx.regraObrigacao.update({ where: { id: String(regraId) }, data: { ativa: false, aplicarANovas: false } });
      const ids = series.map(s => s.id);
      await tx.obrigacao.updateMany({ where: { id: { in: ids } }, data: { ativa: false, encerradaAPartirDe: '0000-01', sobrescritaLocal: true } });
      await tx.ocorrenciaObrigacao.updateMany({ where: { obrigacaoId: { in: ids }, canceladaEm: null }, data: { canceladaEm: new Date(), canceladaPorId: userId } });
      return { seriesExcluidas: ids.length };
    }, { timeout: 30000 });
  }));
  router.post('/agenda/ocorrencias/editar', rota(async req => {
    const ids = [...new Set(Array.isArray(req.body?.ids) ? req.body.ids : [])];
    if (!ids.length || ids.length > 500 || ids.some(id => typeof id !== 'string')) throw new ObrigacaoError('ids_invalidos', 'Selecione até 500 ocorrências.');
    const dados = req.body?.dados;
    if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new ObrigacaoError('agenda_invalida', 'Informe as alterações da agenda.');
    const portalIds = await empresasVisiveis(req);
    return prisma.$transaction(async tx => {
      const alvos = await tx.ocorrenciaObrigacao.findMany({ where: { id: { in: ids }, obrigacao: { portalClientId: { in: portalIds } } }, include: { obrigacao:true } });
      if (alvos.length !== ids.length) throw new ObrigacaoError('nao_encontrada', 'Ocorrência não encontrada.', 404);
      for (const id of [...new Set(alvos.map(o => o.obrigacaoId))].sort()) await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${id}))`;
      const atuais = await tx.ocorrenciaObrigacao.findMany({ where: { id: { in: ids }, obrigacao: { portalClientId: { in: portalIds } } }, include: { obrigacao:true } });
      if (atuais.length !== ids.length) throw new ObrigacaoError('nao_encontrada', 'Ocorrência não encontrada.', 404);
      if (atuais.some(o => o.canceladaEm || o.foraDaRecorrencia)) throw new ObrigacaoError('ocorrencia_indisponivel', 'Esta ocorrência não está mais disponível no calendário.', 409);
      // O gesto altera somente a janela; os demais campos vêm da leitura protegida pelo lock.
      // Validar todo o grupo antes da primeira gravação também evita atualizações parciais.
      const alteracoes = atuais.map(alvo => {
        const anterior = { ...alvo.obrigacao.agendaConfig, ...alvo.agendaConfig };
        let config;
        try { config = normalizarAgenda({ ...anterior, dataInicio:(alvo.dataInicio || alvo.dataVencimento)?.toISOString().slice(0,10), dataFim:(alvo.dataFim || alvo.dataVencimento)?.toISOString().slice(0,10), ...dados, repetirAte:null }); }
        catch(e) { throw new ObrigacaoError('agenda_invalida', e.message); }
        const titulo = String(Object.hasOwn(dados,'titulo') ? dados.titulo ?? '' : anterior.titulo ?? alvo.obrigacao.nome ?? '').trim();
        if (!titulo || titulo.length > 200) throw new ObrigacaoError('titulo_invalido', 'Informe um título de até 200 caracteres.');
        const descricao = String((Object.hasOwn(dados,'descricao') ? dados.descricao : anterior.descricao ?? alvo.obrigacao.descricao) ?? '').slice(0,10000);
        const agendaConfig = { ...alvo.agendaConfig, horaInicio:config.horaInicio, horaFim:config.horaFim, prioridade:config.prioridade, titulo, descricao };
        return { where:{id:alvo.id}, data:{ dataInicio:new Date(config.dataInicio), dataFim:new Date(config.dataFim), ...(alvo.obrigacao.tipo === 'TAREFA' ? {dataVencimento:new Date(config.dataFim)} : {}), janelaPersonalizada:true, agendaConfig } };
      });
      for (const alteracao of alteracoes) await tx.ocorrenciaObrigacao.update(alteracao);
      return { atualizadas:ids.length };
    }, { timeout:30000 });
  }));
  router.post('/agenda/ocultar', rota(async (req, userId) => {
    const { tipo, id, mes } = req.body || {};
    if (!['guia', 'marco'].includes(tipo) || !limitesDoMes(mes)) throw new ObrigacaoError('item_invalido', 'Selecione um item da agenda.');
    const calendario = await montarCalendarioDoMes({ portalIds: await empresasVisiveis(req), competencia: mes });
    if (!calendario.dias.some(d => d.itens.some(i => i.tipo === tipo && i.id === id))) throw new ObrigacaoError('nao_encontrado', 'Item não encontrado.', 404);
    const chave = `${tipo}|${id}`;
    await prisma.agendaOcultacao.upsert({ where: { userId_chave: { userId, chave } }, create: { userId, chave }, update: {} });
    return { chave };
  }));
  return router;
}
