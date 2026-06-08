// Q14.2.d — Endpoints do sistema de apuração v2.
// Mount: /firm/companies/:companyId/{cadastro-fiscal,produtos-servicos,pendencias,classificar-v2}

import { Router } from "express";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { classificarItensV2 } from "../../application/notas/apuracao/v2/ClassificadorService.js";
import {
  resolverPendenciaItemSemRegra,
  resolverPendenciaDivergencia,
  TIPOS_RECEITA_VALIDOS,
} from "../../application/notas/apuracao/v2/AprendizadoService.js";

const REGIMES_VALIDOS = new Set(["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI"]);

export function createApuracaoV2Router({ log } = {}) {
  const router = Router({ mergeParams: true });

  function bad(res, status, error, message, extra = {}) {
    return res.status(status).json({ ok: false, error, message, ...extra });
  }

  // ─── Cadastro Fiscal ──────────────────────────────────────────────────────
  // GET cadastro-fiscal (com sugestão CNAE→tipoReceita)
  router.get(
    "/cadastro-fiscal",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      try {
        const cadastro = await prisma.cadastroFiscal.findUnique({
          where: { portalClientId },
        });
        let cnaePrincipalRef = null;
        if (cadastro?.cnaePrincipal) {
          cnaePrincipalRef = await prisma.cnaeAnexo.findUnique({
            where: { cnae: cadastro.cnaePrincipal },
            select: { descricao: true, tipoReceitaSugerido: true, ambiguo: true },
          });
        }
        return res.json({ ok: true, cadastro, cnaePrincipalRef });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao buscar cadastro fiscal");
        return bad(res, 500, "cadastro_fetch_failed", err?.message || "Erro");
      }
    }
  );

  // POST/PUT cadastro-fiscal (upsert)
  router.put(
    "/cadastro-fiscal",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const { regime, dataOpcaoSN, cnaePrincipal, cnaesSecundarios, sublimiteICMSISS, usaFatorR, observacoes } = req.body || {};
      if (!regime || !REGIMES_VALIDOS.has(regime)) {
        return bad(res, 400, "invalid_regime", `Regime deve ser um de: ${[...REGIMES_VALIDOS].join(", ")}`);
      }
      if (!cnaePrincipal || String(cnaePrincipal).replace(/\D+/g, "").length < 7) {
        return bad(res, 400, "invalid_cnae", "cnaePrincipal deve ter 7 dígitos");
      }
      const data = {
        regime,
        dataOpcaoSN: dataOpcaoSN ? new Date(dataOpcaoSN) : null,
        cnaePrincipal: String(cnaePrincipal).replace(/\D+/g, ""),
        cnaesSecundarios: Array.isArray(cnaesSecundarios) ? cnaesSecundarios.map((c) => String(c).replace(/\D+/g, "")) : [],
        sublimiteICMSISS: Boolean(sublimiteICMSISS),
        usaFatorR: Boolean(usaFatorR),
        observacoes: observacoes ? String(observacoes) : null,
        createdByUserId: req.auth?.user?.id,
      };
      try {
        const existing = await prisma.cadastroFiscal.findUnique({ where: { portalClientId } });
        const cadastro = existing
          ? await prisma.cadastroFiscal.update({ where: { portalClientId }, data })
          : await prisma.cadastroFiscal.create({ data: { ...data, portalClientId } });
        return res.json({ ok: true, cadastro });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao salvar cadastro fiscal");
        return bad(res, 500, "cadastro_save_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Produtos / Serviços (catálogo da empresa) ────────────────────────────
  router.get(
    "/produtos-servicos",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const ativo = req.query.ativo !== "false";
      try {
        const items = await prisma.produtoServico.findMany({
          where: { portalClientId, ...(ativo ? { ativo: true } : {}) },
          orderBy: { nome: "asc" },
        });
        return res.json({ ok: true, items });
      } catch (err) {
        return bad(res, 500, "list_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/produtos-servicos",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const { nome, tipoReceita, codigoServico, ncm, cfop, codigoInterno } = req.body || {};
      if (!nome) return bad(res, 400, "nome_required", "nome obrigatório");
      if (!TIPOS_RECEITA_VALIDOS.has(tipoReceita)) {
        return bad(res, 400, "tipo_receita_invalido", `tipoReceita deve ser um de: ${[...TIPOS_RECEITA_VALIDOS].join(", ")}`);
      }
      try {
        const created = await prisma.produtoServico.create({
          data: {
            portalClientId,
            nome: String(nome).trim(),
            tipoReceita,
            codigoServico: codigoServico ? String(codigoServico).trim() : null,
            ncm: ncm ? String(ncm).trim() : null,
            cfop: cfop ? String(cfop).trim() : null,
            codigoInterno: codigoInterno ? String(codigoInterno).trim() : null,
            origem: "MANUAL",
            createdByUserId: req.auth?.user?.id,
          },
        });
        return res.json({ ok: true, produto: created });
      } catch (err) {
        return bad(res, 500, "create_failed", err?.message || "Erro");
      }
    }
  );

  router.patch(
    "/produtos-servicos/:produtoId",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const produtoId = String(req.params.produtoId);
      const { nome, tipoReceita, codigoServico, ncm, cfop, codigoInterno, ativo } = req.body || {};
      try {
        const existing = await prisma.produtoServico.findFirst({ where: { id: produtoId, portalClientId } });
        if (!existing) return bad(res, 404, "not_found", "Produto não encontrado");
        const data = {};
        if (nome != null) data.nome = String(nome).trim();
        if (tipoReceita != null) {
          if (!TIPOS_RECEITA_VALIDOS.has(tipoReceita)) return bad(res, 400, "tipo_receita_invalido", "");
          data.tipoReceita = tipoReceita;
        }
        if (codigoServico !== undefined) data.codigoServico = codigoServico ? String(codigoServico).trim() : null;
        if (ncm !== undefined) data.ncm = ncm ? String(ncm).trim() : null;
        if (cfop !== undefined) data.cfop = cfop ? String(cfop).trim() : null;
        if (codigoInterno !== undefined) data.codigoInterno = codigoInterno ? String(codigoInterno).trim() : null;
        if (ativo != null) data.ativo = Boolean(ativo);
        const updated = await prisma.produtoServico.update({ where: { id: produtoId }, data });
        return res.json({ ok: true, produto: updated });
      } catch (err) {
        return bad(res, 500, "update_failed", err?.message || "Erro");
      }
    }
  );

  router.delete(
    "/produtos-servicos/:produtoId",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const produtoId = String(req.params.produtoId);
      try {
        const existing = await prisma.produtoServico.findFirst({ where: { id: produtoId, portalClientId } });
        if (!existing) return bad(res, 404, "not_found", "Produto não encontrado");
        await prisma.produtoServico.delete({ where: { id: produtoId } });
        return res.json({ ok: true });
      } catch (err) {
        return bad(res, 500, "delete_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Pendências ────────────────────────────────────────────────────────────
  router.get(
    "/pendencias",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const resolvida = req.query.resolvida === "true";
      const tipo = req.query.tipo ? String(req.query.tipo) : undefined;
      const competencia = req.query.competencia ? String(req.query.competencia) : undefined;
      try {
        const items = await prisma.filaPendencia.findMany({
          where: {
            portalClientId,
            resolvida,
            ...(tipo ? { tipo } : {}),
            ...(competencia ? { competencia } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        });
        const counts = await prisma.filaPendencia.groupBy({
          by: ["tipo"],
          where: { portalClientId, resolvida: false },
          _count: true,
        });
        return res.json({ ok: true, items, counts });
      } catch (err) {
        return bad(res, 500, "list_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/pendencias/:pendenciaId/resolver",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const pendenciaId = String(req.params.pendenciaId);
      const portalClientId = String(req.params.companyId);
      const { tipoReceita, criarRegra = true, nomeProduto, acao } = req.body || {};
      try {
        // Confirma que a pendência pertence à empresa
        const pend = await prisma.filaPendencia.findFirst({
          where: { id: pendenciaId, portalClientId },
        });
        if (!pend) return bad(res, 404, "pendencia_not_found", "Pendência não encontrada");

        let result;
        if (pend.tipo === "ITEM_SEM_REGRA") {
          if (!tipoReceita) return bad(res, 400, "tipo_receita_required", "Escolha um tipoReceita");
          result = await resolverPendenciaItemSemRegra({
            pendenciaId, tipoReceita, criarRegra, nomeProduto,
            userId: req.auth?.user?.id,
          });
        } else if (pend.tipo === "DIVERGENCIA_CADASTRO") {
          result = await resolverPendenciaDivergencia({
            pendenciaId, acao, userId: req.auth?.user?.id,
          });
        } else {
          return bad(res, 400, "tipo_nao_suportado", `Tipo de pendência ${pend.tipo} não tem resolver automático`);
        }
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn({ err: err?.message, pendenciaId }, "Falha ao resolver pendência");
        return bad(res, 500, "resolve_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Classificar v2 (dispara ClassificadorService) ─────────────────────────
  router.post(
    "/classificar-v2",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const force = req.query.force === "true" || req.body?.force === true;
      const competencia = req.body?.competencia || req.query.competencia;
      try {
        const result = await classificarItensV2({ portalClientId, force, competencia });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao classificar v2");
        return bad(res, 500, "classify_failed", err?.message || "Erro");
      }
    }
  );

  return router;
}
