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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ⚠⚠ A PORTA DA RETENTATIVA — `POST /emissao/:loteId/retentar`
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// > Caso real, 21/08/2026: lote de 3 notas RECUSADO pela Receita (`E1235`), erro do XML consertado
// > e em produção, e a tela respondendo "esta planilha já havia sido emitida" — com **0 emitidas**.
//
// ⚠⚠ **A METADE MAIS IMPORTANTE DESTE BLOCO É A QUE MEDE QUE `NfseService.issue` NÃO FOI CHAMADO.**
// Não basta a tela não oferecer: um `curl` chega aqui direto, e é o SERVIDOR que tem de recusar
// reemitir linha `emitida` ou `indeterminada`.

/** Uma linha do lote como o banco a guarda. */
function linhaDoLote(numeroLinha, desfecho, extra = {}) {
  return {
    id: `linha-${numeroLinha}`,
    loteId: "lote-1",
    numeroLinha,
    desfecho,
    dados: {
      tomador: { doc: CNPJ, nome: `TOMADOR ${numeroLinha}`, email: null, endereco: {} },
      servico: { descricao: "Consultoria", valorServicos: 1500 },
      competencia: null,
    },
    tomadorDoc: CNPJ,
    tomadorNome: `TOMADOR ${numeroLinha}`,
    valorServicos: 1500,
    serviceInvoiceId: null,
    rpsSerie: null,
    rpsNumero: null,
    camada: null,
    codigo: null,
    mensagem: null,
    correcao: null,
    tentadaEm: null,
    ...extra,
  };
}

/**
 * Semeia um lote com linhas de verdade e liga um `where` que FUNCIONA.
 *
 * ⚠ O `where` precisa ser honrado de verdade — é ele que carrega a regra (`desfecho: { in: [...] }`
 * na seleção e na reserva atômica). Um dublê que devolvesse a lista inteira faria estes testes
 * passarem com a trava desligada, que é exatamente o contrário do que eles existem para provar.
 */
function semear(lote, linhas) {
  mockBancoLotes.set(lote.id, lote);
  const banco = new Map(linhas.map((l) => [l.id, { ...l, loteId: lote.id }]));

  const casa = (l, where) => {
    if (where.id !== undefined && l.id !== where.id) return false;
    if (where.loteId !== undefined && l.loteId !== where.loteId) return false;
    if (where.desfecho?.in !== undefined) return where.desfecho.in.includes(l.desfecho);
    if (where.desfecho !== undefined && l.desfecho !== where.desfecho) return false;
    if (where.numeroLinha?.gt !== undefined && !(l.numeroLinha > where.numeroLinha.gt)) return false;
    if (where.numeroLinha?.not !== undefined && l.numeroLinha === where.numeroLinha.not) return false;
    return true;
  };

  mockPrisma.loteEmissaoNfseLinha.findMany.mockImplementation(async ({ where = {}, orderBy }) => {
    const out = [...banco.values()].filter((l) => casa(l, where));
    if (orderBy?.numeroLinha === "asc") out.sort((a, b) => a.numeroLinha - b.numeroLinha);
    return out.map((l) => ({ ...l }));
  });
  mockPrisma.loteEmissaoNfseLinha.updateMany.mockImplementation(async ({ where = {}, data }) => {
    let n = 0;
    for (const l of banco.values()) {
      if (!casa(l, where)) continue;
      Object.assign(l, data);
      n += 1;
    }
    return { count: n };
  });
  mockPrisma.loteEmissaoNfseLinha.update.mockImplementation(async ({ where, data }) => {
    const l = banco.get(where.id);
    Object.assign(l, data);
    return { ...l };
  });
  return banco;
}

/** O laço é DESTACADO (a rota responde 202 e segue). Isto drena as tarefas dele. */
async function drenar() {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
}

const LOTE_BASE = {
  id: "lote-1",
  companyId: "company-legada-1",
  status: "concluido",
  totalLinhas: 3,
  emitidas: 0,
  recusadas: 3,
  naoTentadas: 0,
  linhaIndeterminada: null,
  criadoEm: new Date("2026-08-21T14:41:00.000Z"),
};

