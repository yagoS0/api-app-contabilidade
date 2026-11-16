// Política existente do middleware, compartilhada com revalidações transacionais.
const pesos = { STAFF: 1, ACCOUNTANT: 2, FIRM_ADMIN: 3 };
const normalizar = value => String(value || '').trim().toUpperCase();
export const administradorGlobal = user => String(user?.role || '').toLowerCase() === 'admin';
export function avaliarAcessoEmpresaEscritorio({ user, link, minRole = null, scopes = [] }) {
  if (!user) return { status: 401, error: 'unauthorized' };
  if (administradorGlobal(user)) return { access: { role: 'FIRM_ADMIN', status: 'ACTIVE', scopes: ['*'] } };
  if (!link || link.status !== 'ACTIVE') return { status: 403, error: 'forbidden' };
  if ((pesos[normalizar(link.role)] || 0) < (minRole ? pesos[normalizar(minRole)] || 0 : 0))
    return { status: 403, error: 'insufficient_role' };
  const exigidos = Array.isArray(scopes) ? scopes : [scopes];
  if (exigidos.length && (!Array.isArray(link.scopes)
    || !exigidos.every(s => new Set(link.scopes.map(normalizar)).has(normalizar(s)))))
    return { status: 403, error: 'scope_required' };
  return { access: { role: normalizar(link.role), status: link.status, scopes: Array.isArray(link.scopes) ? link.scopes : [] } };
}
