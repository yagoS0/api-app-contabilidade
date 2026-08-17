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
//   GET    /notas/auditoria             (auditoria pré-apuração da competência — SÓ LEITURA)
//   GET    /notas/:notaId/danfse        (PDF da NFS-e, layout do Padrão Nacional — NT 008)

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
import { montarIndiceDeCiclo, derivarCiclo } from "../../application/notas/cicloNota.js";
import { syncDfeForCompany } from "../../application/notas/dfe/DfeSyncService.js";
import { syncAdnNotasForCompany } from "../../application/notas/adn/AdnNotasService.js";
import { classifyItemsForCompany } from "../../application/notas/apuracao/ClassificadorAnexos.js";
import { calcularApuracaoParaCompetencia } from "../../application/notas/apuracao/CalculoFiscal.js";
import { transmitirApuracao } from "../../application/notas/apuracao/ApuracaoTransmissaoService.js";
import { conferirApuracao } from "../../application/notas/apuracao/ApuracaoConferenciaService.js";
import { gerarDanfse } from "../../application/nfse/danfse/gerarDanfse.js";
import { auditarCompetencia } from "../../application/notas/auditoria/AuditoriaNotasService.js";

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

  // Q20: filtro por ATIVIDADE (CFOP / serviço). CFOP e código de serviço vivem em
  // NotaItem (1 nota tem N itens). Filtra notas que tenham AO MENOS 1 item casando,
  // via subquery indexada (índices em nota_itens.cfop / nota_itens.codigoServico).
  // Mutaciona `where` adicionando `where.id = { in: [...] }`. Retorna true se aplicou.
  async function applyAtividadeFilter(where, { cfop, servico }) {
    const cfopT = String(cfop || "").trim();
    const servicoT = String(servico || "").trim();
    if (!cfopT && !servicoT) return false;
    const itemWhere = { nota: { is: { clientId: where.clientId } } };
    if (cfopT) itemWhere.cfop = cfopT;
    if (servicoT) {
      itemWhere.OR = [
        { codigoServico: { contains: servicoT, mode: "insensitive" } },
        { descricao: { contains: servicoT, mode: "insensitive" } },
      ];
    }
    const rows = await prisma.notaItem.findMany({
      where: itemWhere, select: { notaId: true }, distinct: ["notaId"],
    });
    where.id = { in: rows.map((r) => r.notaId) };
    return true;
  }

  // GET /notas?papel=EMIT|DEST&type=NFE|NFSE&competencia=YYYY-MM&search=&cfop=&servico=&limit=&offset=
  router.get("/notas", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { papel, type, competencia, search, cfop, servico } = req.query;
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
    await applyAtividadeFilter(where, { cfop, servico });

    // Esconde CANCELADAS por padrão (via AND pra não conflitar com o OR do search). ?incluirCanceladas=1 mostra.
    if (String(req.query.incluirCanceladas || "") !== "1") {
      where.AND = [...(where.AND || []), { OR: [{ statusEfetivo: null }, { statusEfetivo: { not: "cancelada" } }] }];
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
          chaveSubstituida: true, motivoSubstituicao: true,
        },
      }),
      prisma.portalInvoice.count({ where }),
    ]);

    // ── O CICLO DE VIDA VIAJA JUNTO — em DUAS consultas para a página inteira, nunca N ──────────
    //
    // A lista devolvia só o retrato (`statusEfetivo`), e com ele não dá para distinguir uma nota
    // CANCELADA de uma SUBSTITUÍDA, nem dizer que de 556 canceladas não guardamos o evento.
    // `ciclo` é LEITURA derivada: não muda nenhum filtro, nenhum total e nenhum campo existente.
    const ids = notas.map((n) => n.id);
    const chavesDaPagina = notas.map((n) => n.chaveAcesso).filter(Boolean);
    const chavesSubstituidas = notas.map((n) => n.chaveSubstituida).filter(Boolean);

    const [eventos, relacionadas] = await Promise.all([
      ids.length
        ? prisma.portalInvoiceEvent.findMany({
          where: { clientId: portalClientId, invoiceId: { in: ids } },
          select: { invoiceId: true, type: true, tpEvento: true, nSeqEvento: true, date: true, reason: true, chaveSubstituta: true, createdAt: true },
        })
        : [],
      // As duas pontas de uma vez: a nota que ESTA substitui, e a que substituiu ESTA.
      (chavesDaPagina.length || chavesSubstituidas.length)
        ? prisma.portalInvoice.findMany({
          where: {
            clientId: portalClientId,
            OR: [
              ...(chavesSubstituidas.length ? [{ chaveAcesso: { in: chavesSubstituidas } }] : []),
              ...(chavesDaPagina.length ? [{ chaveSubstituida: { in: chavesDaPagina } }] : []),
            ],
          },
          select: { id: true, numero: true, chaveAcesso: true, chaveSubstituida: true },
        })
        : [],
    ]);

    const comCiclo = montarIndiceDeCiclo({ notas, eventos, relacionadas });

    return res.json({
      ok: true, total, limit, offset,
      notas: comCiclo.map((n) => ({
        ...n,
        total: n.total != null ? n.total.toString() : null,
      })),
    });
  });

  // PATCH /notas/:notaId/status → marca a nota como CANCELADA (some do faturamento/apuração) ou
  // reativa (autorizada). Bridge manual enquanto a auto-detecção de cancelamento de NFS-e Nacional
  // (evento separado do ADN) não é implementada.
  router.patch("/notas/:notaId/status", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const notaId = String(req.params.notaId);
    const alvo = String(req.body?.statusEfetivo || "").toLowerCase();
    if (!["cancelada", "autorizada"].includes(alvo)) {
      return res.status(400).json({ error: "status_invalido", allowed: ["cancelada", "autorizada"] });
    }
    const nota = await prisma.portalInvoice.findFirst({
      where: { id: notaId, clientId: portalClientId }, select: { id: true },
    });
    if (!nota) return res.status(404).json({ error: "nota_nao_encontrada" });
    const updated = await prisma.portalInvoice.update({
      where: { id: nota.id },
      data: { statusEfetivo: alvo, status: alvo === "cancelada" ? "CANCELADA" : "EMITIDA" },
      select: { id: true, statusEfetivo: true, status: true },
    });
    return res.json({ ok: true, nota: updated });
  });

  // GET /notas/summary → resumo agregado APLICANDO OS MESMOS FILTROS de /notas
  // (papel, type, competencia, search). Fallback: se nada filtrado, usa o ano
  // do query param (ou ano atual).
  router.get("/notas/summary", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const { papel, type, competencia, search, cfop, servico } = req.query;
    const ano = Number(req.query.ano) || new Date().getUTCFullYear();
    const temAtividade = Boolean(String(cfop || "").trim() || String(servico || "").trim());

    // Constrói o MESMO where do /notas — assim summary reflete a tabela
    const where = { clientId: portalClientId };
    if (papel) where.papel = String(papel).toUpperCase();
    if (type) where.type = String(type).toUpperCase();
    if (competencia && /^\d{4}-\d{2}$/.test(competencia)) {
      const [y, m] = competencia.split("-").map(Number);
      where.competencia = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
    } else if (!papel && !type && !search && !temAtividade) {
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
    await applyAtividadeFilter(where, { cfop, servico });

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
      // Canceladas ficam FORA dos totais (faturamento/contagens) — só entram em countCanceladas.
      if (n.statusEfetivo === "cancelada") { countCanceladas++; continue; }
      totalNotas++;
      if (n.type === "NFE") countNfe++;
      else if (n.type === "NFSE") countNfse++;
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
      filtersApplied: { papel: papel || null, type: type || null, competencia: competencia || null, search: search || null, cfop: cfop || null, servico: servico || null },
      totals: { totalNotas, totalEmitido, totalRecebido, countNfe, countNfse, countCanceladas },
      byMonth: Object.values(byMonth).sort((a, b) => a.competencia.localeCompare(b.competencia)),
    });
  });

  // GET /notas/auditoria?competencia=AAAA-MM → a AUDITORIA PRÉ-APURAÇÃO da competência.
  //
  // ⚠ LITERAL, E REGISTRADA ANTES DE `/notas/:notaId` — pela MESMA razão que `/notas/summary`
  // (logo acima) e que as três rotas literais de parcelamento: o Express casa na ordem, e posta
  // depois esta rota seria engolida pelo curinga, devolvendo 404 falando de "nota não encontrada"
  // sobre uma nota chamada "auditoria". Regressão: `__tests__/auditoriaNotasRota.test.js`.
  //
  // ⚠ **SÓ LEITURA, E SEM CHAMADA EXTERNA.** Não marca nota, não classifica, não mexe em apuração,
  // não fala com ADN/SEFAZ/SERPRO. Por isso o guard é o mesmo dos GETs (`requireFirmCompanyAccess()`
  // sem `minRole`): quem pode ver as notas pode ver as perguntas sobre elas. A prova de que nada é
  // escrito está em `application/notas/auditoria/__tests__/auditoriaNaoEscreve.test.js`.
  //
  // A REGRA não mora aqui: `application/notas/auditoria/auditoriaNotas.js` é pura e é a mesma que o
  // script de medição (`scripts/diag-auditoria-notas.mjs`) roda contra produção — a tela e o número
  // do relatório saem do mesmo lugar por construção.
  router.get("/notas/auditoria", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.query.competencia || "");
    if (!COMPETENCIA_RE.test(competencia)) {
      return bad(res, 400, "invalid_competencia", "Informe a competência no formato AAAA-MM.");
    }
    try {
      const auditoria = await auditarCompetencia({ portalClientId, competencia });
      return res.json({ ok: true, auditoria });
    } catch (err) {
      log?.error?.({ err, portalClientId, competencia }, "[notas] auditoria falhou");
      return bad(res, 500, "auditoria_falhou", "Não foi possível montar a auditoria desta competência.");
    }
  });

  // GET /notas/:notaId → a ÍNTEGRA do que temos de UMA nota.
  //
  // ⚠ REGISTRADA DEPOIS DE `/notas/summary` DE PROPÓSITO. O Express casa na ordem: posta antes,
  // esta rota engoliria `/notas/summary` lendo "summary" como id (é o mesmo cuidado que
  // `/companies/annual` já exigiu). Teste de regressão: `__tests__/notaDetalhe.test.js`.
  //
  // O que ela acrescenta ao `/notas` (que é lista e continua enxuta): os itens da nota, o XML
  // bruto, os identificadores alternativos (`idNfse`/`idDps` — a NFS-e nem sempre tem chave) e
  // os carimbos de captura. Medido em produção (10/08/2026): **16.128 de 16.128 NFS-e têm
  // `xmlRaw` gravado** (4,4–11,4 KB) e **16.127 têm item com descrição e código LC116** — tudo
  // isso estava no banco sem nenhuma rota que o servisse.
  router.get("/notas/:notaId", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const notaId = String(req.params.notaId);

    const nota = await prisma.portalInvoice.findFirst({
      where: { id: notaId, clientId: portalClientId },
      include: { itens: { orderBy: { id: "asc" } } },
    });
    if (!nota) return bad(res, 404, "nota_nao_encontrada", "Nota não encontrada nesta empresa.");

    // ── A HISTÓRIA DA NOTA, não só o retrato ────────────────────────────────────────────────────
    // Aqui cabem TODOS os eventos (a lista traz só o mais específico), porque é a tela onde a
    // pergunta "o que aconteceu com esta nota?" é feita de verdade.
    const eventos = await prisma.portalInvoiceEvent.findMany({
      where: { clientId: portalClientId, invoiceId: nota.id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: { id: true, type: true, tpEvento: true, nSeqEvento: true, date: true, reason: true, chaveSubstituta: true, createdAt: true },
    });
    const chavesLigadas = [nota.chaveSubstituida, ...eventos.map((e) => e.chaveSubstituta)].filter(Boolean);
    const relacionadas = await prisma.portalInvoice.findMany({
      where: {
        clientId: portalClientId,
        OR: [
          ...(chavesLigadas.length ? [{ chaveAcesso: { in: chavesLigadas } }] : []),
          ...(nota.chaveAcesso ? [{ chaveSubstituida: nota.chaveAcesso }] : []),
        ],
      },
      select: { id: true, numero: true, chaveAcesso: true, chaveSubstituida: true, total: true, issueDate: true, statusEfetivo: true },
    });
    const ciclo = derivarCiclo({
      nota,
      // Substituição vence: é o fato mais específico quando a nota tem os dois.
      evento: eventos.find((e) => e.type === "canc_por_substituicao") || eventos[eventos.length - 1] || null,
      substituida: nota.chaveSubstituida
        ? relacionadas.find((r) => r.chaveAcesso === nota.chaveSubstituida) || null : null,
      substituta: nota.chaveAcesso
        ? relacionadas.find((r) => r.chaveSubstituida === nota.chaveAcesso) || null : null,
    });

    // O XML viaja junto: é UMA nota, e o maior da base tem 11,4 KB. O teto existe só para o caso
    // que a base ainda não tem (NF-e com muitos itens) — e, estourando, a resposta DIZ que existe
    // e não coube, em vez de responder `null` como se não houvesse XML.
    const XML_MAX_BYTES = 1_000_000;
    const xmlBytes = nota.xmlRaw ? Buffer.byteLength(nota.xmlRaw, "utf8") : null;
    const xmlCabe = Boolean(nota.xmlRaw) && xmlBytes <= XML_MAX_BYTES;

    return res.json({
      ok: true,
      nota: {
        id: nota.id,
        type: nota.type,
        papel: nota.papel,
        numero: nota.numero,
        serie: nota.serie,
        chaveAcesso: nota.chaveAcesso,
        idNfse: nota.idNfse,
        idDps: nota.idDps,
        competencia: nota.competencia,
        issueDate: nota.issueDate,
        status: nota.status,
        statusEfetivo: nota.statusEfetivo,
        // ⚠ `ciclo` é o que a tela deve ler para NOMEAR o que aconteceu (cancelada × substituída ×
        // substituta × "não temos o evento"). `statusEfetivo` continua sendo o que a APURAÇÃO lê.
        // Os dois não competem: um é história, o outro é dinheiro.
        ciclo,
        chaveSubstituida: nota.chaveSubstituida,
        motivoSubstituicao: nota.motivoSubstituicao,
        eventos: eventos.map((e) => ({
          id: e.id, tipo: e.type, tpEvento: e.tpEvento, nSeqEvento: e.nSeqEvento,
          dataEvento: e.date, motivo: e.reason, chaveSubstituta: e.chaveSubstituta,
          capturadoEm: e.createdAt,
        })),
        total: decimalToString(nota.total),
        emitenteNome: nota.emitenteNome,
        emitenteDoc: nota.emitenteDoc,
        tomadorNome: nota.tomadorNome,
        tomadorDoc: nota.tomadorDoc,
        competenciaPosFechamento: nota.competenciaPosFechamento,
        pdfUrl: nota.pdfUrl,
        xmlHash: nota.xmlHash,
        lastSyncAt: nota.lastSyncAt,
        createdAt: nota.createdAt,
        updatedAt: nota.updatedAt,
        itens: nota.itens.map((i) => ({
          id: i.id,
          descricao: i.descricao,
          codigoServico: i.codigoServico,
          cfop: i.cfop,
          ncm: i.ncm,
          valor: decimalToString(i.valor),
          tipoReceita: i.tipoReceita,
          anexoResolvido: i.anexoResolvido,
          sujeitoFatorR: i.sujeitoFatorR,
          flagST: i.flagST,
          flagMonofasico: i.flagMonofasico,
          flagExportacao: i.flagExportacao,
          classificadoEm: i.classificadoEm,
        })),
        xml: {
          disponivel: Boolean(nota.xmlRaw),
          bytes: xmlBytes,
          conteudo: xmlCabe ? nota.xmlRaw : null,
          // Só quando existe E não coube. Ausência de XML não é truncamento.
          truncadoPorTamanho: Boolean(nota.xmlRaw) && !xmlCabe,
        },
      },
    });
  });

  // ─── DANFSe — o PDF da NFS-e, layout do Padrão Nacional ────────────────────
  //
  // A API oficial (`adn.nfse.gov.br/danfse`) foi SOBRESTADA em 03/08/2026, e a NT 008 diz que é
  // por isso: o documento passou a ser do emissor. Sem PDF, o cliente não tem o que mandar ao
  // tomador.
  //
  // ⚠ GERADO SOB DEMANDA, NÃO SALVO — e a decisão tem duas pernas:
  //   1. o PDF é **inteiramente derivável** do `xmlRaw`, que já está guardado. Salvar seria manter
  //      duas cópias do mesmo fato, com a segunda podendo envelhecer (correção de leiaute, QR Code
  //      que ainda vai entrar, descrições de código que ainda faltam — tudo isso muda o PDF sem
  //      mudar o XML);
  //   2. o volume do Railway é EFÊMERO, e este projeto já paga esse preço: "registro existe,
  //      arquivo não" é caso real com as guias e os relatórios SITFIS (CLAUDE.md de apps/api,
  //      "Armazenamento de PDFs"). Um DANFSe salvo herdaria essa classe inteira de defeito —
  //      derivado, ele nunca some. O custo é irrisório: ~40 KB e alguns milissegundos por nota.
  //
  // O "arquivo ausente" dos precedentes (PGDAS/SITFIS) vira aqui "XML ausente", e é respondido
  // com a mesma honestidade: 404 dizendo QUAL é a falta.
  router.get("/notas/:notaId/danfse", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const notaId = String(req.params.notaId);

    const nota = await prisma.portalInvoice.findFirst({
      where: { id: notaId, clientId: portalClientId },
      select: {
        id: true, numero: true, chaveAcesso: true, chaveSubstituida: true,
        status: true, statusEfetivo: true, xmlRaw: true,
      },
    });
    if (!nota) return bad(res, 404, "nota_nao_encontrada", "Nota não encontrada nesta empresa.");

    if (!nota.xmlRaw) {
      return bad(res, 404, "xml_indisponivel",
        "Esta nota não tem o XML guardado, e o DANFSe é gerado a partir dele — nada aqui é " +
        "inventado. Recapture a nota para que o XML entre na base.");
    }

    // ⚠ O QR CODE É OBRIGATÓRIO (NT §2.2 e §2.4.3) e agora é gerado (dependência `qrcode`, escolhida
    // pelo dono). A RECUSA CONTINUA: quando o QR não puder ser gerado — chave ausente no XML, falha
    // da biblioteca — a resposta é 503, não um PDF sem QR. Servi-lo em silêncio faria o contador
    // mandar ao tomador um documento inválido achando que mandou o certo.
    //
    // ⚠ `?semQrCode=1` FOI REMOVIDO, e o motivo é que ele perdeu o dele. Existia para conferir
    // layout enquanto não havia biblioteca; hoje a conferência se faz com o QR, que é o layout real.
    // O que sobraria é servir o documento inválido exatamente quando ele é inválido — o oposto do
    // que o escape existia para fazer. Um escape assim, alcançável por query string, é uma
    // tentação a um refresh de distância no dia em que o 503 incomodar alguém.

    // ⚠ A MARCA D'ÁGUA VEM DO CICLO DA NOTA, NUNCA DO `chSubstda` DO XML. `chSubstda` diz "eu
    // substituo AQUELA"; quem responde "esta foi substituída" é o evento (ou outra nota apontando
    // para esta) — a mesma distinção que o `NotaDetailModal` já errou uma vez.
    const eventos = await prisma.portalInvoiceEvent.findMany({
      where: { clientId: portalClientId, invoiceId: nota.id },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: { type: true, chaveSubstituta: true },
    });
    const substituta = nota.chaveAcesso
      ? await prisma.portalInvoice.findFirst({
          where: { clientId: portalClientId, chaveSubstituida: nota.chaveAcesso },
          select: { chaveAcesso: true },
        })
      : null;
    const ciclo = derivarCiclo({
      nota,
      evento: eventos.find((e) => e.type === "canc_por_substituicao") || eventos[eventos.length - 1] || null,
      substituta,
    });
    const marcaDagua =
      ciclo?.situacao === "substituida" ? "SUBSTITUIDA"
      : ciclo?.situacao === "cancelada" ? "CANCELADA"
      : null;

    try {
      const { pdf, conformidade } = await gerarDanfse({
        xml: nota.xmlRaw,
        marcaDagua,
        incluirCanhoto: String(req.query.canhoto || "") === "1",
      });

      // A não conformidade viaja em header, não some: quem baixar o PDF consegue saber, sem abrir
      // o arquivo, o que ainda falta nele.
      //
      // ⚠ `X-Danfse-Conforme` SAIU, e sair é mais honesto que ficar. Ele era `qrCode === "presente"`
      // — ou seja, respondia sobre o QR Code com o nome de "o documento está conforme". Agora que o
      // QR sempre sai (quando não sai, a resposta é 503 e não tem header nenhum), ele seria a
      // constante "1" afirmando conformidade que o documento ainda não tem: as fontes Arial/MS Sans
      // Serif não estão embutidas, a logomarca oficial não está versionada e doze descrições de
      // código dependem de um leiaute que não está no repositório.
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition",
        `inline; filename="danfse-${(nota.chaveAcesso || nota.numero || nota.id).toString().replace(/[^\w.-]/g, "")}.pdf"`);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Danfse-Qrcode", String(conformidade.qrCode));
      res.setHeader("X-Danfse-Pendencias", String(conformidade.avisos.length));
      res.setHeader("X-Danfse-Paginas", String(conformidade.paginas));
      return res.send(pdf);
    } catch (err) {
      if (err?.code === "DANFSE_SEM_QRCODE") {
        // ⚠ 503 e não 200-com-PDF-torto: o QR Code é obrigatório e ausência não é resposta.
        return bad(res, 503, "danfse_sem_qrcode", err.message, { motivo: err.motivo || null });
      }
      if (err?.code === "DANFSE_XML_NAO_E_NFSE" || err?.code === "DANFSE_XML_VAZIO") {
        return bad(res, 422, "xml_nao_e_nfse", err.message);
      }
      throw err;
    }
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
            // "OLHEI" É DIFERENTE DE "RECEBI", e a tela precisa dos dois. `adnLastSyncAt` só anda
            // quando VEM nota, então sozinho ele não distingue "a captura está quebrada" de "a
            // empresa não emitiu nada" — e sem essa distinção a aba mostra ausência sem dizer por
            // quê. O campo já era gravado em toda tentativa; só não chegava à UI.
            adnLastAttemptAt: state.adnLastAttemptAt,
            adnLastError: state.adnLastError,
            adnBackoffUntil: state.adnBackoffUntil,
          }
        : { adnNsuCursor: "0", adnLastSyncAt: null, adnLastAttemptAt: null, adnLastError: null, adnBackoffUntil: null },
    });
  });

  // ─── Q12.C: Apuração ──────────────────────────────────────────────────────

  // POST /classificar — reclassifica todos os itens de notas da empresa
  // (lookup DeparaAnexo EMPRESA > GLOBAL > default III).
  router.post("/classificar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const force = String(req.query.force || "false") === "true";
    try {
      const result = await classifyItemsForCompany({ portalClientId, force });
      return res.json({ ok: true, result });
    } catch (err) {
      log?.warn({ err: err?.message, portalClientId }, "Falha ao classificar");
      return bad(res, 500, "classify_failed", err?.message || "Erro");
    }
  });

  // POST /apuracao/:competencia/calcular — calcula RB12/Fator R/receita por anexo
  // (não transmite — só persiste em Apuracao + CompanyMonthlyCircular).
  // Body opcional: { fs12 } pra sobrescrever FS12 manual.
  router.post("/apuracao/:competencia/calcular", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia);
    const { fs12 } = req.body || {};
    try {
      const result = await calcularApuracaoParaCompetencia({
        portalClientId, competencia,
        fs12Override: fs12 != null ? Number(fs12) : undefined,
      });
      return res.json({ ok: true, result });
    } catch (err) {
      log?.warn({ err: err?.message, portalClientId, competencia }, "Falha ao calcular apuração");
      return bad(res, 500, "calc_failed", err?.message || "Erro");
    }
  });

  // Q55: transmissão LEGADA (v1) DESABILITADA. Ela re-derivava as atividades da classificação
  // automática das notas (ignorando o que o contador preenchia) e mandava receita externa = 0 —
  // causa de declarações ZERADAS. Toda transmissão passa agora pelo fluxo v2 (apuração/fechamento):
  // POST /firm/companies/:companyId/apuracao-v2/fechamento/:competencia/transmitir.
  router.post("/apuracao/:competencia/transmitir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    return res.status(410).json({
      ok: false,
      error: "transmissao_v1_desabilitada",
      message: "Transmissão antiga desativada (transmitia zerado). Use o fluxo de Apuração (Calcular → Fechar → Transmitir).",
    });
  });

  // POST /apuracao/:competencia/conferir — confere declaração transmitida contra extrato SERPRO (CONSDECLARACAO13).
  // Marca estado=confirmada se tudo bate; senão cria ApuracaoDivergencia(s).
  router.post("/apuracao/:competencia/conferir", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia);
    try {
      const result = await conferirApuracao({
        portalClientId, competencia, userId: req.auth?.user?.id,
      });
      return res.json({ ok: true, result });
    } catch (err) {
      log?.warn({ err: err?.message, portalClientId, competencia }, "Falha ao conferir PGDAS-D");
      const status = err?.code === "INVALID_STATE" ? 409 :
                     err?.code === "APURACAO_NOT_FOUND" ? 404 : 500;
      return res.status(status).json({
        ok: false,
        error: err?.code || "conferir_failed",
        message: err?.message || "Erro",
        currentState: err?.currentState,
      });
    }
  });

  // POST /apuracao/:competencia/revisar — marca como revisada (libera transmissão)
  router.post("/apuracao/:competencia/revisar", requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia);
    const apuracao = await prisma.apuracao.findUnique({
      where: { portalClientId_competencia: { portalClientId, competencia } },
    });
    if (!apuracao) return bad(res, 404, "apuracao_not_found", "Calcule a apuração antes de revisar");
    if (apuracao.estado !== "calculada") {
      return bad(res, 409, "invalid_state", `Apuração está em "${apuracao.estado}", precisa estar "calculada"`);
    }
    const updated = await prisma.apuracao.update({
      where: { id: apuracao.id },
      data: { estado: "revisada" },
    });
    return res.json({ ok: true, apuracao: { id: updated.id, estado: updated.estado } });
  });

  // GET /apuracao/:competencia — pega snapshot atual + divergências
  router.get("/apuracao/:competencia", requireFirmCompanyAccess(), async (req, res) => {
    const portalClientId = String(req.params.companyId);
    const competencia = String(req.params.competencia);
    const apuracao = await prisma.apuracao.findUnique({
      where: { portalClientId_competencia: { portalClientId, competencia } },
      include: { divergencias: { orderBy: { createdAt: "desc" } } },
    });
    if (!apuracao) return res.json({ ok: true, apuracao: null });
    return res.json({
      ok: true,
      apuracao: {
        ...apuracao,
        rb12: apuracao.rb12?.toString() || null,
        fs12: apuracao.fs12?.toString() || null,
        fatorR: apuracao.fatorR?.toString() || null,
        receitaMes: apuracao.receitaMes?.toString() || null,
        dasValor: apuracao.dasValor?.toString() || null,
      },
    });
  });

  return router;
}
