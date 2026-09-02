import { useEffect, useState } from "react";
import { detalhesDaConfirmacaoDoResponsavel } from "../../lib/portal/responsavelCompartilhado";
import { useLocation, useNavigate } from "react-router-dom";
import { useCompanies } from "../../features/companies/list/hooks/useManageCompanies";
import { useCompanyGuides } from "../../features/guides/list/hooks/useManageCompanyGuides";
// ⚠ OS DOIS MAPAS SAÍRAM DAQUI (19/08/2026) e viraram `features/companies/detail/lib/rotasDaEmpresa.js`.
// Motivo: eles ganharam um SEGUNDO consumidor. A aba do header virou `<a href>` de verdade (para o
// Ctrl+clique abrir em nova guia), e o `href` tem de sair da MESMA fonte que a navegação usa —
// duas construções da mesma URL divergem na primeira correção, e aí o link leva a um lugar e o
// clique a outro. Os nomes e o conteúdo não mudaram; só o endereço.
import { SEGMENT_TO_TAB, TAB_TO_SEGMENT, companyTabPath } from "../../features/companies/detail/lib/rotasDaEmpresa";
import {
  getInitialCompanyFormState,
  mapCompanyToEditForm,
  useCompanyForm,
} from "../../features/companies/form/hooks/useManageCompanyForm";

// Q8.C.3: tabs do CompanyDetail viraram sub-rotas — `companyDetailTab` agora é derivado da URL.
// Mantém a API legada `setCompanyDetailTab(name)` por compat — só faz navigate().
const COMPANY_TAB_SEGMENTS = ["guides", "lancamentos", "circular", "parcelamento", "notas-fiscais", "auditoria", "sitfis", "cadastro-fiscal", "plano-contas", "cadastro", "documentos", "anotacoes", "edit"];
// Q17: competência default do dashboard = mês civil anterior.
function dashboardPrevMonth() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * A EMPRESA da URL. `/companies/<id>/<aba>` → `<id>`; qualquer outra rota → "".
 *
 * ⚠ Isto conserta uma classe inteira de bug, não um caso: a ABA sempre veio da URL, mas a EMPRESA
 * era estado solto (`useCompanies`). Duas fontes de verdade para a mesma tela, e a URL mudava sem
 * o estado acompanhar — clicava-se numa empresa e aparecia outra, a anterior (ou a primeira da
 * carteira, por causa do auto-seleciona do `loadCompanies`). Acontecia em navegação por link,
 * botão voltar do browser e refresh.
 */
function deriveCompanyIdFromPath(pathname) {
  const m = String(pathname || "").match(/^\/companies\/([^/]+)/);
  const seg = m?.[1] || "";
  return seg && seg !== "new" ? seg : "";
}

