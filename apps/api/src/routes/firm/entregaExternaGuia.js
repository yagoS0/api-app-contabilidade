import { Router } from 'express';
import { criarEntregaExternaGuia } from '../../application/guides/EntregaExternaGuiaService.js';
export function createEntregaExternaGuiaRouter({ service = criarEntregaExternaGuia() } = {}) {
  const router = Router({ mergeParams: true });
  const wrap = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.status || 500).json({ ok: false, error: e.status ? e.code : 'erro_interno', message: e.status ? e.message : 'Não foi possível registrar a entrega.' }); }
  };
  router.get('/guides/:guideId/envio-externo/previa', wrap(req => service.previa(req.params.companyId, req.params.guideId, req.auth?.user)));
  router.post('/guides/:guideId/envio-externo', wrap(req => service.registrar(req.params.companyId, req.params.guideId, req.auth?.user, req.body)));
  return router;
}
