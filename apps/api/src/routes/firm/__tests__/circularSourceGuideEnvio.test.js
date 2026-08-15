// O `sourceGuide` DA CIRCULAR — a mesma tela, duas linhas, dois contratos diferentes.
//
// ⚠ O QUE ESTE ARQUIVO PROTEGE É UMA SIMETRIA, não um campo.
//
// `GET /entries/circular` carrega, no `include` das provisões, três campos com comentário
// explicando por que são necessários: `vencimento` (é ele que separa "a vencer" de "vencida" —
// sem ele a Circular pinta de vermelho a guia que vence semana que vem), `emailStatus` e `envios`
// (o "Enviada ao cliente" do popover, cuja verdade mora em `envios_guia`).
//
// Três caminhos REESCREVIAM esse objeto depois — `enrichDasProvisao` (DAS), a provisão sintética
// do INSS e a do DAS por upload — e os três emitiam um `sourceGuide` com cinco campos, jogando os
// outros três fora. DARF, PIS e COFINS não passam por nenhum deles e chegavam completos.
//
// O efeito na tela, nas duas linhas mais comuns da Circular: o popover afirmava "Enviada ao
// cliente: ainda não" para guia que FOI enviada (afirmação falsa, não ausência), a linha
// "Vencimento" sumia, e o valor caía no balde `semData` — subdimensionando o "Total vencido".
//
// A asimetria é a prova de que não foi decisão. É ela que os testes abaixo medem: o DARF é o
// controle, e todo caminho enriquecido tem de responder igual a ele.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, res, next) => {
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    accountingEntry: { findMany: jest.fn(async () => []) },
    guide: { findMany: jest.fn(async () => []) },
    companyMonthlyCircular: { findMany: jest.fn(async () => []) },
  },
}));

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { createAccountingEntriesRouter } from "../accountingEntries.js";
// A leitura do envio NÃO é reimplementada aqui — é a mesma função que o compliance usa.
import { foiEnviadaComLegado } from "../../../application/guides/EnvioGuiaService.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeApp() {
  const app = express();
  app.use(express.json());
  const parent = express.Router();
  parent.use("/companies/:companyId", createAccountingEntriesRouter({ log }));
  app.use("/firm", parent);
  return app;
}

const COMP = "2026-06";
const COMP_SEM_PROVISAO = "2026-07";
const VENCIMENTO = new Date("2026-07-20T00:00:00.000Z");
const ENVIADO_EM = new Date("2026-07-05T13:00:00.000Z");

// Uma guia ENVIADA — e enviada do jeito que a produção de hoje registra: `emailStatus: "SENT"` sem
// nenhuma linha em `envios_guia` (a tabela tem 0 registros; quem responde é `foiEnviadaComLegado`).
const guiaEnviadaPorEmail = (over = {}) => ({
  id: "g-das",
  tipo: "SIMPLES",
  competencia: COMP,
  valor: 1000,
  valorOriginal: 1000,
  source: "SERPRO",
  paymentStatus: "OPEN",
  paymentStatusSource: null,
  paymentConfirmedAt: null,
  serproLastCheckResult: null,
  comprovantePdfFileId: null,
  vencimento: VENCIMENTO,
  updatedAt: new Date("2026-07-01T00:00:00.000Z"),
  parcelamentoId: null,
  extracted: null,
  emailStatus: "SENT",
  emailSentAt: ENVIADO_EM,
  envios: [],
  ...over,
});

// O CONTROLE: a provisão de DARF não passa por enriquecimento nenhum — o `include` da query a
// entrega inteira, e ela é o que a tela sempre leu certo.
const entryDarf = {
  id: "e-darf",
  portalClientId: "p1",
  competencia: COMP,
  tipo: "PROVISAO",
  subtipo: "PIS",
  eventType: "DARF_PIS",
  statusPagamento: "ABERTO",
  baixas: [],
  lines: [
    { id: "l1", conta: "1", tipo: "D", valor: 300, ordem: 0 },
    { id: "l2", conta: "2", tipo: "C", valor: 300, ordem: 1 },
  ],
  sourceGuide: guiaEnviadaPorEmail({ id: "g-darf", tipo: "DARF" }),
};

