// FOLHA AUSENTE NÃO É ZERO — e os demais campos também não têm default plausível.
//
// O cenário que estes testes existem para impedir é um só, e ele termina num PDF entregue ao
// cliente: a empresa não tem folha conhecida, o sistema lê `0`, o Fator R (`fs12/rbt12`) sai `0`,
// o anexo vira V (alíquota maior) e a tela recomenda OUTRO regime. Nada nesse caminho dá erro.
//
// O zero não é hipotético: `CalculoFiscal.calcularApuracaoParaCompetencia` grava
// `fs12Manual: fs12` com `fs12 = ... : 0` quando ninguém digitou folha — ou seja, há zeros
// FABRICADOS gravados no banco, indistinguíveis de um zero informado. Por isso `0` em base
// monetária é tratado como NÃO APURADO.

const prismaModel = () => ({
  findUnique: jest.fn(async () => null),
  findFirst: jest.fn(async () => null),
  findMany: jest.fn(async () => []),
  aggregate: jest.fn(async () => ({ _sum: { total: null }, _count: { _all: 0 } })),
  count: jest.fn(async () => 0),
  create: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA no planejamento"); }),
  update: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA no planejamento"); }),
  upsert: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA no planejamento"); }),
  deleteMany: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA no planejamento"); }),
});

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalClient: prismaModel(),
    company: prismaModel(),
    cadastroFiscal: prismaModel(),
    apuracaoSnapshot: prismaModel(),
    companyMonthlyCircular: prismaModel(),
    rbtExtratoCache: prismaModel(),
    portalInvoice: prismaModel(),
    accountingEntry: prismaModel(),
  },
}));

// A cláusula de faturamento vem do FechamentoService de propósito (uma definição só). No teste ela
// é isolada para não arrastar o grafo do SERPRO — o que se afirma aqui é a montagem dos campos.
jest.mock("../../notas/apuracao/v2/FechamentoService.js", () => ({
  whereFaturamentoEmit: () => ({ papel: "EMIT", statusEfetivo: "autorizada" }),
}));

const mockDerivarFolha = jest.fn(async () => ({
  total: 0, competencias: [], mesesComLancamento: 0, porMes: [], disponivel: false,
}));
jest.mock("../../notas/apuracao/v2/FolhaDerivadaService.js", () => {
  const actual = jest.requireActual("../../notas/apuracao/v2/FolhaDerivadaService.js");
  return { competenciasDe12Meses: actual.competenciasDe12Meses, derivarFolha12m: (...a) => mockDerivarFolha(...a) };
});

const { prisma } = require("../../../infrastructure/db/prisma.js");
const {
  montarDadosPlanejamento, regimeDoTexto, anexoNormalizado, competenciaDeHoje,
} = require("../DadosPlanejamentoService.js");

const AGORA = new Date(Date.UTC(2026, 6, 15)); // 2026-07 → janela 2025-07 .. 2026-06

function comBase({ company = null, cadastro = null, snapshot = null, circular = null, cache = null, notas = null } = {}) {
  prisma.portalClient.findUnique.mockResolvedValue({
    id: "emp-1", razao: "LENTE COMERCIO LTDA", cnpj: "11111111000191", companyId: "comp-1",
  });
  prisma.company.findUnique.mockResolvedValue(company);
  prisma.cadastroFiscal.findUnique.mockResolvedValue(cadastro);
  prisma.apuracaoSnapshot.findFirst.mockResolvedValue(snapshot);
  prisma.companyMonthlyCircular.findFirst.mockResolvedValue(circular);
  prisma.rbtExtratoCache.findFirst.mockResolvedValue(cache);
  prisma.portalInvoice.aggregate.mockResolvedValue(
    notas || { _sum: { total: null }, _count: { _all: 0 } },
  );
}

const rodar = () => montarDadosPlanejamento({ portalClientId: "emp-1", agora: AGORA });

beforeEach(() => {
  jest.clearAllMocks();
  mockDerivarFolha.mockResolvedValue({
    total: 0, competencias: [], mesesComLancamento: 0, porMes: [], disponivel: false,
  });
});

