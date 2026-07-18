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
import { calcularApuracaoLocal } from "../../application/notas/apuracao/v2/MotorApuracaoService.js";
import {
  getDadosFechamento,
  calcularFechamento,
  salvarFechamento,
  transmitirFechamento,
  reabrirFechamento,
  FechamentoError,
} from "../../application/notas/apuracao/v2/FechamentoService.js";
import { carregarAtividades } from "../../application/notas/apuracao/v2/AtividadeResolver.js";
import { resolverPerfilFiscal, normalizarPerfilConfig } from "../../application/notas/apuracao/v2/PerfilFiscalService.js";
import { sugerirAnexosDaCompetencia } from "../../application/notas/apuracao/v2/SugestaoAnexoService.js";
import { conferirCompetencia } from "../../application/notas/apuracao/v2/ConferenciaAdnService.js";

const REGIMES_VALIDOS = new Set(["SIMPLES_NACIONAL", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI"]);

// Q44: mapeia o regime do cadastro da empresa (Company, dados do CNPJ) → enum do CadastroFiscal.
function mapRegime(company) {
  const raw = String(company?.regimeTributario || "").toUpperCase();
  if (/MEI/.test(raw)) return "MEI";
  if (/PRESUMID/.test(raw)) return "LUCRO_PRESUMIDO";
  if (/REAL/.test(raw)) return "LUCRO_REAL";
  if (/SIMPLES/.test(raw) || company?.optanteSimples) return "SIMPLES_NACIONAL";
  return "SIMPLES_NACIONAL"; // default (a maioria das empresas do app é SN)
}

export function createApuracaoV2Router({ log } = {}) {
  const router = Router({ mergeParams: true });

  function bad(res, status, error, message, extra = {}) {
    return res.status(status).json({ ok: false, error, message, ...extra });
  }

  // Erro de negócio/config conhecido (validação nossa ou rejeição do SERPRO) → 400; 500 só pro inesperado.
  function statusForFechamentoErr(err) {
    if (err instanceof FechamentoError) return 400;
    if (String(err?.code || "").startsWith("SERPRO_")) return 400;
    return 500;
  }

  // ─── Cadastro Fiscal ──────────────────────────────────────────────────────
  // GET cadastro-fiscal (com sugestão CNAE→tipoReceita)
  router.get(
    "/cadastro-fiscal",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      try {
        let cadastro = await prisma.cadastroFiscal.findUnique({
          where: { portalClientId },
        });
        // Regime + CNAE são do CADASTRO DA EMPRESA (fonte única, editados na aba "Editar Cadastro").
        // SEMPRE sobrepõe esses campos com os do Company — evita re-digitação e divergência.
        // Os campos fiscais-específicos (usaFatorR, sublimite, forçarCnae, dataOpcao, observações)
        // continuam vindo do CadastroFiscal salvo.
        let prefill = false;
        const pc = await prisma.portalClient.findUnique({
          where: { id: portalClientId }, select: { companyId: true },
        });
        const company = pc?.companyId
          ? await prisma.company.findUnique({
              where: { id: pc.companyId },
              select: { cnaePrincipal: true, cnaesSecundarios: true, regimeTributario: true, optanteSimples: true, simplesDataOpcao: true },
            }).catch(() => null)
          : null;
        if (company?.cnaePrincipal) {
          const doCompany = {
            regime: mapRegime(company),
            cnaePrincipal: String(company.cnaePrincipal).replace(/\D+/g, ""),
            cnaesSecundarios: (company.cnaesSecundarios || []).map((c) => String(c).replace(/\D+/g, "")).filter(Boolean),
          };
          if (cadastro) {
            cadastro = { ...cadastro, ...doCompany }; // sobrepõe regime/CNAE (empresa é a fonte)
          } else {
            cadastro = {
              ...doCompany,
              dataOpcaoSN: company.simplesDataOpcao || null,
              sublimiteICMSISS: false,
              usaFatorR: false,
              forcarTipoReceitaPorCnae: false,
              observacoes: null,
            };
            prefill = true;
          }
        }
        let cnaePrincipalRef = null;
        if (cadastro?.cnaePrincipal) {
          cnaePrincipalRef = await prisma.cnaeAnexo.findUnique({
            where: { cnae: String(cadastro.cnaePrincipal).replace(/\D+/g, "").slice(0, 7) },
            select: { descricao: true, tipoReceitaSugerido: true, ambiguo: true },
          }).catch(() => null);
        }
        return res.json({ ok: true, cadastro, cnaePrincipalRef, prefill });
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
      const { regime, dataOpcaoSN, cnaePrincipal, cnaesSecundarios, sublimiteICMSISS, usaFatorR, forcarTipoReceitaPorCnae, observacoes } = req.body || {};
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
        forcarTipoReceitaPorCnae: Boolean(forcarTipoReceitaPorCnae),
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

  // ─── Perfil Fiscal (Aba Fiscal / Bloco A) ─────────────────────────────────
  // GET perfil-fiscal — atividades permitidas derivadas dos CNAEs + config do contador.
  router.get(
    "/perfil-fiscal",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      try {
        const perfil = await resolverPerfilFiscal({ portalClientId });
        return res.json({ ok: true, ...perfil });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao resolver perfil fiscal");
        return bad(res, 500, "perfil_fetch_failed", err?.message || "Erro");
      }
    }
  );

  // PUT perfil-fiscal — salva a config por CNAE (ativar/desativar, atividade padrão, atributos ISS).
  router.put(
    "/perfil-fiscal",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const perfilAtividades = normalizarPerfilConfig(req.body?.perfilAtividades);
      try {
        const existing = await prisma.cadastroFiscal.findUnique({ where: { portalClientId } });
        if (existing) {
          const cadastro = await prisma.cadastroFiscal.update({
            where: { portalClientId },
            data: { perfilAtividades },
          });
          const perfil = await resolverPerfilFiscal({ portalClientId });
          return res.json({ ok: true, cadastro, ...perfil });
        }
        // Sem CadastroFiscal → cria mínimo a partir do Company (CNPJ), como faz o GET /cadastro-fiscal.
        const pc = await prisma.portalClient.findUnique({ where: { id: portalClientId }, select: { companyId: true } });
        const company = pc?.companyId
          ? await prisma.company.findUnique({
              where: { id: pc.companyId },
              select: { cnaePrincipal: true, cnaesSecundarios: true, regimeTributario: true, optanteSimples: true, simplesDataOpcao: true },
            }).catch(() => null)
          : null;
        if (!company?.cnaePrincipal) {
          return bad(res, 409, "cadastro_fiscal_required", "Salve o Cadastro Fiscal (regime + CNAE) antes de configurar o perfil.");
        }
        const cadastro = await prisma.cadastroFiscal.create({
          data: {
            portalClientId,
            regime: mapRegime(company),
            dataOpcaoSN: company.simplesDataOpcao || null,
            cnaePrincipal: String(company.cnaePrincipal).replace(/\D+/g, ""),
            cnaesSecundarios: (company.cnaesSecundarios || []).map((c) => String(c).replace(/\D+/g, "")).filter(Boolean),
            perfilAtividades,
            createdByUserId: req.auth?.user?.id,
          },
        });
        const perfil = await resolverPerfilFiscal({ portalClientId });
        return res.json({ ok: true, cadastro, ...perfil });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId }, "Falha ao salvar perfil fiscal");
        return bad(res, 500, "perfil_save_failed", err?.message || "Erro");
      }
    }
  );

  // GET apuracao-sugestao/:competencia — sugestão de anexo por nota (§1.3).
  router.get(
    "/apuracao-sugestao/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia || "");
      if (!/^\d{4}-\d{2}$/.test(competencia)) {
        return bad(res, 400, "invalid_competencia", "competência YYYY-MM obrigatória");
      }
      try {
        const out = await sugerirAnexosDaCompetencia({ portalClientId, competencia });
        return res.json({ ok: true, ...out });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId, competencia }, "Falha na sugestão de anexo");
        return bad(res, 500, "sugestao_failed", err?.message || "Erro");
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

  // ─── Q19: lista de atividades do PGDAS-D (de-para oficial) p/ o dropdown do modal ──
  // Path distinto de "/fechamento/:competencia" pra não colidir com o param.
  router.get(
    "/atividades-pgdasd",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const dataReferencia = req.query.dataReferencia
        ? new Date(String(req.query.dataReferencia))
        : new Date();
      try {
        const { linhas } = await carregarAtividades(
          Number.isNaN(dataReferencia.getTime()) ? new Date() : dataReferencia,
        );
        // linhas vêm ordenadas por vigenciaInicio desc → 1ª ocorrência por idAtividade vence.
        const porId = new Map();
        for (const a of linhas) {
          if (!porId.has(a.idAtividade)) {
            porId.set(a.idAtividade, {
              idAtividade: a.idAtividade,
              descricao: a.descricao,
              anexoImplicito: a.anexoImplicito,
              mercado: a.mercado,
              sujeitoFatorR: a.sujeitoFatorR,
              tipoReceita: a.tipoReceita,
            });
          }
        }
        const atividades = [...porId.values()].sort((x, y) => x.idAtividade - y.idAtividade);
        return res.json({ ok: true, atividades });
      } catch (err) {
        log?.warn?.({ err: err?.message }, "Falha ao listar atividades PGDAS-D");
        return bad(res, 500, "atividades_list_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Q15: Fechamento (modal) — dados / calcular(simulação) / salvar / transmitir ──
  router.get(
    "/fechamento/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      try {
        const dados = await getDadosFechamento({ portalClientId, competencia });
        return res.json({ ok: true, dados });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha getDadosFechamento");
        return bad(res, err?.code === "PORTAL_NOT_FOUND" ? 404 : 500, err?.code || "fechamento_get_failed", err?.message || "Erro");
      }
    }
  );

  // Camada 2 (Robustez): confere a contagem de NFS-e da competência contra o ADN (scan read-only) e
  // grava o resultado no snapshot. Divergência → salvarFechamento trava. Sob demanda (hit no ADN).
  router.post(
    "/fechamento/:competencia/conferencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const env = String(req.body?.env || "prod");
      try {
        const conferencia = await conferirCompetencia({ portalClientId, competencia, env });
        return res.json({ ok: true, conferencia });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha conferência ADN");
        return bad(res, statusForFechamentoErr(err), err?.code || "conferencia_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/fechamento/:competencia/calcular",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { atividades, folhaMensal12, regimeApuracao, semMovimento } = req.body || {};
      try {
        const result = await calcularFechamento({ portalClientId, competencia, atividades, folhaMensal12, regimeApuracao, semMovimento: Boolean(semMovimento) });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha calcularFechamento");
        return bad(res, statusForFechamentoErr(err), err?.code || "calcular_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/fechamento/:competencia/salvar",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { atividades, folhaMensal12, regimeApuracao } = req.body || {};
      try {
        const result = await salvarFechamento({
          portalClientId, competencia, atividades, folhaMensal12, regimeApuracao,
          userId: req.auth?.user?.id,
        });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha salvarFechamento");
        return bad(res, err?.code === "NAO_CALCULADA" ? 409 : statusForFechamentoErr(err), err?.code || "salvar_failed", err?.message || "Erro");
      }
    }
  );

  router.post(
    "/fechamento/:competencia/transmitir",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { confirmCompetencia } = req.body || {};
      if (confirmCompetencia !== competencia) {
        return bad(res, 400, "confirm_competencia_mismatch",
          "Digite a competência exata pra confirmar a transmissão (proteção contra envio acidental).");
      }
      try {
        const result = await transmitirFechamento({ portalClientId, competencia, userId: req.auth?.user?.id });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha transmitirFechamento");
        return bad(res, err?.code === "ESTADO_INVALIDO" ? 409 : statusForFechamentoErr(err), err?.code || "transmitir_failed", err?.message || "Erro");
      }
    }
  );

  // Q55 — Reabrir uma apuração "transmitida" para retificar (rebaixa p/ "calculada").
  router.post(
    "/fechamento/:competencia/reabrir",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      try {
        const result = await reabrirFechamento({ portalClientId, competencia, userId: req.auth?.user?.id });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha reabrirFechamento");
        return bad(res, err?.code === "ESTADO_INVALIDO" ? 409 : statusForFechamentoErr(err), err?.code || "reabrir_failed", err?.message || "Erro");
      }
    }
  );

  // Q55 — Retransmitir como RETIFICADORA (tipoDeclaracao:2). Dupla confirmação obrigatória.
  router.post(
    "/fechamento/:competencia/retificar",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { confirmCompetencia, confirmRetificar } = req.body || {};
      if (confirmCompetencia !== competencia) {
        return bad(res, 400, "confirm_competencia_mismatch",
          "Digite a competência exata pra confirmar a retificação.");
      }
      if (confirmRetificar !== true) {
        return bad(res, 400, "confirm_retificar_required",
          "Confirme explicitamente que deseja RETIFICAR (retransmitir a declaração à Receita).");
      }
      try {
        const result = await transmitirFechamento({ portalClientId, competencia, userId: req.auth?.user?.id, retificar: true });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn?.({ err: err?.message, portalClientId, competencia }, "Falha retificar (transmitir)");
        return bad(res, err?.code === "ESTADO_INVALIDO" ? 409 : statusForFechamentoErr(err), err?.code || "retificar_failed", err?.message || "Erro");
      }
    }
  );

  // ─── Apurar v2 (motor local de cálculo de DAS) ─────────────────────────────
  router.post(
    "/apurar-v2/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      const { folha12m } = req.body || {};
      try {
        const result = await calcularApuracaoLocal({
          portalClientId, competencia,
          folha12mOverride: folha12m != null ? Number(folha12m) : undefined,
          userId: req.auth?.user?.id,
        });
        return res.json({ ok: true, result });
      } catch (err) {
        log?.warn({ err: err?.message, portalClientId, competencia }, "Falha ao apurar v2");
        return bad(res, 500, "apurar_failed", err?.message || "Erro", { code: err?.code });
      }
    }
  );

  // GET apuração calculada (snapshot)
  router.get(
    "/apuracao-snapshot/:competencia",
    requireFirmCompanyAccess({ minRole: "ACCOUNTANT" }),
    async (req, res) => {
      const portalClientId = String(req.params.companyId);
      const competencia = String(req.params.competencia);
      try {
        const snap = await prisma.apuracaoSnapshot.findUnique({
          where: { portalClientId_competencia: { portalClientId, competencia } },
        });
        return res.json({ ok: true, snapshot: snap });
      } catch (err) {
        return bad(res, 500, "get_snapshot_failed", err?.message || "Erro");
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
