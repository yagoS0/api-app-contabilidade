// A PORTA DO CONTADOR — `PATCH /firm/companies/:id/emissao-cliente` — e a volta do estado na tela.
//
// ⚠ AS DUAS COISAS QUE ESTE ARQUIVO PROVA, e por que a segunda não é cerimônia:
//   1. o clique GRAVA a chave (e a auditoria de quem/quando), e revogar volta as duas a NULO;
//   2. o estado VOLTA no payload da empresa. O `select` das rotas de empresa é explícito — coluna
//      que não entre nele volta `undefined`, o controle reabre desligado e o contador clica de novo
//      achando que não salvou. Este projeto já pagou isso três vezes (`legacyCompanySelect`,
//      `codigoMunicipioIbge`, os campos de NFS-e), e a única forma de provar que não acontece é
//      olhar o argumento passado ao Prisma.
//
// Mesmo dublê de Prisma das outras suítes de rota do escritório: proxy que materializa
// `prisma.<model>.<metodo>` sob demanda, com a transação recebendo o próprio proxy.

import request from "supertest";
import express from "express";

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
  raiz.$transaction = jest.fn(async (arg) => {
    if (typeof arg === "function") return arg(proxy);
    return Promise.all(arg);
  });
  return { prisma: proxy };
});

jest.mock("../../../application/guides/guideCompliance.js", () => {
  const real = jest.requireActual("../../../application/guides/guideCompliance.js");
  return { ...real, computeGuideComplianceMap: jest.fn(async () => new Map()) };
});

import { createFirmPortalRouter } from "../index.js";
import { prisma as prismaMock } from "../../../infrastructure/db/prisma.js";

const PORTAL_ID = "portal-1";
const COMPANY_LEGACY_ID = "company-legacy-1";
const CNPJ = "11222333000181";
// ⚠ `role: "admin"` (e não "contador") porque `requireFirmCompanyAccess` só curto-circuita para
// admin — "contador" cai no `CompanyFirmAccess` como qualquer outro. É o mesmo usuário das demais
// suítes de rota do escritório.
const CONTADOR = { id: "user-firm-1", role: "admin", accountType: "FIRM", email: "contador@escritorio.com" };

function montarApp(user = CONTADOR) {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...user } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

describe("PATCH /firm/companies/:id/emissao-cliente — ligar e desligar", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
    prismaMock.portalClient.update.mockImplementation(async ({ data }) => ({
      id: PORTAL_ID,
      razao: "EMPRESA TESTE LTDA",
      ...data,
    }));
    prismaMock.user.findUnique.mockResolvedValue({ name: "Contador Fulano", email: "contador@escritorio.com" });
  });

  test("LIBERAR grava a chave, o instante e QUEM liberou", async () => {
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}/emissao-cliente`).send({ liberada: true });

    expect(res.status).toBe(200);
    const { where, data } = prismaMock.portalClient.update.mock.calls[0][0];
    expect(where).toEqual({ id: PORTAL_ID });
    expect(data.emissaoClienteLiberada).toBe(true);
    expect(data.emissaoClienteLiberadaEm).toBeInstanceOf(Date);
    // ⚠ Sem o "quem", a pergunta que se faz depois de uma nota indevida ("quem autorizou este
    // cliente a emitir?") não tem resposta.
    expect(data.emissaoClienteLiberadaPor).toBe(CONTADOR.id);
    expect(res.body.emissaoCliente.liberada).toBe(true);
    expect(res.body.emissaoCliente.liberadaPorNome).toBe("Contador Fulano");
  });

  test("REVOGAR volta as três colunas ao estado fechado — `Em`/`Por` viram NULO", async () => {
    // ⚠ Elas respondem "quem autorizou", não "quem mexeu por último": guardar nelas o instante da
    // revogação daria dois significados a uma coluna só. Mesmo desenho do `reabrir` do fechamento
    // contábil, que também zera `fechadoContabilEm`/`Por`.
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}/emissao-cliente`).send({ liberada: false });

    expect(res.status).toBe(200);
    const { data } = prismaMock.portalClient.update.mock.calls[0][0];
    expect(data).toEqual({
      emissaoClienteLiberada: false,
      emissaoClienteLiberadaEm: null,
      emissaoClienteLiberadaPor: null,
    });
    expect(res.body.emissaoCliente.liberada).toBe(false);
    expect(res.body.emissaoCliente.liberadaPorNome).toBeNull();
  });

  test("corpo sem booleano é RECUSADO e nada é escrito", async () => {
    // `Boolean("false")` é `true`: um chamador mandando a string ligaria o portão por engano.
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}/emissao-cliente`).send({ liberada: "false" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("liberada_invalida");
    expect(prismaMock.portalClient.update).not.toHaveBeenCalled();
  });

  test("campo ausente também é recusado — omissão não desliga nem liga", async () => {
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}/emissao-cliente`).send({});
    expect(res.status).toBe(400);
    expect(prismaMock.portalClient.update).not.toHaveBeenCalled();
  });

  test("empresa inexistente → 404 nomeado", async () => {
    prismaMock.portalClient.update.mockRejectedValue(Object.assign(new Error("nao existe"), { code: "P2025" }));
    const res = await request(app).patch("/firm/companies/nao-existe/emissao-cliente").send({ liberada: true });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("portal_company_not_found");
  });

  test("⚠ STAFF do escritório NÃO liga o portão — o gate é ACCOUNTANT+", async () => {
    // Liberar a emissão faz um cliente passar a emitir nota em produção, em nome da empresa. Mesmo
    // gate de `canal-envio` e dos contatos de WhatsApp.
    const appStaff = montarApp({ id: "user-staff", role: "firm", accountType: "FIRM" });
    prismaMock.companyFirmAccess.findUnique.mockResolvedValue({ role: "STAFF", status: "ACTIVE", scopes: [] });

    const res = await request(appStaff).patch(`/firm/companies/${PORTAL_ID}/emissao-cliente`).send({ liberada: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_role");
    expect(prismaMock.portalClient.update).not.toHaveBeenCalled();
  });
});

