// Q12.A.3: endpoints do módulo Notas Fiscais.
//
// Mountado em /firm/companies/:companyId/* (mergeParams).
// Endpoints:
//   GET    /procuracoes
//   POST   /procuracoes
//   DELETE /procuracoes/:procId
//   GET    /competencias
//   GET    /competencias/:competencia
//   POST   /competencias/:competencia/fechar
//   POST   /competencias/:competencia/reabrir
//   GET    /pendencias-pos-fechamento
//   POST   /pendencias-pos-fechamento/:pendId/resolver

import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import {
  ESTADOS,
  ensureCompetencia,
  fecharCompetencia,
  reabrirCompetencia,
} from "../../application/notas/CompetenciaStateMachine.js";
import { checkCertAvailability, SERVICOS } from "../../application/notas/CertResolver.js";
import { syncDfeForCompany } from "../../application/notas/dfe/DfeSyncService.js";
import { syncAdnNotasForCompany } from "../../application/notas/adn/AdnNotasService.js";

const COMPETENCIA_RE = /^\d{4}-\d{2}$/;

function bad(res, status, error, message, extra = {}) {
  return res.status(status).json({ ok: false, error, message, ...extra });
}

function decimalToString(v) {
  if (v == null) return null;
  return typeof v === "object" && typeof v.toString === "function" ? v.toString() : String(v);
}

function serializeCompetencia(row) {
  if (!row) return null;
  return {
    id: row.id,
    competencia: row.competencia,
    estado: row.estado,
    lockedAt: row.lockedAt,
    lockedByUserId: row.lockedByUserId,
    reopenedAt: row.reopenedAt,
    reopenedByUserId: row.reopenedByUserId,
    reopenedReason: row.reopenedReason,
    rb12: decimalToString(row.rb12),
    fs12Manual: decimalToString(row.fs12Manual),
    fs12Origem: row.fs12Origem,
    fatorR: decimalToString(row.fatorR),
  };
}

function serializeProcuracao(p, certCheck) {
  return {
    id: p.id,
    servico: p.servico,
    validade: p.validade,
    status: p.status,
    observacoes: p.observacoes,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    certCheck: certCheck || null,
  };
}

function serializePendencia(p) {
  return {
    id: p.id,
    competencia: p.competencia,
    notaId: p.notaId,
    motivo: p.motivo,
    observacoes: p.observacoes,
    resolvida: p.resolvida,
    resolvidaAt: p.resolvidaAt,
    resolvidaByUserId: p.resolvidaByUserId,
    createdAt: p.createdAt,
  };
}

