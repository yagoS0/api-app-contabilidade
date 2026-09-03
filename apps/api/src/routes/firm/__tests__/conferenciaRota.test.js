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

jest.mock("../../../application/declarados/VarreduraDeNotasService.js", () => ({
  lerVarreduraAutomatica: jest.fn(async () => ({ ligada: false, config: null, indisponivel: false })),
  ligarVarreduraAutomatica: jest.fn(async () => ({ portalClientId: "emp-1" })),
  desligarVarreduraAutomatica: jest.fn(async () => ({ desligadas: 1 })),
  varrerNotasDaEmpresa: jest.fn(async () => ({
    varridas: 82, criados: 8, jaExistiam: 0,
    fora: [{ motivo: "cancelada", frase: "A nota está cancelada.", n: 31, exemplos: ["pi-9"] }],
    recusados: [],
  })),
}));

/**
 * ⚠⚠ A AUTO-ATIVAÇÃO DE SÉRIES PRECISA DE DUBLÊ, e sem ele esta suíte ESTOURA O TIMEOUT.
 *
 * `POST /conferencia/varrer-notas` não termina na varredura: ela chama `listarSeries` (o detector,
 * que consulta o banco) e `autoAtivarSeriesEstaveis`. Sem banco alcançável, o Prisma fica tentando
 * conectar e os quatro casos desta rota morrem em "Exceeded timeout of 5000 ms" — não por regra
 * nenhuma, por espera.
 *
 * ⚠ O `try/catch` da rota NÃO salva: ele pega exceção, e o que acontece aqui é uma promessa que
 * demora. Falha por lentidão não vira `autoAtivadas: null` a tempo.
 *
 * ⚠ O que estes quatro casos medem é a DATA-PISO e o relatório da varredura. Deixar a recorrência
 * bater no banco real fazia eles medirem a conexão.
 */
jest.mock("../../../application/fluxo/SerieRecorrenteService.js", () => ({
  // ⚠ `requireActual` + sobrescrita das DUAS que tocam o banco: o módulo exporta vocabulário que a
  // rota também usa (`ESTADO_DA_SERIE`), e uma fábrica que só devolvesse as duas deixaria o resto
  // `undefined` — trocando um timeout por um `TypeError`.
  ...jest.requireActual("../../../application/fluxo/SerieRecorrenteService.js"),
  listarSeries: jest.fn(async () => ({ series: [], foraDoAlcance: [], indisponivel: false })),
  autoAtivarSeriesEstaveis: jest.fn(async () => ({ ativadas: 0, series: [] })),
}));

/**
 * ⚠⚠ E O LANÇAMENTO POR REGRA PRECISA DO MESMO DUBLÊ — pelo MESMO motivo, descoberto depois
 * (01/09/2026). A varredura ganhou um terceiro passo em 29/08 (`lancarPorRegraNaEmpresa`), e ele
 * entrou SEM dublê: os casos da data-piso voltaram a morrer em "Exceeded timeout of 5000 ms",
 * medindo a conexão com o banco em vez da rota.
 *
 * ⚠ Os casos que espionam esta função (`jest.spyOn(porRegra, …)`, mais abaixo) continuam valendo:
 * a fábrica devolve um objeto comum, e o `spyOn` deles sobrescreve o dublê caso a caso.
 */
jest.mock("../../../application/declarados/LancamentoPorRegraService.js", () => ({
  ...jest.requireActual("../../../application/declarados/LancamentoPorRegraService.js"),
  lancarPorRegraNaEmpresa: jest.fn(async () => ({ lancados: 0, linhas: [] })),
}));

/**
 * ⚠ A classificação por IA (02/09/2026) também precisa de dublê: o serviço real importa o SDK da
 * Anthropic e lê a fila no banco. O que se mede aqui é a CAMADA HTTP — a flag virando 503 nomeado,
 * o relatório voltando inteiro, a competência saindo do query e o piso de papel.
 */
jest.mock("../../../application/declarados/ClassificacaoPorIaService.js", () => ({
  RECUSA_CLASSIFICACAO: { DESLIGADA: "ia_classificacao_desligada" },
  classificarFila: jest.fn(async () => ({ ok: false, recusa: "ia_classificacao_desligada" })),
}));

