// A PORTA DA EMISSÃO EM LOTE — a flag, o portão, a reconferência no servidor e a idempotência.
//
// ⚠⚠ NADA AQUI EMITE. `NfseService.issue` é MOCKADO em todos os casos, e vários testes medem
// justamente que ele **NÃO foi chamado**. Nenhuma linha deste arquivo toca o sistema nacional.

// ⚠ `var` e não `const`: os `jest.mock` são içados para cima das declarações, e o getter da flag
// precisa de um nome que já exista quando a fábrica for avaliada.
var mockFlagLigada = true;

jest.mock("../../config.js", () => ({
  get INTEGRACAO_NFSE_LOTE() {
    return mockFlagLigada;
  },
}));
jest.mock("../../application/nfse/NfseService.js", () => ({
  NfseService: { issue: jest.fn() },
}));
jest.mock("../middlewares/emissaoNfseGate.js", () => ({
  ensureEmissaoNfseAutorizada: jest.fn(),
}));
jest.mock("../../infrastructure/db/prisma.js", () => ({
  prisma: {
    tomadorEmitido: { findMany: jest.fn(async () => []) },
    loteEmissaoNfse: {
      create: jest.fn(),
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    loteEmissaoNfseLinha: {
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: 0 })),
    },
  },
}));

import express from "express";
import request from "supertest";
import * as XLSX from "xlsx";
import { prisma } from "../../infrastructure/db/prisma.js";
import { NfseService } from "../../application/nfse/NfseService.js";
import { ensureEmissaoNfseAutorizada } from "../middlewares/emissaoNfseGate.js";
import { createNfseLoteRouter } from "../nfseLoteRoutes.js";
import { COLUNAS_LOTE } from "../../application/nfse/lote/colunasLote.js";

const mockIssue = NfseService.issue;
const mockGate = ensureEmissaoNfseAutorizada;
const mockPrisma = prisma;
const mockBancoLotes = new Map();

const CABECALHOS = COLUNAS_LOTE.map((c) => c.rotulo);
const CNPJ = "39254243000191";
const BASE = "/client/companies/pc-1/nfse/lote";

/**
 * ⚠ A planilha tem QUATRO colunas desde 20/08/2026 — nome e endereço do tomador não cabem nela.
 * Para a linha chegar a `PRONTA` (que é o que estes testes precisam), quem os fornece é a MEMÓRIA
 * de tomadores, exatamente como no fluxo real do *"se já teve antes, só preencher"*.
 */
const LINHA_OK = {
  documento: CNPJ,
  descricao: "Consultoria",
  valor: "1500,00",
  competencia: "31/07/2026",
};

const TOMADOR_CONHECIDO = {
  documento: CNPJ,
  nome: "TOMADOR LTDA",
  cMun: "3304557",
  cep: "20031005",
  xLgr: "Av. Rio Branco",
  nro: "100",
  xBairro: "Centro",
};

function planilha(linhas) {
  const wb = XLSX.utils.book_new();
  const matriz = [CABECALHOS, ...linhas.map((v) => COLUNAS_LOTE.map((c) => v[c.chave] ?? ""))];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matriz), "Notas");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

