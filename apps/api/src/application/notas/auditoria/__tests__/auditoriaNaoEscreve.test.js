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
const { auditarCompetencia, LIMITE_NOTAS_SEM_COMPETENCIA } = require("../AuditoriaNotasService.js");
const { SITUACAO, MOTIVO_NAO_CONFERIVEL, MOTIVO_FORA_DA_CONFERENCIA } = require("../auditoriaNotas.js");

const EMPRESA = { id: "emp-1", razao: "Cliente LTDA", cnpj: "12345678000199", companyId: "co-1" };

function nota(over = {}) {
  return {
    id: "n1", numero: "100", chaveAcesso: "CH1", type: "NFSE", papel: "EMIT",
    statusEfetivo: "autorizada",
    issueDate: new Date("2026-07-10T00:00:00.000Z"),
    competencia: new Date("2026-07-01T00:00:00.000Z"),
    total: "1000.00", cTribNac: "310104", xTribNac: "Serviço",
    issqnBaseCalculo: "1000.00", issqnAliquota: "5.0000", issqnValor: "50.00",
    camposFiscaisExtraidosEm: new Date("2026-08-17T12:00:00.000Z"), camposFiscaisMotivo: null,
    ...over,
  };
}

// ⚠ As duas leituras de nota têm `where` DIFERENTES (`competencia: {gte,lt}` × `competencia: null`),
// e o dublê precisa distingui-las — senão a lista do mês vira também a lista das sem competência e
// o teste do conserto de 21/08/2026 passaria por acidente.
function comBase({
  portal = EMPRESA,
  company = { id: "co-1", codigosServicoNacional: ["310104"], codigoServicoNacional: "310104" },
  notas = [nota()],
  semCompetencia = [],
  totalSemCompetencia = null,
} = {}) {
  prisma.portalClient.findUnique.mockResolvedValue(portal);
  prisma.company.findUnique.mockResolvedValue(company);
  prisma.portalInvoice.findMany.mockImplementation(async ({ where }) =>
    (where?.competencia === null ? semCompetencia : notas));
  prisma.portalInvoice.count.mockResolvedValue(
    totalSemCompetencia == null ? semCompetencia.length : totalSemCompetencia);
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

  // ⚠ ATÉ 21/08/2026 ESTE TESTE EXIGIA **UMA** QUERY, e a janela de 12 meses da numeração da DPS era
  // recortada em memória. A pergunta de numeração foi removida (falso positivo — ver
  // `auditoriaNotas.js`), a janela caiu junto, e a consulta passou a ser a do MÊS. As duas leituras
  // a mais são o conserto do buraco: `count` + amostra das notas SEM competência.
  test("a consulta das perguntas é a da COMPETÊNCIA — não mais uma janela de 12 meses", async () => {
    await rodar();
    const [{ where }] = prisma.portalInvoice.findMany.mock.calls[0];
    expect(where.competencia.gte.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(where.competencia.lt.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  test("só as notas do MÊS entram nas perguntas", async () => {
    comBase({ notas: [nota({ id: "doMes" })] });
    const r = await rodar();
    expect(r.totalNotas).toBe(1);
    expect(r.perguntas.map((p) => p.id)).toEqual([
      "ATIVIDADE_FORA_DO_CADASTRO", "EMISSAO_FORA_DA_COMPETENCIA", "ISS_ZERADO_ONDE_TRIBUTA",
    ]);
  });

  // ⚠⚠ O CONSERTO DE 21/08/2026, e é a prova de que a aba não mente ao prometer "nada some em
  // silêncio". Antes, `competencia: { gte, lt }` deixava a nota de competência NULA fora de tudo —
  // fora das perguntas E fora da lista de "notas fora desta conferência".
  test("⚠ a nota SEM COMPETÊNCIA é buscada à parte e aparece, com o motivo", async () => {
    comBase({
      notas: [nota({ id: "doMes" })],
      semCompetencia: [nota({ id: "orfa", numero: "777", competencia: null })],
    });
    const r = await rodar();

    const where = prisma.portalInvoice.findMany.mock.calls
      .map(([a]) => a.where).find((w) => w.competencia === null);
    expect(where).toMatchObject({ clientId: "emp-1", type: "NFSE", papel: "EMIT", competencia: null });

    expect(r.foraDaConferencia.motivo).toBe(MOTIVO_FORA_DA_CONFERENCIA.SEM_COMPETENCIA_GRAVADA);
    expect(r.foraDaConferencia.total).toBe(1);
    expect(r.foraDaConferencia.notas).toEqual([expect.objectContaining({ notaId: "orfa", numero: "777" })]);
    // ⚠ E ela NÃO entra na conferência do mês: atribuí-la a este mês seria inventar a competência.
    expect(r.totalNotas).toBe(1);
  });

  test("⚠ o TOTAL vem do count, não do tamanho da lista — lista truncada não pode virar o número", async () => {
    comBase({
      semCompetencia: [nota({ id: "o1", competencia: null }), nota({ id: "o2", competencia: null })],
      totalSemCompetencia: 137,
    });
    const r = await rodar();
    expect(r.foraDaConferencia.total).toBe(137);
    expect(r.foraDaConferencia.listadas).toBe(2);
    expect(r.foraDaConferencia.truncada).toBe(true);

    const chamada = prisma.portalInvoice.findMany.mock.calls
      .map(([a]) => a).find((a) => a.where.competencia === null);
    expect(chamada.take).toBe(LIMITE_NOTAS_SEM_COMPETENCIA);
  });

  test("sem nota órfã, o bloco existe zerado — a tela precisa poder dizer 'nenhuma'", async () => {
    const r = await rodar();
    expect(r.foraDaConferencia).toMatchObject({ total: 0, listadas: 0, truncada: false, notas: [] });
  });

  // ⚠ NOTA_NAO_LIDA saiu da tela do contador (21/08/2026) mas NÃO foi apagada: o sinal é nosso e
  // continua no payload. O que ela não pode fazer é contar como "ponto a conferir".
  test("⚠ a nota não lida sobe em `manutencao` e NÃO conta em totalAchados", async () => {
    comBase({ notas: [nota({ id: "ilegivel", camposFiscaisMotivo: "NENHUM_CAMPO" })] });
    const r = await rodar();
    expect(r.manutencao.notasNaoLidas).toBe(1);
    expect(r.perguntas.some((p) => p.id === "NOTA_NAO_LIDA")).toBe(false);
    expect(r.totalAchados).toBe(0);
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

  test("nem quando há achado nas três perguntas, mais órfã e nota ilegível", async () => {
    comBase({
      company: { id: "co-1", codigosServicoNacional: ["999999"], codigoServicoNacional: "999999" },
      notas: [
        // ⚠ Dezembro/2025 contra competência 07/2026: 7 meses de desvio, bem acima do piso de 2.
        nota({ id: "a", cTribNac: "310104", issqnValor: "0",
               issueDate: new Date("2025-12-02T00:00:00.000Z") }),
        nota({ id: "b", camposFiscaisMotivo: "NENHUM_CAMPO" }),
      ],
      semCompetencia: [nota({ id: "orfa", competencia: null })],
    });
    const r = await rodar();
    expect(r.totalAchados).toBeGreaterThanOrEqual(3);
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
