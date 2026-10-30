import express from 'express';
import request from 'supertest';
import { createNotasRouter } from '../firm/notas.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import { xmlParaDanfe } from '../../application/notas/download/__tests__/danfeFixture.js';
import { extrairDataEmissao } from '../../application/notas/dataEmissaoNota.js';
jest.mock('../../infrastructure/db/prisma.js', () => ({ prisma: {
  portalClient: { findUnique: jest.fn() }, portalInvoice: { findMany: jest.fn() }, serviceInvoice: { findMany: jest.fn() }, companyFirmAccess: { findUnique: jest.fn() },
} }));
jest.mock('../../application/notas/CompetenciaStateMachine.js', () => ({ ESTADOS: {}, ensureCompetencia: jest.fn(), fecharCompetencia: jest.fn(), reabrirCompetencia: jest.fn() }));
jest.mock('../../application/notas/CertResolver.js', () => ({ checkCertAvailability: jest.fn(), SERVICOS: {} }));
jest.mock('../../application/notas/dfe/DfeSyncService.js', () => ({ syncDfeForCompany: jest.fn() }));
jest.mock('../../application/notas/adn/AdnNotasService.js', () => ({ syncAdnNotasForCompany: jest.fn() }));
jest.mock('../../application/notas/apuracao/ClassificadorAnexos.js', () => ({ classifyItemsForCompany: jest.fn() }));
jest.mock('../../application/notas/apuracao/CalculoFiscal.js', () => ({ calcularApuracaoParaCompetencia: jest.fn() }));
jest.mock('../../application/notas/apuracao/ApuracaoTransmissaoService.js', () => ({ transmitirApuracao: jest.fn() }));
jest.mock('../../application/notas/apuracao/ApuracaoConferenciaService.js', () => ({ conferirApuracao: jest.fn() }));
const xml = xmlParaDanfe(), e = extrairDataEmissao(xml);
function app(user = { id: 'u', role: 'user' }) {
  const a = express();
  a.use((req, res, next) => { req.auth = { user }; next(); });
  a.use('/firm/companies/:companyId', createNotasRouter({ log: { error: jest.fn() } }));
  return a;
}
beforeEach(() => {
  jest.clearAllMocks();
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: 'STAFF', status: 'ACTIVE', scopes: [] });
  prisma.portalClient.findUnique.mockResolvedValue({ companyId: 'legacy', cnpj: e.emitenteDoc });
  prisma.portalInvoice.findMany.mockImplementation(async ({ where }) => where.clientId === 'a' && where.id.in.includes('n')
    ? [{ id: 'n', type: 'NFE', numero: '1', xmlRaw: xml, chaveAcesso: e.identidade, emitenteDoc: e.emitenteDoc }] : []);
  prisma.serviceInvoice.findMany.mockResolvedValue([]);
});
test('XML original, MIME, nome seguro e no-store pela porta autenticada', async () => {
  const res = await request(app()).get('/firm/companies/a/notas/n/documento?formato=XML');
  expect(res.status).toBe(200); expect(res.headers['content-type']).toMatch(/application\/xml/);
  expect(res.headers['cache-control']).toBe('no-store'); expect(res.headers['content-disposition']).toContain('NFE-1-n.xml');
  expect(res.text || res.body.toString()).toBe(xml);
});
test('PDF individual é PDF real; capacidades não precisam gerar arquivo', async () => {
  const caps = await request(app()).get('/firm/companies/a/notas/n/acoes');
  expect(caps.body).toMatchObject({ PDF: { estado: 'disponivel' }, XML: { estado: 'disponivel' }, cancelar: { estado: 'indisponivel' } });
  const res = await request(app()).get('/firm/companies/a/notas/n/documento?formato=PDF');
  expect(res.status).toBe(200); expect(res.headers['content-type']).toMatch(/application\/pdf/);
  expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
});
test('autenticação e vínculo são verificados antes de ler documento', async () => {
  expect((await request(app(null)).get('/firm/companies/a/notas/n/acoes')).status).toBe(401);
  prisma.companyFirmAccess.findUnique.mockResolvedValue(null);
  expect((await request(app()).get('/firm/companies/a/notas/n/documento?formato=XML')).status).toBe(403);
  expect(prisma.portalInvoice.findMany).not.toHaveBeenCalled();
});
test('outro tenant e ID inexistente têm resposta indistinguível', async () => {
  const foreign = await request(app()).get('/firm/companies/b/notas/n/documento?formato=XML');
  const absent = await request(app()).get('/firm/companies/a/notas/ausente/documento?formato=XML');
  expect(foreign.status).toBe(404); expect(absent.status).toBe(404); expect(foreign.body).toEqual(absent.body);
});
test('formato inválido não lê nota nem retorna arquivo', async () => {
  const res = await request(app()).get('/firm/companies/a/notas/n/documento?formato=ZIP');
  expect(res.status).toBe(400); expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(prisma.portalInvoice.findMany).not.toHaveBeenCalled();
});
