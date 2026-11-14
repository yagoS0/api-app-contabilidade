jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  guide: { findFirst: jest.fn() },
  companyClientUser: { findUnique: jest.fn() },
} }));
jest.mock('../../../application/guides/GuideStorageService.js', () => ({
  GuideStorageService: { create: jest.fn() },
}));
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { requireClientCompanyAccess } from '../../../middlewares/requireClientCompanyAccess.js';
import { getGuidePdfBuffer } from '../../../application/guides/GuideService.js';
import { STATUS_DOCUMENTO } from '../../../application/guides/lib/documentoNaoArrecadatorio.js';
import { GuideStorageService } from '../../../application/guides/GuideStorageService.js';

const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const marker = '"/companies/:companyId/guides/:guideId/download"';
const start = source.lastIndexOf('router.get(', source.indexOf(marker));
const end = source.indexOf('\n  );', start) + '\n  );'.length;
const register = new Function('router', 'requireClientCompanyAccess', 'prisma', 'getGuidePdfBuffer', 'STATUS_DOCUMENTO', source.slice(start, end));
function app() {
  const a = express();
  a.use((req, _res, next) => { req.auth = { user: { id: 'cliente', role: 'client' } }; next(); });
  register(a, requireClientCompanyAccess, prisma, getGuidePdfBuffer, STATUS_DOCUMENTO);
  a.use((err, _req, res, _next) => res.status(500).json({ error: 'erro_do_ensaio' }));
  return a;
}
const guia = { id: 'g', portalClientId: 'A', liberadaCliente: true, status: 'PROCESSED', competencia: '2026-10', pdfBytes: Buffer.from('pdf-fixture'), storageKey: 'legado' };
beforeEach(() => {
  jest.clearAllMocks();
  prisma.companyClientUser.findUnique.mockResolvedValue({ role: 'OWNER', status: 'ACTIVE' });
  prisma.guide.findFirst.mockImplementation(async ({where}) => {
    expect(where).toEqual({ id: 'g', portalClientId: 'A', liberadaCliente: true, status: {not: STATUS_DOCUMENTO} });
    return guia;
  });
});
test('download real da rota usa guarda e escopo com liberação, prioriza bytes e preserva DTO', async () => {
  await request(app()).get('/companies/A/guides/g/download').expect(200, {
    url: null, contentBase64: guia.pdfBytes.toString('base64'), fileName: 'guia-2026-10.pdf', mimeType: 'application/pdf', expiresIn: null,
  });
  expect(GuideStorageService.create).not.toHaveBeenCalled();
});
test('empresa sem vínculo não alcança a consulta documental', async () => {
  prisma.companyClientUser.findUnique.mockResolvedValue(null);
  await request(app()).get('/companies/B/guides/g/download').expect(403);
  expect(prisma.guide.findFirst).not.toHaveBeenCalled();
});
test.each(['outra empresa', 'não liberada', 'reclassificada'])('a consulta filtrada omite guia %s', async () => {
  prisma.guide.findFirst.mockImplementation(async ({where}) => {
    expect(where).toEqual({ id: 'g', portalClientId: 'A', liberadaCliente: true, status: {not: STATUS_DOCUMENTO} });
    return null;
  });
  await request(app()).get('/companies/A/guides/g/download').expect(404, {error: 'not_found'});
  expect(GuideStorageService.create).not.toHaveBeenCalled();
});
test('PDF ausente conserva erro público de indisponibilidade', async () => {
  prisma.guide.findFirst.mockResolvedValue({...guia, pdfBytes: null, storageKey: null});
  await request(app()).get('/companies/A/guides/g/download').expect(404, {error:'file_not_available'});
});
test('storageKey é consultada com a chave existente quando faltam bytes', async () => {
  prisma.guide.findFirst.mockResolvedValue({...guia, pdfBytes: null});
  const downloadBuffer=jest.fn().mockResolvedValue(Buffer.from('storage-fixture'));
  GuideStorageService.create.mockReturnValue({downloadBuffer});
  const r=await request(app()).get('/companies/A/guides/g/download').expect(200);
  expect(r.body.contentBase64).toBe(Buffer.from('storage-fixture').toString('base64'));
  expect(downloadBuffer).toHaveBeenCalledWith({key:'legado'});
});
