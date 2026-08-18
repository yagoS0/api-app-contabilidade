// RECUPERAÇÃO DE SENHA — as regras que não podem quebrar em silêncio.
//
// ⚠ POR QUE ESTA SUÍTE EXISTE. Antes desta entrega não havia NADA: `grep -iE
// "forgot|reset|recuperar|esqueci" src/routes/auth.js` não achava uma linha, e o cliente que
// esquecia a senha dependia do escritório mexer no banco à mão. A tela que resolve isso é também a
// que classicamente vaza QUEM É CLIENTE DE QUEM (enumeração de usuário), então cada regra abaixo é
// verificada pelo comportamento observável, não pela leitura do código.
//
// ⚠ NENHUM E-MAIL SAI DAQUI. `EmailService` é substituído por um transporte falso que só guarda o
// que teria sido enviado — é dele que os testes leem o token em claro.

import request from "supertest";
import express from "express";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Configuração: mailer "configurado" e base do portal definida, para que a rota chegue ao
// caminho normal em vez de recusar com 503.
// ─────────────────────────────────────────────────────────────────────────────────────────────
jest.mock("../../config.js", () => ({
  ...jest.requireActual("../../config.js"),
  USE_GMAIL_API: false,
  FROM: "contabilidade@exemplo.com",
  SMTP_HOST: "smtp.exemplo.com",
  PORTAL_CLIENTE_WEB_URL: "https://portal.exemplo.com",
  PASSWORD_RESET_TTL_MINUTES: 60,
}));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// "Banco" em memória
// ─────────────────────────────────────────────────────────────────────────────────────────────
const mockDb = { users: [], tokens: [], sessions: [] };
let mockSeq = 0;

jest.mock("../../infrastructure/db/prisma.js", () => {
  const casa = (linha, where) =>
    Object.entries(where).every(([k, v]) => (v === null ? linha[k] === null : linha[k] === v));

  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }) => {
        const alvo = mockDb.users.find(
          (u) => (where.id && u.id === where.id) || (where.email && u.email === where.email)
        );
        return alvo ? { ...alvo } : null;
      }),
      update: jest.fn(async ({ where, data }) => {
        const alvo = mockDb.users.find((u) => u.id === where.id);
        if (!alvo) throw new Error("user_not_found");
        Object.assign(alvo, data);
        return { ...alvo };
      }),
    },
    passwordResetToken: {
      create: jest.fn(async ({ data }) => {
        mockSeq += 1;
        const linha = { id: `prt-${mockSeq}`, usedAt: null, createdAt: new Date(), ...data };
        mockDb.tokens.push(linha);
        return { ...linha };
      }),
      findUnique: jest.fn(async ({ where }) => {
        const alvo = mockDb.tokens.find((t) => t.tokenHash === where.tokenHash);
        return alvo ? { ...alvo } : null;
      }),
      updateMany: jest.fn(async ({ where, data }) => {
        const alvos = mockDb.tokens.filter((t) => casa(t, where));
        alvos.forEach((t) => Object.assign(t, data));
        return { count: alvos.length };
      }),
    },
    clientSession: {
      updateMany: jest.fn(async ({ where, data }) => {
        const alvos = mockDb.sessions.filter((s) => casa(s, where));
        alvos.forEach((s) => Object.assign(s, data));
        return { count: alvos.length };
      }),
    },
    company: { findMany: jest.fn(async () => []) },
    portalClient: { findFirst: jest.fn(async () => null) },
    $transaction: jest.fn(async (arg) =>
      typeof arg === "function" ? arg(prisma) : Promise.all(arg)
    ),
  };
  return { prisma };
});

// ⚠ TRANSPORTE FALSO — nada sai da máquina. Guarda `{to, subject, html}` para que os testes possam
// ler o link (e portanto o token em claro) exatamente como o usuário o receberia.
const mockEnviados = [];
let mockFalharEnvio = false;

jest.mock("../../infrastructure/mail/EmailService.js", () => ({
  EmailService: class {
    async send(msg) {
      if (mockFalharEnvio) throw new Error("smtp_indisponivel");
      mockEnviados.push(msg);
    }
  },
}));

import { createAuthRouter } from "../auth.js";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Apoio
// ─────────────────────────────────────────────────────────────────────────────────────────────
const SENHA_FORTE = "SenhaNova#2026";
const EMAIL_EXISTENTE = "cliente@exemplo.com";
const EMAIL_INEXISTENTE = "ninguem@exemplo.com";

