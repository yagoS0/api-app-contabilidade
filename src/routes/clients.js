import { Router } from "express";
import { AuthService } from "../application/auth/AuthService.js";

export function createClientsRouter({
  ensureAuthorized,
  validateClientPayload,
  ClientRepository,
  log,
}) {
  const router = Router();

  router.post("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const validation = validateClientPayload(req.body);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.error });
    }
    try {
      const created = await ClientRepository.createClientWithCompany(validation.data);
      res.status(201).json(created);
    } catch (err) {
      if (err.code === "P2002") {
        return res.status(409).json({ error: "client_login_or_email_exists" });
      }
      log.error({ err }, "Falha ao cadastrar cliente");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.post("/login", async (req, res) => {
    const { login, email, password } = req.body || {};
    const identifier = login || email;
    if (!identifier || !password) {
      return res.status(400).json({ error: "login_password_required" });
    }
    try {
      const result = await AuthService.authenticateClient(identifier, password);
      if (!result.ok) {
        return res.status(401).json({ error: "invalid_credentials" });
      }
      const token = AuthService.generateClientToken(result.client);
      return res.json({
        token,
        client: {
          id: result.client.id,
          login: result.client.login,
          email: result.client.email,
          name: result.client.name,
        },
        expiresInMs: AuthService.getExpiresInMs(),
      });
    } catch (err) {
      log.error({ err }, "Falha no login do cliente");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;
    try {
      const result = await ClientRepository.listClients({ limit, offset });
      res.json(result);
    } catch (err) {
      log.error({ err }, "Falha ao listar clientes");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.get("/:id", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    try {
      const client = await ClientRepository.getClientById(req.params.id);
      if (!client) {
        return res.status(404).json({ error: "not_found" });
      }
      res.json(client);
    } catch (err) {
      log.error({ err, id: req.params.id }, "Falha ao buscar cliente");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/:id", async (req, res) => {
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: false }))) return;
    try {
      await ClientRepository.deleteClient(req.params.id);
      return res.status(200).json({ status: "deleted" });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ error: "not_found" });
      }
      log.error({ err, id: req.params.id }, "Falha ao excluir cliente");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

