import { Router } from 'express';
import { requireFirmCompanyAccess } from '../../middlewares/requireFirmCompanyAccess.js';
import { lerImplantacao, salvarImplantacao } from '../../application/company/ImplantacaoService.js';

export function createImplantacaoRouter({ ler = lerImplantacao, salvar = salvarImplantacao } = {}) {
  const router = Router({ mergeParams: true });
  const tratar = fn => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ ok: true, implantacao: { ...await fn(req), podeEditar: ['ACCOUNTANT', 'FIRM_ADMIN'].includes(req.access?.role) } }); }
    catch (e) { res.status(e.status || 503).json({ ok: false, message: e.status ? e.message : 'Não foi possível consultar ou salvar a implantação. Atualize para conferir; a edição permanece na tela.' }); }
  };
  router.get('/implantacao', requireFirmCompanyAccess(), tratar(req => ler(req.params.companyId)));
  router.patch('/implantacao/:chave', requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), tratar(req => salvar(req.params.companyId, req.params.chave, req.body, req.auth?.user?.id)));
  return router;
}
