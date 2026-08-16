// PLANEJAMENTO TRIBUTÁRIO — a porta de leitura dos dados da empresa para a simulação de regime.
//
// UMA rota, GET, sem efeito colateral: o planejamento SIMULA, não grava cadastro nem lançamento.
//
// ⚠ Multi-tenancy: `requireFirmCompanyAccess()` — a mesma guarda das demais rotas por empresa. O id
// vem do PATH e é conferido contra `CompanyFirmAccess`; nada aqui confia no que o navegador mandou.
// A lista que alimenta o seletor da tela é a de `GET /firm/companies`, que já é escopada pelo mesmo
// critério de `empresasVisiveis` — não há uma quarta leitura de escopo neste módulo.

import { Router } from "express";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { montarDadosPlanejamento } from "../../application/planejamento/DadosPlanejamentoService.js";

export function createPlanejamentoRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  router.get("/planejamento", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    try {
      const dados = await montarDadosPlanejamento({ portalClientId });
      if (!dados) return res.status(404).json({ ok: false, error: "company_not_found" });
      return res.json({ ok: true, ...dados });
    } catch (err) {
      log?.warn?.({ err: err?.message, portalClientId }, "Falha ao montar dados de planejamento");
      return res.status(500).json({ ok: false, error: "planejamento_fetch_failed" });
    }
  });

  return router;
}
