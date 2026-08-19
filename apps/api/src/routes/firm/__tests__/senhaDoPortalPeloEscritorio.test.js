// A PORTA DO CONTADOR PARA A SENHA DO CLIENTE —
// `GET  /firm/companies/:id/acesso-portal`
// `POST /firm/companies/:id/acesso-portal/:userId/senha`
//
// ⚠ AS SEIS COISAS QUE ESTE ARQUIVO PROVA, e nenhuma delas é cerimônia:
//   1. a senha nova é GERADA pelo servidor e volta UMA VEZ — o contador não a digita;
//   2. a troca REVOGA TODAS AS SESSÕES do usuário, na MESMA transação. Sem isso, a sessão antiga
//      do cliente sobreviveria a uma senha trocada pelo contador — o oposto do que a troca serve;
//   3. a AUDITORIA é escrita no mesmo commit: quem trocou, quando, e por qual caminho;
//   4. NADA da senha entra na auditoria nem no log;
//   5. o `userId` é obrigatório e TEM DE SER DESTA EMPRESA — o servidor nunca escolhe sozinho;
//   6. o gate é `ACCOUNTANT`+, o mesmo de `PATCH .../emissao-cliente`, porque quem define a senha
//      do cliente pode entrar como ele e emitir NFS-e em nome da empresa dele.
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
import { gerarSenhaDoPortal } from "../../../application/auth/SenhaDoPortalService.js";
import { validateStrongPassword } from "../../../application/validators/passwordPolicy.js";

const PORTAL_ID = "portal-1";
const CLIENTE_ID = "user-cliente-1";
// ⚠ `role: "admin"` (e não "contador") porque `requireFirmCompanyAccess` só curto-circuita para
// admin — "contador" cai no `CompanyFirmAccess` como qualquer outro.
const CONTADOR = {
  id: "user-firm-1",
  role: "admin",
  accountType: "FIRM",
  name: "Contador Fulano",
  email: "contador@escritorio.com",
};

let logSpy;

function montarApp(user = CONTADOR) {
  const app = express();
  app.use(express.json());
  app.locals.ensureAuthorized = async (req) => {
    req.auth = { user: { ...user } };
    return true;
  };
  logSpy = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized: app.locals.ensureAuthorized, log: logSpy }));
  return app;
}

function vinculoAtivo() {
  return {
    role: "OWNER",
    user: { id: CLIENTE_ID, name: "Maria do Cliente", email: "maria@empresa.com.br" },
  };
}

describe("a senha NOVA é gerada, nunca digitada", () => {
  test("passa na política do sistema, em 200 sorteios", () => {
    // ⚠ 200 e não 1: o gerador planta as três classes obrigatórias em POSIÇÕES SORTEADAS, e um
    // sorteio só provaria pouco. Senha gerada que falha na política vira "não consigo entrar" do
    // lado do cliente, depois de o contador já ter ditado o valor.
    for (let i = 0; i < 200; i += 1) {
      expect(validateStrongPassword(gerarSenhaDoPortal()).ok).toBe(true);
    }
  });

  test("não tem caractere ambíguo — ela vai ser DITADA por telefone", () => {
    for (let i = 0; i < 200; i += 1) {
      // `O/0` e `I/l/1` voltam como "não consigo entrar" e gastam uma segunda troca.
      expect(gerarSenhaDoPortal()).not.toMatch(/[Oo0Il1]/);
    }
  });

  test("duas chamadas seguidas não repetem — nada é derivado de id, e-mail ou relógio", () => {
    const amostra = new Set(Array.from({ length: 50 }, () => gerarSenhaDoPortal()));
    expect(amostra.size).toBe(50);
  });
});