describe("⚠⚠ retentar — o servidor recusa reemitir o que já virou nota", () => {
  it("⚠⚠ lote inteiramente EMITIDO responde 422 `nada_a_retentar` e NÃO emite nada", async () => {
    semear({ ...LOTE_BASE, emitidas: 3, recusadas: 0 }, [
      linhaDoLote(2, "emitida", { serviceInvoiceId: "si-2", rpsNumero: "2", rpsSerie: "00001" }),
      linhaDoLote(3, "emitida", { serviceInvoiceId: "si-3", rpsNumero: "3", rpsSerie: "00001" }),
      linhaDoLote(4, "emitida", { serviceInvoiceId: "si-4", rpsNumero: "4", rpsSerie: "00001" }),
    ]);

    const r = await request(app()).post(`${BASE}/emissao/lote-1/retentar`);
    await drenar();

    expect(r.status).toBe(422);
    expect(r.body.error).toBe("nada_a_retentar");
    expect(r.body.retentativa.quantas).toBe(0);
    expect(r.body.retentativa.emitidas).toBe(3);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("⚠⚠ lote parado na INDETERMINADA, sem mais nada, responde 422 e NÃO emite", async () => {
    semear({ ...LOTE_BASE, status: "parado_indeterminado", linhaIndeterminada: 3, emitidas: 1, recusadas: 0 }, [
      linhaDoLote(2, "emitida", { serviceInvoiceId: "si-2" }),
      linhaDoLote(3, "indeterminada", { camada: "TRANSPORTE", rpsNumero: "3", rpsSerie: "00001" }),
    ]);

    const r = await request(app()).post(`${BASE}/emissao/lote-1/retentar`);
    await drenar();

    expect(r.status).toBe(422);
    expect(r.body.retentativa.indeterminadas).toBe(1);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("⚠⚠ O CASO PARCIAL PELA ROTA: 2 emitidas + 1 recusada emite UMA nota, e é a da linha recusada", async () => {
    mockIssue.mockResolvedValue({ status: "issued", nfse: { id: "si-novo", rpsSerie: "00001", rpsNumero: "9" } });
    semear({ ...LOTE_BASE, emitidas: 2, recusadas: 1 }, [
      linhaDoLote(2, "emitida", { serviceInvoiceId: "si-2", rpsNumero: "2", rpsSerie: "00001" }),
      linhaDoLote(3, "emitida", { serviceInvoiceId: "si-3", rpsNumero: "3", rpsSerie: "00001" }),
      linhaDoLote(4, "recusada_receita", {
        camada: "RECEITA", codigo: "E1235", serviceInvoiceId: "si-4", rpsNumero: "4", rpsSerie: "00001",
      }),
    ]);

    const r = await request(app()).post(`${BASE}/emissao/lote-1/retentar`);
    await drenar();

    expect(r.status).toBe(202);
    expect(r.body.retentativa.quantas).toBe(1);
    expect(r.body.retentativa.retentaveis.map((l) => l.numeroLinha)).toEqual([4]);
    expect(r.body.retentativa.bloqueadas.map((b) => b.numeroLinha)).toEqual([2, 3]);

    // ⚠⚠ UMA emissão, e é a do tomador da linha 4. Duas seriam duas notas duplicadas.
    expect(mockIssue).toHaveBeenCalledTimes(1);
    expect(mockIssue.mock.calls[0][0].data.tomador.nome).toBe("TOMADOR 4");
  });

  it("o lote do caso real — 3 recusadas, 0 emitidas — reemite as três", async () => {
    mockIssue.mockResolvedValue({ status: "issued", nfse: { id: "si-novo", rpsSerie: "00001", rpsNumero: "9" } });
    semear({ ...LOTE_BASE }, [
      linhaDoLote(2, "recusada_receita", { camada: "RECEITA", codigo: "E1235", serviceInvoiceId: "si-2" }),
      linhaDoLote(3, "recusada_receita", { camada: "RECEITA", codigo: "E1235", serviceInvoiceId: "si-3" }),
      linhaDoLote(4, "recusada_receita", { camada: "RECEITA", codigo: "E1235", serviceInvoiceId: "si-4" }),
    ]);

    const r = await request(app()).post(`${BASE}/emissao/lote-1/retentar`);
    await drenar();

    expect(r.status).toBe(202);
    expect(r.body.retentativa.quantas).toBe(3);
    expect(mockIssue).toHaveBeenCalledTimes(3);
    // ⚠ E o número anterior é OFERECIDO de volta — não existe inutilização na NFS-e.
    expect(mockIssue.mock.calls.map((c) => c[0].retryInvoiceId)).toEqual(["si-2", "si-3", "si-4"]);
  });

  it("⚠⚠ com a flag OFF a retentativa é recusada pelo SERVIDOR, e o portão nem é consultado", async () => {
    mockFlagLigada = false;
    semear({ ...LOTE_BASE }, [linhaDoLote(2, "recusada_receita")]);

    const r = await request(app()).post(`${BASE}/emissao/lote-1/retentar`);
    await drenar();

    expect(r.status).toBe(503);
    expect(r.body.error).toBe("emissao_lote_desligada");
    expect(mockGate).not.toHaveBeenCalled();
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("⚠ empresa não liberada não retenta NADA — o portão vale antes da primeira linha", async () => {
    mockGate.mockImplementation(async (_req, res) => {
      res.status(403).json({ error: "emissao_cliente_nao_liberada" });
      return { ok: false };
    });
    semear({ ...LOTE_BASE }, [linhaDoLote(2, "recusada_receita")]);

    const r = await request(app()).post(`${BASE}/emissao/lote-1/retentar`);
    await drenar();

    expect(r.status).toBe(403);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("retentar lote de outra empresa responde 404 e não emite nada", async () => {
    mockBancoLotes.set("lote-alheio", { id: "lote-alheio", companyId: "OUTRA-EMPRESA" });
    const r = await request(app()).post(`${BASE}/emissao/lote-alheio/retentar`);
    await drenar();
    expect(r.status).toBe(404);
    expect(mockIssue).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ o RECONHECIDO diz o que dá para fazer — e a data e hora chegam à tela", () => {
  it("a resposta do reconhecido traz o plano de retentativa", async () => {
    mockPrisma.loteEmissaoNfse.findFirst.mockResolvedValue({ ...LOTE_BASE });
    semear({ ...LOTE_BASE }, [
      linhaDoLote(2, "recusada_receita", { camada: "RECEITA", codigo: "E1235" }),
    ]);

    const r = await request(app())
      .post(`${BASE}/emissao`)
      .attach("arquivo", planilha([LINHA_OK]), "notas.xlsx");

    expect(r.status).toBe(200);
    expect(r.body.reconhecido).toBe(true);
    expect(r.body.retentativa.quantas).toBe(1);
    expect(mockIssue).not.toHaveBeenCalled();
  });

  it("⚠⚠ `tentadaEm` viaja por LINHA — desfecho sem carimbo é ambíguo assim que há 2ª tentativa", async () => {
    const quando = new Date("2026-08-21T14:41:00.000Z");
    semear({ ...LOTE_BASE }, [
      linhaDoLote(2, "recusada_receita", { tentadaEm: quando }),
      linhaDoLote(3, "nao_tentada"),
    ]);

    const r = await request(app()).get(`${BASE}/emissao/lote-1`);

    expect(r.status).toBe(200);
    expect(r.body.lote.linhas[0].tentadaEm).toBe(quando.toISOString());
    // ⚠ NULO na não tentada — ninguém encostou nela. A data do LOTE no lugar carimbaria de fato o
    // que nunca aconteceu.
    expect(r.body.lote.linhas[1].tentadaEm).toBeNull();
    expect(r.body.lote.criadoEm).toBe(LOTE_BASE.criadoEm.toISOString());
  });
});
