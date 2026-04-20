import { useEffect, useState } from "react";
import { useCompanies } from "../../features/companies/list/hooks/useManageCompanies";
import { useCompanyGuides } from "../../features/guides/list/hooks/useManageCompanyGuides";
import {
  getInitialCompanyFormState,
  mapCompanyToEditForm,
  useCompanyForm,
} from "../../features/companies/form/hooks/useManageCompanyForm";

export function useManageCompaniesWorkspace({ api, page, setPage, feedback }) {
  const companiesState = useCompanies();
  const guidesState = useCompanyGuides();
  const createCompanyForm = useCompanyForm(getInitialCompanyFormState());
  const editCompanyForm = useCompanyForm(getInitialCompanyFormState());
  const [companyDetailTab, setCompanyDetailTab] = useState("guides");
  const [submittingCompany, setSubmittingCompany] = useState(false);
  const [submittingCompanyEdit, setSubmittingCompanyEdit] = useState(false);
  const [jobEnabled, setJobEnabled] = useState(false);
  const [guideSettings, setGuideSettings] = useState(null);
  const [pendingGuides, setPendingGuides] = useState([]);
  const [selectedPendingGuideIds, setSelectedPendingGuideIds] = useState([]);
  const [loadingPendingGuides, setLoadingPendingGuides] = useState(false);
  const [sendingSelectedPending, setSendingSelectedPending] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);
  const [uploadingGuides, setUploadingGuides] = useState(false);
  const [unidentifiedGuides, setUnidentifiedGuides] = useState([]);
  const [loadingUnidentifiedGuides, setLoadingUnidentifiedGuides] = useState(false);

  const selectedCompany = companiesState.selectedCompany;

  async function loadCompanies() {
    if (page === "login") return;
    companiesState.setLoadingCompanies(true);
    feedback.clearFeedback();
    try {
      const data = await api.listCompanies();
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
      const settings = await api.getGuideSettings();
      setGuideSettings(settings);
      setJobEnabled(Boolean(settings?.pdfReaderConfigured));
    } catch (err) {
      feedback.setError(err?.message || "Falha ao carregar configuracao do job");
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
      setCompanyDetailTab("guides");
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
    createCompanyForm.reset();
    editCompanyForm.reset();
    setCompanyDetailTab("guides");
    setGuideSettings(null);
    setJobEnabled(false);
    setPendingGuides([]);
    setSelectedPendingGuideIds([]);
    setUploadResults([]);
    setUnidentifiedGuides([]);
  }

  useEffect(() => {
    if (page === "companyDetail" && companiesState.selectedCompanyId) {
      loadGuides(companiesState.selectedCompanyId);
      setCompanyDetailTab("guides");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, companiesState.selectedCompanyId]);

  useEffect(() => {
    if (selectedCompany) {
      editCompanyForm.replace(mapCompanyToEditForm(selectedCompany));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompany]);

  useEffect(() => {
    if (page === "companies" || page === "guideSettings") {
      loadCompanies();
      loadGuideSettings();
    } else if (page === "pendingReport") {
      loadPendingGuidesReport();
    } else if (page === "guideUpload") {
      loadUnidentifiedGuides();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

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
    loadGuides,
    loadPendingGuidesReport,
    loadUnidentifiedGuides,
    handleToggleJob,
    handleCreateCompany,
    handleUpdateCompany,
    handleResendGuide,
    handleGuideUpload,
    togglePendingGuideSelection,
    toggleAllPendingGuides,
    handleSendSelectedPending,
    resetWorkspace,
  };
}
