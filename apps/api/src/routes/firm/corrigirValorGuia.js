import { Router } from "express";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { preverCorrecaoValorGuia, corrigirValorGuia, CorrecaoValorError } from "../../application/guides/CorrigirValorGuiaService.js";

export function createCorrigirValorGuiaRouter({ log } = {}) {
  const router = Router({ mergeParams: true });
  const base = "/companies/:companyId/guides/:guideId/corrigir-valor";
  const guard = requireFirmCompanyAccess({ minRole: "ACCOUNTANT" });
  const falhar = (res, e) => {
    const conhecida = e instanceof CorrecaoValorError;
    if (!conhecida) log?.error?.({ code: e?.code }, "Falha ao corrigir valor da guia");
    return res.status(conhecida ? e.status : 500).json({ error: conhecida ? e.code : "erro_interno", message: conhecida ? e.message : "Não foi possível corrigir a guia." });
  };
  router.get(base, guard, async (req, res) => {
    try {
      const { _leitura, ...previa } = await preverCorrecaoValorGuia({ ...req.params, valor: req.query.valor });
      return res.json(previa);
    } catch (e) { return falhar(res, e); }
  });
  router.post(base, guard, async (req, res) => {
    try {
      return res.json(await corrigirValorGuia({ ...req.params, valor: req.body?.valor, revisao: req.body?.revisao, userId: req.auth.user.id }));
    } catch (e) { return falhar(res, e); }
  });
  return router;
}
