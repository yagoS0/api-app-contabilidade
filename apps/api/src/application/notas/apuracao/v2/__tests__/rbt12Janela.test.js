import { getRbt12, pasAnteriores } from '../RbtExtratoService.js';
import { receitasDoExtrato } from '../receitasDoExtrato.js';
import { prisma } from '../../../../../infrastructure/db/prisma.js';
jest.mock('../../../../../infrastructure/db/prisma.js', () => ({ prisma: {
  portalInvoice: { findMany: jest.fn() },
  companyMonthlyCircular: { findMany: jest.fn() },
  rbtExtratoCache: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
} }));

const valores = [22928.26, 22844.26, 22844.66, 41362.52, 22648.26, 22900.26, 22816.26, 23004.26, 23076.26, 23112.26, 23040.26, 23076.26];
const pas = pasAnteriores('2026-09');
const br = n => n.toFixed(2).replace('.', ',');
function extrato(lista = valores) {
  const linhas = numeros => pas.map((pa, i) => `${pa.slice(5)}/${pa.slice(0, 4)} ${br(numeros[i])}`).join(' ');
  return `Período de Apuração (PA): 09/2026
Receita Bruta do PA (RPA) - Competência 23.076,26 0,00 23.076,26
2.2.1) Mercado Interno ${linhas(lista)}
2.2.2) Mercado Externo ${linhas(lista.map(() => 0))}
2.3) Folha de Salários Anteriores 09/2025 999.999,00`;
}
beforeEach(() => {
  jest.resetAllMocks();
  prisma.portalInvoice.findMany.mockResolvedValue([]);
  prisma.companyMonthlyCircular.findMany.mockResolvedValue([]);
  prisma.rbtExtratoCache.findUnique.mockResolvedValue(null);
  prisma.rbtExtratoCache.create.mockImplementation(async ({ data }) => data);
  prisma.rbtExtratoCache.update.mockImplementation(async ({ data }) => data);
});
test('janela exclui competência e atravessa ano, inclusive janeiro', () => {
  expect(pas).toHaveLength(12);
  expect([pas[0], pas[11]]).toEqual(['2025-09', '2026-08']);
  expect(pasAnteriores('2026-01')).toEqual(Array.from({length:12}, (_, i) => `2025-${String(i+1).padStart(2,'0')}`));
});
test('lê colunas concatenadas pelo pdf-parse sem espaços entre datas e valores', () => {
  const text = extrato().replace(/(\d{2}\/\d{4})\s+/g, '$1').replace(/(,\d{2})\s+(?=\d)/g, '$1').replace('Competência ', 'Competência');
  const rows = receitasDoExtrato(text);
  expect(rows).toHaveLength(13);
  expect(rows.filter(m => m.pa < '2026-09').reduce((s,m)=>s+m.valorInterno+m.valorExterno,0)).toBeCloseTo(293653.78,2);
});
test('recalcula cache parcial com histórico oficial sem duplicar notas nem incluir PA atual', async () => {
  prisma.rbtExtratoCache.findUnique.mockResolvedValue({ id: 'cache', origem: 'PARCIAL_LOCAL', rbt12: 183674.08 });
  prisma.companyMonthlyCircular.findMany.mockResolvedValue([{ metadata: { parsedPgdas: { rawText: extrato() } } }]);
  prisma.portalInvoice.findMany.mockResolvedValue(pas.map((pa, i) => ({ competencia: `${pa}-01T00:00:00Z`, total: valores[i] })));
  const r = await getRbt12({ portalClientId: 'empresa', competencia: '2026-09' });
  expect(r.rbt12).toBe(293653.78);
  expect(r.origem).toBe('EXTRATO_PGDAS');
  expect(r.detalhePorMes.map(m => m.pa)).toEqual(pas);
  expect(23076.26 * (0.112 - 9360 / r.rbt12)).toBeCloseTo(1849, 2);
  expect(prisma.portalInvoice.findMany.mock.calls[0][0].where).toMatchObject({ clientId: 'empresa', competencia: {gte: new Date('2025-09-01Z'), lt: new Date('2026-09-01Z')} });
  expect(prisma.companyMonthlyCircular.findMany.mock.calls[0][0].where.portalClientId).toBe('empresa');
});
test('extrato mais recente vence por mês; restante usa notas locais', async () => {
  const texto = extrato().replace('2.2.2) Mercado Externo', 'seção ausente');
  expect(receitasDoExtrato(texto).map(m => m.pa)).toEqual(['2026-09']);
  prisma.companyMonthlyCircular.findMany.mockResolvedValue([
    {metadata: {parsedPgdas: {rawText: extrato(valores.map(() => 10))}}},
    {metadata: {parsedPgdas: {rawText: extrato()}}},
  ]);
  expect((await getRbt12({portalClientId:'empresa',competencia:'2026-09'})).rbt12).toBe(120);
});
test('sem extrato mantém janela local e segrega exportações', async () => {
  prisma.portalInvoice.findMany.mockResolvedValue([
    {competencia:'2025-09-01Z',total:100,itens:[{valor:40,flagExportacao:true},{valor:60}]},
    {competencia:'2026-08-01Z',total:50},
    {competencia:'2026-09-01Z',total:999},
    {competencia:'2025-08-01Z',total:999},
  ]);
  const r = await getRbt12({portalClientId:'empresa',competencia:'2026-09'});
  expect(r.rbt12).toBe(150);
  expect(r.detalhePorMes[0]).toEqual({pa:'2025-09',valorInterno:60,valorExterno:40});
  expect(r.origem).toBe('PARCIAL_LOCAL');
});
test('consulta de relatório não grava cache', async () => {
  await getRbt12({ portalClientId:'empresa', competencia:'2026-09', persistir:false });
  expect(prisma.rbtExtratoCache.create).not.toHaveBeenCalled();
  expect(prisma.rbtExtratoCache.update).not.toHaveBeenCalled();
});
