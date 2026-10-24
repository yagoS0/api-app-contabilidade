jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { companyFirmAccess: { findUnique: jest.fn() },
    portalInvoice: { findFirst: jest.fn(), findMany: jest.fn(async () => []), count: jest.fn(async () => 0), update: jest.fn() },
    notaItem: { findMany: jest.fn(async () => []) },
    // O detalhe passou a devolver o CICLO DE VIDA junto (cancelada × substituída × substituta ×
    // "não temos o evento"), e para isso lê os eventos da nota. Vazio por padrão: é exatamente o
    // estado de produção hoje (0 linhas para 556 canceladas), e é o caso que precisa continuar
    // respondendo sem quebrar.
    portalInvoiceEvent: { findMany: jest.fn(async () => []) },
  },
}));

// Serviços que o router importa no topo — nenhum é exercido aqui.
jest.mock("../../../application/notas/CompetenciaStateMachine.js", () => ({
  ESTADOS: { ABERTO: "aberto" }, ensureCompetencia: jest.fn(), fecharCompetencia: jest.fn(), reabrirCompetencia: jest.fn(),
}));
jest.mock("../../../application/notas/CertResolver.js", () => ({ checkCertAvailability: jest.fn(), SERVICOS: {} }));
jest.mock("../../../application/notas/dfe/DfeSyncService.js", () => ({ syncDfeForCompany: jest.fn() }));
jest.mock("../../../application/notas/adn/AdnNotasService.js", () => ({ syncAdnNotasForCompany: jest.fn() }));
jest.mock("../../../application/notas/apuracao/ClassificadorAnexos.js", () => ({ classifyItemsForCompany: jest.fn() }));
jest.mock("../../../application/notas/apuracao/CalculoFiscal.js", () => ({ calcularApuracaoParaCompetencia: jest.fn() }));
jest.mock("../../../application/notas/apuracao/ApuracaoTransmissaoService.js", () => ({ transmitirApuracao: jest.fn() }));
jest.mock("../../../application/notas/apuracao/ApuracaoConferenciaService.js", () => ({ conferirApuracao: jest.fn() }));

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { createNotasRouter } from "../notas.js";


function app(user = { id: 'u', role: 'staff' }) {
  const a = express(); a.use(express.json());
  a.use((req, res, next) => { req.auth = { user }; next(); });
  a.use('/firm/companies/:companyId', createNotasRouter({ log: {} })); return a;
}
beforeEach(() => {
  jest.clearAllMocks();
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'ACTIVE', role: 'STAFF' });
  prisma.portalInvoice.findMany.mockResolvedValue([]); prisma.portalInvoice.count.mockResolvedValue(0);
});
test.each(['/notas', '/notas/summary'])('%s valida datas reais e ordem antes de ler notas', async route => {
  for (const filters of [{ dataInicio: '2026-02-30' }, { dataFim: 'ruim' }, { dataInicio: '2026-10-22', dataFim: '2026-10-01' }, { situacao: 'substituida' }]) {
    const r = await request(app()).get('/firm/companies/a' + route).query(filters);
    expect(r.status).toBe(400); expect(r.body.error).toBe('filtro_invalido');
  }
  expect(prisma.portalInvoice.findMany).not.toHaveBeenCalled();
});
test.each(['/notas', '/notas/summary'])('%s aplica o mesmo recorte civil, situação e CNPJ no servidor', async route => {
  await request(app()).get('/firm/companies/a' + route).query({ dataInicio: '2025-02-01', dataFim: '2025-02-28', situacao: 'cancelada', search: '12.345.678/0001-99', incluirCanceladas: '1' }).expect(200);
  const { where } = prisma.portalInvoice.findMany.mock.calls[0][0];
  expect(where).toMatchObject({ clientId: 'a', statusEfetivo: 'cancelada', dataEmissaoCivil: { gte: '2025-02-01', lte: '2025-02-28' } });
  expect(where.competencia).toBeUndefined();
  expect(where.OR).toContainEqual({ tomadorDoc: { contains: '12345678000199' } });
});
test.each([{ dataInicio: '2025-01-01' }, { situacao: 'cancelada' }])('filtro isolado %j não ganha ano atual oculto no resumo', async filters => {
  await request(app()).get('/firm/companies/a/notas/summary').query(filters).expect(200);
  expect(prisma.portalInvoice.findMany.mock.calls[0][0].where.competencia).toBeUndefined();
});
test('resumo conta canceladas visíveis sem mudar os totais fiscais legados', async () => {
  prisma.portalInvoice.findMany.mockResolvedValue([
    { papel: 'EMIT', type: 'NFSE', statusEfetivo: 'autorizada', total: '100', competencia: new Date('2026-10-01') },
    { papel: 'EMIT', type: 'NFSE', statusEfetivo: 'cancelada', total: '20', competencia: new Date('2026-10-01') },
  ]);
  const r = await request(app()).get('/firm/companies/a/notas/summary').query({ competencia: '2026-10', incluirCanceladas: '1' });
  expect(r.body.lista.EMIT).toMatchObject({ count: 2, valor: 120, valorCompleto: true });
  expect(r.body.totals).toMatchObject({ totalNotas: 1, countCanceladas: 1, totalEmitido: 100 });
});
test('total da lista ignora tamanho da página e usa o mesmo where', async () => {
  prisma.portalInvoice.count.mockResolvedValue(240);
  const r = await request(app()).get('/firm/companies/a/notas').query({ limit: 100, offset: 100, situacao: 'autorizada' });
  expect(r.body.total).toBe(240);
  expect(prisma.portalInvoice.findMany.mock.calls[0][0]).toMatchObject({ take: 100, skip: 100 });
  expect(prisma.portalInvoice.count.mock.calls[0][0].where).toEqual(prisma.portalInvoice.findMany.mock.calls[0][0].where);
});
test.each(['/notas', '/notas/summary'])('%s respeita autenticação e vínculo real do middleware', async route => {
  await request(app(null)).get('/firm/companies/a' + route).expect(401);
  prisma.companyFirmAccess.findUnique.mockResolvedValue({ status: 'REVOKED', role: 'ACCOUNTANT' });
  await request(app()).get('/firm/companies/a' + route).expect(403);
  expect(prisma.portalInvoice.findMany).not.toHaveBeenCalled();
});

test.each(['/notas', '/notas/summary'])('%s conta datas desconhecidas no restante do recorte, separadas do intervalo', async route => {
  prisma.portalInvoice.count.mockImplementation(async ({ where }) => where.dataEmissaoCivil === null ? 7 : 120);
  const r = await request(app()).get('/firm/companies/a' + route).query({ dataInicio: '2026-09-28', dataFim: '2026-09-28', papel: 'EMIT', search: 'Alfa', incluirCanceladas: '1' }).expect(200);
  expect(r.body.datasIndeterminadas).toBe(7);
  const unknown = prisma.portalInvoice.count.mock.calls.find(([args]) => args.where.dataEmissaoCivil === null)[0].where;
  expect(unknown).toMatchObject({ clientId: 'a', papel: 'EMIT', dataEmissaoCivil: null });
  expect(unknown.OR).toContainEqual({ emitenteNome: { contains: 'Alfa', mode: 'insensitive' } });
  expect(prisma.portalInvoice.findMany.mock.calls[0][0].where.dataEmissaoCivil).toEqual({ gte: '2026-09-28', lte: '2026-09-28' });
});
