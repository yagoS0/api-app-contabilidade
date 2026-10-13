import { Router } from "express";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { preverCorrecaoCompetenciaGuia, corrigirCompetenciaGuia, CorrecaoCompetenciaError } from "../../application/guides/CorrigirCompetenciaGuiaService.js";

export function createCorrigirCompetenciaGuiaRouter({ log } = {}) {
  const router = Router({ mergeParams: true });
  const base = "/companies/:companyId/guides/:guideId/corrigir-competencia";
  const guard = requireFirmCompanyAccess({ minRole: "ACCOUNTANT" });
  const falhar = (res, e) => {
    const conhecida = e instanceof CorrecaoCompetenciaError;
    if (!conhecida) log?.error?.({ code: e?.code }, "Falha ao corrigir competência da guia");
    return res.status(conhecida ? e.status : 500).json({ error: conhecida ? e.code : "erro_interno", message: conhecida ? e.message : "Não foi possível corrigir a competência." });
  };
  router.get(base, guard, async (req, res) => {
    try { return res.json(await preverCorrecaoCompetenciaGuia({ ...req.params, competencia: req.query.competencia })); }
    catch (e) { return falhar(res, e); }
  });
  router.post(base, guard, async (req, res) => {
    try { return res.json(await corrigirCompetenciaGuia({ ...req.params, competencia: req.body?.competencia, revisao: req.body?.revisao, userId: req.auth.user.id })); }
    catch (e) { return falhar(res, e); }
  });
  return router;
}
