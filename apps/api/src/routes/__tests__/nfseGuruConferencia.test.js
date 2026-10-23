jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../middlewares/portalAccess.js', () => ({
  resolveLegacyCompanyId: jest.fn(async () => 'legacy-local'),
  ensureLegacyCompanyAccess: jest.fn(async () => ({ ok: true })),
}));
import express from 'express';
import request from 'supertest';
import { createNfseGuruConferenciaRouter } from '../nfseGuruConferencia.js';
import { ensureLegacyCompanyAccess, resolveLegacyCompanyId } from '../middlewares/portalAccess.js';

function fixture(role = 'contador', authenticated = true) {
  const service = { preparar: jest.fn(async () => ({ item: { modo: 'CONFERENCIA' }, repetida: false })),
    listar: jest.fn(async () => ({ items: [], total: 0 })), importar: jest.fn(async () => ({ estado: 'CONCLUIDA' })),
    obter: jest.fn(async () => ({ estado: 'PREPARADA' })), conferir: jest.fn(async () => ({ item: {} })),
    buscarNotas: jest.fn(async () => ({ items: [], total: 0, pagina: 1 })),
    obterNota: jest.fn(async () => ({ id: 'portal:nota', hash: 'revisao' })),
    vincularNota: jest.fn(async () => ({ item: { notas: [] } })),
    documentoNota: jest.fn(async () => ({ bytes: Buffer.from('<NFSe/>'), tipo: 'application/xml', nome: 'nota.xml' })),
    emitir: jest.fn(async () => { throw Object.assign(Error('blocked'), { status: 409, code: 'guru_emissao_bloqueada_modo_conferencia' }); }) };
  const ensureAuthorized = jest.fn(async (req, res) => {
    if (!authenticated) { res.status(401).json({ error: 'unauthorized' }); return false; }
    req.auth = { user: { id: 'ator-local', role } }; return true;
  });
  const app = express(); app.use(express.json());
  app.use('/nfse/guru-conferencia', createNfseGuruConferenciaRouter({ ensureAuthorized, service }));
  return { app, service, ensureAuthorized };
}
const base = '/nfse/guru-conferencia/portal-local/preparacoes';
beforeEach(() => { jest.clearAllMocks(); resolveLegacyCompanyId.mockResolvedValue('legacy-local'); ensureLegacyCompanyAccess.mockResolvedValue({ ok: true }); });
test('resolve empresa da URL, autentica sem API key e conserva contrato HTTP', async () => {
  const f = fixture();
  expect((await request(f.app).post(base).send({ transacaoId: 'local' })).status).toBe(201);
  expect(f.ensureAuthorized.mock.calls[0][2]).toEqual({ allowApiKeyFallback: false });
  expect(f.service.preparar).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'legacy-local', userId: 'ator-local' }));
  f.service.preparar.mockResolvedValueOnce({ item: {}, repetida: true });
  expect((await request(f.app).post(base).send({})).status).toBe(200);
});

