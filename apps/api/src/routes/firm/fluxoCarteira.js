import { Router } from 'express';
import { requireFirmCompanyAccess } from '../../middlewares/requireFirmCompanyAccess.js';
import { lerFluxoEmpresa, salvarFluxoTarefa } from '../../application/company/FluxoCarteiraService.js';

export function createFluxoCarteiraRouter({ access = requireFirmCompanyAccess, ler = lerFluxoEmpresa, salvar = salvarFluxoTarefa } = {}) {
  const router = Router({ mergeParams: true });
  const tratar = fn => async (req, res) => {
    try { res.json({ ok: true, ...await fn(req) }); }
    catch(e) { res.status(e.code === 'P2034' ? 409 : e.status || 500).json({ ok: false, message: e.code === 'P2034' ? 'Os dados mudaram. Atualize antes de salvar.' : e.status ? e.message : 'Não foi possível carregar ou salvar o fluxo da competência.' }); }
  };
  router.get('/fluxo-carteira', access(), tratar(async req => {
    const { fluxo, lancamentos } = await ler(req.params.companyId, req.query.competencia);
    return { fluxo, lancamentos };
  }));
  router.post('/fluxo-carteira/:chave', access({ minRole: 'ACCOUNTANT' }), tratar(req => salvar(req.params.companyId, req.body.competencia, req.params.chave, req.body, String(req.auth.user.id))));
  return router;
}
