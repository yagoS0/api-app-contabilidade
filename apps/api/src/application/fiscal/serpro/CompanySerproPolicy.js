// Pausa do transporte SERPRO. Não altera seleções de rotinas nem impede leitura local.
export const chavePoliticaSerpro = companyId => `company_serpro_policy:${companyId}`;
export const erroPoliticaSerpro = (code, message, detalhe = {}) => Object.assign(new Error(message), { code, status: 409, detalhe });

export async function bloquearPoliticaEmpresa(db, companyId) {
  await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`company_automation:${companyId}`}))::text`;
}

export async function lerPoliticaSerpro(db, companyId) {
  const row = await db.appSetting.findUnique({ where: { key: chavePoliticaSerpro(companyId) } });
  if (!row) return { paused: false, reason: '', updatedAt: null, updatedBy: null };
  const value = row.value;
  if (!value || typeof value.paused !== 'boolean' || typeof value.reason !== 'string') {
    throw erroPoliticaSerpro('SERPRO_POLITICA_INVALIDA', 'A política SERPRO da empresa precisa ser conferida antes de novas operações.', { companyId });
  }
  return { paused: value.paused, reason: value.reason, updatedAt: value.updatedAt || null, updatedBy: value.updatedBy || null };
}

export async function conferirPoliticaSerpro(db, companyId) {
  if (!companyId) return;
  const policy = await lerPoliticaSerpro(db, companyId);
  if (policy.paused) throw erroPoliticaSerpro('SERPRO_EMPRESA_PAUSADA', `As operações SERPRO desta empresa estão pausadas. ${policy.reason}`, { companyId, reason: policy.reason });
}

// Cadastro aceita CNPJ com ou sem máscara. Nunca usar contains para autorização.
// Chamadas sem contribuinte e CNPJs ainda não cadastrados conservam a guarda global;
// não existe uma política de empresa que possa ser aplicada a esses casos.
export async function empresaDaChamada(db, payload) {
  if (payload?.contribuinte == null) return null;
  const raw = String(payload.contribuinte.numero || '').trim();
  if (!/^(\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(raw)) {
    throw erroPoliticaSerpro('SERPRO_IDENTIDADE_INVALIDA', 'O contribuinte da operação SERPRO não possui um CNPJ válido. Nenhuma operação foi enviada.');
  }
  const cnpj = raw.replace(/\D/g, '');
  const mask = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  const rows = await db.portalClient.findMany({ where: { cnpj: { in: [cnpj, mask] } }, select: { id: true } });
  if (rows.length > 1) throw erroPoliticaSerpro('SERPRO_IDENTIDADE_AMBIGUA', 'Mais de uma empresa corresponde ao contribuinte. Confira o cadastro antes da operação SERPRO.');
  return rows[0]?.id || null;
}
