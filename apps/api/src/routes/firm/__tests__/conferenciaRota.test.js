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
  varrerNotasDaEmpresa: jest.fn(async () => ({
    varridas: 82, criados: 8, jaExistiam: 0,
    fora: [{ motivo: "cancelada", frase: "A nota está cancelada.", n: 31, exemplos: ["pi-9"] }],
    recusados: [],
  })),
}));

jest.mock("../../../application/declarados/DeclaradoService.js", () => {
  const real = jest.requireActual("../../../application/declarados/DeclaradoService.js");
  return {
    ...real,
    aplicarTransicao: jest.fn(async () => ({ id: "d-1", estado: "CONTABILIZADO", valor: 1500 })),
    sugestoesDePagamento: jest.fn(async () => ({ linhas: [], totalDebitos: 0, totalNotas: 0 })),
    fundirPagamentoNaNota: jest.fn(async () => ({ id: "n-1", estado: "A_CONFERIR" })),
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
  const { sugestoesDePagamento, fundirPagamentoNaNota } = require("../../../application/declarados/DeclaradoService.js");

  const CASAMENTOS = () => request(makeApp()).get("/firm/companies/emp-1/conferencia/casamentos");
  const FUNDIR = (body) => request(makeApp()).post("/firm/companies/emp-1/conferencia/casamentos/fundir").send(body);

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
});
