// Teste de CARACTERIZAÇÃO de `POST /firm/companies`.
//
// Por que ele existe: até aqui a rota mais crítica do sistema (o único ato que traz uma empresa
// para dentro do portal — seis registros numa transação) não tinha NENHUM teste. O módulo de
// onboarding vai extrair esse corpo para um service compartilhado, e sem uma rede escrita ANTES da
// extração não há como distinguir "refator ok" de "regressão silenciosa".
//
// ⚠ Ele importa o `createFirmPortalRouter` REAL — não um mini-router reconstruído (como faz
// `fiscalRoutes.test.js`). Um mini-router testa uma cópia: ele passaria verde com a rota real
// quebrada. Só o Prisma e o bcrypt são trocados por dublês.
//
// Este arquivo é escrito contra o comportamento ATUAL e deve rodar SEM EDIÇÃO contra o código
// extraído. Qualquer necessidade de editá-lo durante a extração é sinal de mudança de contrato.

import request from "supertest";
import express from "express";

// ── Dublê do Prisma ─────────────────────────────────────────────────────────────
// Proxy que materializa `prisma.<model>.<metodo>` como jest.fn() sob demanda, com referência
// estável (fica cacheada). Enumerar os ~40 models que `routes/firm/index.js` alcança seria uma
// lista que envelhece a cada rota nova — e a falha apareceria como "cannot read property of
// undefined" num teste que não tem nada a ver com o model novo.
//
// O dublê é construído DENTRO da factory porque `jest.mock` é içado para o topo do arquivo:
// referenciar uma const declarada aqui embaixo dá ReferenceError. Ele volta para o teste pelo
// próprio import do módulo mockado, logo abaixo.
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

  // A transação roda o callback com o PRÓPRIO proxy: o `tx` do código de produção e o `prisma`
  // do teste passam a ser o mesmo objeto, então uma asserção sobre `prisma.user.create` enxerga
  // o que aconteceu dentro da transação.
  raiz.$transaction = jest.fn(async (arg) => {
    if (typeof arg === "function") return arg(proxy);
    return Promise.all(arg);
  });

  return { prisma: proxy };
});

jest.mock("bcryptjs", () => ({
  __esModule: true,
  default: {
    hash: jest.fn(async (senha) => `hash:${senha}`),
    compare: jest.fn(async () => true),
    hashSync: jest.fn((senha) => `hash:${senha}`),
    compareSync: jest.fn(() => true),
  },
}));

// As duas dependências best-effort do pós-criação. Ficam mockadas para o teste falar sobre a
// ROTA, não sobre a propagação de regras nem sobre o seed de rotinas — cada um tem (ou terá) o
// seu próprio teste.
jest.mock("../../../application/obrigacoes/RegrasObrigacaoService.js", () => {
  const real = jest.requireActual("../../../application/obrigacoes/RegrasObrigacaoService.js");
  return {
    ...real,
    aplicarRegrasAEmpresaNova: jest.fn(async () => ({ regrasAvaliadas: 0, obrigacoesCriadas: 0 })),
  };
});

jest.mock("../../../application/fiscal/serpro/CompanyRotinasService.js", () => {
  const real = jest.requireActual("../../../application/fiscal/serpro/CompanyRotinasService.js");
  return {
    ...real,
    saveCompanyRotinas: jest.fn(async () => ({ atualizadas: 0 })),
  };
});

import { createFirmPortalRouter } from "../index.js";
import { prisma as prismaMock } from "../../../infrastructure/db/prisma.js";
import { aplicarRegrasAEmpresaNova } from "../../../application/obrigacoes/RegrasObrigacaoService.js";
import { saveCompanyRotinas } from "../../../application/fiscal/serpro/CompanyRotinasService.js";

const USUARIO_LOGADO = {
  id: "user-firm-1",
  role: "contador",
  accountType: "FIRM",
  email: "contador@escritorio.com",
};

// Payload mínimo que HOJE resulta em 201. Cada campo aqui está porque a rota o exige:
// `validateAndNormalizeCompanyProfile` recusa sem CNPJ de 14 dígitos, sem razão social, sem
// regime dos três aceitos, sem CNAE principal e sem os 6 campos de endereço.
function payloadValido(extra = {}) {
  return {
    ownerEmail: "dono@empresa.com",
    ownerName: "Dono da Empresa",
    ownerPassword: "Senha@Forte1",
    company: {
      razaoSocial: "EMPRESA TESTE LTDA",
      cnpj: "11.222.333/0001-81",
      regimeTributario: "SIMPLES",
      cnaePrincipal: "6201-5/01",
      endereco: {
        rua: "Rua das Flores",
        numero: "100",
        bairro: "Centro",
        cidade: "São Paulo",
        uf: "SP",
        cep: "01001-000",
      },
    },
    ...extra,
  };
}

function montarApp() {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...USUARIO_LOGADO } };
    return true;
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log }));
  return app;
}