describe("POST /firm/companies/:id/acesso-portal/:userId/senha", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
    prismaMock.companyClientUser.findFirst.mockResolvedValue(vinculoAtivo());
    prismaMock.user.update.mockResolvedValue({ id: CLIENTE_ID });
    prismaMock.clientSession.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.portalPasswordChange.create.mockImplementation(async ({ data }) => ({
      id: "troca-1",
      createdAt: new Date("2026-08-19T12:00:00.000Z"),
      ...data,
    }));
  });

  async function trocar(body = { confirmado: true }, userId = CLIENTE_ID) {
    return request(app).post(`/firm/companies/${PORTAL_ID}/acesso-portal/${userId}/senha`).send(body);
  }

  test("devolve a senha UMA VEZ, com `Cache-Control: no-store`, e grava o hash", async () => {
    const res = await trocar();

    expect(res.status).toBe(200);
    expect(typeof res.body.senha).toBe("string");
    expect(validateStrongPassword(res.body.senha).ok).toBe(true);
    // ⚠ Sem `no-store`, o corpo que carrega a senha em claro ganha cópia no cache do navegador e em
    // qualquer proxy do caminho — e "exibida uma vez" deixa de ser verdade.
    expect(res.headers["cache-control"]).toBe("no-store");

    const { where, data } = prismaMock.user.update.mock.calls[0][0];
    expect(where).toEqual({ id: CLIENTE_ID });
    // ⚠ O QUE VAI PARA O BANCO É BCRYPT, e não o texto claro. Se um dia alguém "simplificar" isto,
    // uma cópia do banco vira a senha de todos os clientes do escritório.
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(data.passwordHash).not.toContain(res.body.senha);
  });

  test("a tela recebe DE QUEM é a senha — nome e e-mail, não 'a senha do portal'", async () => {
    const res = await trocar();
    expect(res.body.usuario).toMatchObject({
      userId: CLIENTE_ID,
      nome: "Maria do Cliente",
      email: "maria@empresa.com.br",
      papel: "OWNER",
    });
  });

  test("⚠ REVOGA TODAS AS SESSÕES do usuário, e os tokens de recuperação pendentes", async () => {
    await trocar();

    // Sem isto, a sessão antiga do cliente sobrevive a uma senha trocada pelo contador — que é o
    // oposto do que a troca serve. É a mesma garantia que `/auth/change-password` já dá.
    const sessoes = prismaMock.clientSession.updateMany.mock.calls[0][0];
    expect(sessoes.where).toEqual({ userId: CLIENTE_ID, revokedAt: null });
    expect(sessoes.data.revokedAt).toBeInstanceOf(Date);

    // Um link de "esqueci minha senha" pedido ANTES desfaria em silêncio a senha recém-ditada.
    const tokens = prismaMock.passwordResetToken.updateMany.mock.calls[0][0];
    expect(tokens.where).toEqual({ userId: CLIENTE_ID, usedAt: null });
    expect(tokens.data.usedAt).toBeInstanceOf(Date);
  });

  test("⚠ as quatro escritas acontecem na MESMA transação", async () => {
    await trocar();
    // Senha nova com sessão viva, ou senha nova sem auditoria, são os estados intermediários que a
    // transação evita — e são justamente os dois que ninguém descobre olhando a tela.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(typeof prismaMock.$transaction.mock.calls[0][0]).toBe("function");
  });

  test("⚠ a AUDITORIA registra quem trocou, quando e por qual caminho", async () => {
    await trocar();

    const { data } = prismaMock.portalPasswordChange.create.mock.calls[0][0];
    expect(data.userId).toBe(CLIENTE_ID);
    expect(data.portalClientId).toBe(PORTAL_ID);
    expect(data.origem).toBe("ESCRITORIO");
    expect(data.autorUserId).toBe(CONTADOR.id);
    // Cópia imutável: o contador pode ser desligado e apagado, e a linha continua contando quem foi.
    expect(data.autorNome).toBe("Contador Fulano");
    expect(data.autorEmail).toBe("contador@escritorio.com");
  });

  test("⚠⚠ NADA da senha entra na auditoria — nem claro, nem hash, nem tamanho", async () => {
    const res = await trocar();
    const { data } = prismaMock.portalPasswordChange.create.mock.calls[0][0];

    const serializado = JSON.stringify(data);
    expect(serializado).not.toContain(res.body.senha);
    expect(serializado).not.toContain(prismaMock.user.update.mock.calls[0][0].data.passwordHash);
    // Nem por outro nome: nenhuma chave desta linha pode se parecer com senha.
    for (const chave of Object.keys(data)) {
      expect(chave).not.toMatch(/senha|password|hash/i);
    }
    // E o tamanho também não — ele estreita o espaço de busca de quem olhar a tabela.
    expect(serializado).not.toContain(String(res.body.senha.length));
  });

  test("⚠⚠ NADA da senha entra no LOG", async () => {
    const res = await trocar();
    const logado = JSON.stringify(logSpy.info.mock.calls.concat(logSpy.error.mock.calls));
    expect(logado).not.toContain(res.body.senha);
    expect(logado).toContain(CLIENTE_ID);
  });

  test("sem `confirmado: true` NADA acontece", async () => {
    // Duplo cinto: a tela já confirmou repetindo os dados; o servidor recusa mesmo assim, porque um
    // dos dois lados sozinho já foi contornado antes neste projeto.
    const res = await trocar({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("confirmacao_obrigatoria");
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  test("⚠ `userId` de OUTRA empresa é recusado — o gate da empresa não basta", async () => {
    // Multi-tenancy em dois pontos: o middleware diz que este contador pode falar desta empresa; o
    // `where` do service diz que este usuário é DESTA empresa. Sem o segundo, um `userId` de outro
    // cliente teria a senha trocada passando pelo gate da empresa errada.
    prismaMock.companyClientUser.findFirst.mockResolvedValue(null);

    const res = await trocar({ confirmado: true }, "user-de-outra-empresa");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("usuario_nao_e_do_portal");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    // O `where` carrega a empresa, não só o usuário.
    expect(prismaMock.companyClientUser.findFirst.mock.calls[0][0].where).toEqual({
      companyId: PORTAL_ID,
      userId: "user-de-outra-empresa",
      status: "ACTIVE",
    });
  });

  test("⚠ STAFF do escritório NÃO troca a senha — o gate é ACCOUNTANT+", async () => {
    // Mesmo gate de `PATCH .../emissao-cliente`, e pelo mesmo motivo: quem define a senha do
    // cliente pode entrar como ele e emitir NFS-e em nome da empresa dele.
    const appStaff = montarApp({ id: "user-staff", role: "firm", accountType: "FIRM" });
    prismaMock.companyFirmAccess.findUnique.mockResolvedValue({ role: "STAFF", status: "ACTIVE", scopes: [] });

    const res = await request(appStaff)
      .post(`/firm/companies/${PORTAL_ID}/acesso-portal/${CLIENTE_ID}/senha`)
      .send({ confirmado: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("insufficient_role");
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe("GET /firm/companies/:id/acesso-portal — o ESTADO que a tela mostra", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = montarApp();
  });

  test("nomeia cada usuário e diz quando a senha foi trocada e por quem", async () => {
    prismaMock.companyClientUser.findMany.mockResolvedValue([
      {
        id: "link-1",
        role: "OWNER",
        status: "ACTIVE",
        createdAt: new Date("2026-01-10T00:00:00.000Z"),
        user: { id: CLIENTE_ID, name: "Maria do Cliente", email: "maria@empresa.com.br", status: "active" },
      },
    ]);
    prismaMock.portalPasswordChange.findMany.mockResolvedValue([
      {
        userId: CLIENTE_ID,
        origem: "ESCRITORIO",
        autorUserId: CONTADOR.id,
        autorNome: "Contador Fulano",
        autorEmail: "contador@escritorio.com",
        createdAt: new Date("2026-08-19T12:00:00.000Z"),
      },
    ]);

    const res = await request(app).get(`/firm/companies/${PORTAL_ID}/acesso-portal`);

    expect(res.status).toBe(200);
    expect(res.body.usuarios).toHaveLength(1);
    expect(res.body.usuarios[0]).toMatchObject({
      userId: CLIENTE_ID,
      nome: "Maria do Cliente",
      email: "maria@empresa.com.br",
      papel: "OWNER",
    });
    expect(res.body.usuarios[0].ultimaTroca).toMatchObject({
      origem: "ESCRITORIO",
      autorNome: "Contador Fulano",
    });
    expect(res.body.podeDefinirSenha).toBe(true);
  });

  test("⚠ a ÚLTIMA troca vence — e ela pode ser a do próprio cliente", async () => {
    // É UMA SENHA SÓ com três caminhos. Se a tela mostrasse sempre a troca do escritório, ela diria
    // "trocada por mim" muito depois de o cliente ter trocado por conta própria.
    prismaMock.companyClientUser.findMany.mockResolvedValue([
      {
        id: "link-1",
        role: "OWNER",
        status: "ACTIVE",
        createdAt: new Date("2026-01-10T00:00:00.000Z"),
        user: { id: CLIENTE_ID, name: "Maria", email: "maria@empresa.com.br", status: "active" },
      },
    ]);
    // O service pede `orderBy: createdAt desc` e fica com a PRIMEIRA de cada usuário.
    prismaMock.portalPasswordChange.findMany.mockResolvedValue([
      { userId: CLIENTE_ID, origem: "CLIENTE_PERFIL", autorUserId: CLIENTE_ID, autorNome: null, autorEmail: null, createdAt: new Date("2026-08-19T18:00:00.000Z") },
      { userId: CLIENTE_ID, origem: "ESCRITORIO", autorUserId: CONTADOR.id, autorNome: "Contador Fulano", autorEmail: null, createdAt: new Date("2026-08-19T12:00:00.000Z") },
    ]);

    const res = await request(app).get(`/firm/companies/${PORTAL_ID}/acesso-portal`);

    expect(res.body.usuarios[0].ultimaTroca.origem).toBe("CLIENTE_PERFIL");
    expect(prismaMock.portalPasswordChange.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: "desc" });
  });

  test("usuário sem nenhuma troca registrada volta `ultimaTroca: null` — não uma data inventada", async () => {
    // A senha pode ter sido definida no provisionamento da empresa, anterior a esta tabela. A tela
    // diz "não há registro" com todas as letras; inventar uma data seria pior que não ter nenhuma.
    prismaMock.companyClientUser.findMany.mockResolvedValue([
      {
        id: "link-1",
        role: "OWNER",
        status: "ACTIVE",
        createdAt: new Date("2026-01-10T00:00:00.000Z"),
        user: { id: CLIENTE_ID, name: "Maria", email: "maria@empresa.com.br", status: "active" },
      },
    ]);
    prismaMock.portalPasswordChange.findMany.mockResolvedValue([]);

    const res = await request(app).get(`/firm/companies/${PORTAL_ID}/acesso-portal`);
    expect(res.body.usuarios[0].ultimaTroca).toBeNull();
  });

  test("⚠ o `select` do vínculo traz TUDO que o cartão mostra", async () => {
    // Campo que não entre no `select` explícito volta `undefined` sem erro, e a tela mostra em
    // branco. Este projeto já pagou isso três vezes esta semana.
    prismaMock.companyClientUser.findMany.mockResolvedValue([]);
    prismaMock.portalPasswordChange.findMany.mockResolvedValue([]);

    await request(app).get(`/firm/companies/${PORTAL_ID}/acesso-portal`);

    const { where, select } = prismaMock.companyClientUser.findMany.mock.calls[0][0];
    expect(where).toEqual({ companyId: PORTAL_ID, status: "ACTIVE" });
    expect(select.role).toBe(true);
    expect(select.user.select).toEqual({ id: true, name: true, email: true, status: true });
  });

  test("STAFF LÊ o estado, mas recebe `podeDefinirSenha: false`", async () => {
    // O botão precisa nascer desabilitado NOMEANDO o motivo, em vez de o contador descobrir o 403
    // clicando. Antecipar não é substituir: quem recusa continua sendo o middleware.
    const appStaff = montarApp({ id: "user-staff", role: "firm", accountType: "FIRM" });
    prismaMock.companyFirmAccess.findUnique.mockResolvedValue({ role: "STAFF", status: "ACTIVE", scopes: [] });
    prismaMock.companyClientUser.findMany.mockResolvedValue([]);
    prismaMock.portalPasswordChange.findMany.mockResolvedValue([]);

    const res = await request(appStaff).get(`/firm/companies/${PORTAL_ID}/acesso-portal`);

    expect(res.status).toBe(200);
    expect(res.body.podeDefinirSenha).toBe(false);
    expect(res.body.papelMinimoDefinirSenha).toBe("ACCOUNTANT");
  });
});
