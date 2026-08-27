// A LIGAÇÃO do cálculo do Lucro Presumido — a REGRA é medida em
// `lib/__tests__/apuracaoPresumido.test.js` (39) e NÃO é remedida aqui. O que este arquivo prende é
// o que só o serviço pode errar: de onde sai a receita, **qual guia** ele lê, quantas vezes ele vai
// ao banco, e o que ele NÃO faz.

const chamadas = { portalInvoice: [], guide: [] };

const proibido = (nome) => jest.fn(async () => { throw new Error(`ESCRITA PROIBIDA no cálculo do LP: ${nome}`); });

jest.mock("../../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalInvoice: {
      findMany: jest.fn(async (args) => {
        chamadas.portalInvoice.push(args);
        return global.__NOTAS__ ?? [];
      }),
      create: proibido("portalInvoice.create"),
      update: proibido("portalInvoice.update"),
      upsert: proibido("portalInvoice.upsert"),
    },
    guide: {
      findFirst: jest.fn(async (args) => {
        chamadas.guide.push(args);
        return global.__GUIA__ ?? null;
      }),
      create: proibido("guide.create"),
      update: proibido("guide.update"),
      upsert: proibido("guide.upsert"),
    },
  },
}));

const { calcularLp } = require("../LucroPresumidoCalculoService.js");

beforeEach(() => {
  chamadas.portalInvoice = [];
  chamadas.guide = [];
  global.__NOTAS__ = [];
  global.__GUIA__ = null;
});

describe("de onde sai a receita", () => {
  it("NFS-e vira SERVIÇO e NF-e vira MERCADORIA", async () => {
    global.__NOTAS__ = [
      { type: "NFSE", total: 1000 },
      { type: "nfse", total: 500 },
      { type: "NFE", total: 200 },
    ];
    const r = await calcularLp({ portalClientId: "pc1", competencia: "2026-05" });
    expect(r.receita).toEqual({ servicos: 1500, mercadorias: 200, total: 1700 });
  });

  it("⚠ só EMIT autorizada da competência — a mesma população do faturamento", async () => {
    await calcularLp({ portalClientId: "pc1", competencia: "2026-05" });
    expect(chamadas.portalInvoice[0].where).toMatchObject({
      clientId: "pc1",
      papel: "EMIT",
      statusEfetivo: "autorizada",
    });
    expect(chamadas.portalInvoice[0].where.competencia).toHaveProperty("gte");
    expect(chamadas.portalInvoice[0].where.competencia).toHaveProperty("lt");
  });

  it("competência fora do formato YYYY-MM é recusada", async () => {
    await expect(calcularLp({ portalClientId: "pc1", competencia: "2026" })).rejects.toThrow(/YYYY-MM/);
    await expect(calcularLp({ portalClientId: "pc1" })).rejects.toThrow(/YYYY-MM/);
  });
});

describe("⚠ quantas vezes ele vai ao banco", () => {
  it("mês que NÃO fecha trimestre: UMA consulta de notas", async () => {
    await calcularLp({ portalClientId: "pc1", competencia: "2026-05" });
    expect(chamadas.portalInvoice).toHaveLength(1);
  });

  it("mês que FECHA: uma do mês + as três do trimestre", async () => {
    // Buscar as três num mês que não fecha seriam três consultas para um resultado descartado.
    await calcularLp({ portalClientId: "pc1", competencia: "2026-06" });
    expect(chamadas.portalInvoice).toHaveLength(4);
  });
});

