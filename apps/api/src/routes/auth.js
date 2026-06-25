import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { prisma } from "../infrastructure/db/prisma.js";
import { validateStrongPassword, strongPasswordMessage } from "../application/validators/passwordPolicy.js";
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
        const { accessToken, refreshToken } = AuthService.generateTokens(result.user);
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

  return router;
}

