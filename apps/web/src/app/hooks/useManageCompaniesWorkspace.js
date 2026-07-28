import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCompanies } from "../../features/companies/list/hooks/useManageCompanies";
import { useCompanyGuides } from "../../features/guides/list/hooks/useManageCompanyGuides";
import {
  getInitialCompanyFormState,
  mapCompanyToEditForm,
  useCompanyForm,
} from "../../features/companies/form/hooks/useManageCompanyForm";

// Q8.C.3: tabs do CompanyDetail viraram sub-rotas — `companyDetailTab` agora é derivado da URL.
// Mantém a API legada `setCompanyDetailTab(name)` por compat — só faz navigate().
const COMPANY_TAB_SEGMENTS = ["guides", "lancamentos", "circular", "parcelamento", "notas-fiscais", "sitfis", "cadastro-fiscal", "plano-contas", "cadastro", "edit"];
const SEGMENT_TO_TAB = {
  guides: "guides",
  lancamentos: "lancamentos",
  circular: "circular",
  parcelamento: "parcelamento",
  "notas-fiscais": "notasFiscais",
  sitfis: "sitfis",
  "cadastro-fiscal": "cadastroFiscal",
  // Sugestão e Pendências viraram sub-abas INTERNAS do Cadastro (estado local, não URL).
  // Links antigos caem no Cadastro Fiscal.
  sugestao: "cadastroFiscal",
  pendencias: "cadastroFiscal",
  "apuracao-v2": "cadastroFiscal",
  "plano-contas": "planoContas",
  // "configuracoes" (Configurações de Lançamentos) foi removida: lançamento não se configura,
  // ele aprende do histórico. Link antigo cai em Lançamentos.
  configuracoes: "lancamentos",
  cadastro: "cadastro",
  edit: "edit",
};
const TAB_TO_SEGMENT = {
  guides: "guides",
  lancamentos: "lancamentos",
  circular: "circular",
  parcelamento: "parcelamento",
  notasFiscais: "notas-fiscais",
  sitfis: "sitfis",
  cadastroFiscal: "cadastro-fiscal",
  planoContas: "plano-contas",
  cadastro: "cadastro",
  edit: "edit",
};
// Q17: competência default do dashboard = mês civil anterior.
function dashboardPrevMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function deriveCompanyDetailTab(pathname) {
  // Q17: Lançamentos é a aba default ao abrir uma empresa.
  const match = pathname.match(/^\/companies\/[^\/]+\/([^\/]+)/);
  if (!match) return "lancamentos";
  return SEGMENT_TO_TAB[match[1]] || "lancamentos";
}

