// ⚠ A AUDITORIA É LEITURA — e isto é PROVA, não afirmação.
//
// Todo model do prisma nasce aqui com `create`/`update`/`upsert`/`delete*` **lançando**, e o último
// teste varre `Object.values(prisma)` exigindo que nenhum tenha sido chamado. As duas metades são
// necessárias: o `throw` pega a escrita durante qualquer caso; a varredura pega a escrita que um
// `try/catch` engoliu — que é exatamente como uma leitura vira escritora sem ninguém ver.
//
// Precedente exato: `application/planejamento/__tests__/dadosPlanejamento.test.js`, escrito pela
// mesma razão (lá o perigo era `RbtExtratoService.getRbt12`, que faz `upsertCache` no fallback e
// por isso NÃO pôde ser reusado numa tela de leitura).

const prismaModel = () => ({
  findUnique: jest.fn(async () => null),
  findFirst: jest.fn(async () => null),
  findMany: jest.fn(async () => []),
  aggregate: jest.fn(async () => ({ _sum: {}, _count: { _all: 0 } })),
  groupBy: jest.fn(async () => []),
  count: jest.fn(async () => 0),
  create: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA na auditoria"); }),
  createMany: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA na auditoria"); }),
  update: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA na auditoria"); }),
  updateMany: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA na auditoria"); }),
  upsert: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA na auditoria"); }),
  delete: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA na auditoria"); }),
  deleteMany: jest.fn(async () => { throw new Error("ESCRITA PROIBIDA na auditoria"); }),
});

jest.mock("../../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalClient: prismaModel(),
    company: prismaModel(),
    portalInvoice: prismaModel(),
    portalInvoiceEvent: prismaModel(),
    notaItem: prismaModel(),
    apuracaoSnapshot: prismaModel(),
    companyMonthlyCircular: prismaModel(),
    pendenciaPosFechamento: prismaModel(),
    // ⚠ `$transaction` NÃO é um model, e é de propósito que ele fica de fora do mock: se o serviço
    // algum dia o chamar, o teste quebra com `is not a function` — que é o aviso desejado, porque
    // uma leitura não precisa de transação.
  },
}));

const { prisma } = require("../../../../infrastructure/db/prisma.js");
const { auditarCompetencia, MESES_DA_JANELA_DA_SERIE } = require("../AuditoriaNotasService.js");
const { SITUACAO, MOTIVO_NAO_CONFERIVEL } = require("../auditoriaNotas.js");

const EMPRESA = { id: "emp-1", razao: "Cliente LTDA", cnpj: "12345678000199", companyId: "co-1" };

function nota(over = {}) {
  return {
    id: "n1", numero: "100", chaveAcesso: "CH1", type: "NFSE", papel: "EMIT",
    statusEfetivo: "autorizada",
    issueDate: new Date("2026-07-10T00:00:00.000Z"),
    competencia: new Date("2026-07-01T00:00:00.000Z"),
    total: "1000.00", cTribNac: "310104", xTribNac: "Serviço",
    issqnBaseCalculo: "1000.00", issqnAliquota: "5.0000", issqnValor: "50.00",
    dpsSerie: "00001", dpsNumero: "10",
    camposFiscaisExtraidosEm: new Date("2026-08-17T12:00:00.000Z"), camposFiscaisMotivo: null,
    ...over,
  };
}

function comBase({ portal = EMPRESA, company = { id: "co-1", codigosServicoNacional: ["310104"], codigoServicoNacional: "310104" }, notas = [nota()] } = {}) {
  prisma.portalClient.findUnique.mockResolvedValue(portal);
  prisma.company.findUnique.mockResolvedValue(company);
  prisma.portalInvoice.findMany.mockResolvedValue(notas);
}

const rodar = (over = {}) => auditarCompetencia({ portalClientId: "emp-1", competencia: "2026-07", ...over });

beforeEach(() => {
  jest.clearAllMocks();
  comBase();
});

