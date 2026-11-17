import { prisma } from "../infrastructure/db/prisma.js";
import { administradorGlobal, avaliarAcessoEmpresaEscritorio } from '../modules/identity/public.js';

export function requireFirmCompanyAccess(options = {}) {
  const { minRole = null, scopes = [] } = options;
  return async function requireFirmCompanyAccessMiddleware(req, res, next) {
    const user = req?.auth?.user;
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    if (administradorGlobal(user)) {
      req.access = avaliarAcessoEmpresaEscritorio({ user }).access;
      return next();
    }
    const companyId = String(req.params.companyId || req.params.clientId || req.body?.companyId || '').trim();
    if (!companyId) return res.status(400).json({ error: 'company_id_required' });
    const link = await prisma.companyFirmAccess.findUnique({
      where: { companyId_userId: { companyId, userId: String(user.id) } },
      select: { role: true, status: true, scopes: true },
    });
    const resultado = avaliarAcessoEmpresaEscritorio({ user, link, minRole, scopes });
    if (resultado.error) return res.status(resultado.status).json({ error: resultado.error });
    req.access = resultado.access;
    return next();
  };
}
