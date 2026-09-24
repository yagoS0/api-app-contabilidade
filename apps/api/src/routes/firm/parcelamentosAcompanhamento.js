import { Router } from "express";
import { vincularGuiaParcelamento } from "../../application/accounting/parcelamento/GuiaAvulsaParcelamentoService.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { requireFirmCompanyAccess } from "../../middlewares/requireFirmCompanyAccess.js";
import { reprocessarSitfisParcelamentos, localizarParcelamentosFiscais, cadastrarAcompanhamentoFiscal, resolverIndicacaoParcelamento, erroAcompanhamento } from "../../application/fiscal/serpro/ParcelamentoDescobertaService.js";
import { capturarParcelaGuideForCompany } from "../../application/fiscal/serpro/CaptureSerproParcelaService.js";
import { listarPendenciasParcelamento } from "../../application/accounting/parcelamento/ParcelamentoAcompanhamentoService.js";
import { confirmarPagamentoParcela } from "../../application/fiscal/serpro/SerproParcelaPagamentoService.js";
import { obterDocumentoParcela, conferirDocumentoParcela } from "../../application/fiscal/serpro/ParcelamentoDocumentoService.js";
import { getSerproRuntimeSettings } from "../../application/fiscal/serpro/SerproRuntimeSettings.js";

