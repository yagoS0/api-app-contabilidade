// ⚠⚠ A RESPOSTA DO LOGIN TEM DE CARREGAR A PORTA DO PORTAL DO CLIENTE (30/08/2026)
//
// > Dono: *"alterou os logins, nao consigo acessar o portal do cliente com meu login novo"*
//
// A marca `podeAbrirPortalDoCliente` existia no banco, `sanitizeUser` a carregava e os três
// middlewares a liam — mas o objeto `user` desta resposta é montado À MÃO, campo a campo, e ela
// ficou de fora. `accountGate.exigirContaDeCliente`, no portal, via `accountType: "FIRM"` sem a
// marca e recusava NA TELA: o servidor, que autorizaria, nunca chegava a ser chamado.
//
// ⚠ Não foi a troca de e-mail que quebrou nada — o login sempre esteve assim. O e-mail novo só foi
// a primeira vez que se tentou entrar depois de a marca existir.
//
// ⚠⚠ ESTA SUÍTE EXISTE PORQUE O OBJETO É MONTADO À MÃO. Todo campo novo do usuário que a tela
// precise ler cai no mesmo buraco, em silêncio — sem erro, sem log, com o login respondendo 200.

import request from "supertest";
import express from "express";

jest.mock("../../config.js", () => ({
  ...jest.requireActual("../../config.js"),
  USE_GMAIL_API: false,
}));

// Mesmo dublê de Prisma das outras suítes de rota: proxy que materializa `prisma.<model>.<metodo>`
// sob demanda. Nenhum caminho medido aqui toca o banco, mas o módulo importa `prisma` no topo.
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
            if (!m[metodo]) m[metodo] = jest.fn(async () => []);
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

jest.mock("../../infrastructure/mail/EmailService.js", () => ({
  EmailService: class {
    async send() {}
  },
}));

import { createAuthRouter } from "../auth.js";

// ⚠ O visitante é FIRM. É o ponto: a marca abre a porta SEM trocar o tipo da conta — trocar o tipo
// tiraria dele o portal do escritório, e promover a `admin` daria bypass total nos middlewares.
const VISITANTE = {
  id: "u-firm",
  email: "yago@altan.company",
  name: "Yago",
  role: "contador",
  accountType: "FIRM",
  podeAbrirPortalDoCliente: true,
  source: "db",
};

function montarApp(usuario) {
  const app = express();
  app.use(express.json());
  app.use(
    "/auth",
    createAuthRouter({
      AuthService: {
        isEnabled: () => true,
        authenticate: jest.fn(async () => (usuario ? { ok: true, user: usuario } : { ok: false })),
        authenticateClient: jest.fn(async () => ({ ok: false })),
        generateToken: () => "access-token",
        generateRefreshToken: () => "refresh-token",
      },
      UserRepository: { findByEmail: jest.fn(async () => null), findById: jest.fn(async () => null) },
      log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
      ensureAuthorized: async () => false,
    })
  );
  return app;
}

function entrar(usuario) {
  return request(montarApp(usuario))
    .post("/auth/login")
    .send({ email: usuario?.email || "quem@exemplo.com", password: "SenhaQualquer#2026" });
}

describe("⚠⚠ o login e a porta do portal do cliente", () => {
  it("o visitante marcado recebe a marca na resposta — é ela que a TELA lê", async () => {
    const r = await entrar(VISITANTE);
    expect(r.status).toBe(200);
    expect(r.body.user.podeAbrirPortalDoCliente).toBe(true);
  });

  it("⚠⚠ e a conta continua FIRM — a marca abre a porta, não troca o tipo da conta", async () => {
    // Trocar o tipo tiraria dele o portal do ESCRITÓRIO, que é onde ele trabalha.
    const r = await entrar(VISITANTE);
    expect(r.body.user.accountType).toBe("FIRM");
    expect(r.body.user.role).toBe("contador");
  });

  it("⚠⚠ contador SEM a marca responde `false` — é o que mantém o 'só eu'", async () => {
    const r = await entrar({ ...VISITANTE, id: "u-2", podeAbrirPortalDoCliente: undefined });
    expect(r.status).toBe(200);
    expect(r.body.user.podeAbrirPortalDoCliente).toBe(false);
  });

  it("⚠ `=== true`, nunca truthy — valor estranho no campo NÃO vira permissão", async () => {
    // Ausência e lixo falham FECHADO. O `Boolean()` seria mais frouxo: `"false"` é truthy.
    for (const v of [null, 0, "", "true", 1, {}, "sim"]) {
      const r = await entrar({ ...VISITANTE, podeAbrirPortalDoCliente: v });
      expect(r.body.user.podeAbrirPortalDoCliente).toBe(false);
    }
  });

  it("o cliente comum não depende da marca — ele entra por `accountType: CLIENT`", async () => {
    const r = await entrar({
      id: "u-cli",
      email: "dono@empresa.com.br",
      name: "Dono",
      role: "user",
      accountType: "CLIENT",
      source: "env", // evita a criação de ClientSession, que não é o que esta suíte mede
    });
    expect(r.body.user.accountType).toBe("CLIENT");
    expect(r.body.user.podeAbrirPortalDoCliente).toBe(false);
  });

  it("⚠ os campos que a tela já usava continuam na resposta — nada foi trocado de lugar", async () => {
    const r = await entrar(VISITANTE);
    expect(Object.keys(r.body.user).sort()).toEqual(
      ["accountType", "defaultClientId", "id", "name", "podeAbrirPortalDoCliente", "role"].sort()
    );
    expect(r.body.accessToken).toBe("access-token");
    expect(r.body.refreshToken).toBe("refresh-token");
  });
});