// Plano de contas global CONFIGURADO (os 5 tipos presentes) — pré-requisito da rota.
function planoGlobalCompleto() {
  prismaMock.chartOfAccount.groupBy.mockResolvedValue([
    { tipo: "ATIVO", _count: { _all: 3 } },
    { tipo: "PASSIVO", _count: { _all: 2 } },
    { tipo: "RECEITA", _count: { _all: 4 } },
    { tipo: "DESPESA", _count: { _all: 9 } },
    { tipo: "PATRIMONIO", _count: { _all: 1 } },
  ]);
}

function caminhoFelizNoBanco({ ownerExistente = null } = {}) {
  prismaMock.user.findUnique.mockResolvedValue(ownerExistente);
  prismaMock.user.create.mockImplementation(async ({ data }) => ({ id: "user-owner-novo", ...data }));
  prismaMock.client.findUnique.mockResolvedValue(null);
  prismaMock.client.create.mockImplementation(async ({ data }) => ({ id: "client-legacy-1", ...data }));
  prismaMock.company.create.mockImplementation(async ({ data }) => ({ id: "company-legacy-1", ...data }));
  prismaMock.portalClient.create.mockImplementation(async ({ data }) => ({ id: "portal-1", ...data }));
  prismaMock.companyClientUser.upsert.mockResolvedValue({});
  prismaMock.companyFirmAccess.upsert.mockResolvedValue({});
}

