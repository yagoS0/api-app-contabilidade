import { Router } from 'express';
import { cadastroAtual, cadastroReformaVazio, salvarCadastroReforma, carteiraReforma, conferirNfse, lerConferencia } from '../../application/fiscal/reforma/ReformaFiscalService.js';

// O router pai exige autenticação FIRM. Identidade e empresa nunca vêm do payload.
export function createReformaFiscalRouter({ prisma, requireFirmCompanyAccess }) {
  const router = Router();
  const executar = fn => async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (e) {
      if ([400, 404, 409].includes(e.status)) return res.status(e.status).json({ error: 'reforma_fiscal', reason: e.message });
      next(e);
    }
  };
  const base = '/companies/:companyId/reforma';
  router.get('/reforma/carteira', executar(async (req, res) => res.json({ ok: true, ...await carteiraReforma(prisma, req.auth.user, req.query.competencia) })));
  router.get(base, requireFirmCompanyAccess(), executar(async (req, res) => {
    const atual = await cadastroAtual(prisma, req.params.companyId);
    const historico = await prisma.reformaFiscalRevisao.findMany({ where: { portalClientId: req.params.companyId }, orderBy: { versao: 'desc' }, take: 100 });
    res.json({ ok: true, versao: atual?.versao || 0, dados: atual?.dados || cadastroReformaVazio(), historico,
      podeEditar: ['ACCOUNTANT', 'FIRM_ADMIN'].includes(req.access?.role), historicoLimitado: (atual?.versao || 0) > 100 });
  }));
  router.post(base, requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' }), executar(async (req, res) => {
    const revisao = await salvarCadastroReforma(prisma, req.params.companyId, req.body, req.auth.user);
    res.status(201).json({ ok: true, revisao });
  }));
  router.get(`${base}/nfse`, requireFirmCompanyAccess(), executar(async (req, res) => res.json({ ok: true, ...await lerConferencia(prisma, req.params.companyId, req.query.competencia) })));
  router.post(`${base}/nfse`, requireFirmCompanyAccess(), executar(async (req, res) => {
    await conferirNfse(prisma, req.params.companyId, req.body?.competencia, req.auth.user);
    res.json({ ok: true, ...await lerConferencia(prisma, req.params.companyId, req.body?.competencia) });
  }));
  return router;
}
