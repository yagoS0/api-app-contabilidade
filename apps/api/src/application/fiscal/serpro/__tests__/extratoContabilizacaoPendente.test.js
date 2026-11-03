// Cache documental e gerador REAL; apenas persistência e integrações são sintéticas.
jest.mock("../../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../SerproHttpClient.js", () => ({ SerproHttpClient: jest.fn(() => { throw new Error("rede_proibida"); }) }));
jest.mock("../CaptureSerproGuidesService.js", () => ({ capturePgdasGuideForCompany: jest.fn(() => { throw new Error("rede_proibida"); }) }));
import { prisma } from "../../../../infrastructure/db/prisma.js";
import { syncPgdasByCompetencia } from "../SerproPgdasDeclaracaoService.js";
import { SerproHttpClient } from "../SerproHttpClient.js";

function fixture(extra = {}, semContas = false) {
  const circular = { id: "circ", portalClientId: "c", competencia: "2026-09", serproSyncStatus: "SUCCESS", pgdasNumeroDeclaracao: "123", pgdasDeclaracaoFileId: "pdf", pgdasReciboFileId: "rec", receitaBruta: 100, receitaServicos: 100, dasTotal: 10, ...extra };
  const entries = [];
  Object.assign(prisma, {
    portalClient: { findUnique: jest.fn(async () => ({ id: "c", cnpj: "11222333000181" })) },
    guide: { findFirst: jest.fn(async () => null) },
    companyMonthlyCircular: { findUnique: jest.fn(async () => ({ ...circular })), update: jest.fn(async ({ data }) => Object.assign(circular, data)) },
    accountingEntryRule: { findFirst: jest.fn(async () => semContas ? null : ({ id: "regra", debitAccountCode: "D", creditAccountCode: "C", descriptionTemplate: "Teste {{competencia}}", entryDateStrategy: "LAST_DAY_OF_MONTH" })) },
    accountingHistorico: { findMany: jest.fn(async () => []) },
    accountingEntry: {
      findFirst: jest.fn(async ({ where }) => entries.find(e => e.eventType === where.eventType) || null),
      create: jest.fn(async ({ data }) => { const e = { ...data, id: `e${entries.length}`, lines: data.lines.createMany.data }; entries.push(e); return e; }),
      update: jest.fn(async ({ where, data }) => { const e = entries.find(e => e.id === where.id); Object.assign(e, data); const { lines, ...returned } = e; return returned; }),
    },
    accountingEntryLine: {
      deleteMany: jest.fn(async ({ where }) => { entries.find(e => e.id === where.entryId).lines = []; }),
      createMany: jest.fn(async ({ data }) => { for (const line of data) entries.find(e => e.id === line.entryId).lines.push(line); return { count: data.length }; }),
    },
  });
  prisma.$transaction = jest.fn(async fn => fn(prisma));
  return { circular, entries, sync: (options = {}) => syncPgdasByCompetencia({ portalClientId: "c", competencia: "2026-09", ...options }) };
}
beforeEach(() => jest.clearAllMocks());
test.each([{ receitaBruta: null }, { dasTotal: null }, { receitaBruta: undefined }, { receitaBruta: "" }])("PDF não supre valores ausentes %j", async patch => {
  const t = fixture(patch); const out = await t.sync();
  expect(out.accounting).toMatchObject({ ok: false, reason: "extrato_incompleto" });
  expect(t.entries).toHaveLength(0); expect(t.circular.hasAccountingDivergence).toBe(true);
  expect(SerproHttpClient).not.toHaveBeenCalled();
});
test("zero explícito é completo, distinto de ausente", async () => {
  const t = fixture({ receitaBruta: 0, receitaServicos: 0, dasTotal: 0 });
  expect((await t.sync()).accounting).toMatchObject({ ok: true, generatedEntries: [], divergences: [] });
  expect(t.circular.hasAccountingDivergence).toBe(false);
});
test("cache somenteDocumentos depois normal e repetição usam gerador sem rede", async () => {
  const t = fixture();
  await t.sync({ somenteDocumentos: true }); expect(t.entries).toHaveLength(0);
  const first = await t.sync(); expect(first.accounting.generatedEntries).toHaveLength(2);
  expect(t.entries).toHaveLength(2);
  const second = await t.sync(); expect(second.accounting.generatedEntries.every(e => e.action === "noop")).toBe(true);
  expect(t.entries).toHaveLength(2); expect(SerproHttpClient).not.toHaveBeenCalled();
});
test("mês fechado mantém cache documental e recusa geração", async () => {
  const t = fixture({ fechadoContabilEm: new Date() });
  expect((await t.sync()).accounting).toMatchObject({ ok: false, reason: "mes_fechado" });
  expect(t.entries).toHaveLength(0);
  expect((await t.sync({ somenteDocumentos: true })).accounting.somenteDocumentos).toBe(true);
});
test("atualização recria partidas sem contas e conserva divergência", async () => {
  const t = fixture({}, true);
  await t.sync();
  t.circular.receitaBruta = 200; t.circular.receitaServicos = 200;
  const out = await t.sync();
  expect(out.accounting.generatedEntries).toContainEqual(expect.objectContaining({ eventType: "RECEITA_SERVICO", action: "updated" }));
  expect(out.accounting.divergences).toContainEqual(expect.objectContaining({ eventType: "RECEITA_SERVICO", message: expect.stringMatching(/contas pendentes/) }));
  expect(t.entries.find(e => e.eventType === "RECEITA_SERVICO").lines.every(l => l.conta === "")).toBe(true);
  expect(t.circular.hasAccountingDivergence).toBe(true);
});
test("falha de persistência nunca retorna contabilização bem sucedida", async () => {
  const t = fixture(); prisma.accountingEntry.create.mockRejectedValueOnce(new Error("banco indisponível"));
  await expect(t.sync()).rejects.toThrow("banco indisponível");
  expect(SerproHttpClient).not.toHaveBeenCalled();
});

