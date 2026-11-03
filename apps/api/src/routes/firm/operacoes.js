import { listarErrosConsultas, listarEvidenciasOperacoes } from '../../application/operacoes/OperationsConsultas.js';
import { Router } from 'express';
import { lerOperacao, salvarOperacao } from '../../application/operacoes/OperationsService.js';
import { executarOperacao } from '../../application/operacoes/OperationsExecution.js';
import { backgroundRoute } from '../../application/tasks/ManualTaskService.js';
import { empresasVisiveis } from './empresasVisiveis.js';
import { lerInssManual, listarInssManual, salvarInssManual } from '../../application/operacoes/OperationsManualInss.js';
import { createOperationsBatchService } from '../../application/operacoes/OperationsBatchService.js';
import archiver from 'archiver';
import { GuideStorageService } from '../../application/guides/GuideStorageService.js';
import { readTransmissionDocuments, downloadTransmissionDocument, prepareTransmissionArchive } from '../../application/operacoes/OperationsTransmissionDocuments.js';
import { createOperationsGuideEvidence } from '../../application/operacoes/OperationsGuideEvidence.js';

export function createOperationsRouter({ prisma, requireFirmCompanyAccess, batchDependencies = {}, transmissionStorage = () => GuideStorageService.create() }) {
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
  const guideEvidence = createOperationsGuideEvidence({ db: prisma });
  router.get(`${base}/guide-evidence`, requireFirmCompanyAccess(), run(req => guideEvidence.read({ userId: req.auth.user.id, ...req.params, offset: Number(req.query.offset || 0) })));
  router.post(`${base}/guide-evidence/preview`, requireFirmCompanyAccess(), run(async req => ({ preview: await guideEvidence.preview({ userId: req.auth.user.id, ...req.params, items: req.body?.items, whatsappRequested: req.body?.whatsappRequested === true }) })));
  router.get(`${base}/transmission-documents`, requireFirmCompanyAccess(), run(req => readTransmissionDocuments(prisma, req.params.companyId, req.params.competencia)));
  router.get(`${base}/transmission-documents/:releaseId/:versionId/:tipo`, requireFirmCompanyAccess(), async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const { buffer, tipo } = await downloadTransmissionDocument(prisma, transmissionStorage(), req.params);
      const allowed = await new Promise((resolve, reject) => {
        const response = { status() { return this; }, json() { resolve(false); } };
        Promise.resolve(requireFirmCompanyAccess()(req, response, () => resolve(true))).catch(reject);
      });
      if (!allowed) return res.status(403).json({ ok: false, message: 'Seu acesso à empresa mudou.' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="pgdas-${tipo}-${req.params.competencia}.pdf"`);
      res.send(buffer);
    } catch (e) { res.status(e.status || 503).json({ ok: false, message: e.status ? e.message : 'Documento indisponível.' }); }
  });
  router.post('/operacoes/transmission-documents/zip', async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!req.auth?.user?.id) return res.status(401).json({ ok: false, message: 'Autenticação necessária.' });
    // Same middleware as the individual download, including current company ACL.
    const authorize = companyId => new Promise((resolve, reject) => {
      if (typeof companyId !== 'string' || !companyId) return resolve(false);
      const response = { status() { return this; }, json() { resolve(false); } };
      Promise.resolve(requireFirmCompanyAccess()({ ...req, params: { ...req.params, companyId } }, response, () => resolve(true))).catch(reject);
    });
    try {
      const { files, manifest } = await prepareTransmissionArchive(prisma, transmissionStorage(), req.body?.items, authorize);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="extratos-operacoes.zip"');
      const zip = archiver('zip', { zlib: { level: 6 } });
      zip.on('error', e => res.destroy(e));
      zip.pipe(res);
      for (const file of files) zip.append(file.buffer, { name: file.name });
      zip.append(JSON.stringify(manifest, null, 2), { name: 'resultado.json' });
      await zip.finalize();
    } catch (e) {
      if (res.headersSent) return res.destroy(e);
      res.status(e.status || 503).json({ ok: false, message: e.status ? e.message : 'Não foi possível preparar os documentos.' });
    }
  });
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
