import { listarErrosConsultas, listarEvidenciasOperacoes } from '../../application/operacoes/OperationsConsultas.js';
import { Router } from 'express';
import { lerOperacao, salvarOperacao } from '../../application/operacoes/OperationsService.js';
import { executarOperacao } from '../../application/operacoes/OperationsExecution.js';
import { backgroundRoute } from '../../application/tasks/ManualTaskService.js';
import { empresasVisiveis } from './empresasVisiveis.js';
import { lerInssManual, listarInssManual, salvarInssManual } from '../../application/operacoes/OperationsManualInss.js';
import { createOperationsBatchService } from '../../application/operacoes/OperationsBatchService.js';

export function createOperationsRouter({ prisma, requireFirmCompanyAccess, batchDependencies = {} }) {
  const router = Router();
  let batchService;
  const batches = () => batchService ||= createOperationsBatchService({ ...batchDependencies, db: prisma });
  const run = fn => async (req, res) => {
    res.setHeader?.('Cache-Control', 'no-store');
    try { res.json({ ok: true, ...await fn(req) }); }
    catch (e) {
      const conflict = ['P2034', 'P2002'].includes(e.code);
      res.status(conflict ? 409 : e.status || 503).json({ ok: false, message: conflict ? 'Houve uma alteração simultânea. Atualize e confira antes de continuar.' : e.status ? e.message : 'Não foi possível confirmar o resultado. Atualize para conferir o que foi salvo.' });
    }
  };
  router.get('/operacoes/consultas', run(async req => listarErrosConsultas(prisma, await empresasVisiveis(req), req.query.competencia)));
  router.get('/operacoes/evidencias', run(async req => {
    const ids = await empresasVisiveis(req);
    return prisma.$transaction(tx => listarEvidenciasOperacoes(tx, ids, req.query.competencia, { rootDb: prisma }), { isolationLevel: 'RepeatableRead', timeout: 20000 });
  }));
  router.get('/operacoes/lotes', run(req => batches().list({ userId: req.auth.user.id, competencia: req.query.competencia })));
  router.post('/operacoes/lotes/previa', run(async req => ({ preview: await batches().preview({ userId: req.auth.user.id, competencia: req.body?.competencia, batchId: req.body?.batchId || null }) })));
  router.post('/operacoes/lotes/aceitar', run(async req => ({ batch: await batches().accept({ userId: req.auth.user.id, previewId: req.body?.previewId, requestId: req.body?.requestId, confirmCompetencia: req.body?.confirmCompetencia }) })));
  router.get('/operacoes/lotes/:batchId', run(async req => ({ batch: await batches().get({ userId: req.auth.user.id, batchId: req.params.batchId }) })));
  const base = '/companies/:companyId/operacoes/:competencia';
  router.get('/operacoes/inss-manual', run(async req => {
    const ids = await empresasVisiveis(req);
    return prisma.$transaction(tx => listarInssManual(tx, ids, req.query.competencia), { isolationLevel: 'RepeatableRead', timeout: 20000 });
  }));
  router.get(`${base}/inss-manual`, requireFirmCompanyAccess(), run(req => prisma.$transaction(tx => lerInssManual(tx, req.params.companyId, req.params.competencia), { isolationLevel: 'RepeatableRead', timeout: 20000 })));
  router.put(`${base}/inss-manual`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), run(req => salvarInssManual(prisma, req.params.companyId, req.params.competencia, req.auth.user.id, req.body, { isAdmin: String(req.auth.user.role).toLowerCase() === 'admin' })));
  router.get('/operacoes/avisos', run(async req => {
    const ids = await empresasVisiveis(req);
    const offset = Number(req.query.offset || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw Object.assign(new Error('Página inválida.'), { status: 422 });
    const where = { portalClientId: { in: ids }, resolvida: false };
    const [items, total] = await Promise.all([
      prisma.pendenciaPosFechamento.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: offset, take: 200, select: { id: true, portalClientId: true, competencia: true, observacoes: true, createdAt: true, situacaoPeriodo: true, portalClient: { select: { razao: true } } } }),
      prisma.pendenciaPosFechamento.count({ where }),
    ]);
    return { items, total, offset };
  }));
  router.get(base, requireFirmCompanyAccess(), run(req => prisma.$transaction(tx => lerOperacao(tx, req.params.companyId, req.params.competencia, { rootDb: prisma }), { isolationLevel: 'RepeatableRead', timeout: 20000 })));
  router.put(base, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), run(req => salvarOperacao(prisma, req.params.companyId, req.params.competencia, req.auth.user.id, req.body, { isAdmin: String(req.auth.user.role).toLowerCase() === 'admin' })));
  router.post(`${base}/executar`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), backgroundRoute('operacoes-execucao', run(async req => {
    if (req.body?.confirmCompetencia !== req.params.competencia) throw Object.assign(new Error('Confirme a competência antes de executar a liberação.'), { status: 422 });
    return { result: await executarOperacao(prisma, { companyId: req.params.companyId, competencia: req.params.competencia, userId: req.auth.user.id,
      isAdmin: String(req.auth.user.role).toLowerCase() === 'admin', revision: req.body.expectedRevision }) };
  }), 'Executar apuração liberada'));
  return router;
}
