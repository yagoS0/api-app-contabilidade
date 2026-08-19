// É UMA SENHA SÓ, COM TRÊS CAMINHOS — e os três TÊM de registrar a troca.
//
// O caminho do escritório (`POST /firm/companies/:id/acesso-portal/:userId/senha`) é medido em
// `routes/firm/__tests__/senhaDoPortalPeloEscritorio.test.js`. Este arquivo mede os DOIS DO CLIENTE:
//
//   `POST /auth/change-password`  → origem `CLIENTE_PERFIL`
//   `POST /auth/reset-password`   → origem `CLIENTE_RECUPERACAO`
//
// ⚠⚠ POR QUE ISTO É UMA SUÍTE, e não uma linha de comentário. A tela do contador mostra "a senha
// foi trocada pela última vez em X por Y". Se só o caminho DELE registrasse, ela continuaria
// mostrando a troca do escritório como a última **muito depois** de o cliente ter trocado por conta
// própria — o estado errado exatamente no caso em que ele importa (o cliente trocou porque
// desconfiou de algo, e o contador não fica sabendo).
//
// ⚠ E os dois caminhos do cliente também REVOGAM as sessões e QUEIMAM os tokens de recuperação
// pendentes, na mesma transação. Esta suíte mede isso pelo argumento passado ao Prisma.

import request from "supertest";
import express from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";

jest.mock("../../config.js", () => ({
  ...jest.requireActual("../../config.js"),
  USE_GMAIL_API: false,
  FROM: "contabilidade@exemplo.com",
  SMTP_HOST: "smtp.exemplo.com",
  PORTAL_CLIENTE_WEB_URL: "https://portal.exemplo.com",
  PASSWORD_RESET_TTL_MINUTES: 60,
}));