describe("⚠⚠ QUAL GUIA ELE LÊ — o recorte é o `sourceFileId`, nunca o tipo", () => {
  it("filtra pelo prefixo da DARF do LP e pela competência no sufixo", async () => {
    // A DARF do LP e a guia de INSS/DCTFWeb são AS DUAS `tipo: "OUTRA"` com `source: "SERPRO"`.
    // Filtrar por tipo traria a guia errada, e a composição dela alimentaria o aviso de quota com
    // um débito que não é de IRPJ/CSLL do Presumido.
    await calcularLp({ portalClientId: "pc1", competencia: "2026-05" });
    const w = chamadas.guide[0].where;
    expect(w).toMatchObject({ portalClientId: "pc1", competencia: "2026-05" });
    expect(w.sourceFileId).toEqual({ startsWith: "serpro:dctfweb:lp:", endsWith: ":2026-05" });
    expect(w).not.toHaveProperty("tipo");
  });

  it("sem guia, a apuração sai inteira e o aviso de quota é `null`", async () => {
    const r = await calcularLp({ portalClientId: "pc1", competencia: "2026-05" });
    expect(r.guia).toBeNull();
    expect(r.quotaDeTrimestreAnterior).toBeNull();
    expect(r.pis).toBe(0);
  });

  it("⚠ `extracted` torto não derruba nada — vira composição vazia", async () => {
    for (const extracted of [null, "texto", 42, {}, { composicao: "x" }]) {
      global.__GUIA__ = { id: "g1", extracted, valor: null, vencimento: null, paymentStatus: "OPEN" };
      const r = await calcularLp({ portalClientId: "pc1", competencia: "2026-05" });
      expect(r.quotaDeTrimestreAnterior).toBeNull();
      expect(r.guia.id).toBe("g1");
    }
  });

  it("⚠ o `valor` Decimal vira número — cru ele viraria objeto no JSON da rota", async () => {
    global.__GUIA__ = { id: "g1", extracted: {}, valor: "1234.567", vencimento: null, paymentStatus: "OPEN" };
    const r = await calcularLp({ portalClientId: "pc1", competencia: "2026-05" });
    expect(r.guia.valor).toBe(1234.57);
  });
});

describe("⚠⚠ A QUOTA CHEGA À RESPOSTA — a composição da DARF alimenta o aviso", () => {
  beforeEach(() => {
    global.__GUIA__ = {
      id: "g1",
      valor: "8880",
      vencimento: null,
      paymentStatus: "OPEN",
      extracted: {
        composicao: [
          { codigo: "8109", tributo: "PIS", total: 650 },
          { codigo: "2172", tributo: "IRPJ", total: 6000 },
          { codigo: "2372", tributo: "CSLL", total: 2880 },
        ],
      },
    };
  });

  it("num mês que não fecha trimestre, o aviso aparece com IRPJ + CSLL", async () => {
    const r = await calcularLp({ portalClientId: "pc1", competencia: "2026-05" });
    expect(r.irpj).toBeNull();
    expect(r.quotaDeTrimestreAnterior.total).toBe(8880);
  });

  it("no mês que fecha, o aviso não existe — lá o cálculo apura os dois", async () => {
    const r = await calcularLp({ portalClientId: "pc1", competencia: "2026-06" });
    expect(r.quotaDeTrimestreAnterior).toBeNull();
    expect(r.irpj).not.toBeNull();
  });
});

describe("⚠ a confirmação dos R$ 120.000 ATRAVESSA o serviço", () => {
  beforeEach(() => { global.__NOTAS__ = [{ type: "NFSE", total: 30_000 }]; });

  it("sem o parâmetro, o comportamento é o de sempre — 32%", async () => {
    const r = await calcularLp({ portalClientId: "pc1", competencia: "2026-06" });
    expect(r.irpj.base).toBe(28_800); // 90.000 × 32%
    expect(r.servicos16.estado).toBe("nao_perguntado");
  });

  it("⚠⚠ com `true`, os 16% chegam ao IRPJ — e a CSLL fica onde estava", async () => {
    // Sem este teste, o parâmetro seria um ramo inalcançável: nada no serviço o exercitaria.
    const r = await calcularLp({ portalClientId: "pc1", competencia: "2026-06", servicos16: true });
    expect(r.irpj.base).toBe(14_400); // 90.000 × 16%
    expect(r.csll.base).toBe(28_800); // 90.000 × 32%, intacta
  });
});

describe("⚠ O CÁLCULO NÃO ESCREVE NADA", () => {
  it("nenhuma escrita acontece em nenhum dos dois caminhos", async () => {
    // Os dublês LANÇAM em create/update/upsert; chegar ao fim prova que nenhum foi chamado.
    global.__NOTAS__ = [{ type: "NFSE", total: 1000 }];
    await expect(calcularLp({ portalClientId: "pc1", competencia: "2026-05" })).resolves.toBeTruthy();
    await expect(calcularLp({ portalClientId: "pc1", competencia: "2026-06" })).resolves.toBeTruthy();
  });
});