const entryDas = {
  id: "e-das",
  portalClientId: "p1",
  competencia: COMP,
  tipo: "PROVISAO",
  subtipo: "DAS",
  eventType: "DAS_SIMPLES",
  statusPagamento: "ABERTO",
  baixas: [],
  lines: [
    { id: "l3", conta: "1", tipo: "D", valor: 1000, ordem: 0 },
    { id: "l4", conta: "2", tipo: "C", valor: 1000, ordem: 1 },
  ],
  sourceGuide: guiaEnviadaPorEmail(),
};

// A guia de INSS da mesma competência — vira provisão SINTÉTICA (não há lançamento de INSS).
const guiaInss = guiaEnviadaPorEmail({ id: "g-inss", tipo: "INSS", valor: 495, valorOriginal: 495 });

// Uma guia de SIMPLES num mês SEM provisão de DAS — vira a provisão sintética de DAS.
const guiaSimplesSemProvisao = guiaEnviadaPorEmail({
  id: "g-das-upload",
  competencia: COMP_SEM_PROVISAO,
  source: "UPLOAD",
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.accountingEntry.findMany.mockImplementation(async (args) => {
    const tipo = args?.where?.tipo;
    if (tipo === "PROVISAO") return [entryDarf, entryDas];
    return []; // RECEITA e BAIXA
  });
  prisma.guide.findMany.mockImplementation(async (args) => {
    const tipo = args?.where?.tipo;
    if (tipo === "INSS") return [guiaInss];
    if (tipo === "SIMPLES") return [guiaEnviadaPorEmail(), guiaSimplesSemProvisao];
    return [];
  });
  prisma.companyMonthlyCircular.findMany.mockResolvedValue([]);
});

async function carregarCircular() {
  const res = await request(makeApp()).get("/firm/companies/p1/entries/circular?year=2026");
  expect(res.status).toBe(200);
  const porId = new Map(res.body.provisoes.map((p) => [p.id, p]));
  return {
    darf: porId.get("e-darf"),
    das: porId.get("e-das"),
    inssSintetica: porId.get(`synthetic-inss-${guiaInss.id}`),
    dasSintetica: porId.get(`synthetic-das-${guiaSimplesSemProvisao.id}`),
  };
}

// Os três campos que o `include` da rota seleciona COM comentário dizendo para que servem.
const CAMPOS = ["vencimento", "emailStatus", "envios"];

describe("as QUERIES carregam o que a tela precisa ler", () => {
  it("o select das guias de INSS e de SIMPLES traz `emailStatus` e `envios` (sem eles não há o que repassar)", async () => {
    await carregarCircular();
    const selects = prisma.guide.findMany.mock.calls.map(([args]) => ({
      tipo: args?.where?.tipo,
      select: args?.select || {},
    }));
    for (const tipo of ["INSS", "SIMPLES"]) {
      const chamada = selects.find((s) => s.tipo === tipo);
      expect(chamada).toBeDefined();
      expect(chamada.select.vencimento).toBe(true);
      expect(chamada.select.emailStatus).toBe(true);
      expect(chamada.select.envios).toBeTruthy();
    }
  });
});