describe("o estado VOLTA para a tela", () => {
  // Payload mínimo aceito por `validateAndNormalizeCompanyProfile`.
  function payloadDaEmpresa() {
    return {
      company: {
        razaoSocial: "EMPRESA TESTE LTDA",
        cnpj: CNPJ,
        regimeTributario: "SIMPLES",
        cnaePrincipal: "6201501",
        endereco: {
          rua: "Rua das Flores",
          numero: "100",
          bairro: "Centro",
          cidade: "Rio de Janeiro",
          uf: "RJ",
          cep: "20000-000",
        },
      },
    };
  }

  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
    prismaMock.portalClient.findUnique.mockResolvedValue({ id: PORTAL_ID, companyId: COMPANY_LEGACY_ID, cnpj: CNPJ });
    prismaMock.portalClient.update.mockImplementation(async ({ data }) => ({
      id: PORTAL_ID,
      companyId: COMPANY_LEGACY_ID,
      cnpj: CNPJ,
      emissaoClienteLiberada: true,
      emissaoClienteLiberadaEm: new Date("2026-08-18T12:00:00.000Z"),
      emissaoClienteLiberadaPor: "user-firm-1",
      ...data,
    }));
    prismaMock.company.update.mockImplementation(async ({ data }) => ({ id: COMPANY_LEGACY_ID, ...data }));
    prismaMock.company.findUnique.mockResolvedValue({ id: COMPANY_LEGACY_ID });
    prismaMock.companyClientUser.findFirst.mockResolvedValue(null);
    prismaMock.guide.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([{ id: "user-firm-1", name: "Contador Fulano", email: "c@e.com" }]);
  });

  test("o `select` do PATCH do cadastro traz as três colunas", async () => {
    // Sem isto, salvar o cadastro devolveria `liberada: false` e a tela DESLIGARIA o controle
    // sozinha, sem ninguém ter clicado nele.
    await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payloadDaEmpresa());
    const { select } = prismaMock.portalClient.update.mock.calls[0][0];
    expect(select.emissaoClienteLiberada).toBe(true);
    expect(select.emissaoClienteLiberadaEm).toBe(true);
    expect(select.emissaoClienteLiberadaPor).toBe(true);
  });

  test("a resposta do PATCH traz `emissaoCliente` com o nome de quem liberou", async () => {
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payloadDaEmpresa());

    expect(res.status).toBe(200);
    expect(res.body.company.emissaoCliente).toMatchObject({
      liberada: true,
      liberadaPor: "user-firm-1",
      liberadaPorNome: "Contador Fulano",
    });
    expect(res.body.company.emissaoCliente.liberadaEm).toBeTruthy();
  });

  test("⚠ o PATCH do cadastro NÃO altera o portão — ele tem rota própria", async () => {
    // Um `liberada: true` viajando no corpo do formulário não pode ligar a emissão: o ato tem de
    // passar pelo `PATCH .../emissao-cliente`, que é onde mora o gate ACCOUNTANT+ e a auditoria.
    await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send({ ...payloadDaEmpresa(), emissaoClienteLiberada: true });
    const { data } = prismaMock.portalClient.update.mock.calls[0][0];
    expect(data).not.toHaveProperty("emissaoClienteLiberada");
    expect(data).not.toHaveProperty("emissaoClienteLiberadaEm");
    expect(data).not.toHaveProperty("emissaoClienteLiberadaPor");
  });
});