describe("POST /firm/companies — caracterização do provisionamento de empresa", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
    planoGlobalCompleto();
    caminhoFelizNoBanco();
    aplicarRegrasAEmpresaNova.mockResolvedValue({ regrasAvaliadas: 2, obrigacoesCriadas: 5 });
    saveCompanyRotinas.mockResolvedValue({ atualizadas: 7 });
    prismaMock.portalClient.findMany.mockResolvedValue([{ id: "portal-existente" }]);
  });

  // 1 — o CORPO da resposta é contrato: o front lê `regrasAplicadas` para dizer ao contador se as
  // obrigações nasceram junto (elas são best-effort e podem não ter nascido).
  test("201 devolve exatamente { ok, portalId, companyId, ownerUserId, regrasAplicadas }", async () => {
    const res = await request(app).post("/firm/companies").send(payloadValido());

    expect(res.status).toBe(201);
    expect(Object.keys(res.body).sort()).toEqual(
      ["companyId", "ok", "ownerUserId", "portalId", "regrasAplicadas"].sort()
    );
    expect(res.body.ok).toBe(true);
    expect(res.body.portalId).toBe("portal-1");
    expect(res.body.ownerUserId).toBe("user-owner-novo");
    expect(res.body.regrasAplicadas).toEqual({ regrasAvaliadas: 2, obrigacoesCriadas: 5 });
  });

  // 2 — armadilha nº 3 do plano: `companyId` da resposta é o id do PortalClient, NÃO o da Company
  // legada (que existe e é outro). Quem guardar esse valor como "id da company legada" vai errar
  // o certificado A1, que mora na legada.
  test("companyId da resposta é o PortalClient.id, não o Company legado", async () => {
    const res = await request(app).post("/firm/companies").send(payloadValido());

    expect(res.body.companyId).toBe(res.body.portalId);
    expect(res.body.companyId).toBe("portal-1");
    expect(res.body.companyId).not.toBe("company-legacy-1");
    // e a Company legada REALMENTE foi criada com outro id — senão a asserção acima seria vazia
    expect(prismaMock.company.create).toHaveBeenCalledTimes(1);
  });

  // 3
  test("usuário novo sem senha → 400 owner_password_required_min_8", async () => {
    const body = payloadValido();
    delete body.ownerPassword;
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app).post("/firm/companies").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("owner_password_required_min_8");
    expect(prismaMock.portalClient.create).not.toHaveBeenCalled();
  });

  // 4 — CNPJ repetido não é erro interno: é dado de formulário com conserto do lado de quem
  // cadastra, e o campo em conflito precisa chegar na tela.
  test("P2002 → 409 empresa_ja_cadastrada com o campo em conflito na mensagem", async () => {
    const erro = Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { target: ["cnpj"] },
    });
    prismaMock.portalClient.create.mockRejectedValue(erro);

    const res = await request(app).post("/firm/companies").send(payloadValido());

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("empresa_ja_cadastrada");
    expect(res.body.message).toContain("cnpj");
  });

  // 5
  test("plano global incompleto → 400 global_chart_of_accounts_not_configured + missingTipos", async () => {
    prismaMock.chartOfAccount.groupBy.mockResolvedValue([
      { tipo: "ATIVO", _count: { _all: 1 } },
      { tipo: "RECEITA", _count: { _all: 1 } },
    ]);

    const res = await request(app).post("/firm/companies").send(payloadValido());

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("global_chart_of_accounts_not_configured");
    expect(res.body.missingTipos).toEqual(["PASSIVO", "DESPESA", "PATRIMONIO"]);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  // 6 — sem o vínculo do CHAMADOR a empresa nasce órfã: ninguém do escritório a enxerga.
  test("companyFirmAccess.upsert recebe FIRM_ADMIN e o userId de quem chamou", async () => {
    await request(app).post("/firm/companies").send(payloadValido());

    expect(prismaMock.companyFirmAccess.upsert).toHaveBeenCalledTimes(1);
    const arg = prismaMock.companyFirmAccess.upsert.mock.calls[0][0];
    expect(arg.where.companyId_userId).toEqual({ companyId: "portal-1", userId: "user-firm-1" });
    expect(arg.create).toMatchObject({
      companyId: "portal-1",
      userId: "user-firm-1",
      role: "FIRM_ADMIN",
      status: "ACTIVE",
    });
    expect(arg.update).toMatchObject({ role: "FIRM_ADMIN", status: "ACTIVE" });
  });

  // 7 — o dono já pode ter conta (uma pessoa com duas empresas). Nesse caso a senha não é exigida
  // e nenhum User novo é criado.
  test("owner já existente → não cria User e não exige senha", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-owner-antigo", email: "dono@empresa.com" });
    const body = payloadValido();
    delete body.ownerPassword;

    const res = await request(app).post("/firm/companies").send(body);

    expect(res.status).toBe(201);
    expect(res.body.ownerUserId).toBe("user-owner-antigo");
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  // 8 — a empresa JÁ está criada quando o pós-criação roda. Falha ali não pode desfazer cadastro
  // nem virar 500: no pior caso a obrigação entra na próxima vez que a regra for salva.
  test("aplicarRegrasAEmpresaNova lançando NÃO derruba o 201", async () => {
    aplicarRegrasAEmpresaNova.mockRejectedValue(new Error("propagação explodiu"));

    const res = await request(app).post("/firm/companies").send(payloadValido());

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.portalId).toBe("portal-1");
    expect(res.body.regrasAplicadas).toBeNull();
  });

  // 8-bis — MUDANÇA DE COMPORTAMENTO introduzida junto da extração (decisão 3 do plano):
  // até aqui empresa nova só ganhava `CompanyRotina` quando ALGUÉM abria a página Rotinas e o
  // `seedRotinasFromLegacy` rodava. Agora o pós-criação semeia as 7 rotinas na hora, nos DOIS
  // caminhos de criação.
  //
  // ⚠ O payload precisa ser um OBJETO com as 7 chaves, não o Set que `rotinasPadraoPorRegime`
  // devolve: `saveCompanyRotinas` lê `rotinas[chave] === undefined` e pularia todas, gravando
  // zero linha sem erro nenhum.
  test("empresa nova nasce com as rotinas SERPRO do regime semeadas", async () => {
    const res = await request(app).post("/firm/companies").send(payloadValido());

    expect(res.status).toBe(201);
    expect(saveCompanyRotinas).toHaveBeenCalledTimes(1);
    const [itens] = saveCompanyRotinas.mock.calls[0];
    expect(itens).toEqual([
      {
        companyId: "portal-1",
        rotinas: {
          // regime SIMPLES: inss + pagamento (toda empresa) + das/extrato/parcelamento
          das: true,
          inss: true,
          extrato: true,
          presumido: false,
          parcelamento: true,
          pagamento: true,
          conferencia: false,
        },
      },
    ]);
  });

  test("falha ao semear rotinas NÃO derruba o 201 (pós-criação é best-effort)", async () => {
    saveCompanyRotinas.mockRejectedValue(new Error("banco fora do ar"));

    const res = await request(app).post("/firm/companies").send(payloadValido());

    expect(res.status).toBe(201);
    expect(res.body.regrasAplicadas).toEqual({ regrasAvaliadas: 2, obrigacoesCriadas: 5 });
  });

  // 9 — MEI/OUTRO passam no Zod (`companyCreateSchema` os aceita) e morrem na normalização.
  // Caracteriza o comportamento atual: é o bug que aparece no primeiro MEI real, e o modal de
  // conversão do onboarding tem de forçar um dos três regimes por causa dele.
  test("regime MEI passa no Zod e é recusado com 400 company_regime_tributario_invalid", async () => {
    const body = payloadValido();
    body.company.regimeTributario = "MEI";

    const res = await request(app).post("/firm/companies").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("company_regime_tributario_invalid");
  });

  // 10 — endereço incompleto e CNAE ausente são recusa da normalização, não do Zod. O modal de
  // conversão precisa coletar os dois (a ficha de abertura não tem nenhum deles).
  test("endereço incompleto → 400 company_endereco_required_fields_missing", async () => {
    const body = payloadValido();
    delete body.company.endereco.cep;

    const res = await request(app).post("/firm/companies").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("company_endereco_required_fields_missing");
  });
});
