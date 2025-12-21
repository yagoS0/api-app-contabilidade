import { Router } from "express";
import bcrypt from "bcryptjs";

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
      const result = await AuthService.authenticate(loginId, password);
      if (!result.ok) {
        if (result.error === "user_not_active") {
          return res
            .status(403)
            .json({ error: "user_not_active", status: result.status });
        }
        if (result.error === "missing_credentials") {
          return res.status(400).json({ error: "username_password_required" });
        }
        return res.status(401).json({ error: "invalid_credentials" });
      }
      const token = AuthService.generateToken(result.user);
      res.json({
        token,
        user: result.user,
        expiresInMs: AuthService.getExpiresInMs(),
      });
    } catch (err) {
      log.error({ err }, "Falha ao autenticar usuário");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/me", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) {
      return;
    }
    if (!req.auth?.user) {
      return res.status(401).json({ error: "invalid_token" });
    }
    res.json({ user: req.auth.user });
  });

  return router;
}