test.each([
  { receitaServicos: 0 },
  { receitaServicos: null },
  { receitaServicos: 40 },
  { receitaServicos: 120 },
  { receitaServicos: -100, receitaVendasSemST: 200 },
  { receitaServicos: "ilegível" },
  { receitaServicos: 40, metadata: { parsedPgdas: { receitaOutros: 60, atividades: [{ categoria: "outro", receita: 60 }] } } },
  { metadata: { parsedPgdas: { receitaOutros: 10 } } },
])("segregação incompleta não fabrica receita e mantém DAS válido: %j", async patch => {
  const t = fixture(patch);
  const out = await t.sync();
  expect(out.accounting.divergences).toContainEqual(expect.objectContaining({ reason: "receita_segregacao_incompleta" }));
  expect(t.circular.hasAccountingDivergence).toBe(true);
  expect(t.circular.accountingDivergenceMessage).toMatch(/segregação/);
  expect(t.entries.map(e => e.eventType)).toEqual(["DAS_SIMPLES"]);
  expect(t.entries[0].lines.map(l => Number(l.valor))).toEqual([10, 10]);
  await t.sync();
  expect(t.entries).toHaveLength(1);
  expect(SerproHttpClient).not.toHaveBeenCalled();
});

test.each(["RASCUNHO", "EXPORTADO"])("extração parcial preserva receita %s já existente", async status => {
  const t = fixture();
  await t.sync();
  const receita = t.entries.find(e => e.eventType === "RECEITA_SERVICO");
  receita.status = status;
  const antes = JSON.stringify(receita);
  t.circular.receitaServicos = 40;
  const out = await t.sync();
  expect(JSON.stringify(receita)).toBe(antes);
  expect(t.entries).toHaveLength(2);
  expect(out.accounting.generatedEntries.every(e => e.eventType === "DAS_SIMPLES")).toBe(true);
  expect(out.accounting.divergences).toContainEqual(expect.objectContaining({ reason: "receita_segregacao_incompleta" }));
});

test("correção da segregação permite retomar sem duplicar DAS e resolve pendência", async () => {
  const t = fixture({ receitaServicos: 0 });
  await t.sync();
  t.circular.receitaServicos = 60;
  t.circular.receitaVendasSemST = 30;
  t.circular.receitaVendasComST = 10;
  const out = await t.sync();
  expect(out.accounting.divergences).toEqual([]);
  expect(t.circular.hasAccountingDivergence).toBe(false);
  expect(t.circular.accountingDivergenceMessage).toBeNull();
  expect(t.entries).toHaveLength(4);
  expect(t.entries.filter(e => e.eventType === "DAS_SIMPLES")).toHaveLength(1);
});

test("segregação incompleta em mês fechado não altera partidas nem divergência persistida", async () => {
  const t = fixture();
  await t.sync();
  t.circular.receitaServicos = 0;
  t.circular.fechadoContabilEm = new Date();
  const antes = JSON.stringify({ circular: t.circular, entries: t.entries });
  prisma.companyMonthlyCircular.update.mockClear();
  expect((await t.sync()).accounting.reason).toBe("mes_fechado");
  expect(JSON.stringify({ circular: t.circular, entries: t.entries })).toBe(antes);
  expect(prisma.companyMonthlyCircular.update).not.toHaveBeenCalled();
});

test("zero bruto não aceita receita segregada positiva como mês zerado", async () => {
  const t = fixture({ receitaBruta: 0, receitaServicos: 100, dasTotal: 0 });
  const out = await t.sync();
  expect(out.accounting.divergences).toContainEqual(expect.objectContaining({ reason: "receita_segregacao_incompleta" }));
  expect(t.entries).toHaveLength(0);
});

test.each([0.01, 0.02])("tolerância não transforma receita de %s em ausência ou zero", async valor => {
  for (const patch of [{ receitaBruta: valor, receitaServicos: 0 }, { receitaBruta: 0, receitaServicos: valor }]) {
    const t = fixture({ ...patch, dasTotal: 0 });
    const out = await t.sync();
    expect(out.accounting.divergences).toContainEqual(expect.objectContaining({ reason: "receita_segregacao_incompleta" }));
    expect(t.circular.hasAccountingDivergence).toBe(true);
    expect(t.entries).toHaveLength(0);
  }
});

test.each([99.98, 100.02])("preserva tolerância de arredondamento entre total e segregação positivos: %s", async valor => {
  const t = fixture({ receitaServicos: valor });
  const out = await t.sync();
  expect(out.accounting.divergences).toEqual([]);
  expect(t.entries.map(e => e.eventType)).toEqual(["RECEITA_SERVICO", "DAS_SIMPLES"]);
});