const sha256 = (v) => crypto.createHash("sha256").update(String(v)).digest("hex");

// Tudo que passou por qualquer logger, em qualquer nível. É sobre este array que a varredura de
// vazamento do token roda.
let logs = [];

function criarLog() {
  const registrar = (nivel) => (...args) => logs.push({ nivel, args });
  return {
    info: jest.fn(registrar("info")),
    warn: jest.fn(registrar("warn")),
    error: jest.fn(registrar("error")),
    debug: jest.fn(registrar("debug")),
  };
}

function montarApp() {
  const app = express();
  app.use(express.json());
  const AuthService = {
    isEnabled: () => true,
    authenticate: jest.fn(async () => ({ ok: false, error: "invalid_credentials" })),
    authenticateClient: jest.fn(async () => ({ ok: false })),
  };
  const UserRepository = {
    findByEmail: async (email) => {
      const { prisma } = await import("../../infrastructure/db/prisma.js");
      return prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    },
    findById: jest.fn(async () => null),
  };
  app.use(
    "/auth",
    createAuthRouter({
      AuthService,
      UserRepository,
      log: criarLog(),
      ensureAuthorized: async () => false,
    })
  );
  return app;
}

// A rota responde ANTES de criar o token e mandar o e-mail (fecha o oráculo de tempo), então o
// teste precisa deixar a fila de microtasks drenar antes de olhar o resultado.
async function drenar() {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 0));
  }
}

