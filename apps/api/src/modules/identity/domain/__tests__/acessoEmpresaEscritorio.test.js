import { avaliarAcessoEmpresaEscritorio as avaliar } from '../acessoEmpresaEscritorio.js';
const user = { id: 'contador', role: 'user' };
const link = { role: 'ACCOUNTANT', status: 'ACTIVE', scopes: ['READ'] };
test.each(['ACCOUNTANT', ' accountant ', 'FIRM_ADMIN', 'firm_admin'])('preserva papel normalizado %s', role => {
  expect(avaliar({ user, link: { ...link, role }, minRole: ' accountant ' }).access.role).toBe(role.trim().toUpperCase());
});
test.each(['REMOVED', 'INACTIVE', 'active', null])('não normaliza status do vínculo %s', status => {
  expect(avaliar({ user, link: { ...link, status } }).error).toBe('forbidden');
});
test('preserva precedência, scopes e normalização exata de admin', () => {
  expect(avaliar({}).error).toBe('unauthorized');
  expect(avaliar({ user, link: null }).error).toBe('forbidden');
  expect(avaliar({ user, link: { ...link, role: 'STAFF' }, minRole: 'ACCOUNTANT', scopes: ['WRITE'] }).error).toBe('insufficient_role');
  expect(avaliar({ user, link, minRole: 'ACCOUNTANT', scopes: ['WRITE'] }).error).toBe('scope_required');
  expect(avaliar({ user, link, scopes: ' read ' }).access.scopes).toEqual(['READ']);
  expect(avaliar({ user: { role: 'ADMIN' }, minRole: 'FIRM_ADMIN' }).access.scopes).toEqual(['*']);
  expect(avaliar({ user: { role: ' admin ' } }).error).toBe('forbidden');
});
