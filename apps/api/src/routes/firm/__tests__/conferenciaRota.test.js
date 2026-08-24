// AS ROTAS DA FILA DE CONFERÊNCIA.
//
// ⚠ A REGRA tem teste em `application/declarados/lib/__tests__/`; a ligação com o banco tem em
// `application/declarados/__tests__/`. O que se prende AQUI é a camada HTTP: que a data venha do
// CORPO e nunca do relógio, que cada recusa vire o status certo, que a rota literal não seja
// engolida pela de curinga, e que o piso de papel esteja onde deve.
//
// Um teste que repetisse a máquina de estados passaria com a rota quebrada.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: jest.fn((opcoes) => (req, res, next) => {
    req.__gate = opcoes || null; // ⚠ guarda o gate para o teste de papel poder olhá-lo
    req.auth = { user: { id: "u-1", role: "ACCOUNTANT" } };
    next();
  }),
}));

jest.mock("../../../application/declarados/DeclaradoService.js", () => {
  const real = jest.requireActual("../../../application/declarados/DeclaradoService.js");
  return {
    ...real,
    aplicarTransicao: jest.fn(async () => ({ id: "d-1", estado: "CONTABILIZADO", valor: 1500 })),
    listarFila: jest.fn(async () => ({ itens: [], total: 0, pagina: 1, porPagina: 50 })),
    varrerInvariantes: jest.fn(async () => ({ ok: true })),
  };
});

import express from "express";
import request from "supertest";
import { requireFirmCompanyAccess } from "../../../middlewares/requireFirmCompanyAccess.js";
import {
  DeclaradoRecusado,
  RECUSA_DO_SERVICO,
  aplicarTransicao,
  listarFila,
  varrerInvariantes,
} from "../../../application/declarados/DeclaradoService.js";
import { ESTADO, RECUSA, TRANSICAO } from "../../../application/declarados/lib/estadosDeclarado.js";
import { createConferenciaRouter } from "../conferencia.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeApp() {
  const app = express();
  app.use(express.json());
  const parent = express.Router();
  parent.use("/companies/:companyId", createConferenciaRouter({ log }));
  app.use("/firm", parent);
  return app;
}

const POST = (acao, body) => request(makeApp()).post(`/firm/companies/emp-1/conferencia/d-1/${acao}`).send(body);
const GET = (qs = "") => request(makeApp()).get(`/firm/companies/emp-1/conferencia${qs}`);

beforeEach(() => jest.clearAllMocks());

