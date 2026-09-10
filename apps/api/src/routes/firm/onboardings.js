// ONBOARDINGS — funil pré-cadastro do escritório.
// Mount: `/firm/onboardings` (na RAIZ de /firm, não sob `/companies/:companyId`).
//
// ESCOPO: admin/contador gerenciam o escritório; demais usuários FIRM veem somente fichas
// cujo criadoPorId é o próprio usuário. A rota aplica o escopo antes de todo acesso por id.
//
// ⚠ NENHUMA ROTA AQUI USA `requireFirmCompanyAccess`. Ele resolve o `companyId` de
// `params`/`body` e, não achando nenhum, responde **400 `company_id_required`** — daria 400 em toda
// requisição deste arquivo, porque aqui não existe empresa. O gate base é o
// `router.use(requireAuth(), requireAccountType("FIRM"))` do router pai; o que exige mais usa o
// helper local `somenteAdminOuContador`, no molde do `PATCH /companies`.

import { createFluxoComercialRouter } from "./fluxoComercial.js";
import { Router } from "express";
import { criarServicoComercial, exigirEscopo, escopoComercial } from "../../application/onboarding/ComercialService.js";
import {
  OnboardingError,
  atualizar,
  concluirEtapa,
  converter,
  criar,
  descartar,
  desistir,
  listar,
  obter,
} from "../../application/onboarding/OnboardingService.js";
import { CompanyProvisioningError } from "../../application/companies/CompanyProvisioningService.js";
import {
  onboardingCreateSchema,
  onboardingDesistirSchema,
  onboardingEtapaPatchSchema,
  onboardingPatchSchema,
} from "../../application/validators/onboardingSchemas.js";
// Reusa o wrapper que já devolve `{ok, status, body}` e cujo formato de `issues` o front já lê.
// Escrever outro produziria um segundo formato de erro de validação na mesma aplicação.
import { validateCompanyInput } from "../../application/validators/companySchemas.js";
import { empresasVisiveis } from "./empresasVisiveis.js";

