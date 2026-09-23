jest.mock('../../../middlewares/requireFirmCompanyAccess.js', () => ({
  requireFirmCompanyAccess: () => (req, res, next) => next(),
}));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {
  accountingEntry: { findMany: jest.fn() }, guide: { findMany: jest.fn() },
  companyMonthlyCircular: { findMany: jest.fn() },
} }));
import express from 'express';
import request from 'supertest';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { createAccountingEntriesRouter } from '../accountingEntries.js';

let guia, movimentos, provisoes;
const entry = (id, tipoLinha, valor, extra = {}) => ({ id, tipo: 'BAIXA', tipoLinha,
  portalClientId: 'empresa', sourceGuideId: 'guia', data: '2026-06-20', status: 'CONFIRMADO',
  competencia: '2026-06', lines: [{ tipo: 'D', valor }, { tipo: 'C', valor }], ...extra });
beforeEach(() => {
  provisoes = [];
  guia = { id: 'guia', competencia: '2026-06', tipo: 'INSS', valor: 1100, valorOriginal: 1100,
    paymentStatus: 'PAID', source: 'SERPRO', extracted: { comprovante: { total: 1000, principal: 1000,
      juros: 0, multa: 0, dataArrecadacao: '20/06/2026' } } };
  movimentos = [entry('baixa', 'PRINCIPAL', 1000)];
  // Emula o select: retirar extracted da query deve fazer o teste falhar.
  prisma.guide.findMany.mockImplementation(async ({ where, select }) => where.tipo === 'INSS'
    ? [Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, guia[k]]))] : []);
  prisma.accountingEntry.findMany.mockImplementation(async ({ where }) => where.tipo?.in?.includes('BAIXA') ? movimentos : where.tipo === 'PROVISAO' ? provisoes : []);
  prisma.companyMonthlyCircular.findMany.mockResolvedValue([{ competencia: '2026-06', acrescimos: { INSS: { principal: 1050, juros: 30, multa: 20 } } }]);
});
async function ler(todas = false) {
  const app = express();
  app.use('/companies/:companyId', createAccountingEntriesRouter({ log: { error: jest.fn(), warn: jest.fn(), info: jest.fn() } }));
  const r = await request(app).get('/companies/empresa/entries/circular?year=2026');
  expect(r.status).toBe(200);
  return todas ? r.body.provisoes : r.body.provisoes.find(p => p.subtipo === 'INSS');
}
it('consulta tardia → baixa original → edição → recarga mantém a baixa, mesmo com composição antiga', async () => {
  expect(await ler()).toMatchObject({ valor: 1000, totalD: 1000, statusPagamento: 'PAGO', valorObrigacao: 1050,
    pagamentoEfetivo: { total: 1000, principal: 1000, juros: 0, multa: 0 } });
  movimentos = [entry('baixa', 'PRINCIPAL', 980)];
  expect(await ler()).toMatchObject({ valor: 980, pagamentoEfetivo: { divergencia: true } });
  guia.valor = 1200;
  expect(await ler()).toMatchObject({ valor: 980, pagamentoEfetivo: { valorDocumento: 1200 } });
});
it('DARF consolidado não atribui o comprovante inteiro a cada tributo', async () => {
  const sourceGuide = { id: 'darf', tipo: 'OUTRO', valor: 550, extracted: { comprovante: { total: 500, dataArrecadacao: '20/06/2026' } } };
  provisoes = [['PIS', 100], ['COFINS', 400]].map(([subtipo, valor]) => ({
    id: subtipo, portalClientId: 'empresa', tipo: 'PROVISAO', subtipo, competencia: '2026-06',
    status: 'CONFIRMADO', statusPagamento: 'PAGO', sourceGuideId: 'darf', sourceGuide,
    lines: [{ tipo: 'D', valor }, { tipo: 'C', valor }],
    baixas: [entry(`baixa-${subtipo}`, 'PRINCIPAL', valor, { sourceGuideId: 'darf', openEntryId: subtipo })],
  }));
  const result = await ler(true);
  expect(result.find(p => p.id === 'PIS').pagamentoEfetivo.total).toBe(100);
  expect(result.find(p => p.id === 'COFINS').pagamentoEfetivo.total).toBe(400);
  provisoes.forEach(p => { p.baixas = []; });
  expect((await ler(true)).filter(p => ['PIS', 'COFINS'].includes(p.id)).every(p => p.pagamentoEfetivo === null)).toBe(true);
});
it('comprovante chega à tela e não torna pagamento localizado uma baixa lançada', async () => {
  movimentos = [];
  expect(await ler()).toMatchObject({ statusPagamento: 'ABERTO', pagamentoLocalizado: true,
    comprovante: { total: 1000 }, pagamentoEfetivo: { fonte: 'COMPROVANTE', total: 1000 } });
});
it('encargos legítimos integram total uma vez e estorno não mantém baixa ativa', async () => {
  movimentos.push(entry('juros', 'JUROS', 30), entry('multa', 'MULTA', 20));
  expect(await ler()).toMatchObject({ valor: 1050, pagamentoEfetivo: { principal: 1000, juros: 30, multa: 20 } });
  movimentos.push(...movimentos.map(b => ({ ...b, id: `est-${b.id}`, tipo: 'ESTORNO', estornoDeEntryId: b.id })));
  expect(await ler()).toMatchObject({ statusPagamento: 'ABERTO', baixas: [], baixaEntry: null, pagamentoLocalizado: true });
});