describe("⚠⚠ A DATA DO PAGAMENTO VEM DO CORPO, NUNCA DO RELÓGIO", () => {
  it("a data digitada chega ao serviço como meia-noite UTC daquele dia", async () => {
    await POST("confirmar", { dataPagamento: "2026-07-15", origemPagamento: "DECLARADO_PELO_CONTADOR" });
    const args = aplicarTransicao.mock.calls[0][0];
    expect(args.dados.dataPagamento.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(args.dados.origemPagamento).toBe("DECLARADO_PELO_CONTADOR");
  });

  it("⚠⚠ corpo SEM data não vira 'hoje' — o campo nem viaja, e a regra recusa", async () => {
    await POST("confirmar", {});
    expect(aplicarTransicao.mock.calls[0][0].dados).not.toHaveProperty("dataPagamento");
  });

  it("⚠⚠ `agora` é AUDITORIA e NÃO é a data do pagamento", async () => {
    await POST("confirmar", { dataPagamento: "2026-07-15", origemPagamento: "OFX" });
    const args = aplicarTransicao.mock.calls[0][0];
    expect(args.agora).toBeInstanceOf(Date);
    expect(args.agora).not.toBe(args.dados.dataPagamento);
    expect(args.agora.toISOString()).not.toBe("2026-07-15T00:00:00.000Z");
  });

  it("⚠⚠ data em formato americano NÃO é aceita — viraria dia trocado por mês", async () => {
    await POST("confirmar", { dataPagamento: "07/15/2026", origemPagamento: "OFX" });
    expect(aplicarTransicao.mock.calls[0][0].dados.dataPagamento).toBeNull();
  });

  it("⚠ dia que não existe também vira null, e a regra recusa", async () => {
    await POST("confirmar", { dataPagamento: "2026-02-31", origemPagamento: "OFX" });
    expect(aplicarTransicao.mock.calls[0][0].dados.dataPagamento).toBeNull();
  });

  it("⚠ `origemPagamento` NÃO tem padrão — prova e declaração não se confundem por omissão", async () => {
    await POST("confirmar", { dataPagamento: "2026-07-15" });
    expect(aplicarTransicao.mock.calls[0][0].dados.origemPagamento).toBeNull();
  });
});

describe("cada ato chama a transição certa", () => {
  const casos = [
    ["informar-pagamento", TRANSICAO.INFORMAR_PAGAMENTO],
    ["confirmar", TRANSICAO.CONFIRMAR],
    ["ajustar", TRANSICAO.AJUSTAR],
    ["recusar", TRANSICAO.RECUSAR],
    ["reabrir", TRANSICAO.REABRIR],
    ["desfazer", TRANSICAO.DESFAZER],
  ];

  it.each(casos)("POST /%s → %s", async (acao, transicao) => {
    await POST(acao, { motivo: "x", valorAjustado: 10 });
    expect(aplicarTransicao.mock.calls[0][0].transicao).toBe(transicao);
  });

  it("⚠ o escopo da EMPRESA e o id vêm do PATH, nunca do corpo", async () => {
    await POST("recusar", { motivo: "x", portalClientId: "emp-INVASORA", declaradoId: "d-OUTRO" });
    const args = aplicarTransicao.mock.calls[0][0];
    expect(args.portalClientId).toBe("emp-1");
    expect(args.declaradoId).toBe("d-1");
  });

  it("recusar aceita `motivo` (o nome que a tela usa) e `motivoRecusa`", async () => {
    await POST("recusar", { motivo: "despesa do sócio" });
    expect(aplicarTransicao.mock.calls[0][0].dados.motivoRecusa).toBe("despesa do sócio");
    jest.clearAllMocks();
    await POST("recusar", { motivoRecusa: "outro" });
    expect(aplicarTransicao.mock.calls[0][0].dados.motivoRecusa).toBe("outro");
  });

  it("quem decidiu vai junto", async () => {
    await POST("confirmar", {});
    expect(aplicarTransicao.mock.calls[0][0].usuarioId).toBe("u-1");
  });
});

describe("⚠ as recusas viram HTTP com significado", () => {
  const comRecusa = (codigo, frase = "porque sim") => {
    aplicarTransicao.mockRejectedValueOnce(new DeclaradoRecusado(codigo, frase));
  };

  it("não encontrado → 404", async () => {
    comRecusa(RECUSA_DO_SERVICO.NAO_ENCONTRADO);
    const r = await POST("confirmar", {});
    expect(r.status).toBe(404);
    expect(r.body.error).toBe(RECUSA_DO_SERVICO.NAO_ENCONTRADO);
  });

  it("⚠ mês fechado → 409, e não 400: é conflito de estado, e tem conserto", async () => {
    comRecusa(RECUSA_DO_SERVICO.MES_FECHADO, "reabra o mês");
    const r = await POST("confirmar", {});
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/reabra/i);
  });

  it("⚠⚠ a invariante do caixa → 400 COM A FRASE, não um 'erro' mudo", async () => {
    comRecusa(RECUSA.SEM_DATA_DE_PAGAMENTO, "Informe a data em que o dinheiro saiu da conta.");
    const r = await POST("confirmar", {});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(RECUSA.SEM_DATA_DE_PAGAMENTO);
    expect(r.body.message).toMatch(/dinheiro saiu/i);
  });

  it("⚠ falha inesperada vira 500 NOMEADO — a aba não pode quebrar calada", async () => {
    aplicarTransicao.mockRejectedValueOnce(new Error("banco fora"));
    const r = await POST("confirmar", {});
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("conferencia_falhou");
    // ⚠ E a mensagem interna NÃO vaza para a tela.
    expect(JSON.stringify(r.body)).not.toMatch(/banco fora/);
  });
});