function app() {
  const a = express();
  a.use((req, _res, next) => {
    req.auth = { user: { id: "u-1" } };
    next();
  });
  a.use(
    "/client/companies/:companyId/nfse/lote",
    createNfseLoteRouter({ log: null, resolverCompanyId: async () => "company-legada-1" })
  );
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockBancoLotes.clear();
  mockFlagLigada = true;
  mockGate.mockResolvedValue({ ok: true, via: "CLIENTE" });
  // ⚠ A memória conhece o tomador — sem ela a linha de quatro colunas cairia em `consultar`.
  mockPrisma.tomadorEmitido.findMany.mockResolvedValue([TOMADOR_CONHECIDO]);
  mockPrisma.loteEmissaoNfse.findFirst.mockResolvedValue(null);
  mockPrisma.loteEmissaoNfseLinha.findMany.mockResolvedValue([]);
  mockPrisma.loteEmissaoNfse.create.mockImplementation(async ({ data }) => {
    const lote = { id: "lote-1", ...data, status: "emitindo", emitidas: 0, recusadas: 0, criadoEm: new Date() };
    mockBancoLotes.set(lote.id, lote);
    return lote;
  });
  mockPrisma.loteEmissaoNfse.findUnique.mockImplementation(async ({ where }) => mockBancoLotes.get(where.id) || null);
  mockPrisma.loteEmissaoNfse.update.mockImplementation(async ({ where, data }) => {
    const atual = { ...(mockBancoLotes.get(where.id) || {}), ...data };
    mockBancoLotes.set(where.id, atual);
    return atual;
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠⚠ a flag — o SERVIDOR recusa, não a tela", () => {
  const casos = [
    ["POST", `${BASE}/emissao`],
    ["GET", `${BASE}/emissao/lote-1`],
    ["POST", `${BASE}/emissao/lote-1/retomar`],
  ];

  it.each(casos)("%s %s responde 503 nomeado com a flag OFF", async (metodo, url) => {
    mockFlagLigada = false;
    const r = metodo === "GET" ? await request(app()).get(url) : await request(app()).post(url);
    expect(r.status).toBe(503);
    expect(r.body.error).toBe("emissao_lote_desligada");
    expect(r.body.message).toContain("INTEGRACAO_NFSE_LOTE");
  });

  it("⚠⚠ com a flag OFF NADA é emitido e o portão nem é consultado", async () => {
    mockFlagLigada = false;
    await request(app())
      .post(`${BASE}/emissao`)
      .attach("arquivo", planilha([LINHA_OK]), "notas.xlsx");
    expect(mockIssue).not.toHaveBeenCalled();
    expect(mockGate).not.toHaveBeenCalled();
    expect(mockPrisma.loteEmissaoNfse.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠ o portão vale ANTES DA PRIMEIRA linha", () => {
  it("empresa não liberada não emite NENHUMA — e o arquivo nem é lido", async () => {
    mockGate.mockImplementation(async (_req, res) => {
      res.status(403).json({ error: "emissao_cliente_nao_liberada" });
      return { ok: false };
    });
    const r = await request(app())
      .post(`${BASE}/emissao`)
      .attach("arquivo", planilha([LINHA_OK]), "notas.xlsx");

    expect(r.status).toBe(403);
    expect(mockIssue).not.toHaveBeenCalled();
    expect(mockPrisma.loteEmissaoNfse.create).not.toHaveBeenCalled();
  });

  it("⚠ o portão recebe o id da Company LEGADA, nunca o do path", async () => {
    await request(app()).post(`${BASE}/emissao`).attach("arquivo", planilha([LINHA_OK]), "notas.xlsx");
    expect(mockGate.mock.calls[0][2]).toBe("company-legada-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠⚠ a conferência é REFEITA no servidor", () => {
  it("linha com pendência não vira lote — e nada é emitido", async () => {
    // ⚠ Sem memória e sem consulta, o CNPJ fica em `consultar` — nunca `pronta`. É o estado normal
    // de uma planilha de quatro colunas cujo tomador ainda não é conhecido.
    mockPrisma.tomadorEmitido.findMany.mockResolvedValue([]);
    const r = await request(app())
      .post(`${BASE}/emissao`)
      .attach("arquivo", planilha([LINHA_OK]), "notas.xlsx");

    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nenhuma_linha_pronta");
    expect(mockIssue).not.toHaveBeenCalled();
    expect(mockPrisma.loteEmissaoNfse.create).not.toHaveBeenCalled();
  });

  it("⚠⚠ o corpo NÃO escolhe o que emitir — só o arquivo reclassificado decide", async () => {
    const r = await request(app())
      .post(`${BASE}/emissao`)
      // uma tentativa de mandar "as linhas a emitir" prontas: tem de ser ignorada
      .field("linhas", JSON.stringify([{ numero: 2, estado: "pronta" }]))
      .field("prontas", JSON.stringify([2]))
      .attach("arquivo", planilha([{ ...LINHA_OK, valor: "" }]), "notas.xlsx");

    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nenhuma_linha_pronta");
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("arquivo ausente é 400 — e nada é criado", async () => {
    const r = await request(app()).post(`${BASE}/emissao`);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("arquivo_ausente");
    expect(mockPrisma.loteEmissaoNfse.create).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("o lote nasce e é reconhecido", () => {
  it("linha pronta cria o lote e responde 202", async () => {
    mockIssue.mockResolvedValue({ status: "issued", nfse: { id: "si-1", rpsSerie: "00001", rpsNumero: "1" } });
    const r = await request(app())
      .post(`${BASE}/emissao`)
      .attach("arquivo", planilha([LINHA_OK]), "notas.xlsx");

    expect(r.status).toBe(202);
    expect(r.body.reconhecido).toBe(false);
    expect(mockPrisma.loteEmissaoNfse.create).toHaveBeenCalled();
    const criado = mockPrisma.loteEmissaoNfse.create.mock.calls[0][0].data;
    expect(criado.companyId).toBe("company-legada-1");
    expect(criado.totalLinhas).toBe(1);
    expect(criado.impressaoDigital).toMatch(/^[0-9a-f]{64}$/);
  });

  it("⚠⚠ a MESMA planilha de novo RECONHECE o lote e NÃO reemite", async () => {
    mockPrisma.loteEmissaoNfse.findFirst.mockResolvedValue({
      id: "lote-ja-existe",
      companyId: "company-legada-1",
      status: "concluido",
      totalLinhas: 1,
      emitidas: 1,
      recusadas: 0,
      naoTentadas: 0,
    });
    mockBancoLotes.set("lote-ja-existe", {
      id: "lote-ja-existe", companyId: "company-legada-1", status: "concluido",
      totalLinhas: 1, emitidas: 1, recusadas: 0, naoTentadas: 0,
    });

    const r = await request(app())
      .post(`${BASE}/emissao`)
      .attach("arquivo", planilha([LINHA_OK]), "notas.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.reconhecido).toBe(true);
    expect(r.body.lote.id).toBe("lote-ja-existe");
    expect(mockPrisma.loteEmissaoNfse.create).not.toHaveBeenCalled();
    expect(mockIssue).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("⚠ escopo por empresa", () => {
  it("lote de outra empresa responde 404 — nunca 403 (confirmar a existência já vaza)", async () => {
    mockBancoLotes.set("lote-alheio", { id: "lote-alheio", companyId: "OUTRA-EMPRESA" });
    const r = await request(app()).get(`${BASE}/emissao/lote-alheio`);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("lote_nao_encontrado");
  });

  it("retomar lote de outra empresa não emite nada", async () => {
    mockBancoLotes.set("lote-alheio", { id: "lote-alheio", companyId: "OUTRA-EMPRESA" });
    const r = await request(app()).post(`${BASE}/emissao/lote-alheio/retomar`);
    expect(r.status).toBe(404);
    expect(mockIssue).not.toHaveBeenCalled();
  });
});
