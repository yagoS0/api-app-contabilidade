jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('dotenv', () => ({ config: jest.fn() }));
import { autorizarPermissaoDaAcao } from '../AcoesPendentesService.js';
import { autorizarEmissaoDoCliente } from '../../nfse/autorizacaoEmissaoDoCliente.js';
import { TIPOS } from '../confirmacaoPendente.js';

// Integração das duas guardas reais com persistência simulada, sem emissor/modelo/transporte.
function fixture({ permission = true, enabled = true, role = 'CLIENT_ADMIN', status = 'ACTIVE', owner = 'u' } = {}) {
  const acao = { tipo: TIPOS.EMITIR_NFSE, conversaId: 'cv', portalClientId: 'pc', userId: 'u' };
  const client = {
    user: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, status: "active" })) },
    conversaWhatsapp: { findFirst: jest.fn(async () => ({ telefoneE164: 'numero-sintetico' })) },
    contatoWhatsapp: { findMany: jest.fn(async () => [{ userId: owner, permissoesAssistente: permission ? ['EMISSAO_NFSE'] : [] }]) },
    portalClient: { findUnique: jest.fn(async () => ({ id: 'pc', emissaoClienteLiberada: enabled })) },
    companyClientUser: { findUnique: jest.fn(async () => ({ role, status })) },
  };
  return { acao, client };
}

test.each([
  [{}, true, true],
  [{ permission: false }, false, true],
  [{ enabled: false }, true, false],
  [{ role: 'FINANCEIRO' }, false, false],
  [{ status: 'INACTIVE' }, false, false],
  [{ owner: 'outro' }, false, true],
])('configuração do contato e autorização empresarial são guardas independentes: %j', async (options, contact, company) => {
  const { acao, client } = fixture(options);
  expect((await autorizarPermissaoDaAcao({ acao, client })).ok).toBe(contact);
  expect((await autorizarEmissaoDoCliente({ ...acao, client })).ok).toBe(company);
  expect(client.portalClient.findUnique).toHaveBeenCalledWith({ where: { id: 'pc' }, select: { id: true, emissaoClienteLiberada: true } });
});

test('revogação entre leituras impede autorização posterior; erro de leitura não vira liberação', async () => {
  const { acao, client } = fixture();
  expect((await autorizarEmissaoDoCliente({ ...acao, client })).ok).toBe(true);
  client.portalClient.findUnique.mockResolvedValue({ id: 'pc', emissaoClienteLiberada: false });
  expect((await autorizarEmissaoDoCliente({ ...acao, client })).ok).toBe(false);
  client.portalClient.findUnique.mockRejectedValue(new Error('indisponivel'));
  await expect(autorizarEmissaoDoCliente({ ...acao, client })).rejects.toThrow('indisponivel');
});
