// `GET /notas/auditoria` — a rota LITERAL, e a ordem de registro que a torna alcançável.
//
// ⚠ ELA VEM ANTES DE `GET /notas/:notaId`, que é curinga. Registrada depois, o Express leria
// "auditoria" como um id de nota e responderia `404 nota_nao_encontrada` — a aba inteira morreria
// com uma mensagem falando de uma nota inexistente, e ninguém procuraria roteamento. É a MESMA
// armadilha que `/notas/summary` já pagou (ver `notaDetalhe.test.js`) e que as três literais de
// `/parcelamentos/` pagaram antes dela.
//
// ⚠ E ELA NÃO ESCREVE. O guard é o dos GETs (`requireFirmCompanyAccess()` sem `minRole`), porque
// quem pode ver as notas pode ver as perguntas sobre elas. A prova de que nada é gravado está em
// `application/notas/auditoria/__tests__/auditoriaNaoEscreve.test.js`; aqui trava-se a rota.

jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({
  requireFirmCompanyAccess: (opts) => (req, res, next) => {
    req.__opts = opts;
    req.auth = { user: { id: "u1", role: "ACCOUNTANT" } };
    next();
  },
}));

const mockAuditar = jest.fn();
jest.mock("../../../application/notas/auditoria/AuditoriaNotasService.js", () => ({
  auditarCompetencia: (...args) => mockAuditar(...args),
}));

jest.mock("../../../infrastructure/db/prisma.js", () => ({
  prisma: {
    portalInvoice: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    notaItem: { findMany: jest.fn(async () => []) },
    portalInvoiceEvent: { findMany: jest.fn(async () => []) },
  },
}));

// Serviços que o router importa no topo — nenhum é exercido aqui.
jest.mock("../../../application/notas/CompetenciaStateMachine.js", () => ({
  ESTADOS: { ABERTO: "aberto" }, ensureCompetencia: jest.fn(), fecharCompetencia: jest.fn(), reabrirCompetencia: jest.fn(),
}));
jest.mock("../../../application/notas/CertResolver.js", () => ({ checkCertAvailability: jest.fn(), SERVICOS: {} }));
jest.mock("../../../application/notas/dfe/DfeSyncService.js", () => ({ syncDfeForCompany: jest.fn() }));
jest.mock("../../../application/notas/adn/AdnNotasService.js", () => ({ syncAdnNotasForCompany: jest.fn() }));
jest.mock("../../../application/notas/apuracao/ClassificadorAnexos.js", () => ({ classifyItemsForCompany: jest.fn() }));
jest.mock("../../../application/notas/apuracao/CalculoFiscal.js", () => ({ calcularApuracaoParaCompetencia: jest.fn() }));
jest.mock("../../../application/notas/apuracao/ApuracaoTransmissaoService.js", () => ({ transmitirApuracao: jest.fn() }));
jest.mock("../../../application/notas/apuracao/ApuracaoConferenciaService.js", () => ({ conferirApuracao: jest.fn() }));

import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { createNotasRouter } from "../notas.js";

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeApp() {
  const app = express();
  app.use(express.json());
  const parent = express.Router();
  parent.use("/companies/:companyId", createNotasRouter({ log }));
  app.use("/firm", parent);
  app.use((req, res) => res.status(404).json({ ok: false, error: "no_route" }));
  return app;
}

const RESULTADO = {
  competencia: "2026-07",
  totalNotas: 3,
  totalAchados: 1,
  perguntasConferidas: 4,
  perguntasNaoConferiveis: 1,
  perguntas: [],
  empresa: { temCadastroDeServicos: false },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuditar.mockResolvedValue(RESULTADO);
});

describe("GET /notas/auditoria", () => {
  test("responde a auditoria da competência pedida, escopada na empresa do path", async () => {
    const r = await request(makeApp())
      .get("/firm/companies/emp-1/notas/auditoria?competencia=2026-07")
      .expect(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.auditoria).toEqual(RESULTADO);
    expect(mockAuditar).toHaveBeenCalledWith({ portalClientId: "emp-1", competencia: "2026-07" });
  });

  test("⚠ NÃO É ENGOLIDA POR `/notas/:notaId` — a ordem de registro é a garantia", async () => {
    // Se a literal fosse registrada depois do curinga, o serviço nunca seria chamado e a resposta
    // seria um 404 falando de uma nota chamada "auditoria".
    await request(makeApp()).get("/firm/companies/emp-1/notas/auditoria?competencia=2026-07").expect(200);
    expect(mockAuditar).toHaveBeenCalledTimes(1);
  });

  test("a ordem está no ARQUIVO, não só no comportamento deste teste", () => {
    const fonte = fs.readFileSync(path.join(__dirname, "..", "notas.js"), "utf8");
    const literal = fonte.indexOf('router.get("/notas/auditoria"');
    const curinga = fonte.indexOf('router.get("/notas/:notaId"');
    expect(literal).toBeGreaterThan(-1);
    expect(curinga).toBeGreaterThan(-1);
    expect(literal).toBeLessThan(curinga);
  });

  test("competência ausente ou malformada: 400 nomeado, e o serviço nem é chamado", async () => {
    for (const url of [
      "/firm/companies/emp-1/notas/auditoria",
      "/firm/companies/emp-1/notas/auditoria?competencia=2026",
      "/firm/companies/emp-1/notas/auditoria?competencia=julho",
    ]) {
      const r = await request(makeApp()).get(url).expect(400);
      expect(r.body.error).toBe("invalid_competencia");
    }
    expect(mockAuditar).not.toHaveBeenCalled();
  });

  test("⚠ o guard NÃO exige minRole — é leitura, e quem vê as notas vê as perguntas", () => {
    const fonte = fs.readFileSync(path.join(__dirname, "..", "notas.js"), "utf8");
    const trecho = fonte.slice(fonte.indexOf('router.get("/notas/auditoria"'));
    expect(trecho.slice(0, 200)).toContain("requireFirmCompanyAccess()");
    expect(trecho.slice(0, 200)).not.toContain("minRole");
  });

  test("falha do serviço vira 500 nomeado, sem vazar a exceção", async () => {
    mockAuditar.mockRejectedValue(new Error("boom: DATABASE_URL=postgres://segredo"));
    const r = await request(makeApp())
      .get("/firm/companies/emp-1/notas/auditoria?competencia=2026-07")
      .expect(500);
    expect(r.body.error).toBe("auditoria_falhou");
    expect(JSON.stringify(r.body)).not.toContain("segredo");
  });
});