test('listagem só lê; importação explícita usa empresa resolvida e revalida vínculo', async () => {
  const f = fixture();
  expect((await request(f.app).get(`${base}?pagina=2`)).status).toBe(200);
  expect(f.service.listar).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'legacy-local', query: { pagina: '2' } }));
  expect(f.service.importar).not.toHaveBeenCalled();
  f.service.importar.mockImplementation(async args => { await args.revalidarAcesso(); return { estado: 'CONCLUIDA' }; });
  expect((await request(f.app).post('/nfse/guru-conferencia/portal-local/importacoes').send({ campo: 'confirmed_at', inicio: '2026-10-01', fim: '2026-10-22' })).status).toBe(200);
  expect(resolveLegacyCompanyId).toHaveBeenCalledTimes(3);
  for (const [role, auth, status] of [['client', true, 403], ['contador', false, 401]]) {
    const denied = fixture(role, auth);
    expect((await request(denied.app).post('/nfse/guru-conferencia/portal-local/importacoes').send({})).status).toBe(status);
    expect(denied.service.importar).not.toHaveBeenCalled();
    expect((await request(denied.app).get(base)).status).toBe(status);
  }
});
test('GET só consulta; conferência e emissão têm caminhos separados', async () => {
  const f = fixture();
  expect((await request(f.app).get(`${base}/id-local`)).status).toBe(200);
  expect(f.service.preparar).not.toHaveBeenCalled(); expect(f.service.conferir).not.toHaveBeenCalled();
  expect((await request(f.app).post(`${base}/id-local/conferir`).send({ confirmada: true })).status).toBe(200);
  expect((await request(f.app).post(`${base}/id-local/emitir`).send({ modo: 'EMISSAO' })).body.error).toBe('guru_emissao_bloqueada_modo_conferencia');
});
test.each([['client', true, 403], ['contador', false, 401]])('recusa acesso %s/%s', async (role, auth, status) => {
  const f = fixture(role, auth);
  expect((await request(f.app).post(base).send({})).status).toBe(status);
  expect(f.service.preparar).not.toHaveBeenCalled();
});
test('isolamento recusado impede serviço e falha inesperada não expõe detalhes', async () => {
  const f = fixture();
  ensureLegacyCompanyAccess.mockImplementationOnce(async (req, res) => { res.status(403).json({ error: 'forbidden' }); return { ok: false }; });
  expect((await request(f.app).get(`${base}/id-local`)).status).toBe(403);
  expect(f.service.obter).not.toHaveBeenCalled();
  f.service.preparar.mockRejectedValueOnce(Error('detalhe privado'));
  const response = await request(f.app).post(base).send({});
  expect(response.status).toBe(500); expect(response.body).toEqual({ error: 'guru_conferencia_indisponivel' });
});

test('busca, vínculo e download autenticados preservam empresa, filtros, revisão e erros', async () => {
  const f = fixture(), root = '/nfse/guru-conferencia/portal-local';
  expect((await request(f.app).get(`${root}/notas?busca=Tomador&pagina=2`)).status).toBe(200);
  expect(f.service.buscarNotas).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'legacy-local', query: { busca: 'Tomador', pagina: '2' } }));
  expect((await request(f.app).get(`${root}/notas/portal%3Anota`)).status).toBe(200);
  const body = { versao: 1, hash: 'venda', notaId: 'portal:nota', notaHash: 'nota', confirmada: true };
  expect((await request(f.app).post(`${base}/venda/notas`).send(body)).status).toBe(200);
  expect(f.service.vincularNota).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'legacy-local', body }));
  const arquivo = await request(f.app).get(`${base}/venda/notas/portal%3Anota/xml`);
  expect(arquivo.status).toBe(200); expect(arquivo.headers['cache-control']).toBe('no-store');
  expect(arquivo.text).toBe('<NFSe/>');
  f.service.documentoNota.mockRejectedValueOnce(Object.assign(Error('QR Code obrigatório indisponível'), { code: 'DANFSE_SEM_QRCODE' }));
  expect((await request(f.app).get(`${base}/venda/notas/portal%3Anota/danfse`)).body).toMatchObject({ error: 'danfse_sem_qrcode' });
  for (const [role, auth, status] of [['client', true, 403], ['contador', false, 401]]) {
    const denied = fixture(role, auth);
    expect((await request(denied.app).get(`${root}/notas`)).status).toBe(status);
    expect((await request(denied.app).get(`${base}/venda/notas/portal%3Anota/xml`)).status).toBe(status);
    expect((await request(denied.app).post(`${base}/venda/notas`).send(body)).status).toBe(status);
    expect(denied.service.buscarNotas).not.toHaveBeenCalled(); expect(denied.service.documentoNota).not.toHaveBeenCalled();
  }
  expect(f.service.emitir).not.toHaveBeenCalled(); expect(f.service.importar).not.toHaveBeenCalled();
});
