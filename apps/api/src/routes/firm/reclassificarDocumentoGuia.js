import { Router } from 'express';
import { criarReclassificarDocumentoGuia } from '../../application/guides/ReclassificarDocumentoGuiaService.js';
export function createReclassificarDocumentoGuiaRouter({ service = criarReclassificarDocumentoGuia() } = {}) {
  const router = Router({ mergeParams: true });
  const wrap = fn => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(e.code === 'P2034' ? 409 : e.status || 500).json({ ok: false, error: e.status ? e.code : e.code === 'P2034' ? 'GUIA_ALTERADA' : 'erro_interno', message: e.status ? e.message : 'Não foi possível confirmar. Atualize a prévia antes de tentar novamente.' }); }
  };
  router.get('/guides/:guideId/reclassificacao/previa', wrap(req => service.previa(req.params.companyId, req.params.guideId, req.auth?.user)));
  router.post('/guides/:guideId/reclassificacao', wrap(req => service.confirmar(req.params.companyId, req.params.guideId, req.auth?.user, req.body)));
  return router;
}
