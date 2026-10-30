import { Router } from 'express';
import { prisma } from '../../infrastructure/db/prisma.js';
import { SolicitacoesService } from '../../application/solicitacoes/SolicitacoesService.js';
import { SolicitacaoTarefaService } from '../../application/solicitacoes/SolicitacaoTarefaService.js';
import { exigir, SolicitacaoError } from '../../application/solicitacoes/solicitacoesPolicy.js';

const fechado = (value, keys) => {
  exigir(value && typeof value === 'object' && !Array.isArray(value), 'corpo_invalido');
  exigir(Object.keys(value).every(key => keys.includes(key)), 'campo_nao_permitido');
  return value;
};
export function createSolicitacoesRouter({ client = prisma } = {}) {
  const router = Router();
  // Unrelated firm routes may use partial clients. First use still enforces
  // the service's transactional contract, without weakening its authorization.
  let service;
  const obterService = () => service ??= new SolicitacoesService({ client });
  const handle = fn => async (req, res) => {
    try {
      exigir(typeof req.auth?.user?.id === 'string', 'autenticacao_obrigatoria', 401);
      const contexto = { canal: 'INTERNO', atorId: req.auth.user.id };
      return res.json({ ok: true, ...await fn(req, contexto) });
    } catch (error) {
      const status = error instanceof SolicitacaoError ? error.status : 500;
      const code = status === 500 ? 'solicitacao_indisponivel' : error.code;
      return res.status(status).json({ ok: false, code, error: code, motivo: code });
    }
  };
  router.get('/solicitacoes', handle(async (req, contexto) => {
    const query = fechado(req.query, ['limite', 'cursor', 'portalClientId', 'triagem', 'situacao', 'prioridade', 'responsavelId', 'busca', 'recorte']);
    exigir(Object.values(query).every(value => typeof value === 'string'), 'query_invalida');
    const { limite, cursor, ...filtros } = query;
    if ('triagem' in filtros) { exigir(['true', 'false'].includes(filtros.triagem), 'triagem_invalida'); filtros.triagem = filtros.triagem === 'true'; }
    for (const field of ['prioridade', 'responsavelId']) if (filtros[field] === 'null') filtros[field] = null;
    if (limite !== undefined) exigir(/^(?:[1-9][0-9]?|100)$/.test(limite), 'limite_invalido');
    return obterService().listar({ contexto, filtros, limite: limite === undefined ? 50 : Number(limite), cursor });
  }));
  router.get('/solicitacoes/:id/responsaveis', handle(async (req, contexto) =>
    obterService().listarResponsaveis({ contexto, id: req.params.id, query: req.query })));
  router.get('/solicitacoes/:id', handle(async (req, contexto) => ({ item: await obterService().detalhar({ contexto, id: req.params.id }) })));
  router.post('/solicitacoes', handle(async (req, contexto) => {
    const { chave, dados } = fechado(req.body, ['chave', 'dados']);
    return { item: await obterService().criar({ contexto, chave, dados }) };
  }));
  router.post('/solicitacoes/:id/tarefa', handle(async (req, contexto) => {
    const { chave, versao, dados } = fechado(req.body, ['chave', 'versao', 'dados']);
    return { item: await new SolicitacaoTarefaService({ client }).converter({ contexto, id: req.params.id, chave, versao, dados }) };
  }));
  router.patch('/solicitacoes/:id', handle(async (req, contexto) => {
    const { chave, versao, dados } = fechado(req.body, ['chave', 'versao', 'dados']);
    return { item: await obterService().editar({ contexto, id: req.params.id, chave, versao, dados }) };
  }));
  for (const acao of ['concluir', 'reabrir', 'adotar', 'assumir']) router.post(`/solicitacoes/:id/${acao}`, handle(async (req, contexto) => {
    const body = fechado(req.body, ['chave', 'versao', ...(acao === 'concluir' ? ['observacao'] : [])]);
    const args = { ...body, contexto, id: req.params.id };
    return { item: await (acao === 'assumir' ? obterService().editar({ ...args, dados: { responsavelId: contexto.atorId, situacao: 'EM_ATENDIMENTO' } }) : obterService()[acao](args)) };
  }));
  return router;
}
