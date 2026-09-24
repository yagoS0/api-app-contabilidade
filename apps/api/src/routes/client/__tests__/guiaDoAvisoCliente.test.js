jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  guide: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
  companyClientUser: { findUnique: jest.fn() },
  companyMonthlyCircular: { findMany: jest.fn(async () => []) },
  envioGuia: { findMany: jest.fn(async () => []) },
  $transaction: ops => Promise.all(ops),
} }));
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { requireClientCompanyAccess } from '../../../middlewares/requireClientCompanyAccess.js';
import { listGuidesByCompany, toGuideResponse, PUBLICO } from '../../../application/guides/GuideService.js';

const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const start = source.indexOf('router.get("/companies/:companyId/guides"');
const end = source.indexOf('\n  });', start) + '\n  });'.length;
const register = new Function('router', 'requireClientCompanyAccess', 'listGuidesByCompany', 'toGuideResponse', 'PUBLICO', source.slice(start, end));
function setup() {
  let gate, handler;
  register({ get: (_path, g, h) => { gate = g; handler = h; } }, requireClientCompanyAccess, listGuidesByCompany, toGuideResponse, PUBLICO);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return { res, async run(query, companyId = 'c1') {
    const req = { auth: { user: { id: 'user', role: 'client' } }, params: { companyId }, query };
    await gate(req, res, () => handler(req, res));
  } };
}
beforeEach(() => { jest.clearAllMocks(); prisma.companyClientUser.findUnique.mockResolvedValue({ role: 'OWNER', status: 'ACTIVE' }); });
test('leitura direta mantém empresa e liberação, ignora paginação e competência do aviso', async () => {
  const test = setup(); await test.run({ guideId: 'guia-antiga', competencia: '2026-09', page: '8', limit: '25' });
  expect(prisma.guide.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { portalClientId: 'c1', id: 'guia-antiga', liberadaCliente: true }, skip: 0, take: 1 }));
  expect(test.res.json).toHaveBeenCalledWith({ data: [], page: 1, limit: 1, total: 0 });
});
test('empresa sem vínculo ativo não alcança consulta da guia', async () => {
  prisma.companyClientUser.findUnique.mockResolvedValue(null);
  const test = setup(); await test.run({ guideId: 'guia-antiga' }, 'outra-empresa');
  expect(test.res.status).toHaveBeenCalledWith(403); expect(prisma.guide.findMany).not.toHaveBeenCalled();
});
test.each([['g1', 'g2'], '', '../g1'])('id inválido é recusado sem consulta: %j', async guideId => {
  const test = setup(); await test.run({ guideId });
  expect(test.res.status).toHaveBeenCalledWith(400); expect(prisma.guide.findMany).not.toHaveBeenCalled();
});
