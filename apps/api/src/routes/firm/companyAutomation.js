import { Router } from 'express';
import { lerAutomacaoEmpresa, salvarAutomacaoEmpresa } from '../../application/fiscal/serpro/CompanyAutomationService.js';
import { empresasVisiveis } from './empresasVisiveis.js';
import { listarRotinasOperacoes } from '../../application/operacoes/OperationsRoutines.js';

export function createCompanyAutomationRouter({ prisma, requireFirmCompanyAccess }) {
  const router = Router();
  const run = action => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json({ ok: true, ...await action(req) }); }
    catch (e) {
      const conflict = ['P2034', 'P2002'].includes(e.code);
      res.status(conflict ? 409 : e.status || 503).json({ ok: false, error: conflict ? 'AUTOMATION_CHANGED' : e.status ? e.code : 'AUTOMATION_UNAVAILABLE',
        message: conflict ? 'Houve outra alteração simultânea. Recarregue a configuração antes de continuar.' : e.status ? e.message : 'Não foi possível confirmar o resultado. Recarregue para conferir o que foi salvo; nenhuma consulta é iniciada ao salvar.' });
    }
  };
  const base = '/companies/:companyId/automacao';
  router.get('/operacoes/rotinas', run(async req => listarRotinasOperacoes(prisma, await empresasVisiveis(req))));
  router.get(base, requireFirmCompanyAccess(), run(req => lerAutomacaoEmpresa(prisma, req.params.companyId)));
  router.put(base, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), run(req => salvarAutomacaoEmpresa(prisma, req.params.companyId, req.auth.user.id, req.body, { isAdmin: String(req.auth.user.role).toLowerCase() === 'admin' })));
  return router;
}
