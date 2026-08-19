// `PATCH /firm/companies/:id/emissao-nfse` — O SALVAR PRÓPRIO DA ABA DE EMISSÃO.
//
// Decisão do dono (19/08/2026): a configuração de emissão saiu do formulário e virou aba própria,
// e *"ele ganha o próprio salvar"*.
//
// ⚠ O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR, e é uma coisa só: **um salvar parcial que apaga o que
// não veio**. O `PATCH` do cadastro escreve ~30 colunas de uma vez; se esta rota montasse o `data`
// com os sete campos sempre, cada salvar da aba apagaria o que a tela não tivesse enviado — e o
// caso caro é a carga tributária (o commit `11187501` já consertou exatamente isso): a empresa
// pararia de emitir em silêncio, com o contador convicto de que a acabou de configurar.
//
// Por isso os testes olham o ARGUMENTO PASSADO AO PRISMA, e não só o status 200: só o `data` prova
// que a coluna não foi tocada.

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

function dataEnviadaAoPrisma() {
  return prismaMock.company.update.mock.calls[0][0].data;
}

describe("o salvar da aba grava, e grava SÓ o que é dela", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
    prismaMock.portalClient.findUnique.mockResolvedValue({
      id: PORTAL_ID,
      razao: "EMPRESA TESTE LTDA",
      companyId: COMPANY_LEGACY_ID,
    });
    prismaMock.company.update.mockImplementation(async ({ data }) => ({
      id: COMPANY_LEGACY_ID,
      codigoServicoNacional: null,
      codigosServicoNacional: [],
      codigoServicoMunicipal: null,
      rpsSerie: null,
      pTotTribFed: null,
      pTotTribEst: null,
      pTotTribMun: null,
      ...data,
    }));
  });

  test("grava os sete campos, na linha da `Company` (não do `PortalClient`)", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`)
      .send({
        codigoServicoNacional: "170201",
        codigosServicoNacional: ["170201"],
        codigoServicoMunicipal: "001",
        rpsSerie: "1",
        pTotTribFed: "11,33",
        pTotTribEst: "0",
        pTotTribMun: "0,00",
      });

    expect(res.status).toBe(200);
    const { where, data } = prismaMock.company.update.mock.calls[0][0];
    expect(where).toEqual({ id: COMPANY_LEGACY_ID });
    expect(data.codigoServicoNacional).toBe("170201");
    expect(data.codigosServicoNacional).toEqual(["170201"]);
    expect(data.codigoServicoMunicipal).toBe("001");
    // ⚠ Série com padding de 5, a MESMA forma que o XML leva — é a normalização do cadastro,
    // importada e não reescrita.
    expect(data.rpsSerie).toBe("00001");
    // ⚠ Vírgula E ponto são aceitos (percentual não tem milhar), e ZERO É GRAVADO: `0,00` é uma
    // afirmação legítima do contador, não campo vazio.
    expect(data.pTotTribFed).toBe(11.33);
    expect(data.pTotTribEst).toBe(0);
    expect(data.pTotTribMun).toBe(0);
  });

  // ⚠⚠ O TESTE QUE JUSTIFICA A ROTA. Salvar só a série não pode encostar na carga tributária.
  test("campo que NÃO veio no corpo não entra no `data` — `undefined` é NÃO MEXER", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`)
      .send({ rpsSerie: "7" });

    expect(res.status).toBe(200);
    const data = dataEnviadaAoPrisma();
    expect(data).toEqual({ rpsSerie: "00007" });
    for (const campo of ["pTotTribFed", "pTotTribEst", "pTotTribMun", "codigosServicoNacional", "codigoServicoMunicipal", "codigoServicoNacional"]) {
      expect(Object.prototype.hasOwnProperty.call(data, campo)).toBe(false);
    }
  });

  test("campo enviado VAZIO apaga — `null` é uma intenção diferente de ausente", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`)
      .send({ rpsSerie: "", codigoServicoMunicipal: "", pTotTribFed: "" });

    expect(res.status).toBe(200);
    const data = dataEnviadaAoPrisma();
    expect(data.rpsSerie).toBeNull();
    expect(data.codigoServicoMunicipal).toBeNull();
    // NULL é o estado que a emissão RECUSA com motivo — o oposto de gravar 0,00, que AFIRMARIA
    // carga zero ao tomador.
    expect(data.pTotTribFed).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(data, "pTotTribEst")).toBe(false);
  });

  test("lista vazia apaga a lista; lista ausente não a toca", async () => {
    await request(app).patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`).send({ codigosServicoNacional: [] });
    expect(dataEnviadaAoPrisma().codigosServicoNacional).toEqual([]);

    jest.clearAllMocks();
    prismaMock.portalClient.findUnique.mockResolvedValue({ id: PORTAL_ID, razao: "X", companyId: COMPANY_LEGACY_ID });
    prismaMock.company.update.mockResolvedValue({ id: COMPANY_LEGACY_ID });
    await request(app).patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`).send({ codigoServicoMunicipal: "9" });
    expect(Object.prototype.hasOwnProperty.call(dataEnviadaAoPrisma(), "codigosServicoNacional")).toBe(false);
  });
});

describe("o que a rota RECUSA", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
    prismaMock.portalClient.findUnique.mockResolvedValue({
      id: PORTAL_ID, razao: "EMPRESA TESTE LTDA", companyId: COMPANY_LEGACY_ID,
    });
    prismaMock.company.update.mockResolvedValue({ id: COMPANY_LEGACY_ID });
  });

  // ⚠ Aceitar e descartar em silêncio é o defeito que esta base já pagou caro (o campo chegava no
  // corpo, passava pelo Zod e morria na lista de colunas: 200 na resposta, campo vazio na recarga).
  test("campo de FORA da configuração é recusado, nomeando-o — e nada é escrito", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`)
      .send({ rpsSerie: "1", telefone: "21999999999", razaoSocial: "OUTRA COISA LTDA" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("campos_nao_aceitos");
    expect(res.body.campos).toEqual(expect.arrayContaining(["telefone", "razaoSocial"]));
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  // ⚠ A liberação de emissão pelo cliente tem rota PRÓPRIA, com confirmação e auditoria de
  // quem/quando. Se ela passasse por aqui, o ato fiscal viajaria junto de troca de código de
  // serviço e a confirmação perderia o sentido.
  test("`emissaoCliente`/`liberada` NÃO entram por esta porta", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`)
      .send({ rpsSerie: "1", liberada: true });

    expect(res.status).toBe(400);
    expect(res.body.campos).toContain("liberada");
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  test("corpo sem nenhum campo de emissão é recusado — não há o que salvar", async () => {
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("nenhum_campo_de_emissao");
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  test.each([
    ["código nacional fora da forma", { codigoServicoNacional: "17020" }, "company_codigo_servico_nacional_invalid"],
    ["série fora da faixa E0010", { rpsSerie: "50000" }, "company_rps_serie_invalid"],
    ["percentual acima de 100", { pTotTribFed: "180" }, "company_p_tot_trib_fed_invalid"],
    ["percentual com ponto de milhar", { pTotTribMun: "1.500,00" }, "company_p_tot_trib_mun_invalid"],
  ])("%s é recusado com o MESMO código de erro do cadastro", async (_nome, corpo, erro) => {
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`).send(corpo);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(erro);
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  test("vários códigos sem nenhum marcado: recusa nomeada, nada é gravado", async () => {
    // Eleger "o primeiro da lista" seria o sistema decidindo qual serviço a empresa declara ao
    // fisco. A regra é a mesma do cadastro — é literalmente a mesma função.
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`)
      .send({ codigosServicoNacional: ["170201", "140101"], codigoServicoNacional: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("company_codigo_servico_nacional_fora_da_lista");
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  // ⚠ Responder 200 aqui seria o pior desfecho: o contador configuraria a empresa, a tela diria
  // "salvo" e a emissão continuaria recusando por falta de configuração.
  test("empresa sem cadastro legado: 409 nomeado, não um 200 mentiroso", async () => {
    prismaMock.portalClient.findUnique.mockResolvedValue({ id: PORTAL_ID, razao: "X", companyId: null });
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}/emissao-nfse`).send({ rpsSerie: "1" });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("company_legada_ausente");
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  test("empresa inexistente → 404 nomeado", async () => {
    prismaMock.portalClient.findUnique.mockResolvedValue(null);
    const res = await request(app).patch("/firm/companies/nao-existe/emissao-nfse").send({ rpsSerie: "1" });
    expect(res.status).toBe(404);
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });
});
