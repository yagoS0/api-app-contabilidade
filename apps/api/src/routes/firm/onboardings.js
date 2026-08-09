// ONBOARDINGS — funil pré-cadastro do escritório.
// Mount: `/firm/onboardings` (na RAIZ de /firm, não sob `/companies/:companyId`).
//
// ⚠ ESCOPO MULTI-TENANT (Fase 1): NÃO HÁ ISOLAMENTO POR USUÁRIO. Todo usuário FIRM enxerga todos os
// onboardings. Está escrito aqui para ninguém supor um isolamento que não existe ao ler o resto do
// diretório. O motivo é estrutural: as demais rotas de escritório se escopam por
// `empresasVisiveis(req)`, que lê `CompanyFirmAccess` — um vínculo que só passa a existir quando a
// empresa é criada. Uma ficha pré-cadastro, por definição, ainda não tem empresa.
//
// ⚠ NENHUMA ROTA AQUI USA `requireFirmCompanyAccess`. Ele resolve o `companyId` de
// `params`/`body` e, não achando nenhum, responde **400 `company_id_required`** — daria 400 em toda
// requisição deste arquivo, porque aqui não existe empresa. O gate base é o
// `router.use(requireAuth(), requireAccountType("FIRM"))` do router pai; o que exige mais usa o
// helper local `somenteAdminOuContador`, no molde do `PATCH /companies`.

import { Router } from "express";
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

  const atorDe = (req) => String(req.auth?.user?.id || "") || null;

  // ── Lista ────────────────────────────────────────────────────────────────────
  router.get("/onboardings", async (req, res) => {
    try {
      const itens = await listar({
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
