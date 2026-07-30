// Calendário fiscal do escritório.
// Mount: /firm/calendario e /firm/marcos-fiscais
//
// O GET do mês NÃO recebe empresa obrigatória: a visão que interessa é a do escritório — "o que
// vence no dia 20, em todas as empresas". O filtro por empresa é opcional, para recortar.

import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { montarCalendarioDoMes } from "../../application/calendario/CalendarioFiscalService.js";
import { empresasVisiveis } from "./empresasVisiveis.js";

const IMPORTANCIAS = new Set(["ALTA", "MEDIA", "BAIXA"]);

export function createCalendarioRouter({ log } = {}) {
  const router = Router({ mergeParams: true });

  function falhar(res, err, contexto) {
    log?.error?.({ err: err?.message || err, ...contexto }, "Falha no calendário fiscal");
    return res.status(500).json({ ok: false, error: "erro_interno" });
  }

  router.get("/calendario", async (req, res) => {
    const competencia = String(req.query?.mes || "").trim();
    if (!/^\d{4}-\d{2}$/.test(competencia)) {
      return res.status(400).json({ ok: false, error: "mes_invalido", message: "Informe o mês como YYYY-MM." });
    }
    try {
      const portalIds = await empresasVisiveis(req);
      const companyId = String(req.query?.companyId || "").trim() || null;
      const out = await montarCalendarioDoMes({ portalIds, competencia, companyId });
      return res.json(out);
    } catch (err) { return falhar(res, err, { competencia }); }
  });

  // ── Marcos marcados à mão ──────────────────────────────────────────────────────────────────
  router.get("/marcos-fiscais", async (req, res) => {
    try {
      const portalIds = await empresasVisiveis(req);
      const marcos = await prisma.marcoFiscal.findMany({
        where: { OR: [{ portalClientId: null }, { portalClientId: { in: portalIds } }] },
        orderBy: { data: "asc" },
      });
      return res.json({ ok: true, marcos });
    } catch (err) { return falhar(res, err, {}); }
  });

  router.post("/marcos-fiscais", async (req, res) => {
    const titulo = String(req.body?.titulo || "").trim();
    const data = req.body?.data;
    if (!titulo) return res.status(400).json({ ok: false, error: "titulo_obrigatorio" });
    const quando = data ? new Date(data) : null;
    if (!quando || Number.isNaN(quando.getTime())) {
      return res.status(400).json({ ok: false, error: "data_invalida" });
    }
    try {
      const marco = await prisma.marcoFiscal.create({
        data: {
          titulo,
          data: quando,
          descricao: String(req.body?.descricao || "").trim() || null,
          importancia: IMPORTANCIAS.has(String(req.body?.importancia || "").toUpperCase())
            ? String(req.body.importancia).toUpperCase()
            : "MEDIA",
          // Sem empresa = marco do escritório. É o caso do IBS/CBS, que vale para todo mundo.
          portalClientId: String(req.body?.companyId || "").trim() || null,
          criadoPorId: req.auth?.user?.id || null,
        },
      });
      return res.status(201).json({ ok: true, marco });
    } catch (err) { return falhar(res, err, {}); }
  });

  router.patch("/marcos-fiscais/:marcoId", async (req, res) => {
    const id = String(req.params.marcoId);
    try {
      const data = {};
      if (req.body?.titulo !== undefined) {
        const t = String(req.body.titulo || "").trim();
        if (!t) return res.status(400).json({ ok: false, error: "titulo_obrigatorio" });
        data.titulo = t;
      }
      if (req.body?.data !== undefined) {
        const q = new Date(req.body.data);
        if (Number.isNaN(q.getTime())) return res.status(400).json({ ok: false, error: "data_invalida" });
        data.data = q;
      }
      if (req.body?.descricao !== undefined) data.descricao = String(req.body.descricao || "").trim() || null;
      if (req.body?.importancia !== undefined && IMPORTANCIAS.has(String(req.body.importancia).toUpperCase())) {
        data.importancia = String(req.body.importancia).toUpperCase();
      }
      const marco = await prisma.marcoFiscal.update({ where: { id }, data });
      return res.json({ ok: true, marco });
    } catch (err) {
      if (err?.code === "P2025") return res.status(404).json({ ok: false, error: "marco_nao_encontrado" });
      return falhar(res, err, { id });
    }
  });

  router.delete("/marcos-fiscais/:marcoId", async (req, res) => {
    const id = String(req.params.marcoId);
    try {
      await prisma.marcoFiscal.delete({ where: { id } });
      return res.json({ ok: true, removido: { id } });
    } catch (err) {
      if (err?.code === "P2025") return res.status(404).json({ ok: false, error: "marco_nao_encontrado" });
      return falhar(res, err, { id });
    }
  });

  return router;
}
