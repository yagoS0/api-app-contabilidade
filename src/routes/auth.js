import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../infrastructure/db/prisma.js";

export function createAuthRouter({ AuthService, UserRepository, log, ensureAuthorized }) {
  const router = Router();

  router.post("/signup", async (req, res) => {
    const { name, email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "email_password_required" });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      return res.status(400).json({ error: "email_invalid" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "weak_password" });
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
      log.error({ err }, "Falha no signup");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/login", async (req, res) => {
    if (!AuthService.isEnabled()) {
      log.warn("Tentativa de login, mas autenticação não está configurada");
      return res.status(503).json({ error: "auth_not_configured" });
    }
    const { email, username, identifier, password } = req.body || {};
    const loginId = (email || username || identifier || "").trim();
    if (!loginId || !password) {
      return res.status(400).json({ error: "username_password_required" });
    }
    try {
      // 1) Usuários do sistema (admin/contador/user)
      const result = await AuthService.authenticate(loginId, password);
      if (result.ok) {
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
        return res.status(401).json({ error: "invalid_credentials" });
      }

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
      log.error({ err }, "Falha ao autenticar usuário");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/refresh", async (req, res) => {
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

