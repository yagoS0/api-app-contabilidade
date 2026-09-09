import { criarPropostasComerciais } from "../application/onboarding/PropostasComerciaisService.js";
import { Router, json } from "express";
import rateLimit from "express-rate-limit";
import { criarServicoComercial } from "../application/onboarding/ComercialService.js";
import { OnboardingError } from "../application/onboarding/OnboardingService.js";

export function createPublicOnboardingRouter({ servico = criarServicoComercial() } = {}) {
  const router = Router();
  router.use(rateLimit({ windowMs: 60000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "muitas_tentativas", message: "Aguarde um minuto e tente novamente." } }));
  router.use(json({ limit: "64kb" }));
  router.use((_req, res, next) => { res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }); next(); });
  const responder = (editar) => async (req, res) => {
    // Token não viaja no path nem em query, evitando logs e Referer.
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(String(req.headers.authorization || ""))?.[1];
    try { return res.json({ ok: true, ...await servico.publico(token, editar ? req.body : null) }); }
    catch (e) { return res.status(e instanceof OnboardingError ? e.status : 500).json({ ok: false, error: e instanceof OnboardingError ? e.code : "erro_interno", message: e instanceof OnboardingError ? e.message : "Não foi possível salvar. Tente novamente." }); }
  };
  router.get("/onboarding", responder(false));
  router.patch("/onboarding", responder(true));
  const propostas = criarPropostasComerciais();
  const proposta = aceitar => async (req, res) => {
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(String(req.headers.authorization || ""))?.[1];
    try { res.json({ ok: true, ...await propostas.publico(token, aceitar ? req.body : null) }); }
    catch (e) { res.status(e instanceof OnboardingError ? e.status : 500).json({ ok: false, message: e instanceof OnboardingError ? e.message : "Não foi possível concluir." }); }
  };
  router.get("/proposta", proposta(false));
  router.post("/proposta/aceitar", proposta(true));
  return router;
}