describe("a folha de 12 meses", () => {
  test("SEM NENHUMA FONTE sai AUSENTE — nunca zero", async () => {
    comBase();
    const { campos } = await rodar();
    expect(campos.folhaAnual.apurado).toBe(false);
    expect(campos.folhaAnual.valor).toBeNull();
    expect(campos.folhaAnual.valor).not.toBe(0);
    // A recusa carrega o motivo, e o motivo nomeia a consequência.
    expect(campos.folhaAnual.motivoAusencia).toMatch(/Fator R/i);
    expect(campos.folhaAnual.motivoAusencia).toMatch(/Anexo V/i);
  });

  test("o ZERO FABRICADO do caminho legado (fs12Manual = 0) NÃO vira folha zero", async () => {
    comBase({ circular: { competencia: "2026-06", rb12: 900000, fs12Manual: 0, fs12Origem: "MANUAL" } });
    const { campos } = await rodar();
    expect(campos.folhaAnual.apurado).toBe(false);
    expect(campos.folhaAnual.valor).toBeNull();
    // ⚠ E o RBT12 da MESMA linha continua sendo aproveitado: descartar a folha não descarta a receita.
    expect(campos.rbt12.apurado).toBe(true);
    expect(campos.rbt12.valor).toBe(900000);
  });

  test("a folha derivada dos LANÇAMENTOS só entra quando ela própria se declara disponível", async () => {
    // `derivarFolha12m` devolve `total: 0, disponivel: false` no vazio — ler o total sem olhar a
    // flag reintroduziria o zero por outra porta.
    mockDerivarFolha.mockResolvedValue({ total: 0, mesesComLancamento: 0, disponivel: false });
    comBase();
    expect((await rodar()).campos.folhaAnual.apurado).toBe(false);

    mockDerivarFolha.mockResolvedValue({ total: 240000, mesesComLancamento: 11, disponivel: true });
    comBase();
    const campo = (await rodar()).campos.folhaAnual;
    expect(campo).toMatchObject({ apurado: true, valor: 240000 });
    expect(campo.origem).toMatch(/lançamentos de folha\/pró-labore/i);
    expect(campo.origem).toMatch(/11 de 12 meses/);
  });

  test("a folha do FECHAMENTO tem precedência sobre a circular e sobre os lançamentos", async () => {
    mockDerivarFolha.mockResolvedValue({ total: 111, mesesComLancamento: 12, disponivel: true });
    comBase({
      snapshot: { competencia: "2026-05", rbt12: 800000, folha12m: 300000, estado: "transmitida" },
      circular: { competencia: "2026-06", rb12: 900000, fs12Manual: 222, fs12Origem: "MANUAL" },
    });
    const campo = (await rodar()).campos.folhaAnual;
    expect(campo.valor).toBe(300000);
    expect(campo.origem).toMatch(/fechamento de 05\/2026/);
  });
});

describe("o Fator R que o campo ausente evita", () => {
  test("folha ausente + RBT12 conhecido NÃO produz Fator R zero — não há Fator R nenhum", async () => {
    comBase({ cache: { competencia: "2026-06", rbt12: 600000, origem: "PARCIAL_LOCAL" } });
    const { campos } = await rodar();
    // O serviço não calcula Fator R (quem calcula é o motor da tela). O que ele garante é a
    // ENTRADA: com `folhaAnual.valor === null`, `folha/rbt` não tem numerador — e `0/600000 = 0`,
    // que decidiria "Anexo V", nunca chega a ser computável.
    expect(campos.folhaAnual.valor).toBeNull();
    expect(campos.rbt12.valor).toBe(600000);
  });
});

describe("regime atual", () => {
  test("texto vazio NÃO vira SIMPLES_NACIONAL por default", async () => {
    comBase({ company: { regimeTributario: "", simplesAnexo: null, anexoSimples: null } });
    const { campos } = await rodar();
    expect(campos.regimeAtual.apurado).toBe(false);
    expect(campos.regimeAtual.valor).toBeNull();
  });

  test("o cadastro fiscal manda; o cadastro da empresa é a segunda fonte", async () => {
    comBase({ cadastro: { regime: "LUCRO_PRESUMIDO" }, company: { regimeTributario: "Simples Nacional" } });
    expect((await rodar()).campos.regimeAtual).toMatchObject({ valor: "LUCRO_PRESUMIDO", apurado: true });

    comBase({ company: { regimeTributario: "Lucro Presumido" } });
    const campo = (await rodar()).campos.regimeAtual;
    expect(campo.valor).toBe("LUCRO_PRESUMIDO");
    expect(campo.origem).toMatch(/cadastro da empresa/i);
  });

  test("regimeDoTexto devolve null para o que não reconhece", () => {
    expect(regimeDoTexto("")).toBeNull();
    expect(regimeDoTexto(null)).toBeNull();
    expect(regimeDoTexto("ME")).toBeNull();
    expect(regimeDoTexto("Lucro Real")).toBe("LUCRO_REAL");
    expect(regimeDoTexto("MEI")).toBe("MEI");
  });
});

