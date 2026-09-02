// ⚠⚠ O CNAE COM DESCRIÇÃO NÃO PODE TRAVAR O SALVAR — o defeito medido em PRODUÇÃO, 02/09/2026.
//
// O dono relatou que NADA do que pediu no cadastro funcionava: não dava para trocar o e-mail do
// responsável da ALESSANDRO, o município da nota não salvava, o CNAE não gravava com descrição.
// Uma requisição real contra a produção devolveu **a mesma resposta para os três sintomas**:
//
//   PATCH -> 400
//   {"ok":false,"error":"validation_failed","issues":[{"path":"company.cnaePrincipal",
//    "message":"Too big: expected string to have <=20 characters","code":"too_big"}]}
//
// `Company.cnaePrincipal` guarda, em parte da carteira, a linha INTEIRA da consulta à Receita —
// `"62.03-1-00 - Desenvolvimento e licenciamento de programas de computador não-customizáveis"`,
// ~90 caracteres — e o Zod a limitava a 20. **O salvar inteiro era recusado ANTES de o bloco do
// responsável ser alcançado**: por isso os três pedidos "não funcionavam" ao mesmo tempo.
//
// Medido em produção: **12 de 34 empresas** têm `cnaePrincipal` com mais de 20 caracteres (FADINI
// 102, ERISANGELA 119, GL 99, PRISMA 69, ARAUJO BARRETO 57…). Essas 12 não conseguiam salvar
// **nada** pelo cadastro.
//
// ⚠ O conserto NÃO é só afrouxar o Zod. A COLUNA continua sendo de código: quem separa código de
// descrição é o normalizador (`companyProfile.soCodigoDeCnae`), e o texto vai para `atividades`,
// que é onde ele já morava — e de onde `descricaoSugerida.js` o lê para virar `xDescServ` da DPS.
// Afrouxar o Zod e gravar a linha inteira na coluna faria a emissão levar a descrição no lugar do
// código.
//
// Este teste olha o ARGUMENTO passado ao Prisma, pelo mesmo motivo do `companyMunicipioIbge`:
// campo descartado em silêncio responde 200 e some na próxima leitura.

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

// O pós-processamento da resposta (`attachGuideComplianceToCompaniesList`) varre guias e não tem
// nada a dizer sobre município — fica mockado para o teste falar da PERSISTÊNCIA.
jest.mock("../../../application/guides/guideCompliance.js", () => {
  const real = jest.requireActual("../../../application/guides/guideCompliance.js");
  return {
    ...real,
    computeGuideComplianceMap: jest.fn(async () => new Map()),
  };
});

import { createFirmPortalRouter } from "../index.js";
import { prisma as prismaMock } from "../../../infrastructure/db/prisma.js";

const PORTAL_ID = "portal-1";
const COMPANY_LEGACY_ID = "company-legacy-1";
const CNPJ = "11222333000181";

// `admin` passa direto pelo `requireFirmCompanyAccess` (curto-circuito) e satisfaz o gate
// `["admin", "contador"]` da própria rota.
const USUARIO_LOGADO = { id: "user-firm-1", role: "admin", accountType: "FIRM", email: "admin@escritorio.com" };

function montarApp() {
  const app = express();
  app.use(express.json());
  // ⚠ `app.locals.ensureAuthorized` também, e não só o argumento: sem ele o guard do router
  // responde 500 `auth_middleware_not_configured` antes de qualquer rota.
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...USUARIO_LOGADO } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

// Payload mínimo aceito por `validateAndNormalizeCompanyProfile` — os seis campos de endereço, o
// CNAE e um dos três regimes são exigidos por ela, não por este teste.
function payload(companyExtra = {}) {
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
      ...companyExtra,
    },
  };
}

function bancoNoCaminhoFeliz() {
  // A MESMA função responde a duas chamadas: a checagem de CNPJ imutável (fora da transação) e a
  // leitura do portal (dentro dela). O objeto traz o que as duas precisam.
  prismaMock.portalClient.findUnique.mockResolvedValue({ id: PORTAL_ID, companyId: COMPANY_LEGACY_ID, cnpj: CNPJ });
  prismaMock.portalClient.update.mockImplementation(async ({ data }) => ({
    id: PORTAL_ID, companyId: COMPANY_LEGACY_ID, cnpj: CNPJ, ...data,
  }));
  prismaMock.company.update.mockImplementation(async ({ data }) => ({ id: COMPANY_LEGACY_ID, ...data }));
  prismaMock.company.findUnique.mockResolvedValue({ id: COMPANY_LEGACY_ID, codigoMunicipioIbge: "3304557" });
  prismaMock.companyClientUser.findFirst.mockResolvedValue(null);
  // O selo "e-mail do mês" varre as guias da competência depois da transação; sem lista o `for…of`
  // estoura e a rota devolve 500 — que não teria nada a ver com o que este teste mede.
  prismaMock.guide.findMany.mockResolvedValue([]);
}

