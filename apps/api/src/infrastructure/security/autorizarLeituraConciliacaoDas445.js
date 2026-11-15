import { requireFirmCompanyAccess } from '../../middlewares/requireFirmCompanyAccess.js';
import { requireAccountType } from '../../middlewares/requireAccountType.js';

// auth must be the server's authenticated session, never input/body data. Preserve #275 policy.
export async function autorizarLeituraConciliacaoDas445(companyId, auth) {
  const req = { auth, params: { companyId }, body: {} };
  let autorizado = false;
  const res = { statusCode: 403, status(code) { this.statusCode = code; return this; },
    json() { throw Object.assign(new Error('Leitura da empresa não autorizada.'), { code: 'ACESSO_NEGADO', status: this.statusCode }); } };
  requireAccountType('FIRM')(req, res, () => { autorizado = true; });
  if (!autorizado) throw Object.assign(new Error('Leitura da empresa não autorizada.'), { code: 'ACESSO_NEGADO', status: 403 });
  autorizado = false;
  await requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' })(req, res, () => { autorizado = true; });
  if (!autorizado) throw Object.assign(new Error('Leitura da empresa não autorizada.'), { code: 'ACESSO_NEGADO', status: 403 });
}
