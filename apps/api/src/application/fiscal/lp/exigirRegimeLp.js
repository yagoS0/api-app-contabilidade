import { APURACAO, podeApurarPresumido } from './lib/regimeDoPresumido.js';

// Guarda no serviço: protege também workers, assistente e reemissão de guias antigas.
export async function exigirRegimeLp(db, portalClientId, { permitirDesconhecido = false } = {}) {
  const portal = await db.portalClient.findUnique({ where: { id: portalClientId }, select: { cnpj: true, companyId: true } });
  if (!portal) throw Object.assign(new Error('Empresa não encontrada.'), { code: 'PORTAL_COMPANY_NOT_FOUND', status: 404 });
  const company = portal.companyId ? await db.company.findUnique({ where: { id: portal.companyId }, select: { regimeTributario: true, tipoTributario: true } }) : null;
  const porta = podeApurarPresumido(company?.regimeTributario || company?.tipoTributario || null);
  if (!porta.pode || (!permitirDesconhecido && porta.apuracao === APURACAO.DESCONHECIDO)) {
    throw Object.assign(new Error(porta.motivo || 'Confirme o regime Lucro Presumido no cadastro antes de executar esta operação.'), {
      code: 'REGIME_INVALIDO_LP', status: 409, apuracao: porta.apuracao,
    });
  }
  return portal;
}
