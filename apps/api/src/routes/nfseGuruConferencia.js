import { Router } from 'express';
import { criarGuruConferencia } from '../application/nfse/guru/GuruConferenciaService.js';
import { ensureLegacyCompanyAccess, resolveLegacyCompanyId } from './middlewares/portalAccess.js';
import { responderErroDanfse } from './danfseHttp.js';

export function createNfseGuruConferenciaRouter({ ensureAuthorized, log, service = criarGuruConferencia() }) {
  const router = Router();
  router.use('/:companyId', async (req, res, next) => {
    try {
      if (!await ensureAuthorized(req, res, { allowApiKeyFallback: false })) return;
      if (!req.auth?.user?.id || !['admin', 'contador'].includes(req.auth.user.role)) return res.status(403).json({ error: 'forbidden' });
      const companyId = await resolveLegacyCompanyId(req.params.companyId);
      if (!companyId) return res.status(404).json({ error: 'company_not_found' });
      if (!(await ensureLegacyCompanyAccess(req, res, companyId)).ok) return;
      req.guruCompanyId = companyId;
      next();
    } catch (error) { next(error); }
  });
  const contexto = req => ({ companyId: req.guruCompanyId, userId: req.auth.user.id, id: req.params.id, body: req.body });
  router.get('/:companyId/preparacoes', async (req, res, next) => {
    try { res.json(await service.listar({ ...contexto(req), query: req.query })); } catch (error) { next(error); }
  });
  router.post('/:companyId/importacoes', async (req, res, next) => {
    try {
      const revalidarAcesso = async () => {
        // Resolução relida antes de cada página e do commit, sem resposta parcial.
        const silentResponse = { status() { return this; }, json() { return this; } };
        if (await resolveLegacyCompanyId(req.params.companyId) !== req.guruCompanyId
          || !(await ensureLegacyCompanyAccess(req, silentResponse, req.guruCompanyId)).ok) {
          throw Object.assign(new Error('forbidden'), { code: 'forbidden', status: 403 });
        }
      };
      res.json(await service.importar({ ...contexto(req), revalidarAcesso }));
    } catch (error) { next(error); }
  });
  router.post('/:companyId/preparacoes', async (req, res, next) => {
    try {
      const result = await service.preparar(contexto(req));
      res.status(result.repetida ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });
  router.get('/:companyId/preparacoes/:id', async (req, res, next) => {
    try { res.json({ item: await service.obter(contexto(req)) }); } catch (error) { next(error); }
  });
  router.get('/:companyId/notas', async (req, res, next) => {
    try { res.json(await service.buscarNotas({ ...contexto(req), query: req.query })); } catch (error) { next(error); }
  });
  router.get('/:companyId/notas/:notaId', async (req, res, next) => {
    try { res.json({ nota: await service.obterNota({ ...contexto(req), notaId: req.params.notaId }) }); } catch (error) { next(error); }
  });
  router.post('/:companyId/preparacoes/:id/notas', async (req, res, next) => {
    try { res.json(await service.vincularNota(contexto(req))); } catch (error) { next(error); }
  });
  router.get('/:companyId/preparacoes/:id/notas/:notaId/:formato', async (req, res, next) => {
    try {
      const arquivo = await service.documentoNota({ ...contexto(req), notaId: req.params.notaId, formato: req.params.formato });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', arquivo.tipo);
      res.setHeader('Content-Disposition', `attachment; filename="${arquivo.nome}"`);
      res.send(arquivo.bytes);
    } catch (error) { next(error); }
  });
  router.post('/:companyId/preparacoes/:id/conferir', async (req, res, next) => {
    try { res.json(await service.conferir(contexto(req))); } catch (error) { next(error); }
  });
  router.post('/:companyId/preparacoes/:id/emitir', async (req, res, next) => {
    try { await service.emitir(contexto(req)); } catch (error) { next(error); }
  });
  router.use((err, req, res, next) => {
    if (responderErroDanfse(res, err)) return;
    log?.error?.({ code: err.code }, 'Falha na conferência local Guru');
    res.status(err.status || 500).json({ error: err.status ? err.code : 'guru_conferencia_indisponivel' });
  });
  return router;
}