// Mesmo dublê de Prisma das suítes de rota do escritório: proxy que materializa
// `prisma.<model>.<metodo>` sob demanda, com a transação recebendo o próprio proxy.
jest.mock("../../infrastructure/db/prisma.js", () => {
  const models = {};
  const raiz = {};
  const proxy = new Proxy(raiz, {
    get(alvo, prop) {
      if (typeof prop === "symbol") return alvo[prop];
      if (prop === "$transaction") return alvo.$transaction;
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

jest.mock("../../infrastructure/mail/EmailService.js", () => ({
  EmailService: class {
    async send() {}
  },
}));

import { createAuthRouter } from "../auth.js";
import { prisma as prismaMock } from "../../infrastructure/db/prisma.js";

const USER_ID = "user-cliente-1";
const SENHA_ATUAL = "SenhaAntiga#2026";
const SENHA_NOVA = "SenhaNova#2026";

let logSpy;
let usuario;

function montarApp({ autenticado = true } = {}) {
  const app = express();
  app.use(express.json());
  logSpy = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  app.use(
    "/auth",
    createAuthRouter({
      AuthService: { isEnabled: () => true, authenticate: jest.fn(), authenticateClient: jest.fn() },
      UserRepository: {
        findByEmail: jest.fn(async () => null),
        findById: jest.fn(async () => usuario),
        updateUser: jest.fn(async () => usuario),
      },
      log: logSpy,
      ensureAuthorized: async (req) => {
        if (!autenticado) return false;
        req.auth = { user: { id: USER_ID, email: usuario.email, name: usuario.name } };
        return true;
      },
    })
  );
  return app;
}

function linhaDeAuditoria() {
  return prismaMock.portalPasswordChange.create.mock.calls[0][0].data;
}

beforeEach(async () => {
  jest.clearAllMocks();
  usuario = {
    id: USER_ID,
    name: "Maria do Cliente",
    email: "maria@empresa.com.br",
    passwordHash: await bcrypt.hash(SENHA_ATUAL, 10),
    status: "active",
  };
  prismaMock.portalPasswordChange.create.mockImplementation(async ({ data }) => ({
    id: "troca-1",
    createdAt: new Date("2026-08-19T18:00:00.000Z"),
    ...data,
  }));
});

describe("POST /auth/change-password — o cliente trocando a própria", () => {
  async function trocar(body = { currentPassword: SENHA_ATUAL, newPassword: SENHA_NOVA }) {
    return request(montarApp()).post("/auth/change-password").send(body);
  }

  test("registra a troca com origem CLIENTE_PERFIL e o próprio dono como autor", async () => {
    const res = await trocar();

    expect(res.status).toBe(200);
    const data = linhaDeAuditoria();
    expect(data.userId).toBe(USER_ID);
    expect(data.origem).toBe("CLIENTE_PERFIL");
    // ⚠ `portalClientId` NULO não é "não sabemos": é "não houve empresa". Este caminho não passa
    // por empresa nenhuma, e inventar uma diria que o contador estava envolvido.
    expect(data.portalClientId).toBeNull();
    expect(data.autorUserId).toBe(USER_ID);
  });

  test("⚠ revoga TODAS as sessões e queima os tokens pendentes, na MESMA transação", async () => {
    await trocar();

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.clientSession.updateMany.mock.calls[0][0].where).toEqual({
      userId: USER_ID,
      revokedAt: null,
    });
    // Um link de "esqueci minha senha" pedido antes desfaria em silêncio a senha recém-trocada.
    expect(prismaMock.passwordResetToken.updateMany.mock.calls[0][0].where).toEqual({
      userId: USER_ID,
      usedAt: null,
    });
  });

  test("o que vai para o banco é BCRYPT, e a senha não entra na auditoria", async () => {
    await trocar();

    const { data } = prismaMock.user.update.mock.calls[0][0];
    expect(data.passwordHash).toMatch(/^\$2[aby]\$/);
    const serializado = JSON.stringify(linhaDeAuditoria());
    expect(serializado).not.toContain(SENHA_NOVA);
    expect(serializado).not.toContain(SENHA_ATUAL);
    expect(serializado).not.toContain(data.passwordHash);
  });

  test("senha atual errada NÃO troca e NÃO registra nada", async () => {
    const res = await trocar({ currentPassword: "ChutePorAcaso#1", newPassword: SENHA_NOVA });

    expect(res.status).toBe(401);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.portalPasswordChange.create).not.toHaveBeenCalled();
  });

  test("senha nova fraca NÃO troca e NÃO registra nada", async () => {
    const res = await trocar({ currentPassword: SENHA_ATUAL, newPassword: "abc" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("weak_password");
    expect(prismaMock.portalPasswordChange.create).not.toHaveBeenCalled();
  });
});

describe("POST /auth/reset-password — o cliente pelo link do e-mail", () => {
  const TOKEN = "a".repeat(64);

  beforeEach(() => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "prt-1",
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: null,
    });
  });

  test("registra a troca com origem CLIENTE_RECUPERACAO", async () => {
    const res = await request(montarApp({ autenticado: false }))
      .post("/auth/reset-password")
      .send({ token: TOKEN, password: SENHA_NOVA });

    expect(res.status).toBe(200);
    const data = linhaDeAuditoria();
    expect(data.userId).toBe(USER_ID);
    expect(data.origem).toBe("CLIENTE_RECUPERACAO");
    expect(data.portalClientId).toBeNull();
    // Quem redefine pelo link é quem tem a caixa de e-mail: o autor é o próprio dono da senha.
    expect(data.autorUserId).toBe(USER_ID);
  });

  test("⚠ NEM A SENHA NEM O TOKEN entram na linha de auditoria", async () => {
    await request(montarApp({ autenticado: false }))
      .post("/auth/reset-password")
      .send({ token: TOKEN, password: SENHA_NOVA });

    const serializado = JSON.stringify(linhaDeAuditoria());
    expect(serializado).not.toContain(SENHA_NOVA);
    expect(serializado).not.toContain(TOKEN);
    // Nem o hash do token — ele é o que identifica o link no banco.
    expect(serializado).not.toContain(
      crypto.createHash("sha256").update(TOKEN).digest("hex")
    );
  });

  test("token já usado NÃO registra troca nenhuma", async () => {
    prismaMock.passwordResetToken.findUnique.mockResolvedValue({
      id: "prt-1",
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      usedAt: new Date(),
    });

    const res = await request(montarApp({ autenticado: false }))
      .post("/auth/reset-password")
      .send({ token: TOKEN, password: SENHA_NOVA });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_reset_token");
    expect(prismaMock.portalPasswordChange.create).not.toHaveBeenCalled();
  });
});
