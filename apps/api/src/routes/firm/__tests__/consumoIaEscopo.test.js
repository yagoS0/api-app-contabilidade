// O CONSUMO DO ASSISTENTE (IA) É ESCOPADO PELA CARTEIRA — achado do agente "B · multi-tenancy",
// 03/09/2026.
//
// `GET /firm/ia/consumo?portalClientId=` lia o id CRU da query e só exigia `accountType: "FIRM"`.
// Quem tem carteira restrita (`CompanyFirmAccess`) lia centavos gastos, número de chamadas e o
// sinal `estourado` de QUALQUER empresa — metadado de custo é dado da empresa, e a lista de quem
// usa o assistente diz quem é cliente de quem.
//
// ⚠ 404, nunca 403: 403 confirmaria que aquele `portalClientId` existe.
// ⚠ O total do ESCRITÓRIO (chamada SEM `portalClientId`) continua aberto a quem entra aqui — é o
//    nosso próprio consumo, e é o que a tela de conversas mostra no topo.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  const raiz = {};
  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop === "$transaction") return alvo.$transaction;
      if (prop === "$connect" || prop === "$disconnect") {
        if (!alvo[prop]) alvo[prop] = jest.fn(async () => {});
        return alvo[prop];
      }
      if (!models[prop]) {
        const metodos = {};
        models[prop] = new Proxy(metodos, {
          get(m, metodo) {
            if (typeof metodo === "symbol") return m[metodo];
            if (!m[metodo]) m[metodo] = jest.fn();
            return m[metodo];
          },
        });
      }
      return models[prop];
    },
  });
  raiz.$transaction = jest.fn(async (arg) => (typeof arg === "function" ? arg(proxy) : Promise.all(arg)));
  return { prisma: proxy };
});

jest.mock("../../../application/assistente/GuardaIaService.js", () => ({
  consumoIaDoMes: jest.fn(async ({ portalClientId } = {}) => ({
    desde: "2026-09-01T03:00:00.000Z",
    moeda: "USD",
    estimativa: true,
    escritorio: { centavos: 137, chamadas: 12, teto: 6000, restantes: 5863, fracao: 0.02, alerta: false, estourado: false },
    empresa: portalClientId ? { portalClientId, centavos: 40, chamadas: 3, teto: 400, restantes: 360, fracao: 0.1, alerta: false, estourado: false } : null,
  })),
}));

import request from "supertest";
import express from "express";
import { createFirmPortalRouter } from "../index.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { consumoIaDoMes } from "../../../application/assistente/GuardaIaService.js";

const MINHA = "portal-minha";
const OUTRA = "portal-de-outro-escritorio";

const STAFF = { id: "user-staff", role: "staff", accountType: "FIRM", email: "staff@escritorio.com" };
const CONTADOR = { id: "user-contador", role: "contador", accountType: "FIRM", email: "contador@escritorio.com" };

function montarApp(usuario) {
  const app = express();
  app.use(express.json());
  // ⚠ `app.locals.ensureAuthorized` também, e não só o argumento: sem ele o guard do router
  // responde 500 `auth_middleware_not_configured` antes de qualquer rota.
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...usuario } };
    return true;
  };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  // O STAFF só tem acesso ATIVO à primeira; admin e contador enxergam a carteira toda.
  prisma.companyFirmAccess.findMany.mockResolvedValue([{ companyId: MINHA }]);
  prisma.portalClient.findMany.mockResolvedValue([{ id: MINHA }, { id: OUTRA }]);
});

describe("GET /firm/ia/consumo — o escopo por empresa", () => {
  it("⚠ empresa FORA da carteira: 404 e o consumo NÃO é lido", async () => {
    const r = await request(montarApp(STAFF)).get(`/firm/ia/consumo?portalClientId=${OUTRA}`);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("empresa_nao_encontrada");
    expect(consumoIaDoMes).not.toHaveBeenCalled();
  });

  it("empresa DA carteira: 200 com o consumo dela", async () => {
    const r = await request(montarApp(STAFF)).get(`/firm/ia/consumo?portalClientId=${MINHA}`);
    expect(r.status).toBe(200);
    expect(consumoIaDoMes).toHaveBeenCalledWith({ portalClientId: MINHA });
    expect(r.body.empresa).toMatchObject({ portalClientId: MINHA, teto: 400 });
  });

  it("o total do ESCRITÓRIO (sem empresa) não pede carteira nenhuma", async () => {
    const r = await request(montarApp(STAFF)).get("/firm/ia/consumo");
    expect(r.status).toBe(200);
    expect(consumoIaDoMes).toHaveBeenCalledWith({ portalClientId: null });
    expect(r.body.escritorio).toMatchObject({ centavos: 137, teto: 6000 });
    expect(r.body.empresa).toBeNull();
  });

  it("contador enxerga a carteira toda — inclusive a que o staff não vê", async () => {
    const r = await request(montarApp(CONTADOR)).get(`/firm/ia/consumo?portalClientId=${OUTRA}`);
    expect(r.status).toBe(200);
    expect(consumoIaDoMes).toHaveBeenCalledWith({ portalClientId: OUTRA });
  });
});
