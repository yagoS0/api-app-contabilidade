import { Router } from 'express';
import { lerBaseConsumo, vincularEstabelecimentos, salvarConfiguracaoConsumo, prepararRevisaoConsumo } from '../../application/fiscal/consumo/ApuracaoConsumoService.js';

// Montado no router FIRM autenticado; autorização de todos os estabelecimentos é revalidada no serviço.
export function createApuracaoConsumoRouter({ prisma, requireFirmCompanyAccess }) {
  const router = Router();
  const base = '/companies/:companyId/apuracao-consumo';
  const executar = fn => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); }
    catch (e) {
      if ([400, 401, 403, 404, 409].includes(e.status)) return res.status(e.status).json({ error: 'apuracao_consumo', reason: e.message });
      next(e);
    }
  };
  router.get(base, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    res.json({ ok: true, ...await lerBaseConsumo(prisma, req.params.companyId, req.query, req.auth.user) });
  }));
  for (const [sufixo, fn, chave] of [
    ['/estabelecimentos', vincularEstabelecimentos, 'contribuinte'],
    ['/configuracoes', salvarConfiguracaoConsumo, 'configuracao'],
    ['/revisoes', prepararRevisaoConsumo, 'revisao'],
  ]) router.post(`${base}${sufixo}`, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    res.status(201).json({ ok: true, [chave]: await fn(prisma, req.params.companyId, req.body, req.auth.user) });
  }));
  return router;
}