function deriveCompanyDetailTab(pathname) {
  // Q17: Lançamentos é a aba default ao abrir uma empresa.
  const match = pathname.match(/^\/companies\/[^\/]+\/([^\/]+)/);
  // Default = Anotações: se a empresa tem alguma particularidade, ela precisa ser lida ANTES de
  // mexer em qualquer número. Antes o default era Lançamentos, e a anotação só era vista por quem
  // fosse procurá-la.
  if (!match) return "anotacoes";
  return SEGMENT_TO_TAB[match[1]] || "anotacoes";
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

  // A URL MANDA na empresa, como já mandava na aba. Sem isto, as duas discordavam: a URL apontava
  // para uma empresa e a tela renderizava outra — a que estava no estado. Um `setSelectedCompanyId`
  // esquecido em qualquer ponto de navegação (link, voltar do browser, refresh) reproduzia o bug.
  const companyIdDaUrl = deriveCompanyIdFromPath(location.pathname);
  useEffect(() => {
    if (companyIdDaUrl && companyIdDaUrl !== companiesState.selectedCompanyId) {
      companiesState.setSelectedCompanyId(companyIdDaUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyIdDaUrl]);
  /**
   * Abre uma aba de uma empresa ESPECÍFICA. Use esta quando estiver trocando de empresa.
   *
   * ⚠ O `setCompanyDetailTab` abaixo resolve a empresa sozinho, e é aí que mora a armadilha: quem
   * fazia `setSelectedCompanyId(novaEmpresa)` e logo em seguida `setCompanyDetailTab("x")` navegava
   * para a empresa ANTERIOR — o `set` do React não é visível no mesmo closure, então a segunda
   * chamada ainda lia o valor velho. Era exatamente o "clico na ERISANGELA e abre a CHAYM".
   */
  function openCompanyTab(companyId, tab) {
    const segment = TAB_TO_SEGMENT[tab];
    if (!segment) {
      console.warn(`[openCompanyTab] tab desconhecida: ${tab}`);
      return;
    }
    if (!companyId) {
      console.warn("[openCompanyTab] sem companyId — não é possível navegar");
      return;
    }
    // ⚠ A URL SAI DE `companyTabPath`, o MESMO construtor que alimenta o `href` das abas do
    // header. Enquanto era uma template string aqui, havia duas construções da mesma URL: a
    // primeira correção numa delas faria o Ctrl+clique abrir uma tela e o clique normal outra.
    navigate(companyTabPath(companyId, tab));
  }

  function setCompanyDetailTab(tab) {
    // Resolve pela URL primeiro: ela é a fonte de verdade e nunca está atrasada em relação a um
    // `setState` que ainda não renderizou. O estado fica só como retaguarda para quem chama isto
    // de fora de uma página de empresa.
    openCompanyTab(companyIdDaUrl || companiesState.selectedCompanyId, tab);
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
  const [capturingSerproLp, setCapturingSerproLp] = useState(false);
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
      // ⚠ NUNCA auto-selecionar quando a URL já diz qual empresa é. Este atalho ("nenhuma
      // selecionada → pega a primeira da lista") era a causa direta do caso mais visível: abrir
      // `/companies/<X>/apuracao` por link ou refresh começa com o estado vazio, a lista carrega, e
      // o app escolhia a PRIMEIRA empresa da carteira — que não tem nada a ver com a URL. Fora de
      // uma página de empresa o atalho segue valendo, que é para o que ele existe.
      if (!companyIdDaUrl && !companiesState.selectedCompanyId && data.length > 0) {
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
      // ⚠ DEPOIS do reload: `loadGuides` abre com `feedback.clearFeedback()` e engolia esta
      // mensagem — o clique terminava mudo.
      if (companiesState.selectedCompanyId === companyId) {
        await loadGuides(companyId);
      }
      feedback.setMessage("Guia PGDAS-D capturada com sucesso.");
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

  /**
   * Busca os tributos do Lucro Presumido da competência (PIS, COFINS, IRPJ e CSLL numa consulta).
   *
   * Espelha `handleSyncSerproPgdas` de propósito: mesmo feedback, mesmo refresh. Antes disto o
   * único caminho era `runSerproOp("presumido")`, da página Consultas — que devolve `{ok,message}`
   * e não toca no feedback nem recarrega a tela da empresa.
   *
   * "DCTFWeb ainda não transmitida" é estado NORMAL, não erro: a rota devolve 200 com `ok:false`,
   * e tratar isso como falha faria o contador procurar problema onde não há.
   */
  async function handleCaptureSerproLp(companyId, input = {}) {
    if (!companyId) {
      feedback.setError("Selecione uma empresa para buscar os tributos do Presumido.");
      return false;
    }
    const competencia = String(input?.competencia || "").trim();
    if (!competencia) {
      feedback.setError("Informe a competência para buscar os tributos do Presumido.");
      return false;
    }
    setCapturingSerproLp(true);
    feedback.clearFeedback();
    try {
      const payload = await api.captureSerproLp(companyId, { competencia });
      if (payload?.ok === false) {
        feedback.setMessage(payload?.message || "Nada a buscar nesta competência.");
        return null;
      }
      const qtd = payload?.result?.debitos?.length || 0;
      feedback.setMessage(
        qtd
          ? `Tributos do Presumido buscados: ${qtd} provisão(ões) na competência.`
          : "Consulta feita, mas não havia débito nesta competência.",
      );
      if (typeof onPgdasSynced === "function") {
        try { await onPgdasSynced(companyId, payload?.result || null); } catch { /* best-effort */ }
      }
      return payload?.result || null;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao buscar os tributos do Presumido.");
      return false;
    } finally {
      setCapturingSerproLp(false);
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

  // ⚠⚠ TROCAR O E-MAIL DO RESPONSÁVEL PODE CRIAR UM ACESSO NOVO, e o contador tem de ver isso
  // ANTES. Quando a conta atual atende VÁRIAS empresas, o servidor recusa com 409
  // `owner_email_conta_compartilhada` e devolve os dados do ato; guardamos esses dados aqui, a
  // tela os repete, e só então o MESMO formulário é reenviado com `confirmarNovoAcesso: true`.
  // Defeito que isto fecha: um login enxergando nove empresas (produção, 19/08/2026).
  const [confirmacaoAcessoProprio, setConfirmacaoAcessoProprio] = useState(null);
  const [acessoProprioCriado, setAcessoProprioCriado] = useState(null);
  const [vinculoCriado, setVinculoCriado] = useState(null);

  async function salvarEdicaoDaEmpresa({ confirmarNovoAcesso } = {}) {
    if (!companiesState.selectedCompanyId) return;
    setSubmittingCompanyEdit(true);
    feedback.clearFeedback();
    try {
      const resposta = await api.updateCompany(
        companiesState.selectedCompanyId,
        editCompanyForm.form,
        { confirmarNovoAcesso: confirmarNovoAcesso === true }
      );
      setConfirmacaoAcessoProprio(null);
      // ⚠ A conta nova nasce SEM SENHA. Sem este aviso o contador troca o e-mail, avisa o cliente,
      // e o cliente não consegue entrar — sem ninguém saber por quê.
      // ⚠ Os DOIS desfechos, e eles dizem coisas diferentes: `acessoNovo` = conta CRIADA (nasce
      //   sem senha, e o aviso é o que impede o cliente de ficar de fora); `acessoVinculado` =
      //   esta empresa passou a pertencer a uma conta que JÁ EXISTIA (nada a definir).
      setAcessoProprioCriado(resposta?.acessoNovo || null);
      setVinculoCriado(resposta?.acessoVinculado || null);
      // ⚠⚠ O FORMULARIO ACEITA O QUE O SERVIDOR GRAVOU. Ele e um `useState` re-semeado SO quando
      //   muda `companyId` (linha ~1030), entao depois de salvar ele continuava com o que foi
      //   DIGITADO — e a ficha, lida do servidor, com o valor velho. As duas telas discordavam
      //   sempre que a gravacao nao acontecia, e o formulario "ja alterado" PARECIA prova de que
      //   tinha salvo. Era metade do relato do dono.
      // ⚠ DO RETORNO DO PATCH, nunca de um `useEffect`: o comentario de `:1023-1027` explica por
      //   que a dependencia e `companyId` — um efeito ligado a lista apagaria edicao nao salva a
      //   cada refresh de fundo.
      // ⚠⚠ E SO NO SUCESSO. No erro o valor digitado TEM de permanecer, senao o contador perde o
      //   que escreveu justamente quando precisa corrigi-lo (ver o `catch`).
      if (resposta?.company) editCompanyForm.replace(mapCompanyToEditForm(resposta.company));
      await loadCompanies();
      // ⚠ A MENSAGEM VEM DEPOIS DA CARGA: `loadCompanies` abre com `feedback.clearFeedback()`
      //   (linha ~152), entao setada antes ela era APAGADA antes de aparecer — o "salvou" que
      //   ninguem via. Mesma ordem que `handleCreateCompany` ja usa.
      feedback.setMessage("Cadastro da empresa atualizado com sucesso.");
      // ⚠ Com acesso novo criado a tela NÃO troca de aba: o aviso de "defina a senha" some junto,
      // e ele é a única coisa que impede o cliente de ficar de fora sem explicação.
      // ⚠ Com QUALQUER dos dois avisos a tela NÃO troca de aba — o aviso some junto com ela.
      if (!resposta?.acessoNovo && !resposta?.acessoVinculado) setCompanyDetailTab("lancamentos");
    } catch (err) {
      const detalhes = detalhesDaConfirmacaoDoResponsavel(err);
      if (detalhes) {
        // Não é erro do contador: é um ato de consequência esperando confirmação.
        setConfirmacaoAcessoProprio(detalhes);
        return;
      }
      setConfirmacaoAcessoProprio(null);
      feedback.setError(err?.message || "Falha ao atualizar cadastro da empresa.");
    } finally {
      setSubmittingCompanyEdit(false);
    }
  }

  async function handleUpdateCompany(event) {
    event.preventDefault();
    setAcessoProprioCriado(null);
    setVinculoCriado(null);
    // ⚠ O salvar normal NUNCA confirma. A confirmação vale para UM clique, o do painel — se ela
    // viajasse daqui, reabrir a tela e salvar de novo criaria acesso novo sem ninguém ter lido nada.
    await salvarEdicaoDaEmpresa({ confirmarNovoAcesso: false });
  }

  async function confirmarAcessoProprio() {
    if (!confirmacaoAcessoProprio) return;
    await salvarEdicaoDaEmpresa({ confirmarNovoAcesso: true });
  }

  function cancelarAcessoProprio() {
    setConfirmacaoAcessoProprio(null);
  }

  async function handleResendGuide(guideId) {
    if (!guideId) {
      feedback.setError("guide_id_not_found");
      return;
    }
    guidesState.setResendingGuideId(guideId);
    feedback.clearFeedback();
    try {
      const r = await api.resendGuideEmail(guideId);
      // ⚠ A ORDEM IMPORTA: `loadGuides` começa com `feedback.clearFeedback()`. Setar a mensagem
      // antes dele APAGA a mensagem — o clique não devolvia retorno nenhum à tela, nem de sucesso
      // nem de falha. "O sistema diz que fez" tem uma variante pior: o sistema não diz nada.
      await loadGuides();
      // ⚠ Dizia "Guia colocada na fila de reenvio". Não existe fila: o laço automático saiu na Q55
      // e nada drena `emailNextRetryAt`. O reenvio é SÍNCRONO — ou saiu agora, ou não saiu.
      if (r?.sent === false) {
        feedback.setError(r?.message || "O e-mail NÃO foi enviado. Nada tenta de novo sozinho — clique novamente.");
      } else {
        feedback.setMessage("Guia reenviada.");
      }
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
      // ⚠ O RELOAD VEM PRIMEIRO. `loadGuides` abre com `feedback.clearFeedback()`, e enquanto ele
      // rodava DEPOIS todas as mensagens abaixo eram apagadas antes de aparecer — inclusive as que
      // pedem uma ação do contador ("Lance a baixa na Circular", "nenhuma provisão correspondente
      // foi encontrada"). O clique terminava mudo.
      await loadGuides();
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
        // A baixa NÃO é feita aqui — o lançamento acontece na Circular, num único lugar.
        feedback.setMessage(
          `Pagamento confirmado pelo SERPRO — ${partes.join(" · ")}. Lance a baixa na Circular (já vem preenchida).`,
        );
      } else if (res?.comprovanteAviso) {
        // Guia marcada como paga, mas o lançamento saiu com os dados presumidos: avisa pra conferir.
        feedback.setMessage(`Guia marcada como paga. ${res.comprovanteAviso}`);
      } else if (res?.circular?.atualizada === false) {
        feedback.setMessage(
          "Guia marcada como paga, mas nenhuma provisão correspondente foi encontrada na Circular — "
          + "a célula do mês pode continuar em aberto."
        );
      } else if (res?.parcelaBaixa?.pagamentoId) {
        feedback.setMessage("Parcela paga — lançamento de baixa gerado.");
      } else {
        feedback.setMessage("Guia marcada como paga. Lance a baixa na Circular.");
      }
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
      const enviadas = Number(payload?.emailDispatch?.sent || 0);

      // ⚠⚠ A GUIA VENCIDA PODE TER VOLTADO SEM JUROS E MULTA, e isso vem ANTES do estado do e-mail.
      //
      // Não está confirmado que o `GERARGUIA31` (a DARF do Presumido) gere a versão com acréscimos
      // — o PGDAS-D tem serviço próprio para isso; a DCTFWeb, até onde o projeto sabe, tem um só.
      // O backend devolve o que se VIU na composição do documento, com três respostas, e as duas
      // que não são "vieram" precisam chegar ao contador: mandar ao cliente uma guia a menor faz
      // ele pagar errado e continuar devendo a diferença, sem ninguém perceber.
      //
      // ⚠ "Não deu para ler a composição" também entra — ausência de leitura não é prova de
      // ausência de juros, e o silêncio aqui seria lido como confirmação.
      const acrescimos = payload?.acrescimos;
      const alertaAcrescimo = payload?.vencida && acrescimos && acrescimos.estado !== "presentes"
        ? `${acrescimos.texto} `
        : "";
      // ⚠ `loadGuides` limpa o feedback — a mensagem tem que vir DEPOIS dele, senão some.
      await loadGuides();
      // ⚠ Dizia "enviada para a fila de e-mail" / "o envio automático está ocupado". Não há fila e
      // não há envio automático (Q55). O recálculo dispara o envio SÍNCRONO da guia nova; o que a
      // tela pode afirmar é se ele saiu, e o que fazer quando não saiu.
      if (skipped) {
        feedback.setError(
          alertaAcrescimo
          + "Guia recalculada, mas o e-mail NÃO foi enviado: há outro envio em andamento (ou um envio "
          + "anterior que travou). Nada tenta de novo sozinho — use 'Liberar ao cliente' em até 5 minutos.",
        );
      } else if (enviadas > 0) {
        // ⚠ Com ressalva de acréscimo, o desfecho NÃO é verde: a guia saiu, e é justamente por isso
        // que o contador precisa conferi-la antes que o cliente pague.
        if (alertaAcrescimo) feedback.setError(`${alertaAcrescimo}A guia recalculada já foi enviada ao cliente.`);
        else feedback.setMessage("Guia recalculada e enviada ao cliente.");
      } else {
        feedback.setError(
          alertaAcrescimo
          + "Guia recalculada, mas o e-mail NÃO foi enviado. Nada tenta de novo sozinho — "
          + "use 'Liberar ao cliente' para tentar agora.",
        );
      }
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
      // ⚠ DEPOIS do reload — `loadGuides` limpa o feedback (mesmo defeito dos vizinhos).
      await loadGuides(companyId);
      feedback.setMessage(`INSS de ${competencia} recalculado/atualizado.`);
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
      // ⚠ `sent: false` NÃO É SUCESSO. A liberação ao app do cliente deu certo, o e-mail não — e a
      // mensagem do backend ("o e-mail NÃO foi enviado…") aparecia em VERDE, na caixa de sucesso,
      // logo abaixo de um botão que o contador acabou de clicar. Verde é a cor de "pode ir embora";
      // era a última coisa que ele via antes de ir. O chip do dashboard já fazia isso certo
      // (`renderCompaniesHomePage.acoesGuia.onEnviar`); esta metade tinha ficado para trás.
      // ⚠ A ORDEM IMPORTA: `loadGuides` abre com `feedback.clearFeedback()`. Enquanto a mensagem
      // era setada ANTES dele, o clique em "Liberar ao cliente" não devolvia NADA à tela — nem o
      // sucesso, nem a falha, nem a (falsa) promessa de fila. O contador via só o selo 📤 aparecer.
      await loadGuides(companyId);
      if (r?.sent) {
        feedback.setMessage("Guia liberada ao cliente e enviada por e-mail.");
      } else {
        feedback.setError(r?.message || "Guia liberada, mas o e-mail não saiu. Tente enviar de novo.");
      }
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
      // ⚠ Falava em "envio automático". O upload NÃO envia nada desde a Q55: a rota devolve
      // `emailDispatch: { attempted:false, reason:"batch_email_only" }` — as guias nascem PENDING e
      // esperam um clique. "Não pôde iniciar" sugeria que ele iniciaria mais tarde; não inicia.
      const emailSuffix = sent > 0 || failed > 0
        ? ` E-mails: ${sent} enviados, ${failed} falhas.`
        : " Nenhum e-mail foi enviado: o envio é manual (use 'Envio de e-mails em lote').";
      await loadUnidentifiedGuides();
      feedback.setMessage(
        `Upload concluído: ${processed} processadas, ${errors} com erro, ${skipped} ignoradas.${emailSuffix}`
      );
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
    // NÃO navega. Isto roda no logout e na sessão expirada, logo depois de `clearSession()` mandar
    // para /login — um navigate aqui desfaria o redirect e jogaria o usuário DESLOGADO de volta
    // numa página de empresa. E não há aba a resetar: ela é derivada da URL.
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

  // O PORTÃO DA EMISSÃO PELO CLIENTE (18/08/2026) — liga/desliga por empresa.
  //
  // ⚠ NÃO passa pelo "Salvar alterações" do cadastro, de propósito: no backend é rota própria, com
  // gate ACCOUNTANT+ e auditoria de quem/quando. Um campo a mais no formulário faria o ato fiscal
  // viajar junto de trocas de telefone e endereço, e a confirmação perderia o sentido.
  const [emissaoClienteSaving, setEmissaoClienteSaving] = useState(false);

  async function handleSetEmissaoCliente(companyId, liberada) {
    if (!companyId) return { ok: false };
    setEmissaoClienteSaving(true);
    feedback.clearFeedback();
    try {
      const res = await api.setEmissaoClienteNfse(companyId, liberada);
      // Recarrega a carteira: o estado vem do payload da empresa, e sem isto a tela ficaria
      // mostrando o valor anterior até a próxima navegação.
      await loadCompanies();
      feedback.setMessage(
        liberada
          ? "Emissão de NFS-e liberada para os usuários CLIENT_ADMIN e OWNER desta empresa."
          : "Emissão de NFS-e pelo cliente revogada. Só o escritório emite por esta empresa."
      );
      return res;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao alterar a liberação de emissão.");
      throw err;
    } finally {
      setEmissaoClienteSaving(false);
    }
  }

  // ── O SALVAR PRÓPRIO DA ABA DE EMISSÃO DE NFS-e (dono, 19/08/2026) ──────────────────────────
  //
  // ⚠ NÃO É O `handleUpdateCompany`, e a diferença é a razão de a rota existir. Aquele manda a
  // empresa INTEIRA (`buildCompanyPayload`), e a rota do cadastro exige CNPJ, razão social, CNAE e
  // endereço — de uma aba que só tem os campos de emissão, ela responderia 400, e os campos que
  // ela aceita e não recebesse seriam zerados. Esta chama `PATCH .../emissao-nfse`, que aceita só
  // os sete campos e trata ausente como "não mexer".
  const [emissaoNfseSaving, setEmissaoNfseSaving] = useState(false);

  async function handleUpdateEmissaoNfse(companyId, campos) {
    if (!companyId) return { ok: false };
    setEmissaoNfseSaving(true);
    feedback.clearFeedback();
    try {
      const res = await api.updateEmissaoNfse(companyId, campos);
      // ⚠ O FORMULÁRIO DO CADASTRO É ATUALIZADO JUNTO, e sem isto haveria um jeito de desfazer o
      // que acabou de ser salvo: o `editCompanyForm` é remapeado só quando MUDA DE EMPRESA, então
      // ele continuaria segurando a série antiga — e o "Salvar alterações" da aba Cadastro, que
      // manda a empresa inteira, gravaria o valor velho por cima. Os dois passam a concordar aqui.
      const salvo = res?.emissaoNfse || {};
      const texto = (v) => (v != null ? String(v) : "");
      editCompanyForm.setForm((old) => ({
        ...old,
        codigoServicoNacional: texto(salvo.codigoServicoNacional),
        codigosServicoNacional: Array.isArray(salvo.codigosServicoNacional)
          ? salvo.codigosServicoNacional
          : old.codigosServicoNacional,
        codigoServicoMunicipal: texto(salvo.codigoServicoMunicipal),
        rpsSerie: texto(salvo.rpsSerie),
        pTotTribFed: texto(salvo.pTotTribFed),
        pTotTribEst: texto(salvo.pTotTribEst),
        pTotTribMun: texto(salvo.pTotTribMun),
        // ⚠ O BENEFÍCIO MUNICIPAL PRECISA ESTAR AQUI PELO MESMO MOTIVO, e aqui o preço é maior:
        // sem estas três linhas, salvar o benefício pela aba e depois clicar em "Salvar
        // alterações" no cadastro mandaria os campos VELHOS (vazios) e APAGARIA o benefício — em
        // silêncio, porque nada na tela mudaria de aparência.
        beneficioMunicipalNumero: texto(salvo.beneficioMunicipalNumero),
        beneficioMunicipalTipoReducao: texto(salvo.beneficioMunicipalTipoReducao),
        beneficioMunicipalPRedBC: texto(salvo.beneficioMunicipalPRedBC),
      }));
      // A aba lê o que está gravado a partir do payload da empresa — sem recarregar, ela mostraria
      // o valor anterior até a próxima navegação.
      await loadCompanies();
      feedback.setMessage("Configuração de emissão de NFS-e salva.");
      return res;
    } catch (err) {
      feedback.setError(err?.message || "Falha ao salvar a configuração de emissão de NFS-e.");
      throw err;
    } finally {
      setEmissaoNfseSaving(false);
    }
  }

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
    // Trocando de empresa? Use esta, com o id explícito — `setCompanyDetailTab` resolve a empresa
    // sozinho e leva para a anterior quando o `setSelectedCompanyId` ainda não renderizou.
    openCompanyTab,
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
    capturingSerproLp,
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
    handleCaptureSerproLp,
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
    // ⚠ Os três viajam JUNTOS e a tela precisa dos três: sem `confirmacaoAcessoProprio` o salvar
    // fica mudo depois do 409 (parece que "não fez nada"), e sem `acessoProprioCriado` a conta
    // nova nasce sem senha e ninguém avisa.
    confirmacaoAcessoProprio,
    confirmarAcessoProprio,
    cancelarAcessoProprio,
    acessoProprioCriado,
    // ⚠ Sai ao lado do irmão porque são desfechos EXCLUSIVOS e com consequências opostas:
    //   um cria conta sem senha (é preciso definir uma); o outro só muda de dono (nada a fazer).
    vinculoCriado,
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
    // Portão da emissão de NFS-e pelo cliente
    emissaoClienteSaving,
    handleUpdateEmissaoNfse,
    emissaoNfseSaving,
    handleSetEmissaoCliente,
    // Q11.1: ações destrutivas na empresa
    companyDangerSaving,
    handleSuspendCompany,
    handleResumeCompany,
    handleDeleteCompany,
  };
}