describe("anexo do Simples", () => {
  test("atividade sujeita ao Fator R devolve AUSENTE, porque o anexo sai da folha", async () => {
    comBase({ cadastro: { usaFatorR: true }, company: { simplesAnexo: "III" } });
    const { campos } = await rodar();
    expect(campos.anexo.apurado).toBe(false);
    expect(campos.anexo.motivoAusencia).toMatch(/Fator R/);
    expect(campos.sujeitoFatorR).toMatchObject({ valor: true, apurado: true });
  });

  test("sem cadastro fiscal, \"sujeito ao Fator R\" é AUSENTE — não `false`", async () => {
    comBase();
    expect((await rodar()).campos.sujeitoFatorR).toMatchObject({ apurado: false, valor: null });
  });

  test("anexoNormalizado aceita as escritas do cadastro e recusa o resto", () => {
    expect(anexoNormalizado("Anexo III")).toBe("III");
    expect(anexoNormalizado("iii")).toBe("III");
    expect(anexoNormalizado("3")).toBe("III");
    expect(anexoNormalizado("IV")).toBe("IV");
    expect(anexoNormalizado("VI")).toBeNull();
    expect(anexoNormalizado("")).toBeNull();
  });
});

describe("alíquota de ISS", () => {
  test("o perfil guarda PERCENTUAL e a tela recebe FRAÇÃO", async () => {
    comBase({
      cadastro: {
        perfilAtividades: [
          { cnae: "6201501", ativo: true, padrao: false, aliquotaIss: null },
          { cnae: "6202300", ativo: true, padrao: true, aliquotaIss: 5 },
        ],
      },
    });
    const campo = (await rodar()).campos.aliquotaIss;
    expect(campo.valor).toBe(0.05);
    expect(campo.origem).toMatch(/6202300/);
  });

  test("sem alíquota no perfil, ausente", async () => {
    comBase({ cadastro: { perfilAtividades: [{ cnae: "6201501", ativo: true }] } });
    expect((await rodar()).campos.aliquotaIss.apurado).toBe(false);
  });
});

describe("receita anual", () => {
  test("nenhuma nota no período é AUSENTE, não R$ 0,00", async () => {
    comBase({ notas: { _sum: { total: null }, _count: { _all: 0 } } });
    const campo = (await rodar()).campos.receitaAnual;
    expect(campo.apurado).toBe(false);
    expect(campo.valor).toBeNull();
    expect(campo.motivoAusencia).toMatch(/nenhuma nota/i);
  });

  test("com notas, o valor sai com a janela e a contagem na origem", async () => {
    comBase({ notas: { _sum: { total: 1234567.89 }, _count: { _all: 42 } } });
    const campo = (await rodar()).campos.receitaAnual;
    expect(campo.valor).toBe(1234567.89);
    expect(campo.origem).toMatch(/07\/2025 a 06\/2026/);
    expect(campo.origem).toMatch(/42 notas/);
  });
});

describe("atividade do Lucro Presumido", () => {
  test("nunca é derivada do CNAE — sai ausente com o motivo", async () => {
    comBase({ cadastro: { cnaePrincipal: "4711302", perfilAtividades: [] } });
    const campo = (await rodar()).campos.atividadePresumido;
    expect(campo.apurado).toBe(false);
    expect(campo.motivoAusencia).toMatch(/de-para CNAE/i);
  });
});

describe("o planejamento não escreve", () => {
  test("nenhum create/update/upsert em nenhum model", async () => {
    comBase({
      snapshot: { competencia: "2026-06", rbt12: 500000, folha12m: 150000, estado: "fechada" },
      notas: { _sum: { total: 500000 }, _count: { _all: 10 } },
    });
    await rodar();
    for (const model of Object.values(prisma)) {
      expect(model.create).not.toHaveBeenCalled();
      expect(model.update).not.toHaveBeenCalled();
      expect(model.upsert).not.toHaveBeenCalled();
      expect(model.deleteMany).not.toHaveBeenCalled();
    }
  });

  test("empresa inexistente devolve null (e não inventa empresa)", async () => {
    prisma.portalClient.findUnique.mockResolvedValue(null);
    expect(await rodar()).toBeNull();
  });
});

describe("a janela de referência", () => {
  test("é o mês corrente, e a janela são os 12 meses anteriores", async () => {
    expect(competenciaDeHoje(AGORA)).toBe("2026-07");
    comBase();
    const { referencia } = await rodar();
    expect(referencia.competencia).toBe("2026-07");
    expect(referencia.janela[0]).toBe("2025-07");
    expect(referencia.janela[11]).toBe("2026-06");
  });
});
