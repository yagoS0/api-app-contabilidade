import { Router } from 'express';
import { lerBaseConsumo, vincularEstabelecimentos, salvarConfiguracaoConsumo, prepararRevisaoConsumo } from '../../application/fiscal/consumo/ApuracaoConsumoService.js';
import { listarColetasCbs, abrirColetaCbs, consultarColetaCbs, baixarArquivoColetaCbs } from '../../application/fiscal/consumo/ColetaCbsService.js';
import { lerMensalConsumo, listarHistoricoMensalConsumo, executarAcaoMensalConsumo } from '../../application/fiscal/consumo/MensalConsumoService.js';
import { reprocessarArquivoCbs } from '../../application/fiscal/consumo/ReplayCbsService.js';

// Montado no router FIRM autenticado; autorização de todos os estabelecimentos é revalidada no serviço.
export function createApuracaoConsumoRouter({ prisma, requireFirmCompanyAccess, cbsDeps = {} }) {
  const router = Router();
  const base = '/companies/:companyId/apuracao-consumo';
  const dependenciasCbs = req => typeof cbsDeps === 'function'
    ? cbsDeps({ companyId: req.params.companyId, ambiente: req.method === 'GET' ? req.query.ambiente : req.body?.ambiente, usuario: req.auth.user })
    : cbsDeps;
  const executar = fn => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (e) {
      if ([400, 401, 403, 404, 409, 422, 502, 503].includes(e.status)) return res.status(e.status).json({ error: 'apuracao_consumo', reason: e.message });
      next(e);
    }
  };
  router.get(base, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    res.json({ ok: true, ...await lerBaseConsumo(prisma, req.params.companyId, req.query, req.auth.user) });
  }));
  for (const [sufixo, fn, chave] of [
    ['/estabelecimentos', vincularEstabelecimentos, 'contribuinte'],
    ['/configuracoes', salvarConfiguracaoConsumo, 'configuracao'],
    ['/revisoes', prepararRevisaoConsumo, 'revisao'],
  ]) router.post(`${base}${sufixo}`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    res.status(201).json({ ok: true, [chave]: await fn(prisma, req.params.companyId, req.body, req.auth.user) });
  }));
  // GET acompanha somente registros locais. O runtime padrão não injeta transporte nem chave.
  const coletas = `${base}/cbs/coletas`;
  router.get(coletas, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    res.json({ ok: true, ...await listarColetasCbs(prisma, req.params.companyId, req.query, req.auth.user, await dependenciasCbs(req)) });
  }));
  router.post(coletas, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    res.status(200).json({ ok: true, coleta: await abrirColetaCbs(prisma, req.params.companyId, req.body, req.auth.user, await dependenciasCbs(req)) });
  }));
  for (const [acao, fn] of [['consultar', consultarColetaCbs], ['baixar', baixarArquivoColetaCbs]]) {
    router.post(`${coletas}/:coletaId/${acao}`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
      res.json({ ok: true, coleta: await fn(prisma, req.params.companyId, req.params.coletaId, req.body, req.auth.user, await dependenciasCbs(req)) });
    }));
  }
  router.post(`${coletas}/:coletaId/reprocessar`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    res.json({ ok: true, inspecao: await reprocessarArquivoCbs(prisma, req.params.companyId, req.params.coletaId, req.body, req.auth.user, await dependenciasCbs(req)) });
  }));
  for (const [sufixo, fn] of [['/mensal', lerMensalConsumo], ['/mensal/historico', listarHistoricoMensalConsumo]]) {
    router.get(`${base}${sufixo}`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
      res.json({ ok: true, ...await fn(prisma, req.params.companyId, req.query, req.auth.user) });
    }));
  }
  router.post(`${base}/mensal/acoes`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    res.json({ ok: true, ...await executarAcaoMensalConsumo(prisma, req.params.companyId, req.body, req.auth.user) });
  }));
  return router;
}
