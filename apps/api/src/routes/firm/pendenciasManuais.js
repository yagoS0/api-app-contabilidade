import { Router } from 'express';
import { validarPendenciaManual } from '@contabilidade/shared/pendencias-manuais';

// Montado após autenticação FIRM. Toda operação verifica acesso à empresa da URL.
export function createPendenciasManuaisRouter({ prisma, requireFirmCompanyAccess }) {
  const router = Router();
  const caminho = '/companies/:companyId/pendencias-manuais';
  const executar = fn => async (req, res, next) => {
    try { await fn(req, res); } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: 'invalid_manual_debt', reason: err.message });
      next(err);
    }
  };
  router.get(caminho, requireFirmCompanyAccess(), executar(async (req, res) => {
    const itens = await prisma.pendenciaFiscalManual.findMany({ where: { portalClientId: req.params.companyId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    res.json({ ok: true, itens });
  }));
  router.post(caminho, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    const id = req.body?.id;
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return res.status(400).json({ error: 'invalid_request_id' });
    const dados = validarPendenciaManual(req.body?.dados);
    const portalClientId = req.params.companyId;
    try {
      const item = await prisma.pendenciaFiscalManual.create({ data: { id, portalClientId, dados, createdBy: req.auth.user.id, updatedBy: req.auth.user.id } });
      res.status(201).json({ ok: true, item });
    } catch (err) {
      if (err.code !== 'P2002') throw err;
      const item = await prisma.pendenciaFiscalManual.findFirst({ where: { id, portalClientId, deletedAt: null } });
      // Repetição da mesma intenção após timeout não cria um segundo débito.
      if (item && Object.keys(dados).every(k => item.dados[k] === dados[k])) return res.json({ ok: true, item });
      res.status(409).json({ error: 'manual_debt_conflict', reason: 'O registro mudou. Recarregue a lista antes de salvar.' });
    }
  }));
  for (const method of ['put', 'delete']) router[method](`${caminho}/:id`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    const versao = req.body?.versao;
    if (!Number.isSafeInteger(versao) || versao < 1) return res.status(400).json({ error: 'invalid_version' });
    const dados = method === 'put' ? validarPendenciaManual(req.body?.dados) : undefined;
    const where = { id: req.params.id, portalClientId: req.params.companyId, versao, deletedAt: null };
    const resultado = await prisma.pendenciaFiscalManual.updateMany({ where,
      data: { ...(dados ? { dados } : { deletedAt: new Date() }), versao: { increment: 1 }, updatedBy: req.auth.user.id } });
    if (!resultado.count) return res.status(409).json({ error: 'manual_debt_conflict', reason: 'O registro mudou ou foi removido. Recarregue a lista.' });
    const item = method === 'put' ? await prisma.pendenciaFiscalManual.findFirst({ where: { id: req.params.id, portalClientId: req.params.companyId } }) : null;
    res.json({ ok: true, item });
  }));
  return router;
}