export function useManageCompaniesWorkspace({ api, page, setPage, feedback, onInssSynced, onPgdasSynced, onGuidePaymentConfirmed }) {
  const location = useLocation();
  const navigate = useNavigate();
  const companiesState = useCompanies();
  const guidesState = useCompanyGuides();
  const createCompanyForm = useCompanyForm(getInitialCompanyFormState());
  const editCompanyForm = useCompanyForm(getInitialCompanyFormState());

  // Q8.C.3: companyDetailTab derivado da URL. setCompanyDetailTab vira adapter pra navigate.
  const companyDetailTab = deriveCompanyDetailTab(location.pathname);
  function setCompanyDetailTab(tab) {
    const segment = TAB_TO_SEGMENT[tab];
    if (!segment) {
      console.warn(`[setCompanyDetailTab] tab desconhecida: ${tab}`);
      return;
    }
    const cid = companiesState.selectedCompanyId;
    if (!cid) {
      console.warn("[setCompanyDetailTab] sem companyId — não é possível navegar");
      return;
    }
    navigate(`/companies/${cid}/${segment}`);
  }
  const [submittingCompany, setSubmittingCompany] = useState(false);
  // Q17: competência do dashboard (default = mês anterior). Trocar recarrega a lista.
  const [dashboardCompetencia, setDashboardCompetenciaState] = useState(dashboardPrevMonth());
  function changeDashboardCompetencia(comp) {
    const next = comp || dashboardPrevMonth();
    setDashboardCompetenciaState(next);
    loadCompanies(next);
  }
  const [submittingCompanyEdit, setSubmittingCompanyEdit] = useState(false);
  const [jobEnabled, setJobEnabled] = useState(false);
  const [guideSettings, setGuideSettings] = useState(null);
  const [savingSerproSettings, setSavingSerproSettings] = useState(false);
  const [uploadingSerproCertificate, setUploadingSerproCertificate] = useState(false);
  const [deletingSerproCertificate, setDeletingSerproCertificate] = useState(false);
  const [checkingSerproProcuration, setCheckingSerproProcuration] = useState(false);
  const [capturingSerproPgdasd, setCapturingSerproPgdasd] = useState(false);
  const [syncingSerproPgdas, setSyncingSerproPgdas] = useState(false);
  const [syncingSerproInss, setSyncingSerproInss] = useState(false);
  const [recalcInssBusy, setRecalcInssBusy] = useState(false); // Q53: recálculo explícito do INSS na aba Guias
  const [liberarGuiasBusy, setLiberarGuiasBusy] = useState(false); // Portal Cliente (#3.1): liberar/revogar guias ao cliente
  const [serproProcurationStatus, setSerproProcurationStatus] = useState(null);
  const [serproWorkerStatus, setSerproWorkerStatus] = useState(null);
  const [runningSerproCron, setRunningSerproCron] = useState(false);
  const [serproCronRunResult, setSerproCronRunResult] = useState(null);
  const [pendingGuides, setPendingGuides] = useState([]);
  const [selectedPendingGuideIds, setSelectedPendingGuideIds] = useState([]);
  const [loadingPendingGuides, setLoadingPendingGuides] = useState(false);
  const [sendingSelectedPending, setSendingSelectedPending] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);
  const [uploadingGuides, setUploadingGuides] = useState(false);
  const [uploadingCompanyGuide, setUploadingCompanyGuide] = useState(false);
  const [unidentifiedGuides, setUnidentifiedGuides] = useState([]);
  const [loadingUnidentifiedGuides, setLoadingUnidentifiedGuides] = useState(false);
  // Página "Envio de e-mails em lote"
  const [batchEmailReport, setBatchEmailReport] = useState(null);
  const [loadingBatchEmailReport, setLoadingBatchEmailReport] = useState(false);
  const [sendingBatchEmails, setSendingBatchEmails] = useState(false);
  const [batchEmailSendResult, setBatchEmailSendResult] = useState(null);
  // Status do plano de contas global — pré-requisito para criar empresas
  const [globalChartStatus, setGlobalChartStatus] = useState(null);

  const selectedCompany = companiesState.selectedCompany;

  async function loadCompanies(competenciaArg) {
    if (page === "login") return;
    const competencia = competenciaArg || dashboardCompetencia;
    companiesState.setLoadingCompanies(true);
    feedback.clearFeedback();
    try {
      const data = await api.listCompanies(competencia);
      companiesState.setCompanies(data);
      if (!companiesState.selectedCompanyId && data.length > 0) {
        companiesState.setSelectedCompanyId(data[0].companyId);
      }
    } catch (err) {
      feedback.setError(err?.message || "Falha ao carregar empresas");
    } finally {
      companiesState.setLoadingCompanies(false);
    }
  }

  async function loadGuides(companyId = companiesState.selectedCompanyId) {
    if (!companyId) return;
    guidesState.setLoadingGuides(true);
    feedback.clearFeedback();
    try {
      const items = await api.getCompanyGuides(companyId);
      guidesState.setGuides(items);
    } catch (err) {
      feedback.setError(err?.message || "Falha ao carregar guias");
      guidesState.setGuides([]);
    } finally {
      guidesState.setLoadingGuides(false);
    }
  }

  async function loadGuideSettings() {
    if (page === "login") return;
    feedback.clearFeedback();
    try {
      const settings = await api.getSerproSettings();
      setGuideSettings(settings);
      setJobEnabled(Boolean(settings?.enabled));
    } catch (err) {
      feedback.setError(err?.message || "Falha ao carregar configuracao do job");
    }
  }

  async function loadSerproWorkerStatus() {
    if (page === "login") return null;
    try {
      const payload = await api.getSerproStatus();
      setSerproWorkerStatus(payload || null);
      return payload || null;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao carregar status do worker SERPRO.");
      return null;
    }
  }

  // Dispara manualmente o cron SERPRO (DAS PGDAS-D + INSS DCTFWeb).
  // Mesmo fluxo que o cron automático rodaria, mas iniciado pelo botão.
  async function handleRunSerproCron(input = {}) {
    if (page === "login") return null;
    setRunningSerproCron(true);
    feedback.clearFeedback();
    try {
      const result = await api.runSerproCron(input);
      setSerproCronRunResult(result || null);
      feedback.setMessage("Execução manual do cron SERPRO concluída.");
      // atualiza o card "última execução" automaticamente
      await loadSerproWorkerStatus();
      return result;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao executar cron SERPRO.");
      setSerproCronRunResult(null);
      return null;
    } finally {
      setRunningSerproCron(false);
    }
  }

  // Carrega a matriz "empresa × tipo de guia" para a página de envio em lote.
  async function handleLoadBatchEmailReport(competencia) {
    if (page === "login") return null;
    setLoadingBatchEmailReport(true);
    feedback.clearFeedback();
    try {
      const result = await api.getBatchEmailReport(competencia);
      setBatchEmailReport(result || null);
      return result;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao carregar matriz de envio em lote.");
      setBatchEmailReport(null);
      return null;
    } finally {
      setLoadingBatchEmailReport(false);
    }
  }

  // Dispara envio em lote de 1 e-mail por empresa (com todas as guias da competência anexadas).
  async function handleSendBatchEmails(items) {
    if (page === "login" || !Array.isArray(items) || !items.length) return null;
    setSendingBatchEmails(true);
    setBatchEmailSendResult(null);
    feedback.clearFeedback();
    try {
      const result = await api.sendBatchEmails(items);
      setBatchEmailSendResult(result || null);
      const sent = Number(result?.sent || 0);
      if (sent > 0) {
        feedback.setMessage(`${sent} e-mail${sent === 1 ? "" : "s"} enviado${sent === 1 ? "" : "s"} com sucesso.`);
      } else {
        feedback.setError("Nenhum e-mail foi enviado.");
      }
      // Recarrega o report para refletir o novo estado (linhas enviadas somem).
      if (batchEmailReport?.competencia) {
        await handleLoadBatchEmailReport(batchEmailReport.competencia);
      }
      return result;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao enviar e-mails em lote.");
      return null;
    } finally {
      setSendingBatchEmails(false);
    }
  }

  async function handleSaveSerproSettings(input) {
    setSavingSerproSettings(true);
    feedback.clearFeedback();
    try {
      const payload = await api.updateSerproSettings(input);
      setGuideSettings(payload?.settings || null);
      feedback.setMessage("Configuração SERPRO salva com sucesso.");
    } catch (err) {
      feedback.setError(err?.message || "Falha ao salvar configuração SERPRO.");
    } finally {
      setSavingSerproSettings(false);
    }
  }

  async function handleUploadSerproCertificate({ file, password }) {
    if (!file || !password) {
      feedback.setError("Selecione o certificado e informe a senha.");
      return false;
    }
    setUploadingSerproCertificate(true);
    feedback.clearFeedback();
    try {
      await api.uploadSerproCertificate({ file, password });
      feedback.setMessage("Certificado SERPRO enviado com sucesso.");
      await loadGuideSettings();
      return true;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao enviar certificado SERPRO.");
      return false;
    } finally {
      setUploadingSerproCertificate(false);
    }
  }

  async function handleDeleteSerproCertificate() {
    setDeletingSerproCertificate(true);
    feedback.clearFeedback();
    try {
      await api.deleteSerproCertificate();
      feedback.setMessage("Certificado SERPRO removido.");
      await loadGuideSettings();
    } catch (err) {
      feedback.setError(err?.message || "Falha ao remover certificado SERPRO.");
    } finally {
      setDeletingSerproCertificate(false);
    }
  }

  async function loadSerproCompanyProcuration(companyId) {
    if (!companyId) {
      setSerproProcurationStatus(null);
      return null;
    }
    try {
      const payload = await api.getSerproCompanyProcuration(companyId);
      setSerproProcurationStatus(payload?.result || null);
      return payload?.result || null;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao carregar status da procuração SERPRO.");
      return null;
    }
  }

  async function handleCheckSerproProcuration(companyId, input = {}) {
    if (!companyId) {
      feedback.setError("Selecione uma empresa para consultar a procuração.");
      return false;
    }
    setCheckingSerproProcuration(true);
    feedback.clearFeedback();
    try {
      const payload = await api.checkSerproCompanyProcuration(companyId, input);
      setSerproProcurationStatus(payload?.result || null);
      feedback.setMessage("Procuração SERPRO consultada com sucesso.");
      return true;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao consultar procuração SERPRO.");
      return false;
    } finally {
      setCheckingSerproProcuration(false);
    }
  }

  async function handleCaptureSerproPgdasd(companyId, input = {}) {
    if (!companyId) {
      feedback.setError("Selecione uma empresa para capturar a guia PGDAS-D.");
      return false;
    }
    setCapturingSerproPgdasd(true);
    feedback.clearFeedback();
    try {
      const payload = await api.captureSerproPgdasd(companyId, input);
      feedback.setMessage("Guia PGDAS-D capturada com sucesso.");
      if (companiesState.selectedCompanyId === companyId) {
        await loadGuides(companyId);
      }
      return payload?.result || null;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao capturar guia PGDAS-D.");
      return false;
    } finally {
      setCapturingSerproPgdasd(false);
    }
  }

  async function handleSyncSerproPgdas(companyId, input = {}) {
    if (!companyId) {
      feedback.setError("Selecione uma empresa para sincronizar o PGDAS-D.");
      return false;
    }
    const competencia = String(input?.competencia || "").trim();
    if (!competencia) {
      feedback.setError("Informe a competência para sincronizar o PGDAS-D.");
      return false;
    }
    setSyncingSerproPgdas(true);
    feedback.clearFeedback();
    try {
      const payload = await api.syncPgdasCircular(companyId, competencia, {
        contratanteCnpj: input?.contratanteCnpj || undefined,
      });
      if (payload?.result?.circular?.serproSyncStatus === "NOT_FOUND") {
        feedback.setMessage("Nenhuma declaração PGDAS-D transmitida foi encontrada para essa competência.");
      } else {
        feedback.setMessage("Extrato PGDAS-D sincronizado com sucesso.");
      }
      if (typeof onPgdasSynced === "function") {
        try {
          await onPgdasSynced(companyId, payload?.result || null);
        } catch {
          // best-effort refresh
        }
      }
      return payload?.result || null;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao sincronizar o PGDAS-D.");
      return false;
    } finally {
      setSyncingSerproPgdas(false);
    }
  }

  async function handleSyncSerproInss(companyId, input = {}) {
    if (!companyId) {
      feedback.setError("Selecione uma empresa para sincronizar o INSS.");
      return false;
    }
    setSyncingSerproInss(true);
    feedback.clearFeedback();
    try {
      const payload = await api.syncSerproInss(companyId, input);
      feedback.setMessage("INSS sincronizado com sucesso.");
      if (typeof onInssSynced === "function") {
        try {
          await onInssSynced(companyId, payload?.result || null);
        } catch {
          // best-effort refresh
        }
      }
      return payload?.result || null;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao sincronizar INSS.");
      return false;
    } finally {
      setSyncingSerproInss(false);
    }
  }

  // Q36: executa UMA operação SERPRO (das|inss|extrato|parcelamento|procuracao) para uma empresa
  // (e competência quando aplicável). Retorna { ok, message } SEM mexer no feedback global — a página
  // de configuração orquestra o loop (empresas × meses) e mostra o resultado por linha ao vivo.
  async function runSerproOp(op, companyId, competencia) {
    try {
      if (!companyId) return { ok: false, message: "Empresa não informada." };
      switch (op) {
        case "procuracao":
          await api.checkSerproCompanyProcuration(companyId, {});
          return { ok: true };
        case "parcelamento":
          await api.captureSerproParcelamento(companyId);
          return { ok: true };
        case "das":
          await api.captureSerproPgdasd(companyId, { competencia });
          return { ok: true };
        case "inss":
          await api.syncSerproInss(companyId, { competencia });
          return { ok: true };
        case "extrato":
          await api.syncPgdasCircular(companyId, competencia, {});
          return { ok: true };
        case "presumido": {
          // Módulo Fiscal M2 — Lucro Presumido (DCTFWeb → provisão + split + reconciliação).
          const r = await api.captureSerproLp(companyId, { competencia });
          if (r?.ok === false) return { ok: false, message: r?.message || "DCTFWeb não transmitida" };
          const tot = r?.result?.totais?.principal;
          const alerta = r?.result?.reconciliacao?.alerta;
          const base = tot != null ? `Presumido: R$ ${Number(tot).toFixed(2)}` : "Presumido capturado";
          return { ok: true, message: base + (alerta ? " ⚠ divergência calc × DCTFWeb (conferir)" : " ✓ reconciliado") };
        }
        case "pagamento": {
          // Q40/Q43: confirma pagamento das guias OPEN (via PAGTOWEB). competencia é opcional.
          const r = await api.confirmarPagamentoSerpro(companyId, competencia ? { competencia } : {});
          const res = r?.result || {};
          const paid = res.paid ?? 0;
          const errors = res.errors ?? 0;
          // Q45: usa a mensagem detalhada do backend (pagas / não localizadas / sem nº / desabilitado).
          const message = res.mensagem
            || (paid ? `${paid} pago(s)` : (res.total ? "Nenhum pago" : "Sem guias a confirmar"));
          // Não reporta OK quando PAGTOWEB está desligado ou tudo falhou.
          const ok = !res.pagtowebDisabled && !(errors > 0 && paid === 0);
          return { ok, message };
        }
        case "sitfis": {
          // Q40: relatório de situação fiscal.
          const r = await api.getSitfis(companyId);
          return { ok: true, message: r?.processando ? "Processando (tente novamente)" : "Relatório consultado", data: r };
        }
        default:
          return { ok: false, message: `Operação desconhecida: ${op}` };
      }
    } catch (err) {
      return { ok: false, message: err?.message || "Falha na operação SERPRO." };
    }
  }

  async function loadPendingGuidesReport() {
    setLoadingPendingGuides(true);
    feedback.clearFeedback();
    try {
      const report = await api.getPendingGuidesReport({ page: 1, limit: 200 });
      setPendingGuides(Array.isArray(report?.data) ? report.data : []);
      setSelectedPendingGuideIds([]);
    } catch (err) {
      feedback.setError(err?.message || "Falha ao carregar relatório de pendências.");
      setPendingGuides([]);
    } finally {
      setLoadingPendingGuides(false);
    }
  }

  async function loadUnidentifiedGuides() {
    setLoadingUnidentifiedGuides(true);
    try {
      const payload = await api.getUnidentifiedGuides({ page: 1, limit: 200 });
      setUnidentifiedGuides(Array.isArray(payload?.data) ? payload.data : []);
    } catch (err) {
      feedback.setError(err?.message || "Falha ao carregar pendências de identificação.");
      setUnidentifiedGuides([]);
    } finally {
      setLoadingUnidentifiedGuides(false);
    }
  }

  function handleToggleJob() {
    feedback.setMessage(
      "A leitura de PDF é feita pelo serviço pdf-reader (PDF_READER_URL na API). Os PDFs das guias ficam gravados no banco de dados. Use Upload de guias."
    );
  }

  async function handleCreateCompany(event) {
    event.preventDefault();
    setSubmittingCompany(true);
    feedback.clearFeedback();
    try {
      await api.createCompany(createCompanyForm.form);
      createCompanyForm.reset();
      setPage("companies");
      await loadCompanies();
      feedback.setMessage("Empresa cadastrada com sucesso.");
    } catch (err) {
      feedback.setError(err?.message || "Falha ao cadastrar empresa");
    } finally {
      setSubmittingCompany(false);
    }
  }

  async function handleUpdateCompany(event) {
    event.preventDefault();
    if (!companiesState.selectedCompanyId) return;
    setSubmittingCompanyEdit(true);
    feedback.clearFeedback();
    try {
      await api.updateCompany(companiesState.selectedCompanyId, editCompanyForm.form);
      feedback.setMessage("Cadastro da empresa atualizado com sucesso.");
      await loadCompanies();
      setCompanyDetailTab("lancamentos");
    } catch (err) {
      feedback.setError(err?.message || "Falha ao atualizar cadastro da empresa.");
    } finally {
      setSubmittingCompanyEdit(false);
    }
  }

  async function handleResendGuide(guideId) {
    if (!guideId) {
      feedback.setError("guide_id_not_found");
      return;
    }
    guidesState.setResendingGuideId(guideId);
    feedback.clearFeedback();
    try {
      await api.resendGuideEmail(guideId);
      feedback.setMessage("Guia colocada na fila de reenvio.");
      await loadGuides();
    } catch (err) {
      feedback.setError(err?.message || "Falha ao reenviar guia");
    } finally {
      guidesState.setResendingGuideId("");
    }
  }

  async function handleConfirmGuidePayment(guideId) {
    if (!guideId) {
      feedback.setError("guide_id_not_found");
      return;
    }
    guidesState.setConfirmingGuideId(guideId);
    feedback.clearFeedback();
    try {
      const res = await api.confirmGuidePayment(guideId);
      // Q23: guia de parcela gera a baixa do pagamento; mensagem reflete o resultado.
      // A resposta diz se a Circular foi atualizada — não afirmamos "✅ na Circular" sem ter sido.
      // Comprovante do SERPRO: quando `aplicado`, a baixa saiu com a DATA e os VALORES reais.
      const comp = res?.comprovante;
      if (comp?.aplicado) {
        const partes = [`pago em ${comp.dataArrecadacao}`];
        if (comp.juros > 0 || comp.multa > 0) {
          partes.push(`principal R$ ${Number(comp.principal).toFixed(2)}`);
          if (comp.juros > 0) partes.push(`juros R$ ${Number(comp.juros).toFixed(2)}`);
          if (comp.multa > 0) partes.push(`multa R$ ${Number(comp.multa).toFixed(2)}`);
        }
        feedback.setMessage(`Baixa pelo comprovante do SERPRO — ${partes.join(" · ")}.`);
      } else if (res?.comprovanteAviso) {
        // Guia marcada como paga, mas o lançamento saiu com os dados presumidos: avisa pra conferir.
        feedback.setMessage(`Guia marcada como paga. ${res.comprovanteAviso}`);
      } else if (res?.circular?.atualizada === false) {
        feedback.setMessage(
          "Guia marcada como paga, mas nenhuma provisão correspondente foi encontrada na Circular — "
          + "a célula do mês pode continuar em aberto."
        );
      } else if (res?.parcelaBaixa?.pagamentoId) {
        feedback.setMessage("Guia paga — lançamento de baixa gerado.");
      } else {
        feedback.setMessage("Guia marcada como paga.");
      }
      await loadGuides();
      // A Circular lê AccountingEntry.statusPagamento, que acabou de mudar — sem este reload a
      // aba mostrava dado velho (antes só as guias eram recarregadas).
      await onGuidePaymentConfirmed?.();
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.includes("MES_FECHADO")) {
        feedback.setError("Mês contábil fechado — reabra o mês antes de marcar a parcela como paga.");
      } else {
        feedback.setError(err?.message || "Falha ao confirmar pagamento da guia");
      }
    } finally {
      guidesState.setConfirmingGuideId("");
    }
  }

  async function handleRecalculateGuide(guideId) {
    if (!guideId) {
      feedback.setError("guide_id_not_found");
      return;
    }
    guidesState.setRecalculatingGuideId(guideId);
    feedback.clearFeedback();
    try {
      const payload = await api.recalculateGuide(guideId);
      const skipped = Boolean(payload?.emailDispatch?.skipped);
      feedback.setMessage(
        skipped
          ? "Guia recalculada, mas o envio automático está ocupado no momento."
          : "Guia recalculada e enviada para a fila de e-mail."
      );
      await loadGuides();
    } catch (err) {
      feedback.setError(err?.message || "Falha ao recalcular guia");
    } finally {
      guidesState.setRecalculatingGuideId("");
    }
  }

  // Q53: recálculo/traga EXPLÍCITO da guia de INSS de uma competência (botão na aba Guias).
  // Reusa /serpro/inss/sync — o backend bloqueia se a guia da competência já estiver paga.
  async function handleRecalcularInss(competencia) {
    const companyId = companiesState.selectedCompanyId;
    if (!companyId) {
      feedback.setError("Selecione uma empresa para recalcular o INSS.");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
      feedback.setError("Selecione uma competência (AAAA-MM) para recalcular o INSS.");
      return;
    }
    setRecalcInssBusy(true);
    feedback.clearFeedback();
    try {
      await api.syncSerproInss(companyId, { competencia });
      feedback.setMessage(`INSS de ${competencia} recalculado/atualizado.`);
      await loadGuides(companyId);
    } catch (err) {
      feedback.setError(err?.message || "Falha ao recalcular o INSS.");
    } finally {
      setRecalcInssBusy(false);
    }
  }

  // Portal Cliente: libera SÓ a guia selecionada ao cliente e envia SÓ ela por e-mail
  // (página da empresa). O empacotamento DAS+INSS fica no envio em lote da página principal.
  async function handleLiberarGuia(guideId) {
    const companyId = companiesState.selectedCompanyId;
    if (!companyId) { feedback.setError("Selecione uma empresa."); return; }
    if (!guideId) { feedback.setError("Selecione uma guia."); return; }
    setLiberarGuiasBusy(true);
    feedback.clearFeedback();
    try {
      const r = await api.liberarGuiaCliente(guideId);
      feedback.setMessage(r?.sent
        ? "Guia liberada ao cliente e enviada por e-mail."
        : (r?.message || "Guia liberada ao cliente; e-mail em processamento."));
      await loadGuides(companyId);
    } catch (err) {
      feedback.setError(err?.message || "Falha ao liberar a guia ao cliente.");
    } finally {
      setLiberarGuiasBusy(false);
    }
  }

  async function handleGuideUpload(files) {
    if (!Array.isArray(files) || !files.length) {
      feedback.setError("Selecione pelo menos um PDF para enviar.");
      return false;
    }
    setUploadingGuides(true);
    feedback.clearFeedback();
    try {
      const payload = await api.uploadGuides(files);
      const result = payload?.result || {};
      setUploadResults(Array.isArray(result?.items) ? result.items : []);
      const processed = Number(result?.processed || 0);
      const errors = Number(result?.errors || 0);
      const skipped = Number(result?.skipped || 0);
      const sent = Number(result?.sent || 0);
      const failed = Number(result?.failedToSend || 0);
      const emailSuffix = result?.emailDispatch?.skipped
        ? " O envio automático não pôde iniciar porque outro envio já está em andamento."
        : "";
      feedback.setMessage(
        `Upload concluído: ${processed} processadas, ${errors} com erro, ${skipped} ignoradas. ` +
          `E-mails: ${sent} enviados, ${failed} falhas.${emailSuffix}`
      );
      await loadUnidentifiedGuides();
      return true;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao enviar e processar guias.");
      return false;
    } finally {
      setUploadingGuides(false);
    }
  }

  async function handleDeleteGuide(guideId) {
    const companyId = companiesState.selectedCompanyId;
    feedback.clearFeedback();
    try {
      await api.deleteGuide(guideId);
      await loadGuides(companyId);
      feedback.setMessage("Guia excluída com sucesso.");
    } catch (err) {
      feedback.setError(err?.message || "Falha ao excluir guia.");
    }
  }

  async function handleCompanyGuideUpload(file, metadata) {
    const companyId = companiesState.selectedCompanyId;
    if (!companyId) return null;
    setUploadingCompanyGuide(true);
    feedback.clearFeedback();
    try {
      const result = await api.uploadCompanyGuide(companyId, file, metadata);
      if (result?.needsMetadata) return result;
      await loadGuides(companyId);
      const emailMsg = result?.emailStatus === "SENT"
        ? "E-mail enviado ao cliente com sucesso."
        : "Guia salva. E-mail pendente de envio.";
      feedback.setMessage(`Guia salva com sucesso. ${emailMsg}`);
      return result;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao enviar guia.");
      return null;
    } finally {
      setUploadingCompanyGuide(false);
    }
  }

  // Identifica/completa metadados de uma guia já existente (status ERROR ou faltando tipo/competência).
  async function handleIdentifyGuide(guideId, metadata) {
    const companyId = companiesState.selectedCompanyId;
    if (!companyId || !guideId) return { ok: false };
    feedback.clearFeedback();
    try {
      const result = await api.identifyGuide(companyId, guideId, metadata);
      if (result?.ok !== false) {
        await loadGuides(companyId);
        feedback.setMessage("Guia identificada e processada com sucesso.");
      }
      return result;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao identificar guia.");
      return { ok: false, message: err?.message };
    }
  }

  // Baixa o PDF de uma guia como Blob para visualização em iframe (com auth Bearer).
  async function handleFetchGuidePdf(guideId) {
    const companyId = companiesState.selectedCompanyId;
    if (!companyId || !guideId) {
      throw new Error("Empresa ou guia não selecionada.");
    }
    return api.fetchGuidePdfBlob(companyId, guideId);
  }

  function togglePendingGuideSelection(guideId) {
    setSelectedPendingGuideIds((old) => (old.includes(guideId) ? old.filter((id) => id !== guideId) : [...old, guideId]));
  }

  function toggleAllPendingGuides() {
    setSelectedPendingGuideIds((old) => {
      if (old.length === pendingGuides.length) return [];
      return pendingGuides.map((guide) => guide.guideId).filter(Boolean);
    });
  }

  async function handleSendSelectedPending() {
    if (!selectedPendingGuideIds.length) {
      feedback.setError("Selecione pelo menos uma guia pendente.");
      return;
    }
    setSendingSelectedPending(true);
    feedback.clearFeedback();
    try {
      const payload = await api.sendSelectedPendingEmails(selectedPendingGuideIds);
      const result = payload?.result || {};
      const sent = Number(result?.sent || 0);
      const failed = Number(result?.failed || 0);
      const totalRequested = Number(result?.totalRequested || selectedPendingGuideIds.length);
      feedback.setMessage(`Reenvio concluído: ${sent} enviadas, ${failed} falhas (total ${totalRequested}).`);
      await loadPendingGuidesReport();
    } catch (err) {
      feedback.setError(err?.message || "Falha ao reenviar guias selecionadas.");
    } finally {
      setSendingSelectedPending(false);
    }
  }

  function resetWorkspace() {
    companiesState.setCompanies([]);
    companiesState.setSelectedCompanyId("");
    guidesState.setGuides([]);
    guidesState.setResendingGuideId("");
    guidesState.setConfirmingGuideId("");
    guidesState.setRecalculatingGuideId("");
    createCompanyForm.reset();
    editCompanyForm.reset();
    setCompanyDetailTab("lancamentos");
    setGuideSettings(null);
    setJobEnabled(false);
    setSerproProcurationStatus(null);
    setSerproWorkerStatus(null);
    setPendingGuides([]);
    setSelectedPendingGuideIds([]);
    setUploadResults([]);
    setUnidentifiedGuides([]);
  }

  useEffect(() => {
    if (page === "companyDetail" && companiesState.selectedCompanyId) {
      loadGuides(companiesState.selectedCompanyId);
      // Q17/Q49: aba default (Lançamentos) SÓ quando a URL ainda não tem segmento de aba
      // (ex.: /companies/:id). Antes forçava sempre → refresh em /companies/:id/circular era
      // jogado pra /lancamentos e o navigate (push) empilhava histórico, quebrando o Voltar.
      // replace: o redirect default não vira entrada de histórico.
      const temAba = /^\/companies\/[^/]+\/[^/]+/.test(location.pathname);
      if (!temAba) {
        navigate(`/companies/${companiesState.selectedCompanyId}/lancamentos`, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, companiesState.selectedCompanyId]);

  // Remapeia o form APENAS ao trocar de empresa (por companyId) — NÃO a cada refresh da lista.
  // Antes dependia de [selectedCompany]: qualquer reload em background trocava a referência do
  // objeto e resetava o form, apagando edições não salvas (ex.: "empresa zerada = Sim" voltava
  // pra "Não" sozinho antes de salvar). Agora edições ficam preservadas até salvar/trocar de empresa.
  useEffect(() => {
    if (selectedCompany) {
      editCompanyForm.replace(mapCompanyToEditForm(selectedCompany));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany?.companyId]);

  useEffect(() => {
    if (page === "companies" || page === "guideSettings") {
      loadCompanies();
      loadGuideSettings();
      loadSerproWorkerStatus();
    } else if (page === "pendingReport") {
      loadPendingGuidesReport();
    } else if (page === "guideUpload") {
      loadUnidentifiedGuides();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Q49: auto-carga da lista de empresas. Refresh direto em /companies/:id/*, /funcoes-serpro,
  // /download-notas ou /apuracao deixava companies=[] (a lista só carregava na home) → header
  // caía no fallback "Empresa" (empresa fantasma) e as tabelas de seleção ficavam vazias.
  // Carrega uma vez quando qualquer página autenticada monta sem a lista.
  useEffect(() => {
    if (page !== "login" && companiesState.companies.length === 0 && !companiesState.loadingCompanies) {
      loadCompanies();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Carrega status do plano de contas global ao entrar em telas relevantes (home, criar empresa).
  // Usado pelo banner de aviso + bloqueio do botão "Nova empresa".
  async function loadGlobalChartStatus() {
    if (page === "login") return;
    if (typeof api?.getGlobalChartStatus !== "function") return;
    try {
      const result = await api.getGlobalChartStatus();
      setGlobalChartStatus(result || null);
    } catch {
      setGlobalChartStatus(null);
    }
  }

  useEffect(() => {
    if (page === "companies" || page === "createCompany") {
      loadGlobalChartStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // Q11.1: suspender / reativar / excluir empresa
  const [companyDangerSaving, setCompanyDangerSaving] = useState(false);

  async function handleSuspendCompany(companyId, reason) {
    if (!companyId) return { ok: false };
    setCompanyDangerSaving(true);
    feedback.clearFeedback();
    try {
      const res = await api.suspendCompany(companyId, reason);
      await loadCompanies();
      feedback.setMessage("Empresa suspensa. Workers SERPRO não vão processá-la.");
      return res;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao suspender.");
      throw err;
    } finally {
      setCompanyDangerSaving(false);
    }
  }

  async function handleResumeCompany(companyId) {
    if (!companyId) return { ok: false };
    setCompanyDangerSaving(true);
    feedback.clearFeedback();
    try {
      const res = await api.resumeCompany(companyId);
      await loadCompanies();
      feedback.setMessage("Empresa reativada.");
      return res;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao reativar.");
      throw err;
    } finally {
      setCompanyDangerSaving(false);
    }
  }

  async function handleDeleteCompany(companyId, { confirmCnpj }) {
    if (!companyId) return { ok: false };
    setCompanyDangerSaving(true);
    feedback.clearFeedback();
    try {
      const res = await api.deleteCompany(companyId, { confirmCnpj });
      // Após apagar, sai da empresa e recarrega lista
      companiesState.setSelectedCompanyId(null);
      await loadCompanies();
      setPage("companies");
      feedback.setMessage("Empresa excluída com sucesso.");
      return res;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao excluir.");
      throw err;
    } finally {
      setCompanyDangerSaving(false);
    }
  }

  return {
    companiesState,
    guidesState,
    createCompanyForm,
    editCompanyForm,
    companyDetailTab,
    setCompanyDetailTab,
    submittingCompany,
    submittingCompanyEdit,
    jobEnabled,
    guideSettings,
    savingSerproSettings,
    uploadingSerproCertificate,
    deletingSerproCertificate,
    checkingSerproProcuration,
    capturingSerproPgdasd,
    syncingSerproPgdas,
    syncingSerproInss,
    serproProcurationStatus,
    serproWorkerStatus,
    runningSerproCron,
    serproCronRunResult,
    handleRunSerproCron,
    batchEmailReport,
    loadingBatchEmailReport,
    sendingBatchEmails,
    batchEmailSendResult,
    handleLoadBatchEmailReport,
    handleSendBatchEmails,
    handleSaveSerproSettings,
    handleUploadSerproCertificate,
    handleDeleteSerproCertificate,
    loadSerproCompanyProcuration,
    handleCheckSerproProcuration,
    handleCaptureSerproPgdasd,
    handleSyncSerproPgdas,
    handleSyncSerproInss,
    runSerproOp,
    loadSerproWorkerStatus,
    pendingGuides,
    selectedPendingGuideIds,
    loadingPendingGuides,
    sendingSelectedPending,
    uploadResults,
    uploadingGuides,
    unidentifiedGuides,
    loadingUnidentifiedGuides,
    selectedCompany,
    loadCompanies,
    dashboardCompetencia,
    changeDashboardCompetencia,
    loadGuides,
    loadPendingGuidesReport,
    loadUnidentifiedGuides,
    handleToggleJob,
    handleCreateCompany,
    handleUpdateCompany,
    handleResendGuide,
    handleConfirmGuidePayment,
    handleRecalculateGuide,
    handleRecalcularInss,
    recalcInssBusy,
    handleLiberarGuia,
    liberarGuiasBusy,
    handleDeleteGuide,
    handleGuideUpload,
    handleCompanyGuideUpload,
    handleIdentifyGuide,
    handleFetchGuidePdf,
    uploadingCompanyGuide,
    togglePendingGuideSelection,
    toggleAllPendingGuides,
    handleSendSelectedPending,
    resetWorkspace,
    globalChartStatus,
    loadGlobalChartStatus,
    // Q11.1: ações destrutivas na empresa
    companyDangerSaving,
    handleSuspendCompany,
    handleResumeCompany,
    handleDeleteCompany,
  };
}