export function createParcelamentosAcompanhamentoRouter({ log } = {}) {
  const router = Router();
  const base = "/companies/:companyId/parcelamentos/acompanhamento";
  const acesso = requireFirmCompanyAccess({ minRole: "ACCOUNTANT" });
  const handle = fn => async (req, res) => {
    try { const result = await fn(req); return res.json({ ok: true, ...result }); }
    catch (err) {
      log?.warn?.({ code: err.code, companyId: req.params.companyId }, "Falha no acompanhamento de parcelamento");
      return res.status(Number(err.status) >= 400 && Number(err.status) <= 599 ? Number(err.status) : err.code ? 502 : 500).json({ ok: false, error: err.code || "ACOMPANHAMENTO_FALHOU", message: err.code ? err.message : "Não foi possível concluir o acompanhamento." });
    }
  };
  router.post(`${base}/guias/:guideId/vincular`, acesso, handle(req => vincularGuiaParcelamento({ portalClientId: req.params.companyId, guideId: req.params.guideId, parcelamentoId: req.body?.parcelamentoId, numeroParcela: req.body?.numeroParcela })));
  router.get(base, requireFirmCompanyAccess(), handle(async req => {
    const portalClientId = req.params.companyId;
    await reprocessarSitfisParcelamentos({ portalClientId });
    const [indicacoes, rows, projecao, rotinas, configuracao] = await Promise.all([
      prisma.parcelamentoIndicacao.findMany({ where: { portalClientId }, orderBy: [{ status: "asc" }, { evidenciaEm: "desc" }] }),
      prisma.parcelamento.findMany({ where: { portalClientId, status: { not: "EXCLUIDO" } }, orderBy: { createdAt: "desc" } }),
      listarPendenciasParcelamento({ portalClientIds: [portalClientId], mesOperacional: req.query.mesOperacional || undefined }),
      prisma.companyRotina.findMany({ where: { portalClientId, rotina: { in: ["parcelamento", "pagamento"] } }, select: { rotina: true, enabled: true } }),
      getSerproRuntimeSettings(),
    ]);
    const contratos = rows.map(({ fiscalRawPayload, ...c }) => ({ ...c, totalValue: c.totalValue == null ? null : Number(c.totalValue), principalPerParcela: c.principalPerParcela == null ? null : Number(c.principalPerParcela), somenteFiscal: !c.aberturaEntryId }));
    const configurada = rotina => Boolean(configuracao.enabled && configuracao.rotinas?.[rotina]?.enabled !== false && rotinas.some(r => r.rotina === rotina && r.enabled));
    return { indicacoes: indicacoes.map(({ rawPayload, ...i }) => i), contratos, ...projecao,
      acompanhamentoAutomatico: { parcelamento: configurada("parcelamento"), pagamento: configurada("pagamento"), origem: "CONFIGURACAO_EMPRESA_E_AGENDA", execucaoVerificada: false } };
  }));
  router.post(`${base}/reprocessar`, acesso, handle(req => reprocessarSitfisParcelamentos({ portalClientId: req.params.companyId })));
  router.post(`${base}/localizar`, acesso, handle(req => localizarParcelamentosFiscais({ portalClientId: req.params.companyId, modalidades: req.body?.modalidades })));
  router.post(`${base}/contratos`, acesso, handle(async req => {
    const contrato = await cadastrarAcompanhamentoFiscal({ portalClientId: req.params.companyId, tipo: req.body?.tipo, numeroParcelamento: req.body?.numeroParcelamento, label: req.body?.label, formaPagamento: req.body?.formaPagamento, usuarioId: req.auth?.user?.id });
    if (req.body?.indicacaoId) await resolverIndicacaoParcelamento({ portalClientId: req.params.companyId, indicacaoId: req.body.indicacaoId, status: "VINCULADO", motivo: "Contrato identificado pelo contador no acompanhamento fiscal.", parcelamentoId: contrato.id, usuarioId: req.auth?.user?.id });
    return { contrato };
  }));
  router.patch(`${base}/contratos/:contratoId`, acesso, handle(async req => {
    const contrato = await prisma.parcelamento.findFirst({ where: { id: req.params.contratoId, portalClientId: req.params.companyId, status: { not: "EXCLUIDO" } } });
    if (!contrato) throw erroAcompanhamento("CONTRATO_NAO_ENCONTRADO", "Contrato não encontrado nesta empresa.", 404);
    const { formaPagamento, label } = req.body || {};
    if (formaPagamento !== undefined && formaPagamento !== null && !["GUIA_MENSAL", "DEBITO_AUTOMATICO"].includes(formaPagamento)) throw erroAcompanhamento("FORMA_PAGAMENTO_INVALIDA", "Forma de pagamento inválida.");
    if (label !== undefined && !String(label).trim()) throw erroAcompanhamento("DESCRICAO_INVALIDA", "Informe uma descrição.");
    const data = { ...(formaPagamento !== undefined ? { formaPagamento } : {}), ...(label !== undefined ? { label: String(label).trim().slice(0,500) } : {}) };
    return { contrato: await prisma.parcelamento.update({ where: { id: contrato.id }, data }) };
  }));
  router.post(`${base}/indicacoes/:indicacaoId/resolver`, acesso, handle(async req => ({ indicacao: await resolverIndicacaoParcelamento({ portalClientId: req.params.companyId, indicacaoId: req.params.indicacaoId, status: req.body?.status, motivo: req.body?.motivo, parcelamentoId: req.body?.parcelamentoId, usuarioId: req.auth?.user?.id }) })));
  router.post(`${base}/contratos/:contratoId/capturar`, acesso, handle(async req => {
    const parcelamento = await prisma.parcelamento.findFirst({ where: { id: req.params.contratoId, portalClientId: req.params.companyId, status: "ATIVO" } });
    if (!parcelamento) throw erroAcompanhamento("CONTRATO_NAO_ENCONTRADO", "Contrato ativo não encontrado nesta empresa.", 404);
    return capturarParcelaGuideForCompany({ portalClientId: req.params.companyId, parcelamento, log });
  }));
  router.get(`${base}/parcelas/:parcelaId/documento`, acesso, handle(req => obterDocumentoParcela({ portalClientId: req.params.companyId, parcelaId: req.params.parcelaId })));
  router.post(`${base}/parcelas/:parcelaId/conferir-documento`, acesso, handle(req => conferirDocumentoParcela({ portalClientId: req.params.companyId, parcelaId: req.params.parcelaId, usuarioId: req.auth?.user?.id, dados: req.body })));
  router.post(`${base}/parcelas/:parcelaId/consultar-pagamento`, acesso, handle(req => confirmarPagamentoParcela({ portalClientId: req.params.companyId, parcelaId: req.params.parcelaId, force: true })));
  return router;
}
