import { Router } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../../infrastructure/db/prisma.js";
import { configuracaoPush, registrarInscricaoPush, revogarInscricaoPush } from "../../application/whatsapp/AtendimentoPushService.js";

export function createAtendimentoPushRouter({ client = prisma, config = configuracaoPush() } = {}) {
  const router = Router();
  router.use("/whatsapp/push", (req, res, next) => {
    const user = req.auth?.user;
    if (!user?.id || !["admin", "contador"].includes(user.role) || (user.accountType !== "FIRM" && user.role !== "admin")) {
      return res.status(403).json({ ok: false, error: "atendimento_sem_acesso" });
    }
    res.set("Cache-Control", "no-store"); next();
  });
  router.get("/whatsapp/push/config", (_req, res) => res.json({ ok: true, enabled: config.enabled, publicKey: config.publicKey }));
  const limite = rateLimit({ windowMs: 60000, limit: 20, standardHeaders: true, legacyHeaders: false });
  const tratar = (res, e) => res.status(e.status || 500).json({ ok: false, error: e.status ? e.code : "push_indisponivel",
    message: e.status ? e.message : "Não foi possível atualizar as notificações. Tente novamente." });
  router.post("/whatsapp/push/subscriptions", limite, async (req, res) => {
    try { res.json(await registrarInscricaoPush({ userId: req.auth.user.id, ...{
      subscription: req.body?.subscription, deviceName: req.body?.deviceName, preferencias: req.body?.preferencias,
    } }, { client, config })); } catch (e) { tratar(res, e); }
  });
  router.delete("/whatsapp/push/subscriptions", limite, async (req, res) => {
    try { res.json(await revogarInscricaoPush({ userId: req.auth.user.id, endpoint: req.body?.endpoint }, { client })); }
    catch (e) { tratar(res, e); }
  });
  return router;
}