export function createOnboardingsRouter({ log } = {}) {
  const router = Router({ mergeParams: true });
  router.use("/comercial", createFluxoComercialRouter());

  // Erro de domínio traz `status`/`code` próprios; o resto vira 500 sem vazar stack.
  // Molde do `falhar` de `routes/firm/obrigacoes.js`.
  function falhar(res, err, contexto) {
    if (err instanceof OnboardingError) {
      return res.status(err.status).json({
        ok: false,
        error: err.code,
        message: err.message,
        ...(err.extra || {}),
      });
    }
    // A conversão chama `provisionarEmpresa`, que fala o dialeto de erro de `POST /firm/companies`.
    // Repassar o corpo dele TAL COMO ESTÁ é o ponto: o modal de conversão é o mesmo formulário, e
    // uma segunda tradução faria as duas telas mostrarem mensagens diferentes para a mesma recusa.
    if (err instanceof CompanyProvisioningError) {
      if (err.status >= 500) log?.error?.({ err: err.cause || err, ...contexto }, "Falha ao converter onboarding");
      return res.status(err.status).json({ ok: false, ...err.body });
    }
    log?.error?.({ err: err?.message || err, ...contexto }, "Falha em onboarding");
    return res.status(500).json({ ok: false, error: "erro_interno", message: "Erro interno." });
  }

  // Converter, desistir e descartar mexem no rastro (ou criam empresa). Preencher a ficha e marcar
  // etapa ficam liberados a qualquer FIRM — é trabalho de atendimento.
  function somenteAdminOuContador(req, res) {
    const appRole = String(req.auth?.user?.role || "").toLowerCase();
    if (!["admin", "contador"].includes(appRole)) {
      res.status(403).json({ ok: false, error: "forbidden_admin_or_contador_only" });
      return false;
    }
    return true;
  }

  const comercial = criarServicoComercial();
  router.use("/onboardings/:id", async (req, res, next) => {
    if ((req.method === "DELETE" && req.path === "/") || /\/(convert|desistir|analises)(\/|$)/.test(req.path)) {
      if (!somenteAdminOuContador(req, res)) return;
    }
    try { await exigirEscopo(req.params.id, req.auth?.user); next(); }
    catch (err) { return falhar(res, err, { rota: "escopo" }); }
  });
  router.get("/onboardings/:id/comercial", async (req, res) => {
    try { return res.json({ ok: true, ...await comercial.painel(req.params.id, req.auth.user) }); }
    catch (err) { return falhar(res, err, { rota: "comercial" }); }
  });
  router.patch("/onboardings/:id/comercial", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return;
    try { return res.json({ ok: true, ...await comercial.comercial(req.params.id, req.auth.user, req.body) }); }
    catch (err) { return falhar(res, err, { rota: "comercial" }); }
  });
  router.post("/onboardings/:id/analises", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return;
    try { return res.json({ ok: true, ...await comercial.analisar(req.params.id, req.auth.user, req.body?.tipo) }); }
    catch (err) { return falhar(res, err, { rota: "analise" }); }
  });
  router.get("/onboardings/:id/analises/:analiseId/pdf", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return;
    try { const pdf = await comercial.documento(req.params.id, req.params.analiseId, req.auth.user); res.set({ "Cache-Control": "no-store", "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="analise-fiscal.pdf"' }); return res.send(pdf); }
    catch (err) { return falhar(res, err, { rota: "analise_pdf" }); }
  });
  router.post("/onboardings/:id/links", async (req, res) => {
    try { res.set("Cache-Control", "no-store"); return res.status(201).json({ ok: true, ...await comercial.emitirLink(req.params.id, req.auth.user, req.body?.diasValidade ?? 7) }); }
    catch (err) { return falhar(res, err, { rota: "link" }); }
  });
  router.delete("/onboardings/:id/links/:linkId", async (req, res) => {
    try { await comercial.revogar(req.params.id, req.params.linkId, req.auth.user); return res.json({ ok: true }); }
    catch (err) { return falhar(res, err, { rota: "link_revogar" }); }
  });
  const atorDe = (req) => String(req.auth?.user?.id || "") || null;

  // ── Lista ────────────────────────────────────────────────────────────────────
  router.get("/onboardings", async (req, res) => {
    try {
      const itens = await listar({
        escopo: escopoComercial(req.auth?.user),
        origem: String(req.query?.origem || "").trim() || null,
        status: String(req.query?.status || "").trim() || null,
        q: String(req.query?.q || "").trim() || null,
        // ⚠ Rascunho abandonado acumula para sempre (o wizard cria a ficha no primeiro clique).
        // Fora da lista por padrão; a bandeja fica atrás de um toggle.
        incluirRascunhos: req.query?.incluirRascunhos === "1",
      });
      return res.json({ ok: true, itens });
    } catch (err) {
      return falhar(res, err, { rota: "listar" });
    }
  });

  router.get("/onboardings/:id", async (req, res) => {
    try {
      return res.json({ ok: true, onboarding: await obter(req.params.id) });
    } catch (err) {
      return falhar(res, err, { rota: "obter", id: req.params.id });
    }
  });

  // ── Criar ────────────────────────────────────────────────────────────────────
  router.post("/onboardings", async (req, res) => {
    const validacao = validateCompanyInput(onboardingCreateSchema, req.body || {});
    if (!validacao.ok) return res.status(validacao.status).json(validacao.body);
    try {
      const onboarding = await criar({ origem: validacao.data.origem, criadoPorId: atorDe(req) });
      return res.status(201).json({ ok: true, onboarding });
    } catch (err) {
      return falhar(res, err, { rota: "criar" });
    }
  });

  // ── Preencher / finalizar ────────────────────────────────────────────────────
  router.patch("/onboardings/:id", async (req, res) => {
    const validacao = validateCompanyInput(onboardingPatchSchema, req.body || {});
    if (!validacao.ok) return res.status(validacao.status).json(validacao.body);
    try {
      const onboarding = await atualizar(req.params.id, validacao.data, { atorId: atorDe(req) });
      return res.json({ ok: true, onboarding });
    } catch (err) {
      return falhar(res, err, { rota: "atualizar", id: req.params.id });
    }
  });

  // ── Etapas ───────────────────────────────────────────────────────────────────
  router.patch("/onboardings/:id/etapas/:etapaId", async (req, res) => {
    const validacao = validateCompanyInput(onboardingEtapaPatchSchema, req.body || {});
    if (!validacao.ok) return res.status(validacao.status).json(validacao.body);
    try {
      const out = await concluirEtapa(req.params.id, req.params.etapaId, {
        ...validacao.data,
        atorId: atorDe(req),
      });
      return res.json({ ok: true, ...out });
    } catch (err) {
      return falhar(res, err, { rota: "etapa", id: req.params.id, etapaId: req.params.etapaId });
    }
  });

  // ── Conversão ────────────────────────────────────────────────────────────────
  // Recebe O MESMO BODY de `POST /firm/companies` (ou `{ vincularPortalClientId }` na recuperação).
  router.post("/onboardings/:id/convert", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return;
    try {
      // `empresasVisiveis(req)` fica na ROTA porque precisa de `req` — o service recebe a lista
      // pronta, como o `POST /companies` já faz.
      const portalIds = await empresasVisiveis(req);
      const out = await converter(req.params.id, req.body || {}, {
        atorId: atorDe(req),
        portalIds,
        log,
      });
      return res.status(201).json({ ok: true, ...out });
    } catch (err) {
      return falhar(res, err, { rota: "converter", id: req.params.id });
    }
  });

  // ── Desistência ──────────────────────────────────────────────────────────────
  router.post("/onboardings/:id/desistir", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return;
    const validacao = validateCompanyInput(onboardingDesistirSchema, req.body || {});
    if (!validacao.ok) return res.status(validacao.status).json(validacao.body);
    try {
      const onboarding = await desistir(req.params.id, {
        motivo: validacao.data.motivo || null,
        atorId: atorDe(req),
      });
      return res.json({ ok: true, onboarding });
    } catch (err) {
      return falhar(res, err, { rota: "desistir", id: req.params.id });
    }
  });

  // ── Descarte de rascunho ─────────────────────────────────────────────────────
  router.delete("/onboardings/:id", async (req, res) => {
    if (!somenteAdminOuContador(req, res)) return;
    try {
      return res.json(await descartar(req.params.id));
    } catch (err) {
      return falhar(res, err, { rota: "descartar", id: req.params.id });
    }
  });

  return router;
}