export function createNotasRouter({ log }) {
  const router = Router({ mergeParams: true });

  // ─── Procurações ──────────────────────────────────────────────────────────

  router.get("/procuracoes", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const procs = await prisma.procuracao.findMany({
      where: { portalClientId },
      orderBy: [{ servico: "asc" }],
    });
    // Anexa cert check (soft) pra cada serviço — UI usa pra pintar status real
    const enriched = await Promise.all(procs.map(async (p) => {
      const certCheck = await checkCertAvailability({ portalClientId, servico: p.servico });
      return serializeProcuracao(p, certCheck);
    }));
    return res.json({ ok: true, procuracoes: enriched });
  });

  router.post("/procuracoes", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { servico, validade, observacoes } = req.body || {};
    if (!Object.values(SERVICOS).includes(servico)) {
      return bad(res, 400, "invalid_servico", `Serviço deve ser um de: ${Object.values(SERVICOS).join(", ")}`);
    }
    let validadeDate = null;
    if (validade) {
      const d = new Date(validade);
      if (Number.isNaN(d.getTime())) return bad(res, 400, "invalid_validade", "Data de validade inválida");
      validadeDate = d;
    }
    try {
      const proc = await prisma.procuracao.upsert({
        where: { portalClientId_servico: { portalClientId, servico } },
        create: {
          portalClientId, servico,
          validade: validadeDate,
          observacoes: observacoes || null,
          status: "ATIVA",
          createdByUserId: req.auth?.user?.id || null,
        },
        update: {
          validade: validadeDate,
          observacoes: observacoes || null,
          status: "ATIVA",
        },
      });
      return res.json({ ok: true, procuracao: serializeProcuracao(proc) });
    } catch (err) {
      log?.warn({ err: err?.message }, "Falha ao criar procuração");
      return bad(res, 500, "procuracao_create_failed", err?.message || "Erro");
    }
  });

  router.delete("/procuracoes/:procId", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const procId = String(req.params.procId);
    const proc = await prisma.procuracao.findUnique({ where: { id: procId } });
    if (!proc || proc.portalClientId !== portalClientId) {
      return bad(res, 404, "procuracao_not_found", "Procuração não encontrada");
    }
    await prisma.procuracao.update({
      where: { id: procId },
      data: { status: "REVOGADA" },
    });
    return res.json({ ok: true });
  });

  // ─── Competências ─────────────────────────────────────────────────────────

  // GET /competencias?ano=2026 → lista competências com estado.
  // Sempre garante 12 meses (Jan-Dez) do ano solicitado — cria com estado=aberto se não existir.
  router.get("/competencias", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const ano = Number(req.query.ano) || new Date().getUTCFullYear();
    const competencias = Array.from({ length: 12 }, (_, i) =>
      `${ano}-${String(i + 1).padStart(2, "0")}`);

    const rows = await prisma.companyMonthlyCircular.findMany({
      where: { portalClientId, competencia: { in: competencias } },
    });
    const byComp = new Map(rows.map((r) => [r.competencia, r]));

    // Estatísticas adicionais (contagem de notas, pendências) por competência.
    // PortalInvoice.clientId (não portalClientId) + competencia é DateTime → agrupamos em JS.
    const yearStart = new Date(Date.UTC(ano, 0, 1));
    const yearEnd = new Date(Date.UTC(ano + 1, 0, 1));
    const notes = await prisma.portalInvoice.findMany({
      where: {
        clientId: portalClientId,
        competencia: { gte: yearStart, lt: yearEnd },
      },
      select: { competencia: true },
    });
    const notesByComp = new Map();
    for (const n of notes) {
      if (!n.competencia) continue;
      const d = new Date(n.competencia);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      notesByComp.set(key, (notesByComp.get(key) || 0) + 1);
    }

    const pendCounts = await prisma.pendenciaPosFechamento.groupBy({
      by: ["competencia"],
      where: { portalClientId, competencia: { in: competencias }, resolvida: false },
      _count: { _all: true },
    });
    const pendByComp = new Map(pendCounts.map((p) => [p.competencia, p._count._all]));

    const result = competencias.map((comp) => ({
      ...(serializeCompetencia(byComp.get(comp)) || {
        id: null, competencia: comp, estado: ESTADOS.ABERTO,
        lockedAt: null, reopenedAt: null, rb12: null, fs12Manual: null, fs12Origem: null, fatorR: null,
      }),
      notasCount: notesByComp.get(comp) || 0,
      pendenciasAbertas: pendByComp.get(comp) || 0,
    }));
    return res.json({ ok: true, ano, competencias: result });
  });

  router.get("/competencias/:competencia", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia);
    if (!COMPETENCIA_RE.test(competencia)) {
      return bad(res, 400, "invalid_competencia", "Competência deve estar no formato YYYY-MM");
    }
    const row = await ensureCompetencia({ portalClientId, competencia });
    // PortalInvoice.competencia é DateTime — filtramos por range do mês.
    const [yy, mm] = competencia.split("-").map(Number);
    const monthStart = new Date(Date.UTC(yy, mm - 1, 1));
    const monthEnd = new Date(Date.UTC(yy, mm, 1));
    const notasCount = await prisma.portalInvoice.count({
      where: { clientId: portalClientId, competencia: { gte: monthStart, lt: monthEnd } },
    });
    const pendenciasAbertas = await prisma.pendenciaPosFechamento.count({
      where: { portalClientId, competencia, resolvida: false },
    });
    return res.json({
      ok: true,
      competencia: {
        ...serializeCompetencia(row),
        notasCount,
        pendenciasAbertas,
      },
    });
  });

  router.post("/competencias/:competencia/fechar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia);
    if (!COMPETENCIA_RE.test(competencia)) {
      return bad(res, 400, "invalid_competencia", "Competência deve estar no formato YYYY-MM");
    }
    // Garante que está em em_conferencia (transiciona aberto→em_conferencia primeiro se preciso)
    const current = await ensureCompetencia({ portalClientId, competencia });
    try {
      if (current.estado === ESTADOS.ABERTO) {
        const { iniciarConferencia } = await import("../../application/notas/CompetenciaStateMachine.js");
        await iniciarConferencia({ portalClientId, competencia, userId: req.auth?.user?.id });
      }
      const updated = await fecharCompetencia({
        portalClientId, competencia, userId: req.auth?.user?.id,
      });
      return res.json({ ok: true, competencia: serializeCompetencia(updated) });
    } catch (err) {
      if (err.code === "INVALID_FROM_STATE" || err.code === "INVALID_TRANSITION") {
        return bad(res, 409, "invalid_transition", err.message, { currentState: err.currentState });
      }
      log?.warn({ err: err?.message }, "Falha ao fechar competência");
      return bad(res, 500, "fechar_failed", err?.message || "Erro");
    }
  });

  router.post("/competencias/:competencia/reabrir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia);
    const { reason } = req.body || {};
    if (!COMPETENCIA_RE.test(competencia)) {
      return bad(res, 400, "invalid_competencia", "Competência deve estar no formato YYYY-MM");
    }
    if (!reason || !String(reason).trim()) {
      return bad(res, 400, "reason_required", "Motivo da reabertura é obrigatório");
    }
    try {
      const updated = await reabrirCompetencia({
        portalClientId, competencia, userId: req.auth?.user?.id, reason: String(reason).trim(),
      });
      return res.json({ ok: true, competencia: serializeCompetencia(updated) });
    } catch (err) {
      if (err.code === "INVALID_FROM_STATE" || err.code === "INVALID_TRANSITION") {
        return bad(res, 409, "invalid_transition", err.message, { currentState: err.currentState });
      }
      log?.warn({ err: err?.message }, "Falha ao reabrir competência");
      return bad(res, 500, "reabrir_failed", err?.message || "Erro");
    }
  });

  // ─── Pendências pós-fechamento ────────────────────────────────────────────

  router.get("/pendencias-pos-fechamento", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const onlyOpen = String(req.query.onlyOpen || "true").toLowerCase() !== "false";
    const pendencias = await prisma.pendenciaPosFechamento.findMany({
      where: { portalClientId, ...(onlyOpen ? { resolvida: false } : {}) },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    });
    return res.json({ ok: true, pendencias: pendencias.map(serializePendencia) });
  });

  router.post("/pendencias-pos-fechamento/:pendId/resolver", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const pendId = String(req.params.pendId);
    const pend = await prisma.pendenciaPosFechamento.findUnique({ where: { id: pendId } });
    if (!pend || pend.portalClientId !== portalClientId) {
      return bad(res, 404, "pendencia_not_found", "Pendência não encontrada");
    }
    const updated = await prisma.pendenciaPosFechamento.update({
      where: { id: pendId },
      data: {
        resolvida: true,
        resolvidaAt: new Date(),
        resolvidaByUserId: req.auth?.user?.id || null,
      },
    });
    return res.json({ ok: true, pendencia: serializePendencia(updated) });
  });

  // ─── Q12.B: captura DFe (NF-e via SEFAZ) ──────────────────────────────────

  // POST /dfe/sync?env=prod|hom — dispara captura imediata. Sem worker em background nessa fase.
  router.post("/dfe/sync", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const env = String(req.query.env || "prod") === "hom" ? "hom" : "prod";
    try {
      const result = await syncDfeForCompany({ portalClientId, env });
      return res.json({ ok: result.ok, result });
    } catch (err) {
      log?.warn({ err: err?.message, portalClientId }, "Falha ao sincronizar DFe");
      return bad(res, 500, "dfe_sync_failed", err?.message || "Erro");
    }
  });

  // GET /dfe/state — retorna cursor + último erro + backoff (UI mostra status)
  // POST /dfe/clear-error — limpa backoff e último erro (desbloqueia botão)
  router.post("/dfe/clear-error", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    await prisma.portalSyncState.updateMany({
      where: { clientId: portalClientId },
      data: { dfeBackoffUntil: null, dfeLastError: null },
    });
    return res.json({ ok: true });
  });

  // POST /adn/clear-error — idem para ADN
  router.post("/adn/clear-error", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    await prisma.portalSyncState.updateMany({
      where: { clientId: portalClientId },
      data: { adnBackoffUntil: null, adnLastError: null },
    });
    return res.json({ ok: true });
  });

  router.get("/dfe/state", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const state = await prisma.portalSyncState.findUnique({ where: { clientId: portalClientId } });
    return res.json({
      ok: true,
      state: state
        ? {
            dfeNsuCursor: state.dfeNsuCursor?.toString() || "0",
            dfeLastSyncAt: state.dfeLastSyncAt,
            dfeLastError: state.dfeLastError,
            dfeBackoffUntil: state.dfeBackoffUntil,
          }
        : { dfeNsuCursor: "0", dfeLastSyncAt: null, dfeLastError: null, dfeBackoffUntil: null },
    });
  });

  // ─── Q12.C.1: listagem de notas + resumos da empresa ──────────────────────

  // GET /notas?papel=EMIT|DEST&type=NFE|NFSE&competencia=YYYY-MM&search=&limit=&offset=
  router.get("/notas", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { papel, type, competencia, search } = req.query;
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const where = { clientId: portalClientId };
    if (papel) where.papel = String(papel).toUpperCase();
    if (type) where.type = String(type).toUpperCase();
    if (competencia && /^\d{4}-\d{2}$/.test(competencia)) {
      const [y, m] = competencia.split("-").map(Number);
      where.competencia = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
    }
    if (search && String(search).trim()) {
      const s = String(search).trim();
      where.OR = [
        { chaveAcesso: { contains: s } },
        { numero: { contains: s } },
        { emitenteNome: { contains: s, mode: "insensitive" } },
        { emitenteDoc: { contains: s.replace(/\D+/g, "") } },
        { tomadorNome: { contains: s, mode: "insensitive" } },
      ];
    }

    const [notas, total] = await Promise.all([
      prisma.portalInvoice.findMany({
        where, orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        take: limit, skip: offset,
        select: {
          id: true, type: true, papel: true, statusEfetivo: true, status: true,
          chaveAcesso: true, numero: true, serie: true, competencia: true, issueDate: true,
          total: true, emitenteNome: true, emitenteDoc: true,
          tomadorNome: true, tomadorDoc: true,
          competenciaPosFechamento: true,
        },
      }),
      prisma.portalInvoice.count({ where }),
    ]);

    return res.json({
      ok: true, total, limit, offset,
      notas: notas.map((n) => ({
        ...n,
        total: n.total != null ? n.total.toString() : null,
      })),
    });
  });

  // GET /notas/summary → resumo agregado APLICANDO OS MESMOS FILTROS de /notas
  // (papel, type, competencia, search). Fallback: se nada filtrado, usa o ano
  // do query param (ou ano atual).
  router.get("/notas/summary", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { papel, type, competencia, search } = req.query;
    const ano = Number(req.query.ano) || new Date().getUTCFullYear();

    // Constrói o MESMO where do /notas — assim summary reflete a tabela
    const where = { clientId: portalClientId };
    if (papel) where.papel = String(papel).toUpperCase();
    if (type) where.type = String(type).toUpperCase();
    if (competencia && /^\d{4}-\d{2}$/.test(competencia)) {
      const [y, m] = competencia.split("-").map(Number);
      where.competencia = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
    } else if (!papel && !type && !search) {
      // Sem nenhum filtro? Limita ao ano pra não trazer histórico todo
      where.competencia = { gte: new Date(Date.UTC(ano, 0, 1)), lt: new Date(Date.UTC(ano + 1, 0, 1)) };
    }
    if (search && String(search).trim()) {
      const s = String(search).trim();
      where.OR = [
        { chaveAcesso: { contains: s } },
        { numero: { contains: s } },
        { emitenteNome: { contains: s, mode: "insensitive" } },
        { emitenteDoc: { contains: s.replace(/\D+/g, "") } },
        { tomadorNome: { contains: s, mode: "insensitive" } },
      ];
    }

    const notas = await prisma.portalInvoice.findMany({
      where,
      select: { type: true, papel: true, statusEfetivo: true, competencia: true, total: true },
    });

    // Agrega em memória — totals refletem o filtro completo (todas as N
    // que casam, ignorando paginação do /notas).
    const byMonth = {};
    let totalNotas = 0, totalEmitido = 0, totalRecebido = 0;
    let countNfe = 0, countNfse = 0;
    let countCanceladas = 0;
    for (const n of notas) {
      totalNotas++;
      if (n.type === "NFE") countNfe++;
      else if (n.type === "NFSE") countNfse++;
      if (n.statusEfetivo === "cancelada") countCanceladas++;
      if (!n.competencia) continue;
      const d = new Date(n.competencia);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!byMonth[key]) byMonth[key] = { competencia: key, emit: { count: 0, total: 0 }, dest: { count: 0, total: 0 } };
      const bucket = n.papel === "DEST" ? byMonth[key].dest : byMonth[key].emit;
      bucket.count++;
      const val = n.total ? Number(n.total) : 0;
      bucket.total += val;
      if (n.papel === "DEST") totalRecebido += val;
      else totalEmitido += val;
    }
    return res.json({
      ok: true, ano,
      filtersApplied: { papel: papel || null, type: type || null, competencia: competencia || null, search: search || null },
      totals: { totalNotas, totalEmitido, totalRecebido, countNfe, countNfse, countCanceladas },
      byMonth: Object.values(byMonth).sort((a, b) => a.competencia.localeCompare(b.competencia)),
    });
  });

  // ─── Q12.B+: captura NFS-e via ADN ─────────────────────────────────────────

  router.post("/adn/sync", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const env = String(req.query.env || "prod") === "hom" ? "hom" : "prod";
    try {
      const result = await syncAdnNotasForCompany({ portalClientId, env });
      return res.json({ ok: result.ok, result });
    } catch (err) {
      log?.warn({ err: err?.message, portalClientId }, "Falha ao sincronizar ADN");
      return bad(res, 500, "adn_sync_failed", err?.message || "Erro");
    }
  });

  router.get("/adn/state", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const state = await prisma.portalSyncState.findUnique({ where: { clientId: portalClientId } });
    return res.json({
      ok: true,
      state: state
        ? {
            adnNsuCursor: state.adnNsuCursor?.toString() || "0",
            adnLastSyncAt: state.adnLastSyncAt,
            adnLastError: state.adnLastError,
            adnBackoffUntil: state.adnBackoffUntil,
          }
        : { adnNsuCursor: "0", adnLastSyncAt: null, adnLastError: null, adnBackoffUntil: null },
    });
  });

  return router;
}