describe("a fila", () => {
  it("⚠ sem filtro mostra só o que ESPERA alguém", async () => {
    await GET();
    expect(listarFila.mock.calls[0][0].estados).toEqual([ESTADO.AGUARDANDO_PAGAMENTO, ESTADO.A_CONFERIR]);
  });

  it("o filtro explícito alcança os resolvidos", async () => {
    await GET("?estado=CONTABILIZADO,RECUSADO");
    expect(listarFila.mock.calls[0][0].estados).toEqual(["CONTABILIZADO", "RECUSADO"]);
  });

  it("competência mal formada recusa ANTES de consultar", async () => {
    const r = await GET("?competencia=07-2026");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("competencia_invalida");
    expect(listarFila).not.toHaveBeenCalled();
  });

  it("⚠⚠ as datas saem como DIA, nunca como instante — senão o fuso do navegador as move", async () => {
    listarFila.mockResolvedValueOnce({
      total: 1, pagina: 1, porPagina: 50,
      itens: [{
        id: "d-1", estado: ESTADO.AGUARDANDO_PAGAMENTO, valor: 1500, valorAjustado: null,
        dataDocumento: new Date("2026-07-02T00:00:00.000Z"), dataPagamento: null,
        descricaoOriginal: "KODA BEAR", origemPagamento: null,
      }],
    });
    const r = await GET();
    expect(r.body.itens[0].dataDocumento).toBe("2026-07-02");
    expect(r.body.itens[0].dataPagamento).toBeNull();
  });

  it("⚠ a PROCEDÊNCIA da data vai para a tela — é o que separa prova de declaração", async () => {
    listarFila.mockResolvedValueOnce({
      total: 1, pagina: 1, porPagina: 50,
      itens: [{ id: "d-1", estado: ESTADO.A_CONFERIR, dataPagamento: new Date("2026-07-15T00:00:00.000Z"),
        origemPagamento: "DECLARADO_PELO_CONTADOR", descricaoOriginal: "x", valor: 1 }],
    });
    const r = await GET();
    expect(r.body.itens[0].origemPagamento).toBe("DECLARADO_PELO_CONTADOR");
  });

  it("⚠ Decimal vira TEXTO — mandá-lo como número perderia centavo em valor grande", async () => {
    listarFila.mockResolvedValueOnce({
      total: 1, pagina: 1, porPagina: 50,
      itens: [{ id: "d-1", estado: ESTADO.A_CONFERIR, valor: { toString: () => "1500.00" },
        descricaoOriginal: "x", dataPagamento: null }],
    });
    const r = await GET();
    expect(r.body.itens[0].valor).toBe("1500.00");
  });
});

describe("⚠ a rota literal vem antes da de curinga", () => {
  it("/conferencia/varredura NÃO é lido como um declaradoId", async () => {
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/varredura");
    expect(r.status).toBe(200);
    expect(varrerInvariantes).toHaveBeenCalledWith({ portalClientId: "emp-1" });
  });
});

describe("⚠ o piso de papel", () => {
  it("ESCREVER exige ACCOUNTANT — confirmar cria lançamento contábil", async () => {
    await POST("confirmar", {});
    const pisos = requireFirmCompanyAccess.mock.calls.map(([o]) => o?.minRole);
    expect(pisos).toContain("ACCOUNTANT");
  });

  it("⚠ LER a fila não exige — conferir o que está pendente é leitura", async () => {
    jest.clearAllMocks();
    makeApp();
    // A fábrica registra os gates na montagem: as duas leituras entram sem `minRole`.
    const semPiso = requireFirmCompanyAccess.mock.calls.filter(([o]) => !o?.minRole);
    expect(semPiso.length).toBe(2);
  });
});

describe("⚠⚠ a rota NÃO reimplementa regra", () => {
  it("não importa a máquina de estados para decidir nada — só para nomear a transição", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "conferencia.js"), "utf8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    // Nenhuma decisão de estado escrita à mão aqui.
    expect(fonte).not.toMatch(/podeTransitar/);
    expect(fonte).not.toMatch(/montarLancamento/);
    expect(fonte).not.toMatch(/accountingEntry\./);
    // ⚠ E nenhum `new Date()` fora do carimbo de auditoria: um segundo relógio aqui viraria data
    // de pagamento em algum caminho.
    expect((fonte.match(/new Date\(\s*\)/g) || []).length).toBe(1);
  });
});
