import { requireFirmCompanyAccess } from '../../middlewares/requireFirmCompanyAccess.js';

const conferirAcesso = requireFirmCompanyAccess({ minRole: 'ACCOUNTANT' });

// O lote inteiro é autorizado antes do primeiro efeito. Itens incompletos
// continuam recebendo invalid_input pelo handler legado.
export async function autorizarEmpresasLiberacaoGuias(req, res, items) {
  for (const item of items) {
    const companyId = String(item?.portalClientId || '').trim();
    const competencia = String(item?.competencia || '').trim();
    if (!companyId || !competencia) continue;
    let autorizado = false;
    await conferirAcesso({ ...req, params: { companyId } }, res, () => { autorizado = true; });
    if (!autorizado) return false;
  }
  return true;
}
