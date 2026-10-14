import { Router } from "express";
import { listarHistoricoPgdas, arquivoHistoricoPgdas } from "../../application/fiscal/serpro/PgdasHistoricoService.js";
import { GuideStorageService } from "../../application/guides/GuideStorageService.js";

export function createPgdasHistoricoRouter({ prisma, requireFirmCompanyAccess, storage = () => GuideStorageService.create() }) {
  const router = Router();
  const base = "/companies/:companyId/pgdas/:competencia/historico";
  const validar = (req, res, next) => /^\d{4}-(0[1-9]|1[0-2])$/.test(req.params.competencia)
    ? next() : res.status(400).json({ error: "competencia_invalida" });
  router.get(base, requireFirmCompanyAccess(), validar, async (req, res, next) => {
    try { res.setHeader("Cache-Control", "no-store"); res.json({ ok: true, ...await listarHistoricoPgdas(req.params.companyId, req.params.competencia, prisma) }); }
    catch (err) { next(err); }
  });
  router.get(base + "/:versao/pdf", requireFirmCompanyAccess(), validar, async (req, res, next) => {
    const tipo = req.query.tipo || "declaracao";
    if (!["declaracao", "recibo"].includes(tipo) || !/^[a-f0-9]{64}$/.test(req.params.versao)) return res.status(400).json({ error: "versao_ou_tipo_invalido" });
    try {
      const key = await arquivoHistoricoPgdas(req.params.companyId, req.params.competencia, req.params.versao, tipo, prisma);
      if (!key) return res.status(404).json({ error: "pdf_not_available" });
      let buf;
      try { buf = await storage().downloadBuffer({ key }); } catch { return res.status(404).json({ error: "pdf_not_available" }); }
      if (!buf?.length) return res.status(404).json({ error: "pdf_not_available" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `inline; filename="pgdas-${tipo}-${req.params.competencia}.pdf"`);
      res.send(buf);
    } catch (err) { next(err); }
  });
  return router;
}
