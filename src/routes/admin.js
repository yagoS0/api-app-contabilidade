import { Router } from "express";

export function createAdminRouter({
  ensureAuthorized,
  UserRepository,
  log,
  USER_STATUSES,
  USER_ROLES,
  serializeUser,
}) {
  const router = Router();

  router.get("/users", async (req, res) => {
    const statusFilter = req.query.status ? String(req.query.status).toLowerCase() : undefined;
    if (statusFilter && !USER_STATUSES.includes(statusFilter)) {
      return res.status(400).json({ error: "invalid_status" });
    }
    if (
      !(await ensureAuthorized(req, res, {
        allowApiKeyFallback: false,
        requireRole: "admin",
      }))
    )
      return;
    try {
      const users = await UserRepository.listByStatus(statusFilter);
      res.json({ items: users.map(serializeUser) });
    } catch (err) {
      log.error({ err }, "Falha ao listar usuários");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.patch("/users/:id/approve", async (req, res) => {
    if (
      !(await ensureAuthorized(req, res, {
        allowApiKeyFallback: false,
        requireRole: "admin",
      }))
    )
      return;
    const { role } = req.body || {};
    const updateData = { status: "active" };
    if (role) {
      if (!USER_ROLES.includes(role)) {
        return res.status(400).json({ error: "invalid_role" });
      }
      updateData.role = role;
    }
    try {
      const updated = await UserRepository.updateUser(req.params.id, updateData);
      res.json({ user: serializeUser(updated) });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ error: "not_found" });
      }
      log.error({ err, id: req.params.id }, "Falha ao aprovar usuário");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.patch("/users/:id/reject", async (req, res) => {
    if (
      !(await ensureAuthorized(req, res, {
        allowApiKeyFallback: false,
        requireRole: "admin",
      }))
    )
      return;
    try {
      const updated = await UserRepository.updateUser(req.params.id, {
        status: "rejected",
      });
      res.json({ user: serializeUser(updated) });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ error: "not_found" });
      }
      log.error({ err, id: req.params.id }, "Falha ao rejeitar usuário");
      res.status(500).json({ error: "internal_error" });
    }
  });

  router.delete("/users/:id", async (req, res) => {
    if (
      !(await ensureAuthorized(req, res, {
        allowApiKeyFallback: false,
        requireRole: "admin",
      }))
    )
      return;
    try {
      const deleted = await UserRepository.deleteUser(req.params.id);
      res.json({ user: serializeUser(deleted) });
    } catch (err) {
      if (err.code === "P2025") {
        return res.status(404).json({ error: "not_found" });
      }
      log.error({ err, id: req.params.id }, "Falha ao excluir usuário");
      res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}

