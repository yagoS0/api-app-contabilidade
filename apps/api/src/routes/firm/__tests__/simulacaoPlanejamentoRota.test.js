// ⚠⚠ A FOTO DA SIMULAÇÃO — a porta, o escopo e a recusa nomeada.
//
// O que este arquivo existe para impedir, em ordem de custo:
//   1. o corpo do pedido apontar a foto para OUTRA empresa (multi-tenancy);
//   2. a razão social do PDF vir do navegador em vez do banco;
//   3. uma falha de armazenamento virar 500 genérico — o contador procuraria o defeito na
//      simulação, e ele está na infraestrutura (o Volume do Railway).

import request from "supertest";
import express from "express";

// ⚠ `jest.mock` com fábrica, e NÃO `unstable_mockModule` + top-level await: o jest desta api roda
// em CommonJS e o `await` no topo do arquivo é erro de PARSE — a suíte inteira morre antes do
// primeiro teste, com uma mensagem que não aponta para a causa. É a mesma armadilha que o
// `import.meta` já criou aqui, e está registrada nos dois `CLAUDE.md`.
jest.mock("../../../application/planejamento/SimulacaoPlanejamentoService.js", () => ({
  salvarSimulacao: jest.fn(),
  listarSimulacoes: jest.fn(),
  gerarDocumentoDaSimulacao: jest.fn(),
  SimulacaoPlanejamentoError: class extends Error {
    constructor(codigo, mensagem, status = 400) {
      super(mensagem);
      this.codigo = codigo;
      this.status = status;
    }
  },
}));
jest.mock("../../../application/planejamento/DadosPlanejamentoService.js", () => ({
  montarDadosPlanejamento: jest.fn(async () => ({ empresa: {} })),
}));
jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: { portalClient: { findUnique: jest.fn() } },
}));
// ⚠ A guarda de acesso é DUBLADA de propósito: este arquivo mede o que a ROTA faz DEPOIS de
// autorizada. Quem prova a guarda é o teste do próprio middleware — reimplementá-la num dublê e
// depois "testá-la" seria testar o dublê.
jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: () => (req, _res, next) => { req.user = { id: "u1" }; next(); },
}));

import { createPlanejamentoRouter } from "../planejamento.js";
import {
  salvarSimulacao,
  listarSimulacoes,
  gerarDocumentoDaSimulacao,
} from "../../../application/planejamento/SimulacaoPlanejamentoService.js";
import { prisma } from "../../../infrastructure/db/prisma.js";

const findUnique = prisma.portalClient.findUnique;
/** ⚠ A classe de erro tem de ser a MESMA que a rota vê (o `instanceof` do dublê), não a minha. */
const ErroDoServico = jest.requireMock(
  "../../../application/planejamento/SimulacaoPlanejamentoService.js",
).SimulacaoPlanejamentoError;

function app() {
  const a = express();
  a.use(express.json());
  a.use("/companies/:companyId", createPlanejamentoRouter({ log: { warn() {} } }));
  return a;
}

beforeEach(() => {
  salvarSimulacao.mockReset();
  listarSimulacoes.mockReset();
  gerarDocumentoDaSimulacao.mockReset();
  findUnique.mockReset();
});

describe("⚠⚠ gravar a foto — e o PATH vencendo o CORPO", () => {
  it("grava e devolve 201", async () => {
    salvarSimulacao.mockResolvedValue({ id: "s1" });
    const r = await request(app())
      .post("/companies/emp-1/planejamento/simulacoes")
      .send({ competencia: "2026-08", entradas: {}, resultado: {} });
    expect(r.status).toBe(201);
    expect(r.body.simulacao.id).toBe("s1");
  });

  it("⚠⚠⚠ um `portalClientId` NO CORPO não desvia a foto para outra empresa", async () => {
    // É literalmente o furo que a F1 do WhatsApp pagou: `{...body, portalClientId: path}` com o
    // spread ANTES. Invertido, a permissão é conferida numa empresa e a gravação acontece noutra.
    salvarSimulacao.mockResolvedValue({ id: "s1" });
    await request(app())
      .post("/companies/emp-1/planejamento/simulacoes")
      .send({ portalClientId: "empresa-de-outro-escritorio", competencia: "2026-08", entradas: {}, resultado: {} });
    expect(salvarSimulacao).toHaveBeenCalledWith(
      expect.objectContaining({ portalClientId: "emp-1" }),
    );
  });

  it("⚠ o autor sai da SESSÃO, nunca do corpo", async () => {
    salvarSimulacao.mockResolvedValue({ id: "s1" });
    await request(app())
      .post("/companies/emp-1/planejamento/simulacoes")
      .send({ geradoPor: "usuario-inventado", competencia: "2026-08", entradas: {}, resultado: {} });
    expect(salvarSimulacao).toHaveBeenCalledWith(expect.objectContaining({ geradoPor: "u1" }));
  });

  it("a recusa do serviço chega NOMEADA, com o status dela", async () => {
    salvarSimulacao.mockRejectedValue(
      new ErroDoServico("competencia_invalida", "Competência deve ser AAAA-MM."),
    );
    const r = await request(app())
      .post("/companies/emp-1/planejamento/simulacoes")
      .send({ entradas: {}, resultado: {} });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("competencia_invalida");
  });
});

describe("⚠⚠ gerar o PDF", () => {
  it("⚠⚠ a razão social vem do BANCO, nunca do corpo — o PDF circula sozinho", async () => {
    findUnique.mockResolvedValue({ razao: "ALFA REAL LTDA", cnpj: "1" });
    gerarDocumentoDaSimulacao.mockResolvedValue({ simulacao: {}, documento: { id: "d1" } });
    await request(app())
      .post("/companies/emp-1/planejamento/simulacoes/s1/documento")
      .send({ empresa: { razao: "NOME QUE O NAVEGADOR MANDOU" } });
    expect(gerarDocumentoDaSimulacao).toHaveBeenCalledWith(
      expect.objectContaining({ empresa: { razao: "ALFA REAL LTDA", cnpj: "1" } }),
    );
  });

  it("simulação de outra empresa não é encontrada — 404 nomeado", async () => {
    findUnique.mockResolvedValue({ razao: "A", cnpj: "1" });
    gerarDocumentoDaSimulacao.mockRejectedValue(
      new ErroDoServico("simulacao_nao_encontrada", "Simulação não encontrada.", 404),
    );
    const r = await request(app()).post("/companies/emp-1/planejamento/simulacoes/x/documento");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("simulacao_nao_encontrada");
  });

  it("⚠⚠ falha de ARMAZENAMENTO tem código próprio e diz que a simulação foi salva", async () => {
    // Sem o Volume no Railway a gravação falha. Um 500 genérico faria o contador procurar o defeito
    // na simulação — e ele está na infraestrutura. A frase tem de dizer que a foto sobreviveu.
    findUnique.mockResolvedValue({ razao: "A", cnpj: "1" });
    gerarDocumentoDaSimulacao.mockRejectedValue(new Error("ENOENT: no such file or directory"));
    const r = await request(app()).post("/companies/emp-1/planejamento/simulacoes/s1/documento");
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("documento_nao_gerado");
    expect(r.body.message).toMatch(/simulação foi salva/i);
    expect(r.body.message).toMatch(/armazenamento/i);
  });
});

describe("⚠ listar", () => {
  it("lista escopada pela empresa do path", async () => {
    listarSimulacoes.mockResolvedValue([{ id: "s1" }]);
    const r = await request(app()).get("/companies/emp-1/planejamento/simulacoes");
    expect(r.status).toBe(200);
    expect(listarSimulacoes).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: "emp-1" }));
  });
});
