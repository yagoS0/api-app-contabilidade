// O CAMPO CHEGA AO BANCO? — `PATCH /firm/companies/:id` e o município emissor da NFS-e.
//
// ⚠ POR QUE ESTE TESTE EXISTE, e por que ele olha o ARGUMENTO do `update`.
// A rota lista os campos aceitos UM A UM: monta `data: { razaoSocial, cnpj, … }` a partir de
// `normalizedCompany`. Campo que não esteja nessa lista (ou que o normalizador não devolva) é
// **descartado em silêncio** — o Zod do topo é `.passthrough()`, então nada reclama, a resposta é
// 200 e o valor simplesmente não existe na próxima leitura. É a falha mais provável de um campo
// novo, e a única forma de provar que ela não acontece é olhar o que foi passado ao Prisma.
//
// Medido com esta suíte: removendo a linha `codigoMunicipioIbge:` do `tx.company.update` (ou o
// campo do retorno de `validateAndNormalizeCompanyProfile`), o primeiro teste falha com
// `undefined` no lugar do código — que é exatamente o que o contador veria como "salvei e voltou
// vazio".
//
// Mesmo dublê de Prisma da caracterização do POST: proxy que materializa `prisma.<model>.<metodo>`
// sob demanda, com a transação recebendo o próprio proxy (então `tx.company.update` e
// `prismaMock.company.update` são a mesma função espiã).

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

describe("PATCH /firm/companies/:id — município emissor da NFS-e (codigoMunicipioIbge)", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
    bancoNoCaminhoFeliz();
  });

  test("o código escolhido CHEGA ao update da Company — não é descartado pela lista de campos", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ codigoMunicipioIbge: "3304557" }));

    expect(res.status).toBe(200);
    expect(dadosDoUpdateDaCompany().data.codigoMunicipioIbge).toBe("3304557");
  });

  test("volta na resposta — o `select` da rota precisa trazer a coluna, senão a tela reabre vazia", async () => {
    // O `select` é explícito em `legacyCompanySelect`; sem a coluna ali o Prisma não a devolve e o
    // formulário abriria sempre em branco, com o contador reescolhendo o município a cada edição.
    await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payload({ codigoMunicipioIbge: "3304557" }));
    expect(dadosDoUpdateDaCompany().select.codigoMunicipioIbge).toBe(true);
  });

  test("máscara não atrapalha: pontuação é limpa e sobram os 7 dígitos", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ codigoMunicipioIbge: "3.304.557" }));

    expect(res.status).toBe(200);
    expect(dadosDoUpdateDaCompany().data.codigoMunicipioIbge).toBe("3304557");
  });

  test("vazio grava NULL — desfazer uma escolha errada precisa ser possível", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ codigoMunicipioIbge: "" }));

    expect(res.status).toBe(200);
    expect(dadosDoUpdateDaCompany().data.codigoMunicipioIbge).toBeNull();
  });

  test("código curto → 400 nomeado, e NADA é escrito", async () => {
    // ⚠ A recusa vem do normalizador, não do CHECK do banco: violação de constraint sobe como 500
    // sem nome, e o contador leria "erro interno" sem saber qual campo o servidor recusou.
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ codigoMunicipioIbge: "3304" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("company_codigo_municipio_ibge_invalid");
    expect(prismaMock.company.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  test("texto sem nenhum dígito também é recusado — não vira NULL em silêncio", async () => {
    const res = await request(app)
      .patch(`/firm/companies/${PORTAL_ID}`)
      .send(payload({ codigoMunicipioIbge: "Rio de Janeiro" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("company_codigo_municipio_ibge_invalid");
    expect(prismaMock.company.update).not.toHaveBeenCalled();
  });

  test("⚠ o município do ENDEREÇO nunca vira código sozinho", async () => {
    // O endereço do payload é "Rio de Janeiro/RJ" e o código NÃO vem no corpo. Se algum dia alguém
    // "ajudar" derivando o IBGE do nome, este teste cai — que é o ponto: homônimo (há cinco "Bom
    // Jesus" no país) produziria nota emitida no município errado, em silêncio.
    const res = await request(app).patch(`/firm/companies/${PORTAL_ID}`).send(payload());

    expect(res.status).toBe(200);
    expect(dadosDoUpdateDaCompany().data.codigoMunicipioIbge).toBeNull();
  });
});