describe("a ligação com o banco", () => {
  test("o escopo multi-tenant viaja no where de TODA query de nota", async () => {
    await rodar();
    const [{ where }] = prisma.portalInvoice.findMany.mock.calls[0];
    expect(where.clientId).toBe("emp-1");
    expect(where.type).toBe("NFSE");
    expect(where.papel).toBe("EMIT");
  });

  test("⚠ é UMA query de notas só — a competência é um recorte da janela, em memória", async () => {
    await rodar();
    expect(prisma.portalInvoice.findMany).toHaveBeenCalledTimes(1);
  });

  test("a janela da numeração termina na competência e cobre 12 meses (INCLUSIVE ela)", async () => {
    const r = await rodar();
    expect(r.janelaDaSerie).toEqual({ de: "2025-08", ate: "2026-07", meses: MESES_DA_JANELA_DA_SERIE });
    const [{ where }] = prisma.portalInvoice.findMany.mock.calls[0];
    expect(where.competencia.gte.toISOString()).toBe("2025-08-01T00:00:00.000Z");
    expect(where.competencia.lt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  test("só as notas do MÊS entram nas perguntas da apuração; a janela inteira, na numeração", async () => {
    comBase({
      notas: [
        nota({ id: "velha", dpsNumero: "8", competencia: new Date("2026-05-01T00:00:00.000Z"), issueDate: new Date("2026-05-02T00:00:00.000Z") }),
        nota({ id: "doMes", dpsNumero: "10" }),
      ],
    });
    const r = await rodar();
    expect(r.totalNotas).toBe(1);                       // só a do mês
    const num = r.perguntas.find((p) => p.id === "NUMERACAO_DA_DPS");
    expect(num.avaliadas).toBe(2);                      // a janela inteira
    expect(num.achados[0].dados).toMatchObject({ de: 9, ate: 9 }); // o buraco só é visível na janela
  });

  test("empresa sem `Company` legada: o cadastro é vazio e a pergunta 1 diz NÃO CONFERÍVEL", async () => {
    comBase({ portal: { ...EMPRESA, companyId: null } });
    const r = await rodar();
    expect(prisma.company.findUnique).not.toHaveBeenCalled();
    expect(r.empresa.temCadastroDeServicos).toBe(false);
    const p = r.perguntas.find((x) => x.id === "ATIVIDADE_FORA_DO_CADASTRO");
    expect(p.situacao).toBe(SITUACAO.NAO_CONFERIVEL);
    expect(p.motivo).toBe(MOTIVO_NAO_CONFERIVEL.EMPRESA_SEM_CODIGOS_CADASTRADOS);
  });

  test("competência malformada é recusada antes de qualquer leitura", async () => {
    await expect(auditarCompetencia({ portalClientId: "emp-1", competencia: "2026" })).rejects.toThrow();
    expect(prisma.portalInvoice.findMany).not.toHaveBeenCalled();
  });
});

describe("⚠ a auditoria não escreve", () => {
  test("nenhum create/update/upsert em nenhum model", async () => {
    await rodar();
    for (const model of Object.values(prisma)) {
      expect(model.create).not.toHaveBeenCalled();
      expect(model.createMany).not.toHaveBeenCalled();
      expect(model.update).not.toHaveBeenCalled();
      expect(model.updateMany).not.toHaveBeenCalled();
      expect(model.upsert).not.toHaveBeenCalled();
      expect(model.delete).not.toHaveBeenCalled();
      expect(model.deleteMany).not.toHaveBeenCalled();
    }
  });

  test("nem quando há achado em todas as cinco perguntas", async () => {
    comBase({
      company: { id: "co-1", codigosServicoNacional: ["999999"], codigoServicoNacional: "999999" },
      notas: [
        nota({ id: "a", dpsNumero: "10", cTribNac: "310104", issqnValor: "0",
               issueDate: new Date("2026-08-02T00:00:00.000Z") }),
        nota({ id: "b", dpsNumero: "20", camposFiscaisMotivo: "NENHUM_CAMPO" }),
      ],
    });
    const r = await rodar();
    expect(r.totalAchados).toBeGreaterThanOrEqual(4);
    for (const model of Object.values(prisma)) {
      expect(model.create).not.toHaveBeenCalled();
      expect(model.update).not.toHaveBeenCalled();
      expect(model.upsert).not.toHaveBeenCalled();
      expect(model.deleteMany).not.toHaveBeenCalled();
    }
  });

  test("⚠ o SERVIÇO não contém nenhuma escrita, nem em texto", () => {
    // A varredura acima só prova o caminho exercido. Esta prova o arquivo: um `update` num ramo que
    // nenhum teste alcança passaria despercebido pela primeira e não passa por esta.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "AuditoriaNotasService.js"), "utf8");
    const codigo = fonte.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const proibido of [".create(", ".createMany(", ".update(", ".updateMany(", ".upsert(", ".delete(", ".deleteMany(", "$transaction", "$executeRaw"]) {
      expect(codigo).not.toContain(proibido);
    }
  });

  test("⚠ nenhuma chamada externa: ADN, SEFAZ, SERPRO ou Meta", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const ler = (arquivo) => fs.readFileSync(path.join(__dirname, "..", arquivo), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
    for (const arquivo of ["AuditoriaNotasService.js", "auditoriaNotas.js"]) {
      const codigo = ler(arquivo);
      for (const proibido of ["fetch(", "axios", "https.request", "Adn", "Serpro", "Sefaz"]) {
        expect(codigo).not.toContain(proibido);
      }
    }
  });

  test("⚠ a REGRA não importa prisma — ela é pura", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "auditoriaNotas.js"), "utf8");
    expect(fonte).not.toContain("infrastructure/db/prisma");
    // O único import é a leitura de data civil do projeto — que também é pura.
    const imports = fonte.split("\n").filter((l) => l.startsWith("import "));
    expect(imports).toEqual(['import { dataCivilISO } from "../../../utils/dataCivil.js";']);
  });
});
