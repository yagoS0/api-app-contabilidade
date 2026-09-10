// A porta que libera funções da IA por número: autenticação, papel, validação e escopo da empresa.

import request from "supertest";
import express from "express";

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  const root = {};
  const proxy = new Proxy(root, {
    get(target, prop) {
      if (typeof prop === "symbol") return target[prop];
      if (prop === "$transaction") return target.$transaction;
      if (!models[prop]) {
        const methods = {};
        models[prop] = new Proxy(methods, {
          get(model, method) {
            if (typeof method === "symbol") return model[method];
            if (!model[method]) model[method] = jest.fn();
            return model[method];
          },
        });
      }
      return models[prop];
    },
  });
  root.$transaction = jest.fn(async (arg) => typeof arg === "function" ? arg(proxy) : Promise.all(arg));
  return { prisma: proxy };
});

jest.mock("../../../application/guides/guideCompliance.js", () => {
  const real = jest.requireActual("../../../application/guides/guideCompliance.js");
  return { ...real, computeGuideComplianceMap: jest.fn(async () => new Map()) };
});

import { createFirmPortalRouter } from "../index.js";
import { prisma } from "../../../infrastructure/db/prisma.js";

const EMPRESA = "pc-1";
const CONTATO = "ct-1";
const ADMIN = { id: "firm-1", role: "admin", accountType: "FIRM" };

function montarApp(user = ADMIN) {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => { req.auth = { user }; return true; };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return { app, log };
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.contatoWhatsapp.findFirst.mockResolvedValue({ permissoesAssistente: [] });
  prisma.contatoWhatsapp.update.mockImplementation(async ({ data }) => ({ id: CONTATO, portalClientId: EMPRESA, ...data }));
});

describe("PATCH /firm/companies/:companyId/contatos-whatsapp/:contatoId/permissoes-assistente", () => {
  it("normaliza dependências, limita a escrita à empresa e registra o ator", async () => {
    const { app, log } = montarApp();
    const resposta = await request(app)
      .patch(`/firm/companies/${EMPRESA}/contatos-whatsapp/${CONTATO}/permissoes-assistente`)
      .send({ permissoesAssistente: ["recalculo_guia"] });

    expect(resposta.status).toBe(200);
    expect(resposta.body.contato.permissoesAssistente).toEqual(["RECALCULO_GUIA", "GUIAS"]);
    expect(prisma.contatoWhatsapp.update).toHaveBeenCalledWith({
      where: { id: CONTATO, portalClientId: EMPRESA },
      data: { permissoesAssistente: ["RECALCULO_GUIA", "GUIAS"] },
    });
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: EMPRESA, contatoId: CONTATO, actorUserId: ADMIN.id }), expect.any(String));
  });

  it("recusa payload inválido antes de escrever", async () => {
    const { app } = montarApp();
    const resposta = await request(app)
      .patch(`/firm/companies/${EMPRESA}/contatos-whatsapp/${CONTATO}/permissoes-assistente`)
      .send({ permissoesAssistente: ["APAGAR_EMPRESA"] });
    expect(resposta.status).toBe(400);
    expect(resposta.body.error).toBe("PERMISSOES_ASSISTENTE_INVALIDAS");
    expect(prisma.contatoWhatsapp.update).not.toHaveBeenCalled();
  });

  it("devolve 404 quando o contato não pertence à empresa", async () => {
    prisma.contatoWhatsapp.findFirst.mockResolvedValue(null);
    prisma.contatoWhatsapp.update.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2025" }));
    const { app } = montarApp();
    const resposta = await request(app)
      .patch(`/firm/companies/${EMPRESA}/contatos-whatsapp/${CONTATO}/permissoes-assistente`)
      .send({ permissoesAssistente: ["GUIAS"] });
    expect(resposta.status).toBe(404);
    expect(resposta.body.error).toBe("CONTATO_NAO_ENCONTRADO");
  });

  it("exige ao menos ACCOUNTANT na carteira", async () => {
    prisma.companyFirmAccess.findUnique.mockResolvedValue({ role: "STAFF", status: "ACTIVE", scopes: [] });
    const { app } = montarApp({ id: "staff-1", role: "staff", accountType: "FIRM" });
    const resposta = await request(app)
      .patch(`/firm/companies/${EMPRESA}/contatos-whatsapp/${CONTATO}/permissoes-assistente`)
      .send({ permissoesAssistente: ["GUIAS"] });
    expect(resposta.status).toBe(403);
    expect(resposta.body.error).toBe("insufficient_role");
    expect(prisma.contatoWhatsapp.update).not.toHaveBeenCalled();
  });
});
