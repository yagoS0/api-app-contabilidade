jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { autorizarEmissaoDoCliente } from '../autorizacaoEmissaoDoCliente.js';
const fixture = status => ({
  user: { findUnique: jest.fn(async () => status == null ? null : ({ id: 'u', status })) },
  portalClient: { findUnique: jest.fn(async () => ({ id: 'p', emissaoClienteLiberada: true })) },
  companyClientUser: { findUnique: jest.fn(async () => ({ role: 'CLIENT_ADMIN', status: 'ACTIVE' })) },
});
it.each(['inactive', 'pending', 'rejected', null, undefined])('usuário %s não emite mesmo com vínculo ativo', async status => {
  const client = fixture(status);
  expect(await autorizarEmissaoDoCliente({ portalClientId: 'p', userId: 'u', client })).toMatchObject({ ok: false, codigo: 'USUARIO_INATIVO' });
  expect(client.portalClient.findUnique).not.toHaveBeenCalled();
});
it('ativo passa e revogação posterior recusa; erro de leitura não autoriza', async () => {
  const client = fixture('active'); const args = { portalClientId: 'p', userId: 'u', client };
  expect((await autorizarEmissaoDoCliente(args)).ok).toBe(true);
  client.user.findUnique.mockResolvedValue({ id: 'u', status: 'rejected' });
  expect((await autorizarEmissaoDoCliente(args)).ok).toBe(false);
  client.user.findUnique.mockRejectedValue(Error('banco indisponível'));
  await expect(autorizarEmissaoDoCliente(args)).rejects.toThrow('banco indisponível');
});