function dadosDoUpdateDaCompany() {
  expect(prismaMock.company.update).toHaveBeenCalledTimes(1);
  return prismaMock.company.update.mock.calls[0][0];
}

describe("PATCH /firm/companies/:id — CNAE com descrição não trava o salvar", () => {
  let app;

  const CNAE_LONGO =
    "46.19-2-00 - Representantes comerciais e agentes do comércio de mercadorias em geral não especializado";
  const CNAE_SECUNDARIO_LONGO = "82.20-2-00 - Atividades de teleatendimento";

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
    bancoNoCaminhoFeliz();
  });

  test("⚠⚠ O PAYLOAD REAL DE PRODUÇÃO É ACEITO — não volta mais `validation_failed`", async () => {
    // Este é o corpo que a tela manda hoje: ela semeia o formulário com o que está no banco, e o
    // que está no banco é a linha inteira. Com o `max(20)` do Zod, isto era 400.
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ cnaePrincipal: CNAE_LONGO }));

    expect(res.status).toBe(200);
    expect(res.body.error).toBeUndefined();
  });

  test("a COLUNA recebe só o código de 7 dígitos — ela tem 20 caracteres", async () => {
    await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payload({ cnaePrincipal: CNAE_LONGO }));

    const { data } = dadosDoUpdateDaCompany();
    expect(data.cnaePrincipal).toBe("4619200");
    // ⚠ A prova é o COMPRIMENTO, não o formato: é ele que o banco recusa.
    expect(data.cnaePrincipal.length).toBeLessThanOrEqual(20);
  });

  test("⚠ A DESCRIÇÃO NÃO SE PERDE — ela vai para `atividades`, com o código na frente", async () => {
    // Sem esta metade o conserto seria uma perda de dado: o texto que o tomador lê no `xDescServ`
    // da DPS sai de `Company.atividades` (`descricaoSugerida.js` é o único consumidor).
    await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payload({ cnaePrincipal: CNAE_LONGO }));

    expect(dadosDoUpdateDaCompany().data.atividades).toEqual([CNAE_LONGO]);
  });

  test("o SECUNDÁRIO segue a mesma regra: código na lista, texto na atividade", async () => {
    await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ cnaePrincipal: CNAE_LONGO, cnaesSecundarios: [CNAE_SECUNDARIO_LONGO] }));

    const { data } = dadosDoUpdateDaCompany();
    expect(data.cnaesSecundarios).toEqual(["8220200"]);
    expect(data.atividades).toEqual([CNAE_LONGO, CNAE_SECUNDARIO_LONGO]);
  });

  test("código NU continua funcionando igual — o caminho de sempre não mudou", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ cnaePrincipal: "6201501" }));

    expect(res.status).toBe(200);
    expect(dadosDoUpdateDaCompany().data.cnaePrincipal).toBe("6201501");
    expect(dadosDoUpdateDaCompany().data.atividades).toEqual(["6201501"]);
  });

  test("⚠ o que NÃO tem 7 dígitos entra CRU — a forma é decisão do validador, não desta separação", async () => {
    // `soCodigoDeCnae` devolve null e o valor original segue. Descartá-lo apagaria do cadastro algo
    // que o contador digitou; e a recusa por forma, se existir, é do normalizador.
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ cnaePrincipal: "620150" }));

    expect(res.status).toBe(200);
    expect(dadosDoUpdateDaCompany().data.cnaePrincipal).toBe("620150");
  });

  test("⚠ a descrição gravada no banco SOBREVIVE a um salvar que manda só o código", async () => {
    // É o caso do dia a dia: o contador abre a ficha, muda o telefone e salva. A tela manda o
    // código; `mesclarAtividades` recupera o texto da linha que já existe.
    prismaMock.company.findUnique.mockResolvedValue({
      id: COMPANY_LEGACY_ID,
      codigoMunicipioIbge: "3304557",
      atividades: [CNAE_LONGO],
    });

    await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payload({ cnaePrincipal: "4619200" }));

    expect(dadosDoUpdateDaCompany().data.atividades).toEqual([CNAE_LONGO]);
  });
});
