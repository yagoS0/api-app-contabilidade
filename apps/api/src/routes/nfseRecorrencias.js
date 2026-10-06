import { Router } from 'express';
import { prisma } from '../infrastructure/db/prisma.js';
import { NFSE_ENV } from '../config.js';
import { workerRecorrenciaHabilitado } from '../application/nfse/recorrenciaConfiguracao.js';
import { ensureLegacyCompanyAccess, resolveLegacyCompanyId } from './middlewares/portalAccess.js';
import { ensureEmissaoNfseAutorizada } from './middlewares/emissaoNfseGate.js';
import { criarRecorrencia, listarRecorrencias, pausarRecorrencia, retomarRecorrencia } from '../application/nfse/NfseRecorrenciaService.js';

// Revalida o usuário e as permissões atuais a cada execução, nunca uma cópia antiga do papel.
export async function autorizarExecucaoRecorrente(item) {
  const user = await prisma.user.findUnique({ where: { id: item.autorizadoPor } });
  if (!user || user.status !== 'active') return false;
  const req = { auth: { user } };
  const res = { status() { return this; }, json() { return this; } };
  if (!(await ensureLegacyCompanyAccess(req, res, item.companyId)).ok) return false;
  return (await ensureEmissaoNfseAutorizada(req, res, item.companyId)).ok;
}

export function createNfseRecorrenciasRouter({ ensureAuthorized, log }) {
  const router = Router();
  router.use(async (req, res, next) => {
    try {
      if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
      const id = await resolveLegacyCompanyId(req.query.companyId || req.body?.companyId);
      if (!id) return res.status(404).json({ message: 'Empresa não encontrada.' });
      if (!(await ensureLegacyCompanyAccess(req, res, id)).ok) return;
      if (!(await ensureEmissaoNfseAutorizada(req, res, id, { log })).ok) return;
      req.recorrenciaCompanyId = id;
      next();
    } catch (e) { next(e); }
  });
  router.get('/', async (req, res, next) => {
    try { res.json({ items: await listarRecorrencias(req.recorrenciaCompanyId), workerAtivo: workerRecorrenciaHabilitado(process.env, NFSE_ENV) }); }
    catch (e) { next(e); }
  });
  router.post('/', async (req, res, next) => {
    try { res.status(201).json(await criarRecorrencia({ companyId: req.recorrenciaCompanyId, userId: req.auth.user.id, body: req.body })); }
    catch (e) { next(e); }
  });
  router.post('/:id/pausar', async (req, res, next) => {
    try {
      const ok = await pausarRecorrencia(req.recorrenciaCompanyId, req.params.id);
      res.status(ok ? 200 : 404).json({ ok });
    } catch (e) { next(e); }
  });
  router.post('/:id/retomar', async (req, res, next) => {
    try {
      if (req.body.confirmada !== true) return res.status(400).json({ message: 'Confirme a retomada mensal.' });
      await retomarRecorrencia({ companyId: req.recorrenciaCompanyId, id: req.params.id, userId: req.auth.user.id, inicio: req.body.inicio });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });
  router.use((err, req, res, next) => {
    log?.error?.({ code: err.code }, 'Falha na recorrência NFS-e');
    res.status(err.status || 500).json({ message: err.status ? err.message : 'Não foi possível salvar ou carregar a recorrência.' });
  });
  return router;
}