describe("A SIMETRIA — o DARF é o controle, e as linhas enriquecidas têm de responder igual", () => {
  it("o `sourceGuide` do DARF chega com vencimento, emailStatus e envios", async () => {
    const { darf } = await carregarCircular();
    for (const campo of CAMPOS) expect(darf.sourceGuide).toHaveProperty(campo);
    expect(darf.sourceGuide.vencimento).toBeTruthy();
    expect(darf.sourceGuide.emailStatus).toBe("SENT");
  });

  it("o `sourceGuide` do DAS (enrichDasProvisao) chega com os MESMOS três campos", async () => {
    const { das, darf } = await carregarCircular();
    for (const campo of CAMPOS) expect(das.sourceGuide).toHaveProperty(campo);
    expect(Object.keys(das.sourceGuide).sort()).toEqual(
      expect.arrayContaining(CAMPOS.filter((c) => Object.keys(darf.sourceGuide).includes(c))),
    );
  });

  it("o `sourceGuide` da provisão SINTÉTICA de INSS chega com os mesmos três campos", async () => {
    const { inssSintetica } = await carregarCircular();
    for (const campo of CAMPOS) expect(inssSintetica.sourceGuide).toHaveProperty(campo);
  });

  it("o `sourceGuide` da provisão SINTÉTICA de DAS (guia por upload) chega com os mesmos três campos", async () => {
    const { dasSintetica } = await carregarCircular();
    for (const campo of CAMPOS) expect(dasSintetica.sourceGuide).toHaveProperty(campo);
  });
});

describe("O QUE O CONTADOR VÊ — a mesma pergunta, feita às quatro linhas", () => {
  it('"esta guia foi enviada?" responde SIM nas quatro (a guia é a mesma; só o caminho difere)', async () => {
    const linhas = await carregarCircular();
    for (const [nome, entry] of Object.entries(linhas)) {
      const g = entry.sourceGuide;
      // A MESMA leitura do backend (`guideCompliance`) e da tela (`ResumoDaGuia`).
      expect([nome, foiEnviadaComLegado(g.envios, g)]).toEqual([nome, true]);
    }
  });

  it('a linha "Vencimento" do popover tem data nas quatro — e é a MESMA data', async () => {
    const linhas = await carregarCircular();
    for (const [nome, entry] of Object.entries(linhas)) {
      expect([nome, new Date(entry.sourceGuide.vencimento).toISOString()])
        .toEqual([nome, VENCIMENTO.toISOString()]);
    }
  });
});

describe("A tolerância NÃO é o único caminho — envio registrado em `envios_guia` também atravessa", () => {
  it("uma guia de DAS com linha WHATSAPP/enviado chega com a linha inteira no `sourceGuide`", async () => {
    const envio = {
      canal: "WHATSAPP", status: "enviado", destino: "5521999999999",
      enviadoEm: ENVIADO_EM, entregueEm: null, lidoEm: null,
    };
    const comEnvio = guiaEnviadaPorEmail({ emailStatus: "PENDING", envios: [envio] });
    prisma.guide.findMany.mockImplementation(async (args) => {
      const tipo = args?.where?.tipo;
      if (tipo === "INSS") return [];
      if (tipo === "SIMPLES") return [comEnvio];
      return [];
    });

    const { das } = await carregarCircular();
    expect(das.sourceGuide.envios).toHaveLength(1);
    expect(das.sourceGuide.envios[0].canal).toBe("WHATSAPP");
    expect(das.sourceGuide.envios[0].destino).toBe("5521999999999");
    expect(foiEnviadaComLegado(das.sourceGuide.envios, das.sourceGuide)).toBe(true);
  });
});

describe("O QUE O ENRIQUECIMENTO NÃO PODE MUDAR (era o assunto conhecido, e continua sendo)", () => {
  it("`enrichDasProvisao` segue corrigindo valor/totalD pelo `circular.dasTotal` e NÃO toca em `saldo`", async () => {
    prisma.companyMonthlyCircular.findMany.mockResolvedValue([
      { competencia: COMP, dasTotal: 1234.56, acrescimos: null, pgdasDeclaracaoFileId: null, pgdasReciboFileId: null, semFaturamento: false },
    ]);
    const { das } = await carregarCircular();
    expect(das.valor).toBe(1234.56);
    expect(das.totalD).toBe(1234.56);
    // `saldo` vem de `entryToResponse`/`computeSaldoProvisao`, das LINHAS — 1000, não 1234,56.
    expect(das.saldo).toBe(1000);
  });
});