/** Faz o pedido e devolve o token em claro extraído do e-mail que teria sido enviado. */
async function pedirTokenPara(app, email = EMAIL_EXISTENTE) {
  await request(app).post("/auth/forgot-password").send({ email });
  await drenar();
  const msg = mockEnviados[mockEnviados.length - 1];
  const achado = /token=([0-9a-f]+)/.exec(msg?.html || "");
  return achado ? achado[1] : null;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.users = [
    {
      id: "user-1",
      name: "Cliente Exemplo",
      email: EMAIL_EXISTENTE,
      passwordHash: "$2a$10$hashantigoquenaovaleparanada000000000000000000000000",
      status: "active",
      role: "user",
      accountType: "CLIENT",
    },
  ];
  mockDb.tokens = [];
  mockDb.sessions = [
    { id: "sess-1", userId: "user-1", revokedAt: null },
    { id: "sess-2", userId: "user-1", revokedAt: null },
    { id: "sess-outro", userId: "user-2", revokedAt: null },
  ];
  mockEnviados.length = 0;
  mockFalharEnvio = false;
  logs = [];
  mockSeq = 0;
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 1. NÃO REVELAR SE O E-MAIL EXISTE
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("POST /auth/forgot-password — não revela se o e-mail existe", () => {
  test("e-mail cadastrado e não cadastrado devolvem status e CORPO idênticos", async () => {
    const app = montarApp();

    const existente = await request(app).post("/auth/forgot-password").send({ email: EMAIL_EXISTENTE });
    const inexistente = await request(app)
      .post("/auth/forgot-password")
      .send({ email: EMAIL_INEXISTENTE });
    await drenar();

    expect(existente.status).toBe(200);
    expect(inexistente.status).toBe(200);
    // Comparação do corpo INTEIRO, não de um campo escolhido: um campo a mais no caminho do
    // usuário existente (um `sent: true`, um `expiresIn`) já seria o vazamento.
    expect(existente.body).toEqual(inexistente.body);
    expect(JSON.stringify(existente.body)).toBe(JSON.stringify(inexistente.body));

    // E o comportamento por trás REALMENTE difere — senão o teste acima passaria por não fazer nada.
    expect(mockEnviados).toHaveLength(1);
    expect(mockEnviados[0].to).toBe(EMAIL_EXISTENTE);
  });

  test("usuário inativo/pendente também recebe a resposta genérica, e sem e-mail", async () => {
    mockDb.users.push({
      id: "user-pendente",
      name: "Pendente",
      email: "pendente@exemplo.com",
      passwordHash: "x",
      status: "pending",
      role: "user",
      accountType: "CLIENT",
    });
    const app = montarApp();

    const ativo = await request(app).post("/auth/forgot-password").send({ email: EMAIL_EXISTENTE });
    const pendente = await request(app)
      .post("/auth/forgot-password")
      .send({ email: "pendente@exemplo.com" });
    await drenar();

    expect(pendente.status).toBe(ativo.status);
    expect(pendente.body).toEqual(ativo.body);
    expect(mockEnviados.map((e) => e.to)).toEqual([EMAIL_EXISTENTE]);
  });

  test("falha no envio NÃO vira erro visível — seria oráculo de existência", async () => {
    const app = montarApp();
    mockFalharEnvio = true;

    const comFalha = await request(app).post("/auth/forgot-password").send({ email: EMAIL_EXISTENTE });
    mockFalharEnvio = false;
    const inexistente = await request(app)
      .post("/auth/forgot-password")
      .send({ email: EMAIL_INEXISTENTE });
    await drenar();

    expect(comFalha.status).toBe(200);
    expect(comFalha.body).toEqual(inexistente.body);
  });

  test("a mensagem é a condicional — nunca afirma que a conta existe", async () => {
    const app = montarApp();
    const res = await request(app).post("/auth/forgot-password").send({ email: EMAIL_INEXISTENTE });
    expect(res.body.message).toMatch(/se houver/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 2. AUSÊNCIA DE CONFIGURAÇÃO NÃO VIRA SUCESSO SILENCIOSO
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("POST /auth/forgot-password — configuração ausente", () => {
  // ⚠ UM TESTE SÓ, e a economia é deliberada: `jest.resetModules()` + `import()` reconstrói o grafo
  // inteiro de módulos (config, prisma, mailer) e é de longe a coisa mais cara desta suíte. As duas
  // asserções são sobre o MESMO cenário — a rota recusa, e recusa antes do banco —, então separá-las
  // pagaria o custo duas vezes para exercer o mesmo caminho.
  test("sem mailer configurado: RECUSA 503, igual para todo e-mail, e SEM consultar o banco", async () => {
    jest.resetModules();
    jest.doMock("../../config.js", () => ({
      ...jest.requireActual("../../config.js"),
      USE_GMAIL_API: false,
      FROM: "",
      SMTP_HOST: "",
      PORTAL_CLIENTE_WEB_URL: "",
    }));
    const { createAuthRouter: criar } = await import("../auth.js");
    const findByEmail = jest.fn();
    const app = express();
    app.use(express.json());
    app.use(
      "/auth",
      criar({
        AuthService: { isEnabled: () => true },
        UserRepository: { findByEmail },
        log: criarLog(),
        ensureAuthorized: async () => false,
      })
    );

    const existente = await request(app).post("/auth/forgot-password").send({ email: EMAIL_EXISTENTE });
    const inexistente = await request(app)
      .post("/auth/forgot-password")
      .send({ email: EMAIL_INEXISTENTE });

    // 1. Não responde 200 em silêncio — o usuário ficaria esperando um e-mail que nunca foi tentado.
    expect(existente.status).toBe(503);
    expect(existente.body.error).toBe("mail_not_configured");

    // 2. E a recusa não é oráculo: mesma resposta para os dois endereços...
    expect(existente.status).toBe(inexistente.status);
    expect(existente.body).toEqual(inexistente.body);
    // ...porque foi decidida ANTES do banco — que não chegou a ser consultado em nenhum dos dois.
    expect(findByEmail).not.toHaveBeenCalled();

    jest.dontMock("../../config.js");
    jest.resetModules();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 3. O TOKEN: entropia, hash em repouso, e nunca em log
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("o token", () => {
  test("o guardado NÃO é o enviado — é o SHA-256 dele (prova do hash em repouso)", async () => {
    const app = montarApp();
    const token = await pedirTokenPara(app);

    expect(token).toBeTruthy();
    expect(mockDb.tokens).toHaveLength(1);
    const guardado = mockDb.tokens[0].tokenHash;

    expect(guardado).not.toBe(token);
    expect(guardado).toBe(sha256(token));
    // E nenhuma coluna guarda o claro por outro nome.
    expect(JSON.stringify(mockDb.tokens[0])).not.toContain(token);
  });

  test("tem entropia criptográfica: 32 bytes (64 hex) e nunca se repete", async () => {
    const app = montarApp();
    const t1 = await pedirTokenPara(app);
    const t2 = await pedirTokenPara(app);

    expect(t1).toHaveLength(64);
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t2).not.toBe(t1);
    // Não é UUID (que tem hífens e só 122 bits) nem derivado do e-mail/id.
    expect(t1).not.toContain("-");
    expect(t1).not.toContain(sha256(EMAIL_EXISTENTE));
  });

  test("NÃO aparece em log algum — varredura de tudo que foi logado", async () => {
    const app = montarApp();
    const token = await pedirTokenPara(app);

    expect(logs.length).toBeGreaterThan(0); // a varredura só vale se houve o que varrer
    const tudoQueFoiLogado = JSON.stringify(
      logs.map((l) => l.args.map((a) => (a instanceof Error ? { m: a.message, s: a.stack } : a)))
    );
    expect(tudoQueFoiLogado).not.toContain(token);
    expect(tudoQueFoiLogado).not.toContain(sha256(token));
  });

  test("também não vaza no log quando o ENVIO falha", async () => {
    const app = montarApp();
    // Captura o token pela criação, mesmo com o envio quebrado.
    mockFalharEnvio = true;
    await request(app).post("/auth/forgot-password").send({ email: EMAIL_EXISTENTE });
    await drenar();

    expect(mockDb.tokens).toHaveLength(1);
    const hash = mockDb.tokens[0].tokenHash;
    const tudoQueFoiLogado = JSON.stringify(
      logs.map((l) => l.args.map((a) => (a instanceof Error ? { m: a.message, s: a.stack } : a)))
    );
    expect(tudoQueFoiLogado).not.toContain(hash);
    // O erro foi registrado (o escritório precisa saber), só que sem a credencial.
    expect(logs.some((l) => l.nivel === "error")).toBe(true);
  });

  test("pedir de novo invalida o pedido anterior — não ficam dois links vivos", async () => {
    const app = montarApp();
    const primeiro = await pedirTokenPara(app);
    const segundo = await pedirTokenPara(app);

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token: primeiro, password: SENHA_FORTE });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_reset_token");

    const ok = await request(app)
      .post("/auth/reset-password")
      .send({ token: segundo, password: SENHA_FORTE });
    expect(ok.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 4. REDEFINIR: o caminho feliz e as QUATRO recusas idênticas
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("POST /auth/reset-password", () => {
  test("token válido troca a senha (e o hash gravado confere com a senha nova)", async () => {
    const app = montarApp();
    const token = await pedirTokenPara(app);
    const hashAntes = mockDb.users[0].passwordHash;

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token, password: SENHA_FORTE });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const { default: bcrypt } = await import("bcryptjs");
    expect(mockDb.users[0].passwordHash).not.toBe(hashAntes);
    expect(await bcrypt.compare(SENHA_FORTE, mockDb.users[0].passwordHash)).toBe(true);
  });

  test("token VÁLIDO, EXPIRADO, JÁ USADO e ADULTERADO — a recusa é a MESMA", async () => {
    const app = montarApp();

    // (a) expirado
    const tExpirado = await pedirTokenPara(app);
    mockDb.tokens.find((t) => t.tokenHash === sha256(tExpirado)).expiresAt = new Date(Date.now() - 1000);
    const expirado = await request(app)
      .post("/auth/reset-password")
      .send({ token: tExpirado, password: SENHA_FORTE });

    // (b) já usado
    const tUsado = await pedirTokenPara(app);
    await request(app).post("/auth/reset-password").send({ token: tUsado, password: SENHA_FORTE });
    const jaUsado = await request(app)
      .post("/auth/reset-password")
      .send({ token: tUsado, password: SENHA_FORTE });

    // (c) adulterado — um caractere trocado
    const tBom = await pedirTokenPara(app);
    const tAdulterado = (tBom[0] === "a" ? "b" : "a") + tBom.slice(1);
    const adulterado = await request(app)
      .post("/auth/reset-password")
      .send({ token: tAdulterado, password: SENHA_FORTE });

    // (d) inexistente
    const inexistente = await request(app)
      .post("/auth/reset-password")
      .send({ token: "f".repeat(64), password: SENHA_FORTE });

    for (const res of [expirado, jaUsado, adulterado, inexistente]) {
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: "invalid_reset_token" });
    }
    // Corpos byte a byte iguais: nenhuma pista de qual dos quatro casos foi.
    const corpos = [expirado, jaUsado, adulterado, inexistente].map((r) => JSON.stringify(r.body));
    expect(new Set(corpos).size).toBe(1);
  });

  test("redefinir REVOGA AS SESSÕES do usuário (e só as dele)", async () => {
    const app = montarApp();
    const token = await pedirTokenPara(app);

    expect(mockDb.sessions.filter((s) => s.revokedAt !== null)).toHaveLength(0);

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token, password: SENHA_FORTE });
    expect(res.status).toBe(200);

    const minhas = mockDb.sessions.filter((s) => s.userId === "user-1");
    expect(minhas).toHaveLength(2);
    for (const s of minhas) {
      expect(s.revokedAt).toBeInstanceOf(Date);
    }
    // Multi-tenancy: a sessão de outro usuário não foi tocada.
    expect(mockDb.sessions.find((s) => s.userId === "user-2").revokedAt).toBeNull();
  });

  test("o token é marcado como CONSUMIDO (`usedAt`), não apagado", async () => {
    const app = montarApp();
    const token = await pedirTokenPara(app);
    await request(app).post("/auth/reset-password").send({ token, password: SENHA_FORTE });

    const linha = mockDb.tokens.find((t) => t.tokenHash === sha256(token));
    expect(linha).toBeDefined();
    expect(linha.usedAt).toBeInstanceOf(Date);
  });

  test("senha fraca é recusada ANTES do token — senão `weak_password` provaria o token válido", async () => {
    const app = montarApp();
    const tokenBom = await pedirTokenPara(app);

    const comTokenBom = await request(app)
      .post("/auth/reset-password")
      .send({ token: tokenBom, password: "123" });
    const comTokenRuim = await request(app)
      .post("/auth/reset-password")
      .send({ token: "f".repeat(64), password: "123" });

    expect(comTokenBom.status).toBe(400);
    expect(comTokenBom.body.error).toBe("weak_password");
    // A resposta é a mesma com token válido e inválido: não dá para distinguir um do outro.
    expect(comTokenRuim.body.error).toBe("weak_password");
    expect(comTokenBom.status).toBe(comTokenRuim.status);

    // E a senha NÃO foi trocada, nem o token queimado.
    expect(mockDb.tokens.find((t) => t.tokenHash === sha256(tokenBom)).usedAt).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 5. RATE LIMIT NAS DUAS ROTAS
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("rate limit", () => {
  test("/auth/forgot-password bloqueia com 429 (limite mais estrito: 5 / 15 min)", async () => {
    const app = montarApp();
    const status = [];
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post("/auth/forgot-password").send({ email: EMAIL_INEXISTENTE });
      status.push(res.status);
    }
    expect(status.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(status[5]).toBe(429);
  });

  test("/auth/reset-password bloqueia com 429 (authStrictLimiter: 10 / 5 min)", async () => {
    const app = montarApp();
    const status = [];
    for (let i = 0; i < 11; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post("/auth/reset-password")
        .send({ token: "f".repeat(64), password: SENHA_FORTE });
      status.push(res.status);
    }
    expect(status.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(status[10]).toBe(429);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// 6. O LINK DO E-MAIL
// ═════════════════════════════════════════════════════════════════════════════════════════════
describe("o e-mail", () => {
  test("aponta para a base vinda de configuração, nunca cravada nem lida do header Host", async () => {
    const app = montarApp();
    await request(app)
      .post("/auth/forgot-password")
      .set("Host", "atacante.example")
      .set("X-Forwarded-Host", "atacante.example")
      .send({ email: EMAIL_EXISTENTE });
    await drenar();

    const html = mockEnviados[0].html;
    expect(html).toContain("https://portal.exemplo.com/redefinir-senha?token=");
    expect(html).not.toContain("atacante.example");
  });

  test("o assunto NÃO carrega o token (assunto vai para notificação de celular e índice)", async () => {
    const app = montarApp();
    const token = await pedirTokenPara(app);
    expect(mockEnviados[0].subject).not.toContain(token);
    expect(mockEnviados[0].subject).toMatch(/redefini/i);
  });

  test("diz o prazo e avisa quem não pediu", async () => {
    const app = montarApp();
    await pedirTokenPara(app);
    expect(mockEnviados[0].html).toContain("60 minutos");
    expect(mockEnviados[0].html).toMatch(/não foi você/i);
  });
});
