// AS DUAS LEITURAS DE "ESTE MÊS ESTÁ FECHADO?".
//
// ⚠⚠ `isMonthClosed` (uma competência) e `competenciasFechadas` (várias) leem a MESMA coluna,
// `CompanyMonthlyCircular.fechadoContabilEm`. Duas leituras da mesma pergunta é exatamente como as
// quatro cópias do filtro de envio de guia divergiram nesta base — por isso as duas moram no mesmo
// arquivo e por isso este teste exige que **concordem**.
//
// A segunda existe porque o pré-voo da fila de conferência precisa da resposta para uma PÁGINA
// inteira: 50 chamadas a `isMonthClosed` por abertura de tela.

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { companyMonthlyCircular: { findUnique: jest.fn(), findMany: jest.fn() } },
}));

import { prisma } from "../../../infrastructure/db/prisma.js";
import { competenciasFechadas, isMonthClosed } from "../fechamentoContabil.js";

const FECHADA = new Date("2026-08-01T12:00:00.000Z");

beforeEach(() => jest.clearAllMocks());

describe("isMonthClosed", () => {
  it("fechada quando `fechadoContabilEm` existe", async () => {
    prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ fechadoContabilEm: FECHADA });
    expect(await isMonthClosed("emp-1", "2026-07")).toBe(true);
  });

  it("aberta quando é nula", async () => {
    prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ fechadoContabilEm: null });
    expect(await isMonthClosed("emp-1", "2026-07")).toBe(false);
  });

  it("⚠ sem circular não é fechada — sem linha não há fechamento", async () => {
    prisma.companyMonthlyCircular.findUnique.mockResolvedValue(null);
    expect(await isMonthClosed("emp-1", "2026-07")).toBe(false);
  });

  it("argumento ausente responde ABERTA sem consultar o banco", async () => {
    expect(await isMonthClosed(null, "2026-07")).toBe(false);
    expect(await isMonthClosed("emp-1", null)).toBe(false);
    expect(prisma.companyMonthlyCircular.findUnique).not.toHaveBeenCalled();
  });
});

describe("competenciasFechadas", () => {
  const client = (linhas) => ({ companyMonthlyCircular: { findMany: jest.fn(async () => linhas) } });

  it("devolve SÓ as fechadas", async () => {
    const c = client([
      { competencia: "2026-06", fechadoContabilEm: FECHADA },
      { competencia: "2026-07", fechadoContabilEm: null },
    ]);
    const r = await competenciasFechadas("emp-1", ["2026-06", "2026-07"], c);
    expect([...r]).toEqual(["2026-06"]);
  });

  it("⚠ UMA query, com as competências DEDUPLICADAS", async () => {
    // A página tem 50 linhas e tipicamente 1 ou 2 competências. Mandar 50 valores no `IN` seria
    // desperdício, e mandar 50 queries seria o defeito que esta função existe para evitar.
    const c = client([]);
    await competenciasFechadas("emp-1", ["2026-07", "2026-07", "2026-06", "2026-07"], c);
    expect(c.companyMonthlyCircular.findMany).toHaveBeenCalledTimes(1);
    expect(c.companyMonthlyCircular.findMany.mock.calls[0][0].where.competencia.in.sort())
      .toEqual(["2026-06", "2026-07"]);
  });

  it("⚠ sempre escopa por empresa", async () => {
    const c = client([]);
    await competenciasFechadas("emp-1", ["2026-07"], c);
    expect(c.companyMonthlyCircular.findMany.mock.calls[0][0].where.portalClientId).toBe("emp-1");
  });

  it("⚠ nulos na lista são descartados — competência ausente não é competência", async () => {
    const c = client([]);
    await competenciasFechadas("emp-1", [null, "2026-07", undefined, ""], c);
    expect(c.companyMonthlyCircular.findMany.mock.calls[0][0].where.competencia.in).toEqual(["2026-07"]);
  });

  it("lista vazia (ou só de nulos) não consulta o banco", async () => {
    const c = client([]);
    expect([...(await competenciasFechadas("emp-1", [], c))]).toEqual([]);
    expect([...(await competenciasFechadas("emp-1", [null, null], c))]).toEqual([]);
    expect([...(await competenciasFechadas(null, ["2026-07"], c))]).toEqual([]);
    expect(c.companyMonthlyCircular.findMany).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ AS DUAS CONCORDAM — é isto que impede a divergência silenciosa", () => {
  const CASOS = [
    ["fechada", FECHADA, true],
    ["aberta", null, false],
  ];

  it.each(CASOS)("competência %s: as duas respondem o mesmo", async (_rotulo, valor, esperado) => {
    prisma.companyMonthlyCircular.findUnique.mockResolvedValue({ fechadoContabilEm: valor });
    const uma = await isMonthClosed("emp-1", "2026-07");

    const c = { companyMonthlyCircular: { findMany: jest.fn(async () => [{ competencia: "2026-07", fechadoContabilEm: valor }]) } };
    const varias = (await competenciasFechadas("emp-1", ["2026-07"], c)).has("2026-07");

    expect(uma).toBe(esperado);
    expect(varias).toBe(esperado);
  });

  it("⚠ e concordam também na AUSÊNCIA de circular", async () => {
    prisma.companyMonthlyCircular.findUnique.mockResolvedValue(null);
    const c = { companyMonthlyCircular: { findMany: jest.fn(async () => []) } };
    expect(await isMonthClosed("emp-1", "2026-07")).toBe(false);
    expect((await competenciasFechadas("emp-1", ["2026-07"], c)).has("2026-07")).toBe(false);
  });

  it("⚠ as duas leem a MESMA coluna — varredura da fonte", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "fechamentoContabil.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Duas ocorrências de `fechadoContabilEm` no `select` e duas na leitura do resultado.
    expect((fonte.match(/fechadoContabilEm/g) || []).length).toBeGreaterThanOrEqual(3);
    // ⚠ E nenhuma outra coluna decide fechamento aqui.
    expect(fonte).not.toMatch(/fechadoEm|estado:\s*["']fechada/);
  });
});
