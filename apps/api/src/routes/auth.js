import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { prisma } from "../infrastructure/db/prisma.js";
import { validateStrongPassword, strongPasswordMessage } from "../application/validators/passwordPolicy.js";
import { ClientSessionService } from "../application/auth/ClientSessionService.js";
import {
  PasswordResetService,
  enviarEmailRedefinicao,
  mailerConfigurado,
  portalConfigurado,
} from "../application/auth/PasswordResetService.js";
import { safeLogError } from "../lib/safeLogError.js";

export function createAuthRouter({ AuthService, UserRepository, log, ensureAuthorized }) {
  const router = Router();
  const authAttemptMap = new Map();
  const AUTH_WINDOW_MS = 60 * 1000;
  const AUTH_MAX_ATTEMPTS = 20;

  function isRateLimited(req) {
    const key = `${req.ip || "unknown"}:${req.path}`;
    const now = Date.now();
    const history = authAttemptMap.get(key) || [];
    const recent = history.filter((ts) => now - ts < AUTH_WINDOW_MS);
    if (recent.length >= AUTH_MAX_ATTEMPTS) return true;
    recent.push(now);
    authAttemptMap.set(key, recent);
    return false;
  }

  // Q27.C: trava por CONTA (além do rate-limit por IP). Após N falhas no mesmo e-mail dentro da
  // janela, bloqueia aquele login por LOCK_DURATION. Em memória (reseta no restart; sem migração).
  const loginFailMap = new Map(); // email -> { count, firstAt, lockedUntil }
  const LOCK_THRESHOLD = 5;
  const LOCK_WINDOW_MS = 15 * 60 * 1000;
  const LOCK_DURATION_MS = 15 * 60 * 1000;
  const lockKey = (email) => String(email || "").trim().toLowerCase();

  function accountLockState(email) {
    const e = loginFailMap.get(lockKey(email));
    if (e?.lockedUntil && e.lockedUntil > Date.now()) {
      return { locked: true, retryAfterSec: Math.ceil((e.lockedUntil - Date.now()) / 1000) };
    }
    return { locked: false };
  }
  function recordFailedLogin(email) {
    const k = lockKey(email);
    if (!k) return;
    const now = Date.now();
    const e = loginFailMap.get(k) || { count: 0, firstAt: now, lockedUntil: 0 };
    if (now - e.firstAt > LOCK_WINDOW_MS) { e.count = 0; e.firstAt = now; e.lockedUntil = 0; }
    e.count += 1;
    if (e.count >= LOCK_THRESHOLD) e.lockedUntil = now + LOCK_DURATION_MS;
    loginFailMap.set(k, e);
  }
  function clearFailedLogin(email) {
    loginFailMap.delete(lockKey(email));
  }

  // Q8.A.3: rate-limit por IP usando express-rate-limit.
  // 10 tentativas / 5 min — bloqueia força-bruta de senha/refresh tokens.
  // Em memória (single-instance). Em produção horizontal, trocar `store` por RedisStore.
  // isRateLimited (acima) continua ativo como 2ª linha de defesa (por email/path).
  const authStrictLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests", reason: "auth_rate_limit" },
  });

  // ⚠ MAIS ESTRITO QUE O `authStrictLimiter`, e o motivo é que esta rota é a única da API que
  // FAZ O SERVIDOR MANDAR E-MAIL PARA UM ENDEREÇO ESCOLHIDO POR QUEM CHAMA.
  //
  // /login e /refresh, sob abuso, só gastam CPU nossa. /forgot-password entrega mensagens na caixa
  // de outra pessoa: 10 requisições em 5 minutos são 10 e-mails que a vítima recebe sem ter pedido
  // nada, e o mesmo abuso queima a reputação de envio do domínio do escritório. 5 em 15 minutos
  // continua folgado para o uso legítimo — quem esqueceu a senha pede uma vez, no máximo duas.
  const forgotPasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too_many_requests", reason: "auth_rate_limit" },
  });

  router.post("/signup", authStrictLimiter, async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "too_many_requests" });
    }
    const { name, email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email_password_required" });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      return res.status(400).json({ error: "email_invalid" });
    }
    // Q27.A: senha de acesso forte (8 + maiúscula + minúscula + número + especial).
    const pwCheck = validateStrongPassword(password);
    if (!pwCheck.ok) {
      return res.status(400).json({ error: "weak_password", message: strongPasswordMessage(pwCheck.errors), missing: pwCheck.errors });
    }
    try {
      const existing = await UserRepository.findByEmail(normalizedEmail);
      if (existing) {
        const status = existing.status || "active";
        return res
          .status(409)
          .json({ error: status === "pending" ? "user_pending" : "user_exists" });
      }
      const passwordHash = await bcrypt.hash(String(password), 10);
      await UserRepository.createPending({
        name: name ? String(name).trim() : null,
        email: normalizedEmail,
        passwordHash,
      });
      res
        .status(201)
        .json({ status: "pending", message: "Cadastro aguardando aprovação." });
    } catch (err) {
      safeLogError(log, { email: normalizedEmail }, err, "Falha no signup");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/login", authStrictLimiter, async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "too_many_requests" });
    }
    if (!AuthService.isEnabled()) {
      log.warn("Tentativa de login, mas autenticação não está configurada");
      return res.status(503).json({ error: "auth_not_configured" });
    }
    const { email, username, identifier, password } = req.body || {};
    // Q27.B: valida tipos do corpo (sem distinguir mensagens) antes de tocar no banco.
    if (typeof password !== "string" || (email && typeof email !== "string") || (username && typeof username !== "string") || (identifier && typeof identifier !== "string")) {
      return res.status(400).json({ error: "username_password_required" });
    }
    const loginId = (email || username || identifier || "").trim();
    if (!loginId || !password) {
      return res.status(400).json({ error: "username_password_required" });
    }
    // Q27.C: trava por conta — bloqueia o e-mail após N falhas (defesa direcionada além do IP).
    const lock = accountLockState(loginId);
    if (lock.locked) {
      return res.status(429).json({ error: "account_locked", retryAfterSec: lock.retryAfterSec });
    }
    try {
      // 1) Usuários do sistema (admin/contador/user)
      const result = await AuthService.authenticate(loginId, password);
      if (result.ok) {
        clearFailedLogin(loginId);
        const accessToken = AuthService.generateToken(result.user);
        // Portal do cliente (app): refresh OPACO revogável por dispositivo (ClientSession).
        // FIRM/env seguem com o refresh JWT stateless de antes.
        let refreshToken;
        if ((result.user.accountType || "CLIENT") === "CLIENT" && result.user.source !== "env") {
          const session = await ClientSessionService.createSession(result.user.id, {
            deviceLabel: req.headers["x-device-label"],
          });
          refreshToken = session.refreshToken;
        } else {
          refreshToken = AuthService.generateRefreshToken(result.user);
        }
        return res.json({
          accessToken,
          refreshToken,
          user: {
            id: result.user.id,
            role: result.user.role,
            accountType: result.user.accountType || "CLIENT",
            defaultClientId: null,
            name: result.user.name || null,
          },
        });
      }

      // 2) Cliente (dono da empresa) — usa tabela Client
      const clientResult = await AuthService.authenticateClient(loginId, password);
      if (!clientResult.ok) {
        if (result.error === "user_not_active") {
          return res.status(403).json({ error: "user_not_active", status: result.status });
        }
        if (result.error === "missing_credentials") {
          return res.status(400).json({ error: "username_password_required" });
        }
        // Q27.C: registra a falha pra contar contra a trava por conta.
        recordFailedLogin(loginId);
        return res.status(401).json({ error: "invalid_credentials" });
      }

      clearFailedLogin(loginId);
      const { accessToken, refreshToken } = AuthService.generateClientTokens(clientResult.client);

      // defaultClientId: primeira empresa do cliente (se existir PortalClient ligado à Company)
      const companies = await prisma.company.findMany({
        where: { clientId: String(clientResult.client.id) },
        select: { id: true },
        take: 50,
      });
      const companyIds = companies.map((c) => c.id);
      const defaultPortal = companyIds.length
        ? await prisma.portalClient.findFirst({
            where: { companyId: { in: companyIds } },
            orderBy: { razao: "asc" },
            select: { id: true },
          })
        : null;

      return res.json({
        accessToken,
        refreshToken,
        user: {
          id: clientResult.client.id,
          role: "cliente",
          accountType: "CLIENT",
          defaultClientId: defaultPortal?.id || null,
          name: clientResult.client.name || null,
        },
      });
    } catch (err) {
      safeLogError(log, { loginId }, err, "Falha ao autenticar usuário");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/refresh", authStrictLimiter, async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "too_many_requests" });
    }
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      return res.status(400).json({ error: "refresh_token_required" });
    }
    // Refresh OPACO do portal do cliente (ClientSession): valida contra a store, rotaciona
    // e emite um access novo. FIRM/env caem no caminho JWT abaixo.
    if (ClientSessionService.looksOpaque(refreshToken)) {
      try {
        const rotated = await ClientSessionService.rotate(refreshToken);
        if (!rotated) {
          return res.status(401).json({ error: "invalid_refresh_token" });
        }
        const user = await UserRepository.findById(rotated.userId);
        if (!user) {
          return res.status(401).json({ error: "invalid_token" });
        }
        if (user.status && user.status !== "active") {
          return res.status(403).json({ error: "user_not_active", status: user.status });
        }
        const accessToken = AuthService.generateToken({
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          accountType: user.accountType || "CLIENT",
          source: "db",
        });
        return res.json({ accessToken, refreshToken: rotated.refreshToken });
      } catch (err) {
        safeLogError(log, {}, err, "Falha ao rotacionar sessão do cliente");
        return res.status(401).json({ error: "invalid_refresh_token" });
      }
    }
    try {
      const payload = AuthService.verifyRefreshToken(refreshToken);
      const user = await AuthService.resolveUserFromPayload(payload);
      if (!user) {
        return res.status(401).json({ error: "invalid_token" });
      }
      if (user.status && user.status !== "active") {
        return res.status(403).json({ error: "user_not_active", status: user.status });
      }
      const tokens =
        user.role === "client"
          ? AuthService.generateClientTokens(user)
          : AuthService.generateTokens(user);
      res.json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
    } catch (err) {
      log.warn({ err: err.message }, "Refresh token inválido");
      res.status(401).json({ error: "invalid_refresh_token" });
    }
  });

  router.get("/me", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) {
      return;
    }
    if (!req.auth?.user) {
      return res.status(401).json({ error: "invalid_token" });
    }
    const u = req.auth.user;
    let defaultClientId = null;
    if (u.role === "client" || u.role === "cliente") {
      const companies = await prisma.company.findMany({
        where: { clientId: String(u.id) },
        select: { id: true },
        take: 50,
      });
      const companyIds = companies.map((c) => c.id);
      const defaultPortal = companyIds.length
        ? await prisma.portalClient.findFirst({
            where: { companyId: { in: companyIds } },
            orderBy: { razao: "asc" },
            select: { id: true },
          })
        : null;
      defaultClientId = defaultPortal?.id || null;
    }
    res.json({
      id: u.id,
      role: u.role === "client" ? "cliente" : u.role,
      accountType: u.accountType || (u.role === "admin" || u.role === "contador" ? "FIRM" : "CLIENT"),
      defaultClientId,
      name: u.name || null,
    });
  });

  // Logout do dispositivo: revoga a ClientSession do refresh apresentado (best-effort).
  router.post("/logout", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) {
      return;
    }
    const u = req.auth?.user;
    if (!u) return res.status(401).json({ error: "invalid_token" });
    const { refreshToken } = req.body || {};
    try {
      if (refreshToken && ClientSessionService.looksOpaque(refreshToken)) {
        await ClientSessionService.revokeByRefresh(refreshToken, u.id);
      }
      return res.json({ ok: true });
    } catch (err) {
      safeLogError(log, { userId: u.id }, err, "Falha no logout");
      return res.json({ ok: true });
    }
  });

  // Troca de senha do usuário logado. Valida a senha atual, exige senha forte, grava e
  // REVOGA todas as sessões do usuário (força re-login em todos os dispositivos).
  router.post("/change-password", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) {
      return;
    }
    const authUser = req.auth?.user;
    if (!authUser) return res.status(401).json({ error: "invalid_token" });

    const { currentPassword, newPassword } = req.body || {};
    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      !currentPassword ||
      !newPassword
    ) {
      return res.status(400).json({ error: "passwords_required" });
    }
    const pwCheck = validateStrongPassword(newPassword);
    if (!pwCheck.ok) {
      return res.status(400).json({
        error: "weak_password",
        message: strongPasswordMessage(pwCheck.errors),
        missing: pwCheck.errors,
      });
    }
    try {
      const user = await UserRepository.findById(authUser.id);
      if (!user || !user.passwordHash) {
        return res.status(404).json({ error: "user_not_found" });
      }
      const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: "invalid_current_password" });
      }
      const passwordHash = await bcrypt.hash(String(newPassword), 10);
      await UserRepository.updateUser(user.id, { passwordHash });
      await ClientSessionService.revokeAllForUser(user.id);
      return res.json({ ok: true });
    } catch (err) {
      safeLogError(log, { userId: authUser.id }, err, "Falha ao trocar senha");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ESQUECI MINHA SENHA — pedir o link
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠⚠ A RESPOSTA É A MESMA PARA E-MAIL CADASTRADO E NÃO CADASTRADO. Mesmo corpo, mesmo status.
  // Isto não é polidez: um portal contábil que responde "este e-mail não existe" deixa qualquer
  // pessoa descobrir, endereço por endereço, QUEM É CLIENTE DE QUAL ESCRITÓRIO. A enumeração de
  // usuário é o defeito clássico desta tela e é o requisito mais forte desta rota.
  //
  // Os quatro desfechos que respondem IGUAL (200 `RESPOSTA_GENERICA`):
  //   1. e-mail não existe          → nada acontece
  //   2. e-mail existe e está ativo → token criado, e-mail enviado
  //   3. usuário pendente/bloqueado → nada é enviado (ver abaixo)
  //   4. o envio do e-mail falhou   → ver a nota sobre falha de envio
  //
  // ⚠ A ÚNICA resposta diferente é 503, e ela é sobre o SERVIDOR, não sobre a conta: é decidida
  // ANTES de tocar no banco, então vale igual para todo endereço e não informa nada sobre nenhum.
  const RESPOSTA_GENERICA = {
    ok: true,
    message:
      "Se houver uma conta com esse e-mail, enviamos as instruções para redefinir a senha.",
  };

  router.post("/forgot-password", forgotPasswordLimiter, async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "too_many_requests" });
    }

    // ⚠ CONFIGURAÇÃO PRIMEIRO, SEMPRE. Sem mailer ou sem a base do portal, esta rota NÃO PODE
    // responder 200: o usuário ficaria esperando para sempre um e-mail que nunca foi tentado.
    // Mesmo desenho do `auth_not_configured` do /login logo acima — ausência de configuração é
    // recusa nomeada, nunca sucesso silencioso.
    if (!mailerConfigurado()) {
      log.warn("Pedido de redefinição de senha, mas o envio de e-mail não está configurado");
      return res.status(503).json({ error: "mail_not_configured" });
    }
    if (!portalConfigurado()) {
      log.warn("Pedido de redefinição de senha, mas PORTAL_CLIENTE_WEB_URL não está configurada");
      return res.status(503).json({ error: "mail_not_configured" });
    }

    const { email } = req.body || {};
    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "email_required" });
    }
    const normalizedEmail = email.trim().toLowerCase();

    let user = null;
    try {
      user = await UserRepository.findByEmail(normalizedEmail);
    } catch (err) {
      safeLogError(log, {}, err, "Falha ao consultar usuário para redefinição de senha");
    }

    // ⚠⚠ A RESPOSTA SAI AQUI, ANTES DE CRIAR O TOKEN E DE MANDAR O E-MAIL — e isto fecha o
    // ORÁCULO DE TEMPO, que é o vazamento que sobra depois de igualar corpo e status.
    //
    // Se esperássemos o envio, o caminho "e-mail existe" custaria uma escrita no banco mais uma
    // ida ao Gmail (centenas de ms a segundos) e o caminho "não existe" custaria um SELECT
    // indexado (~1 ms). Ninguém precisa ler o corpo da resposta para enumerar clientes: bastaria
    // CRONOMETRAR. Respondendo antes, os dois caminhos fazem exatamente o mesmo trabalho até o
    // `res.json` — a mesma consulta, e nada mais.
    //
    // Isto NÃO enfraquece nada, porque o desfecho do envio já não podia mudar a resposta (veja a
    // nota de falha de envio abaixo): não se está escondendo um erro que antes aparecia.
    res.json(RESPOSTA_GENERICA);

    // ⚠ `status !== "active"` NÃO vira exceção visível — a resposta genérica já foi enviada, igual
    // para todo mundo. Não mandamos e-mail porque redefinir a senha de uma conta ainda não
    // aprovada não daria acesso a nada (o /login continuaria recusando com `user_not_active`):
    // seria um link prometendo o que não pode cumprir. Quem pergunta não fica sabendo a diferença.
    if (!user || (user.status || "active") !== "active") return;

    try {
      const { token, expiraEmMinutos } = await PasswordResetService.criarPedido(user.id, {
        requestIp: req.ip,
      });
      await enviarEmailRedefinicao({
        to: user.email,
        nome: user.name,
        token,
        expiraEmMinutos,
      });
      // ⚠ SEM O TOKEN. `userId` responde "quem pediu"; o token em claro nunca entra em log nenhum
      // — nem aqui, nem em mensagem de erro. (`safeLogError` redige chaves com "token", mas
      // depender disso seria contar com a rede de proteção em vez de não deixar cair.)
      log.info({ userId: user.id }, "E-mail de redefinição de senha enviado");
    } catch (err) {
      // ⚠ FALHA NO ENVIO NÃO VIRA ERRO PARA QUEM CHAMOU, e é escolha consciente entre dois males.
      //
      // Um 5xx aqui seria um ORÁCULO: para e-mail inexistente nunca há envio, logo nunca haveria
      // erro — então "deu erro" passaria a significar "esta conta existe". Isso desfaria, por uma
      // porta lateral, a regra inteira que esta rota existe para cumprir.
      //
      // Por isso a falha vira RUÍDO NO LOG DO ESCRITÓRIO, não sinal para quem chama. A ausência de
      // configuração — que é o caso comum e previsível — já foi tratada acima, ANTES do banco,
      // onde pode recusar sem vazar nada. O que sobra aqui é falha transitória do provedor.
      //
      // ⚠ PERGUNTA EM ABERTO PARA O DONO: se o Gmail cair, o cliente lê "enviamos as instruções" e
      // não recebe nada. Um alerta ao escritório (ou um retry, como o `guideEmailWorker` já faz
      // com as guias) fecharia esse buraco sem reabrir o oráculo. Não foi construído por ser
      // decisão de produto, não detalhe de implementação.
      safeLogError(log, { userId: user.id }, err, "Falha ao enviar e-mail de redefinição de senha");
    }
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // ESQUECI MINHA SENHA — usar o link
  // ───────────────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ UMA SÓ RECUSA para token inexistente, adulterado, EXPIRADO e JÁ USADO: `invalid_reset_token`.
  //
  // ⚠ O código é PRÓPRIO, e não o `invalid_token` genérico do resto da API, porque aquele já
  // significa "sua sessão expirou" para o portal do cliente (`lib/mensagens.js`). Reaproveitá-lo
  // faria a tela de redefinição dizer a um usuário DESLOGADO que a sessão dele acabou — instrução
  // impossível de seguir. Distinguir aqui não vaza nada: os quatro casos continuam idênticos entre
  // si, que é a regra; o que muda é só a separação de "link ruim" e "sessão morta".
  // "Este token já foi usado" conta ao atacante que o token existiu — e portanto que a conta
  // existe, que alguém pediu a redefinição e mais ou menos quando.
  router.post("/reset-password", authStrictLimiter, async (req, res) => {
    if (isRateLimited(req)) {
      return res.status(429).json({ error: "too_many_requests" });
    }
    const { token, password } = req.body || {};
    if (typeof token !== "string" || !token || typeof password !== "string" || !password) {
      return res.status(400).json({ error: "token_password_required" });
    }

    // ⚠ A FORÇA DA SENHA É CONFERIDA ANTES DO TOKEN, e a ordem é de propósito.
    //
    // Ao contrário, um atacante mandaria um token chutado com uma senha fraca: receber
    // `weak_password` em vez de `invalid_token` provaria que o chute acertou. Adivinhar 32 bytes é
    // inviável, então isto é defesa em profundidade — mas custa uma troca de ordem, e o caminho em
    // que ela importa é aquele em que alguma outra coisa já deu errado.
    const pwCheck = validateStrongPassword(password);
    if (!pwCheck.ok) {
      return res.status(400).json({
        error: "weak_password",
        message: strongPasswordMessage(pwCheck.errors),
        missing: pwCheck.errors,
      });
    }

    try {
      const resultado = await PasswordResetService.redefinirSenha(token, password);
      if (!resultado.ok) {
        return res.status(400).json({ error: "invalid_reset_token" });
      }
      // Nada do token aqui — só de quem foi a senha trocada.
      log.info({ userId: resultado.userId }, "Senha redefinida por token; sessões revogadas");
      return res.json({ ok: true });
    } catch (err) {
      safeLogError(log, {}, err, "Falha ao redefinir senha por token");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

