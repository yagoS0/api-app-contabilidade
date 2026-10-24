import { listarErrosConsultas } from '../../application/operacoes/OperationsConsultas.js';
import { Router } from 'express';
import { lerOperacao, salvarOperacao } from '../../application/operacoes/OperationsService.js';
import { executarOperacao } from '../../application/operacoes/OperationsExecution.js';
import { backgroundRoute } from '../../application/tasks/ManualTaskService.js';
import { empresasVisiveis } from './empresasVisiveis.js';
import { lerInssManual, listarInssManual, salvarInssManual } from '../../application/operacoes/OperationsManualInss.js';

export function createOperationsRouter({ prisma, requireFirmCompanyAccess }) {
  const router = Router();
  const run = fn => async (req, res) => {
    res.setHeader?.('Cache-Control', 'no-store');
    try { res.json({ ok: true, ...await fn(req) }); }
    catch (e) {
      const conflict = ['P2034', 'P2002'].includes(e.code);
      res.status(conflict ? 409 : e.status || 503).json({ ok: false, message: conflict ? 'Houve uma alteração simultânea. Atualize e confira antes de continuar.' : e.status ? e.message : 'Não foi possível confirmar o resultado. Atualize para conferir o que foi salvo.' });
    }
  };
  router.get('/operacoes/consultas', run(async req => listarErrosConsultas(prisma, await empresasVisiveis(req), req.query.competencia)));
  const base = '/companies/:companyId/operacoes/:competencia';
  router.get('/operacoes/inss-manual', run(async req => {
    const ids = await empresasVisiveis(req);
    return prisma.$transaction(tx => listarInssManual(tx, ids, req.query.competencia), { isolationLevel: 'RepeatableRead', timeout: 20000 });
  }));
  router.get(`${base}/inss-manual`, requireFirmCompanyAccess(), run(req => prisma.$transaction(tx => lerInssManual(tx, req.params.companyId, req.params.competencia), { isolationLevel: 'RepeatableRead', timeout: 20000 })));
  router.put(`${base}/inss-manual`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), run(req => salvarInssManual(prisma, req.params.companyId, req.params.competencia, req.auth.user.id, req.body, { isAdmin: String(req.auth.user.role).toLowerCase() === 'admin' })));
  router.get('/operacoes/avisos', run(async req => {
    const ids = await empresasVisiveis(req);
    const where = { portalClientId: { in: ids }, resolvida: false };
    const [items, total] = await Promise.all([
      prisma.pendenciaPosFechamento.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, portalClientId: true, competencia: true, observacoes: true, createdAt: true, situacaoPeriodo: true, portalClient: { select: { razao: true } } } }),
      prisma.pendenciaPosFechamento.count({ where }),
    ]);
    return { items, total };
  }));
  router.get(base, requireFirmCompanyAccess(), run(req => prisma.$transaction(tx => lerOperacao(tx, req.params.companyId, req.params.competencia), { isolationLevel: 'RepeatableRead', timeout: 20000 })));
  router.put(base, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), run(req => salvarOperacao(prisma, req.params.companyId, req.params.competencia, req.auth.user.id, req.body, { isAdmin: String(req.auth.user.role).toLowerCase() === 'admin' })));
  router.post(`${base}/executar`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), backgroundRoute('operacoes-execucao', run(async req => {
    if (req.body?.confirmCompetencia !== req.params.competencia) throw Object.assign(new Error('Confirme a competência antes de executar a liberação.'), { status: 422 });
    return { result: await executarOperacao(prisma, { companyId: req.params.companyId, competencia: req.params.competencia, userId: req.auth.user.id,
      isAdmin: String(req.auth.user.role).toLowerCase() === 'admin', revision: req.body.expectedRevision }) };
  }), 'Executar apuração liberada'));
  return router;
}