jest.mock("../../../application/declarados/DeclaradoService.js", () => {
  const real = jest.requireActual("../../../application/declarados/DeclaradoService.js");
  return {
    ...real,
    aplicarTransicao: jest.fn(async () => ({ id: "d-1", estado: "CONTABILIZADO", valor: 1500 })),
    sugestoesDePagamento: jest.fn(async () => ({ linhas: [], totalDebitos: 0, totalNotas: 0 })),
    fundirPagamentoNaNota: jest.fn(async () => ({ id: "n-1", estado: "A_CONFERIR" })),
    absorverDebitoJaContabilizado: jest.fn(async () => ({
      debito: { id: "ofx-1", estado: "FUNDIDO", parDeclaradoId: "n-1" },
      nota: { id: "n-1", estado: "CONTABILIZADO" },
      divergencia: { diverge: true, dias: 7, dataDoLancamento: new Date("2026-07-15T00:00:00.000Z"), dataDoExtrato: new Date("2026-07-22T00:00:00.000Z") },
    })),
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
import { varrerNotasDaEmpresa } from "../../../application/declarados/VarreduraDeNotasService.js";
import { ESTADO, RECUSA, TRANSICAO } from "../../../application/declarados/lib/estadosDeclarado.js";
import { createConferenciaRouter } from "../conferencia.js";
import { prisma } from "../../../infrastructure/db/prisma.js";

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

  it("⚠⚠ SÓ EXISTEM DOIS PISOS: nenhum (leitura) e ACCOUNTANT (escrita)", async () => {
    // ⚠ A asserção é sobre o USO, não sobre a CONTAGEM: contar rotas quebra a cada rota nova e
    // ensina a subir o número em vez de olhar o que foi acrescentado. O que importa é que ninguém
    // introduza um terceiro piso (`STAFF`, `ADMIN`) sem que este teste caia.
    jest.clearAllMocks();
    makeApp();
    const pisos = new Set(requireFirmCompanyAccess.mock.calls.map(([o]) => o?.minRole ?? null));
    expect([...pisos].sort()).toEqual([null, "ACCOUNTANT"].sort());
  });

  it("⚠ e as DUAS espécies existem — leitura sem piso, escrita com ACCOUNTANT", async () => {
    jest.clearAllMocks();
    makeApp();
    const calls = requireFirmCompanyAccess.mock.calls;
    expect(calls.some(([o]) => !o?.minRole)).toBe(true);
    expect(calls.some(([o]) => o?.minRole === "ACCOUNTANT")).toBe(true);
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
    // ⚠⚠ TODO `new Date()` desta rota tem de ser o carimbo de AUDITORIA (`agora:`). Um relógio
    // lido em qualquer outro lugar aqui viraria data de PAGAMENTO em algum caminho — e o
    // lançamento credita o caixa, então isso afirmaria uma saída de dinheiro que não houve.
    //
    // ⚠ A asserção é sobre o USO, não sobre a CONTAGEM: contar quebra a cada rota nova e ensina a
    // subir o número em vez de olhar o que foi acrescentado.
    const relogios = fonte.split(/\r?\n/).filter((l) => /new Date\(\s*\)/.test(l));
    expect(relogios.length).toBeGreaterThan(0);
    for (const l of relogios) expect(l).toMatch(/agora:\s*new Date\(\s*\)/);
  });
});

describe("⚠⚠ POST /conferencia/varrer-notas — a data-piso é OBRIGATÓRIA", () => {
  const VARRER = (qs = "") => request(makeApp()).post(`/firm/companies/emp-1/conferencia/varrer-notas${qs}`);

  it("⚠⚠ sem `desde`, RECUSA — e a mensagem diz por quê", async () => {
    // São 1.897 NFS-e recebidas na base. Sem piso, a primeira varredura produz a base inteira de
    // uma vez, e isso não é fila, é muro. Um default faria o SISTEMA escolher o tamanho do
    // trabalho que o contador vai encontrar na tela.
    const r = await VARRER();
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("data_piso_obrigatoria");
    expect(r.body.message).toMatch(/toda a base/i);
    expect(varrerNotasDaEmpresa).not.toHaveBeenCalled();
  });

  it("⚠ data mal formada recusa com código PRÓPRIO — conserto diferente do de ausência", async () => {
    const r = await VARRER("?desde=07/2026");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("data_piso_invalida");
    expect(varrerNotasDaEmpresa).not.toHaveBeenCalled();
  });

  it("com a data, varre — e o piso chega como meia-noite UTC", async () => {
    const r = await VARRER("?desde=2026-07-01");
    expect(r.status).toBe(200);
    const args = varrerNotasDaEmpresa.mock.calls[0][0];
    expect(args.portalClientId).toBe("emp-1");
    expect(args.dataPiso.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(args.criadoPor).toBe("u-1");
  });

  it("⚠⚠ o relatório INTEIRO volta — o que ficou de fora não some", async () => {
    const r = await VARRER("?desde=2026-07-01");
    expect(r.body).toMatchObject({ varridas: 82, criados: 8, jaExistiam: 0 });
    expect(r.body.fora[0]).toMatchObject({ motivo: "cancelada", n: 31 });
    expect(r.body.desde).toBe("2026-07-01");
  });

  it("aceita a data no corpo também", async () => {
    await VARRER().send({ desde: "2026-07-01" });
    expect(varrerNotasDaEmpresa.mock.calls[0][0].dataPiso.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("⚠ escrever exige ACCOUNTANT — a varredura cria linhas na fila", async () => {
    await VARRER("?desde=2026-07-01");
    const chamadaDaVarredura = requireFirmCompanyAccess.mock.calls.filter(([o]) => o?.minRole === "ACCOUNTANT");
    expect(chamadaDaVarredura.length).toBeGreaterThan(0);
  });

  it("⚠ falha vira 500 nomeado, e a mensagem interna não vaza", async () => {
    varrerNotasDaEmpresa.mockRejectedValueOnce(new Error("banco fora"));
    const r = await VARRER("?desde=2026-07-01");
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("conferencia_falhou");
    expect(JSON.stringify(r.body)).not.toMatch(/banco fora/);
  });
});

describe("⚠⚠ o que a REVISÃO DA TELA apontou como faltando", () => {
  const { COMPETENCIA_AUSENTE } = require("../../../application/declarados/DeclaradoService.js");

  const comFila = (item) =>
    listarFila.mockResolvedValueOnce({
      total: 1,
      porEstado: { AGUARDANDO_PAGAMENTO: 229, A_CONFERIR: 12, CONTABILIZADO: 3, RECUSADO: 1, FUNDIDO: 0 },
      pagina: 1,
      porPagina: 50,
      itens: [{ id: "d-1", estado: ESTADO.A_CONFERIR, valor: 1500, descricaoOriginal: "KODA BEAR", ...item }],
    });

  it("⚠ o RESUMO POR ESTADO chega à tela — é ele que diz quanto trabalho existe", async () => {
    comFila({});
    const r = await GET();
    expect(r.body.porEstado).toMatchObject({ AGUARDANDO_PAGAMENTO: 229, A_CONFERIR: 12, FUNDIDO: 0 });
  });

  it("⚠⚠ `mesFechado` viaja — o botão desabilita ANTES do clique, não depois do 409", async () => {
    comFila({ mesFechado: true });
    expect((await GET()).body.itens[0].mesFechado).toBe(true);
  });

  it("⚠ e é sempre booleano, nunca `undefined`", async () => {
    comFila({});
    expect((await GET()).body.itens[0].mesFechado).toBe(false);
  });

  it("⚠ o NÚMERO DA NOTA chega — é por ele que o contador acha o documento", async () => {
    comFila({ notaRecebida: { numero: "1234", serie: "00001", chaveAcesso: "ch", type: "NFSE" } });
    expect((await GET()).body.itens[0].nota).toEqual({
      numero: "1234", serie: "00001", chaveAcesso: "ch", tipo: "NFSE",
    });
  });

  it("⚠ nota apagada (FK SetNull) vira `nota: null`, e a tela desabilita o link com o motivo", async () => {
    comFila({ notaRecebida: null });
    expect((await GET()).body.itens[0].nota).toBeNull();
  });

  it("⚠⚠ o recorte `sem-competencia` é ACEITO — sem ele a nota sem competência some para sempre", async () => {
    const r = await GET(`?competencia=${COMPETENCIA_AUSENTE}`);
    expect(r.status).toBe(200);
    expect(listarFila.mock.calls[0][0].competencia).toBe(COMPETENCIA_AUSENTE);
  });

  it("⚠ e a recusa de competência torta NOMEIA o recorte, para ele ser descobrível", async () => {
    const r = await GET("?competencia=07-2026");
    expect(r.status).toBe(400);
    expect(r.body.message).toContain(COMPETENCIA_AUSENTE);
  });
});

describe("⚠⚠ O CASAMENTO DÉBITO × NOTA — as rotas", () => {
  const {
    sugestoesDePagamento,
    fundirPagamentoNaNota,
    absorverDebitoJaContabilizado,
  } = require("../../../application/declarados/DeclaradoService.js");

  const CASAMENTOS = () => request(makeApp()).get("/firm/companies/emp-1/conferencia/casamentos");
  const FUNDIR = (body) => request(makeApp()).post("/firm/companies/emp-1/conferencia/casamentos/fundir").send(body);
  const ABSORVER = (body) => request(makeApp()).post("/firm/companies/emp-1/conferencia/casamentos/absorver").send(body);

  const debitoSerializavel = { id: "ofx-1", estado: ESTADO.A_CONFERIR, valor: 1500, descricaoOriginal: "PAGTO GOOGLE" };
  const notaSerializavel = { id: "n-1", estado: ESTADO.AGUARDANDO_PAGAMENTO, valor: 1500, descricaoOriginal: "GOOGLE CLOUD" };

  it("⚠ rota LITERAL — `/casamentos` não é lido como um `declaradoId`", async () => {
    sugestoesDePagamento.mockResolvedValueOnce({ linhas: [], totalDebitos: 0, totalNotas: 0 });
    const r = await CASAMENTOS();
    expect(r.status).toBe(200);
    expect(sugestoesDePagamento).toHaveBeenCalledWith({ portalClientId: "emp-1" });
  });

  it("um candidato vira SUGESTÃO, com a pista", async () => {
    sugestoesDePagamento.mockResolvedValueOnce({
      totalDebitos: 1,
      totalNotas: 1,
      linhas: [{
        debito: debitoSerializavel,
        sugestao: { nota: notaSerializavel, pista: "NOME_NO_MEMO", frase: "O nome do fornecedor aparece na descrição do banco." },
        candidatos: [{ nota: notaSerializavel, pista: "NOME_NO_MEMO", frase: "x" }],
        motivo: null,
        frase: "",
      }],
    });
    const r = await CASAMENTOS();
    expect(r.body.linhas[0].sugestao.nota.id).toBe("n-1");
    expect(r.body.linhas[0].sugestao.pista).toBe("NOME_NO_MEMO");
  });

  it("⚠⚠ AMBÍGUO: `sugestao` NULA e os candidatos visíveis, com o motivo", async () => {
    sugestoesDePagamento.mockResolvedValueOnce({
      totalDebitos: 1,
      totalNotas: 2,
      linhas: [{
        debito: debitoSerializavel,
        sugestao: null,
        candidatos: [{ nota: notaSerializavel, pista: "NOME_NO_MEMO", frase: "x" }, { nota: { ...notaSerializavel, id: "n-2" }, pista: "NOME_NO_MEMO", frase: "x" }],
        motivo: "ambiguo",
        frase: "Mais de uma nota se parece com este débito. O sistema não escolhe entre elas — confira qual é a certa.",
      }],
    });
    const r = await CASAMENTOS();
    expect(r.body.linhas[0].sugestao).toBeNull();
    expect(r.body.linhas[0].candidatos).toHaveLength(2);
    expect(r.body.linhas[0].frase).toMatch(/não escolhe/i);
  });

  it("fundir manda os DOIS ids, escopados pelo PATH", async () => {
    fundirPagamentoNaNota.mockResolvedValueOnce(notaSerializavel);
    await FUNDIR({ declaradoOfxId: "ofx-1", declaradoNotaId: "n-1", portalClientId: "emp-INVASORA" });
    const args = fundirPagamentoNaNota.mock.calls[0][0];
    expect(args).toMatchObject({ portalClientId: "emp-1", declaradoOfxId: "ofx-1", declaradoNotaId: "n-1", usuarioId: "u-1" });
  });

  it("⚠ par incompleto recusa ANTES de tocar no serviço", async () => {
    const r = await FUNDIR({ declaradoOfxId: "ofx-1" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("par_incompleto");
    expect(fundirPagamentoNaNota).not.toHaveBeenCalled();
  });

  it("⚠⚠ a recusa de casamento envelhecido chega à tela COM o conserto", async () => {
    fundirPagamentoNaNota.mockRejectedValueOnce(
      new DeclaradoRecusado("casamento_nao_confere", "Este débito não confere mais com esta nota. Algo mudou — recarregue e confira."),
    );
    const r = await FUNDIR({ declaradoOfxId: "ofx-1", declaradoNotaId: "n-1" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/recarregue/i);
  });

  // ⚠⚠ ABSORVER — o quarto verbo (01/09/2026). A rota é irmã da de fundir, e o que a distingue
  // está na RESPOSTA: a nota volta inteira (prova de que não foi tocada) e a divergência de datas
  // viaja junto, porque absorver não corrige o razão.
  it("⚠⚠ absorver manda os DOIS ids, escopados pelo PATH", async () => {
    await ABSORVER({ declaradoOfxId: "ofx-1", declaradoNotaId: "n-1", portalClientId: "emp-INVASORA" });
    const args = absorverDebitoJaContabilizado.mock.calls[0][0];
    expect(args).toMatchObject({ portalClientId: "emp-1", declaradoOfxId: "ofx-1", declaradoNotaId: "n-1", usuarioId: "u-1" });
  });

  it("⚠⚠⚠ a DIVERGÊNCIA DE DATAS sai na resposta — decisão do dono: «absorve e AVISA»", async () => {
    // ⚠ Campo fora do serializador some sem erro nenhum, e é justamente o aviso que sumiria: a tela
    // mostraria o débito desaparecer e ninguém saberia que o razão está com outra data.
    const r = await ABSORVER({ declaradoOfxId: "ofx-1", declaradoNotaId: "n-1" });
    expect(r.status).toBe(200);
    expect(r.body.divergencia).toEqual({
      diverge: true, dias: 7, dataDoLancamento: "2026-07-15", dataDoExtrato: "2026-07-22",
    });
    // ⚠ Datas como DIA, nunca ISO completa — a mesma regra de `serializar`.
    expect(r.body.divergencia.dataDoExtrato).not.toMatch(/T/);
  });

  it("⚠⚠ a NOTA volta na resposta, e é a prova de que ela não foi tocada", async () => {
    const r = await ABSORVER({ declaradoOfxId: "ofx-1", declaradoNotaId: "n-1" });
    expect(r.body.nota).toMatchObject({ id: "n-1", estado: "CONTABILIZADO" });
    expect(r.body.declarado).toMatchObject({ id: "ofx-1", estado: "FUNDIDO" });
  });

  it("⚠ par incompleto recusa ANTES de tocar no serviço", async () => {
    const r = await ABSORVER({ declaradoNotaId: "n-1" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("par_incompleto");
    expect(absorverDebitoJaContabilizado).not.toHaveBeenCalled();
  });

  it("⚠⚠ a recusa «esta nota não está lançada» chega à tela — o conserto é usar o outro verbo", async () => {
    absorverDebitoJaContabilizado.mockRejectedValueOnce(
      new DeclaradoRecusado("nota_nao_esta_lancada", "Esta nota ainda não virou lançamento — o ato aqui é casar, não absorver."),
    );
    const r = await ABSORVER({ declaradoOfxId: "ofx-1", declaradoNotaId: "n-1" });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/casar/i);
  });

  it("⚠ escrever exige ACCOUNTANT — absorver tira um débito da fila", async () => {
    jest.clearAllMocks();
    await ABSORVER({ declaradoOfxId: "ofx-1", declaradoNotaId: "n-1" });
    const comPiso = requireFirmCompanyAccess.mock.calls.filter(([o]) => o?.minRole === "ACCOUNTANT");
    expect(comPiso.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A CONTAGEM DE PENDÊNCIAS — o número do BOTÃO que substituiu a aba (29/08/2026).
//
// > Dono: *"essa aba deve estar dentro dos lançamentos, como um botão com aviso quando há
// > conferência a ser feita, como notas recebidas"*.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ GET /conferencia/pendencias soma AS TRÊS filas", () => {
  const contarCom = ({ declarados = 0, series = 0, saidas = 0, semSaidas = false } = {}) => {
    prisma.lancamentoDeclarado = { count: jest.fn(async () => declarados) };
    prisma.serieRecorrente = { count: jest.fn(async () => series) };
    prisma.saidaAvulsaCliente = semSaidas ? {} : { count: jest.fn(async () => saidas) };
  };

  it("o total é a soma, e cada fila volta separada", async () => {
    contarCom({ declarados: 3, series: 2, saidas: 4 });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, total: 9, declarados: 3, series: 2, saidas: 4 });
  });

  it("⚠⚠ `aLancar` é SÓ o que vira lançamento; o fluxo vai separado (01/09/2026)", async () => {
    // > Dono: *"tudo que virar lançamento deve entrar no fluxo, mas nem tudo do fluxo
    // > necessariamente deve ser um lançamento"*.
    //
    // O botão se chama "A lançar" e mostrava `total`, que soma as três — sendo que recorrências e
    // saídas do cliente NUNCA viram lançamento. O número prometia trabalho que não existia.
    contarCom({ declarados: 3, series: 2, saidas: 4 });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(r.body.aLancar).toBe(3);
    expect(r.body.noFluxo).toBe(6);
  });

  it("⚠ e `total` FICA — ele responde «quanto há para decidir nesta tela?»", async () => {
    // Tirá-lo esconderia o que o cliente digitou, que é o que a soma das três existia para mostrar.
    contarCom({ declarados: 3, series: 2, saidas: 4 });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(r.body.total).toBe(9);
  });

  it("⚠⚠ contar só os DECLARADOS faria o contador nunca ver o que o cliente digitou", async () => {
    // É o defeito que esta rota existe para não cometer: o pedido do dono é justamente sobre o que
    // o CLIENTE escreve chegar até ele.
    contarCom({ declarados: 0, series: 0, saidas: 5 });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(r.body.total).toBe(5);
  });

  it("⚠⚠ com `?competencia=`, devolve o RECORTE e quantos ficaram FORA dele", async () => {
    // > Dono, sobre a ALBATROZ em produção: *"aparecem 19 a lançar mas ao abrir não aparece isso
    // > tudo"*. O selo conta a fila em qualquer mês; a TELA abre filtrada. Os dois estão certos, e
    // a diferença é o que se lia como despesa perdida.
    prisma.serieRecorrente = { count: jest.fn(async () => 0) };
    prisma.saidaAvulsaCliente = { count: jest.fn(async () => 0) };
    prisma.lancamentoDeclarado = {
      // ⚠ O SEGUNDO `count` é o do recorte — ele é o único que leva `competencia` no `where`.
      count: jest.fn(async (args) => (args?.where?.competencia === undefined ? 19 : 6)),
    };
    const r = await request(makeApp())
      .get("/firm/companies/emp-1/conferencia/pendencias?competencia=2026-07");
    expect(r.status).toBe(200);
    expect(r.body.declarados).toBe(19);
    expect(r.body.declaradosNaCompetencia).toBe(6);
    expect(r.body.declaradosForaDaCompetencia).toBe(13);
  });

  it("⚠⚠ SEM competência os dois campos vêm `null` — não pedi o recorte ≠ não há nenhum", async () => {
    // Desenhar as duas iguais faria a tela afirmar que o mês está limpo sem ter contado.
    contarCom({ declarados: 19 });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(r.body.declaradosNaCompetencia).toBeNull();
    expect(r.body.declaradosForaDaCompetencia).toBeNull();
  });

  it("⚠ `sem-competencia` é RECORTE, e vira `competencia: null` no banco", async () => {
    // `where.competencia = "2026-07"` não casa com NULL em SQL — sem este ramo, a nota que chegou
    // sem competência ficaria fora dos DOIS lados da conta.
    prisma.serieRecorrente = { count: jest.fn(async () => 0) };
    prisma.saidaAvulsaCliente = { count: jest.fn(async () => 0) };
    prisma.lancamentoDeclarado = { count: jest.fn(async () => 4) };
    await request(makeApp())
      .get("/firm/companies/emp-1/conferencia/pendencias?competencia=sem-competencia");
    const chamadas = prisma.lancamentoDeclarado.count.mock.calls.map((c) => c[0]?.where?.competencia);
    expect(chamadas).toContain(null);
  });

  it("⚠ competência malformada RECUSA nomeando — não vira filtro silencioso", async () => {
    contarCom({ declarados: 1 });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias?competencia=julho");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("competencia_invalida");
  });

  it("⚠⚠ é `count`, nunca a fila inteira — a barra de Lançamentos pede isto a cada abertura", async () => {
    contarCom({ declarados: 1 });
    await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(prisma.lancamentoDeclarado.count).toHaveBeenCalled();
    // ⚠ `listarFila` é a consulta CARA (ela pagina, serializa e traz o casamento). Chamá-la aqui
    // seria trazer a fila para medir o tamanho dela.
    expect(listarFila).not.toHaveBeenCalled();
  });

  it("⚠ o escopo por empresa vive no `where` das TRÊS", async () => {
    contarCom({ declarados: 1, series: 1, saidas: 1 });
    await request(makeApp()).get("/firm/companies/emp-9/conferencia/pendencias");
    for (const m of [prisma.lancamentoDeclarado, prisma.serieRecorrente, prisma.saidaAvulsaCliente]) {
      expect(m.count.mock.calls[0][0].where.portalClientId).toBe("emp-9");
    }
  });

  it("⚠⚠ TABELA AUSENTE devolve zero E SE DECLARA — a barra não pode quebrar por migration", async () => {
    // As migrations desta casa são ato do dono, então este estado é normal. Sem a guarda, uma
    // migration não aplicada tiraria do ar a aba mais usada do sistema.
    contarCom({ declarados: 3, series: 2, saidas: 1 });
    const p2021 = Object.assign(new Error("no table"), { code: "P2021" });
    prisma.serieRecorrente.count = jest.fn(async () => { throw p2021; });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(4);
    expect(r.body.series).toBe(0);
    // ⚠ "0 pendências" e "não consegui contar" são respostas diferentes.
    expect(r.body.indisponiveis).toContain("series");
  });

  it("⚠⚠ o DELEGATE ausente (o `prisma generate` que não rodou) também se declara", async () => {
    contarCom({ declarados: 2, semSaidas: true });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(r.body.indisponiveis).toContain("saidas");
  });

  it("⚠ nada pendente devolve zero SEM indisponíveis — as duas coisas não se confundem", async () => {
    contarCom({});
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(r.body.total).toBe(0);
    expect(r.body.indisponiveis).toEqual([]);
  });

  it("⚠⚠ a rota LITERAL não é engolida pela de curinga", async () => {
    // `/conferencia/:declaradoId/<transicao>` mora no mesmo router. Registrada depois, esta rota
    // responderia como se "pendencias" fosse um id.
    contarCom({ declarados: 7 });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(r.body.declarados).toBe(7);
  });

  it("⚠ LER a contagem não exige ACCOUNTANT — é leitura", async () => {
    contarCom({});
    await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    const gates = requireFirmCompanyAccess.mock.calls.map(([o]) => o?.minRole);
    // ⚠ A rota é montada junto das outras; o que se afirma é que existe pelo menos uma sem piso —
    // e que a de ESCRITA continua exigindo ACCOUNTANT (travado nos casos acima).
    expect(gates).toContain(undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A FILA DAS SAÍDAS DO CLIENTE — dentro da mesma tela (29/08/2026).
//
// > Dono: *"essas saídas que o cliente digitar aparecem para o contador na aba de conferência"*.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ as saídas do cliente na Conferência", () => {
  const saidaAvulsa = require("../../../application/fluxo/SaidaAvulsaService.js");

  it("a fila devolve a DATA CIVIL, nunca o ISO com hora", async () => {
    // O ISO deslocaria o dia no fuso de quem lê — e este é o dia que a PESSOA escolheu.
    jest.spyOn(saidaAvulsa, "listarSaidasPendentes").mockResolvedValue({
      indisponivel: false,
      saidas: [{
        id: "sa-1", data: new Date("2026-09-18T00:00:00.000Z"), valor: "3000.00",
        descricao: "Reforma da sala", estado: "PENDENTE", criadaEm: new Date("2026-08-29T12:00:00.000Z"),
      }],
    });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/saidas-do-cliente");
    expect(r.status).toBe(200);
    expect(r.body.saidas[0].data).toBe("2026-09-18");
    expect(r.body.saidas[0].descricao).toBe("Reforma da sala");
  });

  it("⚠⚠ tabela ausente devolve LISTA VAZIA + `indisponivel`, nunca 503", async () => {
    // Esta leitura convive com as outras na MESMA tela: derrubá-la tiraria do ar também o que o
    // declarado tem a dizer. É a assimetria deliberada de `listarSaidasPendentes`.
    jest.spyOn(saidaAvulsa, "listarSaidasPendentes").mockResolvedValue({ saidas: [], indisponivel: true });
    const r = await request(makeApp()).get("/firm/companies/emp-1/conferencia/saidas-do-cliente");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, indisponivel: true, saidas: [] });
  });

  it("decidir chama o serviço com o usuário e o estado normalizados", async () => {
    const decidir = jest.spyOn(saidaAvulsa, "decidirSaidaAvulsa")
      .mockResolvedValue({ id: "sa-1", estado: "CONFIRMADA" });
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/saidas-do-cliente/sa-1/decidir")
      .send({ estado: "confirmada" });
    expect(r.status).toBe(200);
    expect(decidir).toHaveBeenCalledWith(expect.objectContaining({
      portalClientId: "emp-1", saidaId: "sa-1", estado: "CONFIRMADA", usuarioId: "u-1",
    }));
  });

  it("⚠⚠ a recusa NOMEADA vira o status certo — não um 500 mudo", async () => {
    // Sem o ramo de `SaidaRecusada` no responder, `saida_ja_decidida` viraria "não foi possível
    // concluir": o defeito de engolir o motivo que a pessoa poderia entender.
    // ⚠ A FRASE é o segundo argumento — a classe não a deriva do código sozinha (quem faz isso é
    // o `recusar()` interno do serviço). Um teste que a omitisse mediria uma recusa sem mensagem,
    // que é justamente o que a tela não pode receber.
    const { SaidaRecusada, FRASE_DA_RECUSA_DA_SAIDA } = saidaAvulsa;
    jest.spyOn(saidaAvulsa, "decidirSaidaAvulsa")
      .mockRejectedValue(new SaidaRecusada("saida_ja_decidida", FRASE_DA_RECUSA_DA_SAIDA.saida_ja_decidida));
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/saidas-do-cliente/sa-1/decidir")
      .send({ estado: "CONFIRMADA" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("saida_ja_decidida");
    expect(r.body.message).toBeTruthy();
  });

  it("⚠ e a que não existe NESTA empresa é 404", async () => {
    const { SaidaRecusada, FRASE_DA_RECUSA_DA_SAIDA } = saidaAvulsa;
    jest.spyOn(saidaAvulsa, "decidirSaidaAvulsa")
      .mockRejectedValue(new SaidaRecusada("saida_nao_encontrada", FRASE_DA_RECUSA_DA_SAIDA.saida_nao_encontrada));
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/saidas-do-cliente/sa-9/decidir")
      .send({ estado: "CONFIRMADA" });
    expect(r.status).toBe(404);
  });

  it("⚠⚠ DECIDIR exige ACCOUNTANT; LER não — a varredura da FONTE", () => {
    // ⚠ O gate é criado na MONTAGEM do router, não por requisição: contar chamadas do middleware
    // mediria quantas rotas existem, não o piso de cada uma. O que separa as duas é a FONTE.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "conferencia.js"), "utf8");
    expect(fonte).toContain(
      'router.get("/conferencia/saidas-do-cliente", requireFirmCompanyAccess(),',
    );
    expect(fonte).toContain(
      'requireFirmCompanyAccess({ minRole: "ACCOUNTANT" })',
    );
    // ⚠ E a de DECIDIR é a que leva o piso: a linha inteira, não só a existência do trecho.
    const linhaDecidir = fonte
      .split(String.fromCharCode(10))
      .find((l) => l.includes("saidas-do-cliente/:saidaId/decidir"));
    expect(linhaDecidir).toContain('minRole: "ACCOUNTANT"');
  });
  it("⚠⚠ CONFIRMAR NÃO LANÇA NADA — a rota não toca em lançamento contábil", () => {
    // O que se confirma é uma PREVISÃO de caixa do cliente. Lançar continua sendo o caminho do
    // declarado, que exige `dataPagamento` porque afirma que o dinheiro saiu.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "conferencia.js"), "utf8")
      // ⚠ BLOCO antes de LINHA: um `//` dentro de um comentário de bloco apaga o `*/`.
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    const trecho = fonte.slice(
      fonte.indexOf("saidas-do-cliente/:saidaId/decidir"),
      fonte.indexOf("saidas-do-cliente/:saidaId/decidir") + 900,
    );
    expect(trecho).not.toMatch(/accountingEntry|AccountingEntry|lancamento/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A AUTO-ATIVAÇÃO DAS SÉRIES, na varredura (29/08/2026).
//
// > Dono: *"se a variação for = ou menor que 10%, pode ser lançado no fluxo automaticamente."*
//
// ⚠⚠ O lugar foi escolhido: `listarSeries` é o detector, e o eixo daquele módulo é *"observar não
// grava"*. A varredura é o passo em que o contador já mandou processar o que chegou.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ a varredura auto-ativa as séries estáveis", () => {
  const serieService = require("../../../application/fluxo/SerieRecorrenteService.js");

  it("ela roda depois da varredura e devolve quantas entraram", async () => {
    jest.spyOn(serieService, "listarSeries").mockResolvedValue({ series: [{ id: "s-1" }] });
    jest.spyOn(serieService, "autoAtivarSeriesEstaveis").mockResolvedValue({ ativadas: 2, series: [] });
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/varrer-notas?desde=2026-01-01");
    expect(r.status).toBe(200);
    expect(r.body.autoAtivadas).toBe(2);
    // ⚠ E o relatório da varredura continua inteiro: ela não substitui nada.
    expect(r.body.criados).toBe(8);
  });

  it("⚠⚠ falhar na recorrência NÃO derruba a varredura — as notas já viraram fila", async () => {
    // Perder essa resposta faria o contador varrer de novo, e o relatório de "criei 12" some.
    jest.spyOn(serieService, "listarSeries").mockRejectedValue(new Error("tabela fora"));
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/varrer-notas?desde=2026-01-01");
    expect(r.status).toBe(200);
    expect(r.body.criados).toBe(8);
    // ⚠⚠ `null` é "não sei" — nunca zero, que diria "olhei e nenhuma entrou".
    expect(r.body.autoAtivadas).toBeNull();
  });

  it("⚠ nenhuma estável ⇒ ZERO, que é diferente de `null`", async () => {
    jest.spyOn(serieService, "listarSeries").mockResolvedValue({ series: [] });
    jest.spyOn(serieService, "autoAtivarSeriesEstaveis").mockResolvedValue({ ativadas: 0, series: [] });
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/varrer-notas?desde=2026-01-01");
    expect(r.body.autoAtivadas).toBe(0);
  });

  it("⚠⚠ ela NÃO roda na LEITURA da fila — observar não grava", async () => {
    const auto = jest.spyOn(serieService, "autoAtivarSeriesEstaveis").mockResolvedValue({ ativadas: 0 });
    await request(makeApp()).get("/firm/companies/emp-1/conferencia");
    await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    expect(auto).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ A PORTA DA REGRA MANUAL (29/08/2026).
//
// > Dono: *"o contador deve poder colocar o código de débito e crédito nessa despesa."*
//
// ⚠⚠ A tabela já existia e SÓ NASCIA `APRENDIDA` — havia `GET` e o `PATCH` que liga/desliga, e
// nenhum `POST`. O que se prende aqui é a camada HTTP: o piso de papel, o corpo que chega ao
// serviço, e a recusa NOMEADA que não pode virar 500 mudo.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ POST /conferencia/regras", () => {
  const regraService = require("../../../application/declarados/RegraService.js");

  it("passa o corpo inteiro ao serviço, com o usuário e o relógio", async () => {
    const criar = jest.spyOn(regraService, "criarRegraManual")
      .mockResolvedValue({ id: "r-1", origemRegra: "MANUAL" });
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/regras")
      .send({
        cnpjFornecedor: "12345678000190",
        valorMin: 1000,
        valorMax: 1500,
        contaDestino: "411030012",
        contaCredito: "111010001",
      });
    expect(r.status).toBe(201);
    expect(r.body.regra).toEqual({ id: "r-1", origemRegra: "MANUAL" });
    const arg = criar.mock.calls[0][0];
    expect(arg).toMatchObject({
      portalClientId: "emp-1",
      cnpjFornecedor: "12345678000190",
      contaDestino: "411030012",
      contaCredito: "111010001",
      usuarioId: "u-1",
    });
    // ⚠ O relógio vem da ROTA — o serviço tem varredura de fonte contra `new Date()`.
    expect(arg.agora).toBeInstanceOf(Date);
  });

  it("⚠⚠ a recusa do crédito vira 400 NOMEADO — não um 500 mudo", async () => {
    // Sem o ramo de `RegraRecusada` no responder, o contador não saberia QUE conta trocar.
    const { RegraRecusada, FRASE_DA_RECUSA_DA_REGRA } = regraService;
    jest.spyOn(regraService, "criarRegraManual").mockRejectedValue(
      new RegraRecusada("credito_nao_e_disponibilidade", FRASE_DA_RECUSA_DA_REGRA.credito_nao_e_disponibilidade),
    );
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/regras")
      .send({ cnpjFornecedor: "1", valorMin: 1, valorMax: 2, contaDestino: "x", contaCredito: "y" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("credito_nao_e_disponibilidade");
    expect(r.body.message).toMatch(/disponibilidade/i);
  });

  it("⚠ sem a tabela é 503 — a migration é ato do dono", async () => {
    const { RegraRecusada, FRASE_DA_RECUSA_DA_REGRA } = regraService;
    jest.spyOn(regraService, "criarRegraManual").mockRejectedValue(
      new RegraRecusada("regras_indisponiveis", FRASE_DA_RECUSA_DA_REGRA.regras_indisponiveis),
    );
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/regras")
      .send({ cnpjFornecedor: "1", valorMin: 1, valorMax: 2, contaDestino: "x" });
    expect(r.status).toBe(503);
  });

  it("⚠⚠ ela exige ACCOUNTANT — escrever regra decide como a despesa será classificada daqui em diante", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "conferencia.js"), "utf8");
    const linha = fonte
      .split(String.fromCharCode(10))
      .find((l) => l.includes('router.post("/conferencia/regras"'));
    expect(linha).toContain('minRole: "ACCOUNTANT"');
  });

  it("⚠⚠ criar a regra NÃO LANÇA NADA — varredura da rota", () => {
    // Ela passa a existir para o motor consultar; o que lança tem outra trava, e nasce desligada.
    const fs = require("node:fs");
    const path = require("node:path");
    const fonte = fs.readFileSync(path.join(__dirname, "..", "conferencia.js"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ");
    const i = fonte.indexOf('router.post("/conferencia/regras"');
    expect(fonte.slice(i, i + 900)).not.toMatch(/accountingEntry|AccountingEntry/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O LANÇAMENTO POR REGRA — o CHAMADOR e o EXTRATO (29/08/2026).
//
// Até aqui `lancarPorRegra` existia e nenhum caminho de produção a invocava. O que estes testes
// protegem é o LIGAMENTO: que ele rode na varredura, que não a derrube, e que a rota de desfazer
// não seja engolida pela de curinga — `/conferencia/:declaradoId/desfazer` existe desde antes, e
// um `POST .../lancados-por-regra/desfazer` cairia nela com `declaradoId: "lancados-por-regra"`,
// sem erro nenhum.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ o lançamento por regra na varredura", () => {
  const porRegra = require("../../../application/declarados/LancamentoPorRegraService.js");
  const serieService = require("../../../application/fluxo/SerieRecorrenteService.js");

  beforeEach(() => {
    jest.spyOn(serieService, "listarSeries").mockResolvedValue({ series: [] });
    jest.spyOn(serieService, "autoAtivarSeriesEstaveis").mockResolvedValue({ ativadas: 0, series: [] });
  });

  const varrer = () => request(makeApp())
    .post("/firm/companies/emp-1/conferencia/varrer-notas?desde=2026-01-01");

  it("ele roda na varredura e o relatório volta junto", async () => {
    jest.spyOn(porRegra, "lancarPorRegraNaEmpresa")
      .mockResolvedValue({ lancados: 3, ids: ["a", "b", "c"], recusados: [] });
    const r = await varrer();

    expect(r.status).toBe(200);
    expect(r.body.lancadosPorRegra).toMatchObject({ lancados: 3 });
    // ⚠ E o relatório da varredura continua inteiro: ele não substitui nada.
    expect(r.body.criados).toBe(8);
  });

  it("⚠ a empresa do path é a que ele recebe — nunca o corpo", async () => {
    const espia = jest.spyOn(porRegra, "lancarPorRegraNaEmpresa")
      .mockResolvedValue({ lancados: 0, ids: [], recusados: [] });
    await varrer();
    expect(espia.mock.calls[0][0].portalClientId).toBe("emp-1");
  });

  it("⚠⚠ falhar NÃO derruba a varredura, e `null` é 'não sei' — nunca zero", async () => {
    jest.spyOn(porRegra, "lancarPorRegraNaEmpresa").mockRejectedValue(new Error("coluna fora"));
    const r = await varrer();

    expect(r.status).toBe(200);
    expect(r.body.criados).toBe(8);
    expect(r.body.lancadosPorRegra).toBeNull();
  });

  it("⚠⚠ ele NÃO roda na LEITURA da fila — observar não grava, e aqui o que se grava é o razão", async () => {
    const espia = jest.spyOn(porRegra, "lancarPorRegraNaEmpresa").mockResolvedValue({ lancados: 0 });
    await request(makeApp()).get("/firm/companies/emp-1/conferencia");
    await request(makeApp()).get("/firm/companies/emp-1/conferencia/pendencias");
    await request(makeApp()).get("/firm/companies/emp-1/conferencia/casamentos");
    expect(espia).not.toHaveBeenCalled();
  });
});

describe("⚠⚠ o EXTRATO de lançados por regra", () => {
  const porRegra = require("../../../application/declarados/LancamentoPorRegraService.js");

  it("devolve o extrato da competência pedida", async () => {
    jest.spyOn(porRegra, "extratoDeLancadosPorRegra")
      .mockResolvedValue({ competencia: "2026-08", total: 2, valor: 2400, linhas: [{ id: "d-1" }, { id: "d-2" }] });
    const r = await request(makeApp())
      .get("/firm/companies/emp-1/conferencia/lancados-por-regra?competencia=2026-08");

    expect(r.status).toBe(200);
    expect(r.body.total).toBe(2);
    expect(porRegra.extratoDeLancadosPorRegra.mock.calls[0][0])
      .toMatchObject({ portalClientId: "emp-1", competencia: "2026-08" });
  });

  it("⚠ competência ausente ou torta RECUSA — não existe 'a competência de hoje' aqui", async () => {
    const espia = jest.spyOn(porRegra, "extratoDeLancadosPorRegra");
    for (const qs of ["", "?competencia=", "?competencia=agosto", "?competencia=2026-8"]) {
      const r = await request(makeApp()).get(`/firm/companies/emp-1/conferencia/lancados-por-regra${qs}`);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("competencia_invalida");
    }
    expect(espia).not.toHaveBeenCalled();
  });

  it("⚠ sem a migration aplicada responde VAZIO e DIZ que está indisponível", async () => {
    // "Não há lançamento por regra" e "não consigo olhar" são respostas diferentes.
    jest.spyOn(porRegra, "extratoDeLancadosPorRegra")
      .mockRejectedValue(Object.assign(new Error("no column"), { code: "P2022" }));
    const r = await request(makeApp())
      .get("/firm/companies/emp-1/conferencia/lancados-por-regra?competencia=2026-08");

    expect(r.status).toBe(200);
    expect(r.body.linhas).toEqual([]);
    expect(r.body.indisponivel).toBe(true);
  });

  it("⚠⚠ a rota de DESFAZER não é engolida pela de curinga", async () => {
    // `/conferencia/:declaradoId/desfazer` existe desde antes. Registrada primeiro, ela casaria
    // com `declaradoId: "lancados-por-regra"` — e o lote inteiro viraria uma transição solta.
    const desfazer = jest.spyOn(porRegra, "desfazerLancadosPorRegra")
      .mockResolvedValue({ pedidos: 2, desfeitos: 2, ids: ["d-1", "d-2"], recusados: [] });
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/lancados-por-regra/desfazer")
      .send({ ids: ["d-1", "d-2"] });

    expect(r.status).toBe(200);
    expect(r.body.desfeitos).toBe(2);
    expect(desfazer).toHaveBeenCalled();
    expect(aplicarTransicao).not.toHaveBeenCalled();
  });

  it("⚠ lista vazia RECUSA — desfazer sem alvo não é um lote de zero", async () => {
    const espia = jest.spyOn(porRegra, "desfazerLancadosPorRegra");
    for (const body of [{}, { ids: [] }, { ids: "d-1" }]) {
      const r = await request(makeApp())
        .post("/firm/companies/emp-1/conferencia/lancados-por-regra/desfazer").send(body);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("ids_obrigatorios");
    }
    expect(espia).not.toHaveBeenCalled();
  });

  it("⚠⚠ o que FALHA volta nomeado, e com 200 — o lote não para", async () => {
    // Uma linha em mês fechado não pode esconder que as outras foram desfeitas.
    jest.spyOn(porRegra, "desfazerLancadosPorRegra").mockResolvedValue({
      pedidos: 3, desfeitos: 2, ids: ["d-1", "d-3"],
      recusados: [{ id: "d-2", motivo: "mes_fechado", frase: "Mês fechado." }],
    });
    const r = await request(makeApp())
      .post("/firm/companies/emp-1/conferencia/lancados-por-regra/desfazer")
      .send({ ids: ["d-1", "d-2", "d-3"] });

    expect(r.status).toBe(200);
    expect(r.body.desfeitos).toBe(2);
    expect(r.body.recusados[0]).toMatchObject({ id: "d-2", motivo: "mes_fechado" });
  });

  it("⚠ desfazer exige ACCOUNTANT; o extrato é leitura e não exige", async () => {
    jest.spyOn(porRegra, "desfazerLancadosPorRegra").mockResolvedValue({ pedidos: 1, desfeitos: 1, ids: ["d-1"], recusados: [] });
    jest.spyOn(porRegra, "extratoDeLancadosPorRegra").mockResolvedValue({ competencia: "2026-08", total: 0, valor: 0, linhas: [] });
    requireFirmCompanyAccess.mockClear();

    await request(makeApp()).post("/firm/companies/emp-1/conferencia/lancados-por-regra/desfazer").send({ ids: ["d-1"] });
    await request(makeApp()).get("/firm/companies/emp-1/conferencia/lancados-por-regra?competencia=2026-08");

    const gates = requireFirmCompanyAccess.mock.calls.map(([o]) => o?.minRole ?? null);
    expect(gates).toContain("ACCOUNTANT");
  });
});


// -------------------------------------------------------------------------------------------------
// ⚠⚠ A VARREDURA AUTOMÁTICA — as rotas (dono, 01/09/2026).
//
// > *"aquela parte onde diz «trazer notas» — elas devem ser trazidas automaticamente, como tem na
// > aba de notas fiscais deve aparecer ali."*
//
// ⚠⚠ A DATA-PISO CONTINUA OBRIGATÓRIA, e é o ponto: o que a automação guarda é a escolha do
// CONTADOR, repetida. Um piso escolhido pelo sistema despejaria a base inteira na fila.
// -------------------------------------------------------------------------------------------------
describe("⚠⚠ /conferencia/varredura-automatica", () => {
  const {
    lerVarreduraAutomatica,
    ligarVarreduraAutomatica,
    desligarVarreduraAutomatica,
  } = require("../../../application/declarados/VarreduraDeNotasService.js");

  const LER = () => request(makeApp()).get("/firm/companies/emp-1/conferencia/varredura-automatica");
  const LIGAR = (body) => request(makeApp()).post("/firm/companies/emp-1/conferencia/varredura-automatica").send(body);
  const DESLIGAR = () => request(makeApp()).delete("/firm/companies/emp-1/conferencia/varredura-automatica");

  it("⚠ desligada: `ligada: false`, e nada mais é afirmado", async () => {
    const r = await LER();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, ligada: false, desde: null, indisponivel: false });
  });

  it("⚠⚠⚠ ligada: as TRÊS respostas viajam separadas — a data, «olhei» e «trouxe»", async () => {
    // ⚠⚠ Amassar as duas últimas numa só foi o que deixou a captura 29 dias parada em produção:
    // "olhei e não veio nada" ficava idêntico a "ninguém olhou".
    lerVarreduraAutomatica.mockResolvedValueOnce({
      ligada: true,
      indisponivel: false,
      config: {
        dataPiso: new Date("2026-07-01T00:00:00.000Z"),
        ligadaEm: new Date("2026-08-01T10:00:00.000Z"),
        ultimaTentativaEm: new Date("2026-09-02T08:00:00.000Z"),
        ultimoResultadoEm: new Date("2026-08-30T08:00:00.000Z"),
        ultimoCriados: 12,
        ultimoErro: null,
      },
    });
    const r = await LER();
    expect(r.body).toMatchObject({ ligada: true, desde: "2026-07-01", ultimoCriados: 12 });
    expect(r.body.ultimaTentativaEm).not.toBe(r.body.ultimoResultadoEm);
    // ⚠ A data-piso sai como DIA, nunca ISO completa — ela é data civil.
    expect(r.body.desde).not.toMatch(/T/);
  });

  it("⚠⚠ `indisponivel` viaja — «não sei olhar» não pode virar «esta empresa não tem»", async () => {
    lerVarreduraAutomatica.mockResolvedValueOnce({ ligada: false, config: null, indisponivel: true });
    const r = await LER();
    expect(r.body).toMatchObject({ ligada: false, indisponivel: true });
  });

  it("⚠⚠ ligar SEM data recusa — a mesma exigência da varredura avulsa", async () => {
    const r = await LIGAR({});
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("data_piso_obrigatoria");
    expect(r.body.message).toMatch(/toda a base/i);
    expect(ligarVarreduraAutomatica).not.toHaveBeenCalled();
  });

  it("⚠ data mal formada recusa com código PRÓPRIO", async () => {
    const r = await LIGAR({ desde: "07/2026" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("data_piso_invalida");
    expect(ligarVarreduraAutomatica).not.toHaveBeenCalled();
  });

  it("⚠⚠⚠ ligar GUARDA a escolha E VARRE AGORA — senão o contador escolhe e não vê nada", async () => {
    // ⚠ Sem a varredura imediata, a fila só mudaria no próximo ciclo do worker (1h). Quem acabou de
    // escolher a data leria isso como "não funcionou".
    const r = await LIGAR({ desde: "2026-07-01" });
    expect(r.status).toBe(200);
    expect(ligarVarreduraAutomatica).toHaveBeenCalledWith(expect.objectContaining({
      portalClientId: "emp-1", usuarioId: "u-1",
    }));
    expect(ligarVarreduraAutomatica.mock.calls[0][0].dataPiso.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    // ⚠⚠ O relatório INTEIRO volta, igual ao do botão avulso — é o MESMO corpo (`varrerAgora`).
    expect(varrerNotasDaEmpresa).toHaveBeenCalled();
    expect(r.body).toMatchObject({ ok: true, ligada: true, desde: "2026-07-01", varridas: 82, criados: 8 });
  });

  it("⚠⚠ as DUAS PORTAS usam o MESMO corpo — o relatório tem as mesmas chaves", async () => {
    // Duas cópias divergiriam na primeira correção, e a divergência sairia como série auto-ativada
    // por um caminho e não pelo outro — invisível até alguém comparar as duas telas.
    const avulsa = await request(makeApp()).post("/firm/companies/emp-1/conferencia/varrer-notas?desde=2026-07-01");
    const ligando = await LIGAR({ desde: "2026-07-01" });
    const chaves = (b) => Object.keys(b).filter((k) => k !== "ligada").sort();
    expect(chaves(ligando.body)).toEqual(chaves(avulsa.body));
  });

  it("⚠⚠ desligar APAGA e não toca na fila", async () => {
    const r = await DESLIGAR();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, ligada: false, desligadas: 1 });
    expect(desligarVarreduraAutomatica).toHaveBeenCalledWith({ portalClientId: "emp-1" });
  });

  it("⚠⚠ LER não exige papel; LIGAR e DESLIGAR exigem ACCOUNTANT", async () => {
    // ⚠ Ligar cria linhas na fila de despesa da empresa — é escrita, e o piso de papel é o mesmo da
    // varredura avulsa. Ler é leitura.
    jest.clearAllMocks();
    await LER();
    expect(requireFirmCompanyAccess.mock.calls.some(([o]) => !o?.minRole)).toBe(true);

    jest.clearAllMocks();
    await LIGAR({ desde: "2026-07-01" });
    expect(requireFirmCompanyAccess.mock.calls.some(([o]) => o?.minRole === "ACCOUNTANT")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠⚠ O BOTÃO «Sugerir contas com IA» — `POST /conferencia/classificar-ia` (02/09/2026)
//
// A regra (quem vai, catálogo, leitura conferida) está em `lib/__tests__/classificacaoPorIa.test.js`;
// a ligação (nunca `contaAplicada`, guarda, lotes) em `__tests__/classificacaoPorIa.service.test.js`.
// O que se prende AQUI: a flag OFF vira 503 NOMEADO (quem recusa é o servidor), o relatório volta
// inteiro, a competência sai do query, e o piso é ACCOUNTANT — a mesma pessoa que pode lançar.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("⚠⚠ POST /conferencia/classificar-ia — o botão de IA", () => {
  const { classificarFila } = jest.requireMock("../../../application/declarados/ClassificacaoPorIaService.js");
  const CLASSIFICAR = (qs = "") => request(makeApp()).post(`/firm/companies/emp-1/conferencia/classificar-ia${qs}`);

  const relatorioBom = {
    ok: true, recusa: null, semLinhas: false, linhasOlhadas: 12, linhasEnviadas: 3, lotes: 1,
    propostas: 2, gravadas: 2,
    recusadas: [{ id: "d-7", motivo: "conta_fora_do_plano", frase: "A IA indicou uma conta que não existe no plano desta empresa." }],
    ilegiveis: 0, erros: [], recusadaPelaGuarda: null, custoEstimadoCentavos: 3, modelo: "claude-opus-5",
  };

  beforeEach(() => jest.clearAllMocks());

  it("⚠⚠ flag OFF ⇒ 503 NOMEADO — o servidor recusa, não a tela", async () => {
    classificarFila.mockResolvedValueOnce({ ok: false, recusa: "ia_classificacao_desligada" });
    const r = await CLASSIFICAR();
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, error: "ia_classificacao_desligada" });
    expect(r.body.message).toMatch(/INTEGRACAO_IA_CLASSIFICACAO/);
  });

  it("o relatório volta INTEIRO — propostas, recusadas com motivo, custo, modelo", async () => {
    classificarFila.mockResolvedValueOnce(relatorioBom);
    const r = await CLASSIFICAR("?competencia=2026-07");
    expect(r.status).toBe(200);
    expect(r.body).toEqual(relatorioBom);
  });

  it("⚠ a empresa vem do PATH e a competência do QUERY — o corpo não escolhe a empresa", async () => {
    classificarFila.mockResolvedValueOnce(relatorioBom);
    await request(makeApp()).post("/firm/companies/emp-1/conferencia/classificar-ia?competencia=2026-07").send({ portalClientId: "emp-INVASORA" });
    expect(classificarFila).toHaveBeenCalledWith({ portalClientId: "emp-1", competencia: "2026-07" });
  });

  it("sem competência, a fila inteira (null) — nunca um mês inventado", async () => {
    classificarFila.mockResolvedValueOnce(relatorioBom);
    await CLASSIFICAR();
    expect(classificarFila).toHaveBeenCalledWith({ portalClientId: "emp-1", competencia: null });
  });

  it("⚠ a guarda recusando NÃO é 503 — a fila não caiu, e o relatório diz o motivo", async () => {
    classificarFila.mockResolvedValueOnce({ ...relatorioBom, lotes: 0, propostas: 0, gravadas: 0, recusadas: [], recusadaPelaGuarda: { motivo: "teto_empresa", mensagem: "teto", apartirDoLote: 1 } });
    const r = await CLASSIFICAR();
    expect(r.status).toBe(200);
    expect(r.body.recusadaPelaGuarda).toMatchObject({ motivo: "teto_empresa" });
  });

  it("⚠⚠ o piso é ACCOUNTANT — grava proposta na fila da empresa", async () => {
    classificarFila.mockResolvedValueOnce(relatorioBom);
    await CLASSIFICAR();
    expect(requireFirmCompanyAccess.mock.calls.some(([o]) => o?.minRole === "ACCOUNTANT")).toBe(true);
  });

  it("⚠⚠ a rota NÃO chama `aplicarTransicao` — a IA propõe, nunca lança", async () => {
    classificarFila.mockResolvedValueOnce(relatorioBom);
    await CLASSIFICAR();
    expect(aplicarTransicao).not.toHaveBeenCalled();
  });

  it("⚠ a fila serializa as colunas da PROPOSTA — campo fora do serializador some sem erro", async () => {
    listarFila.mockResolvedValueOnce({
      itens: [{
        id: "d-1", origem: "NOTA_RECEBIDA", estado: "AGUARDANDO_PAGAMENTO", tipo: "SAIDA", valor: 890, valorAjustado: null,
        competencia: "2026-07", dataDocumento: new Date("2026-07-02T00:00:00.000Z"), anexos: [], notaRecebida: null,
        contaSugeridaIa: "411030012", creditoSugeridoIa: "111020001", justificativaIa: "nuvem = software",
        sugeridaIaModelo: "claude-opus-5", sugeridaIaEm: new Date("2026-09-02T15:00:00.000Z"),
      }],
      total: 1, porEstado: {}, pagina: 1, porPagina: 50,
    });
    const r = await GET("?competencia=2026-07");
    expect(r.status).toBe(200);
    expect(r.body.itens[0]).toMatchObject({
      contaSugeridaIa: "411030012",
      creditoSugeridoIa: "111020001",
      justificativaIa: "nuvem = software",
      sugeridaIaModelo: "claude-opus-5",
      sugeridaIaEm: "2026-09-02T15:00:00.000Z",
    });
    // linha sem proposta: `null`, nunca `undefined` (a tela distingue "não há" de "não veio")
    expect(Object.prototype.hasOwnProperty.call(r.body.itens[0], "contaSugeridaIa")).toBe(true);
  });
});
