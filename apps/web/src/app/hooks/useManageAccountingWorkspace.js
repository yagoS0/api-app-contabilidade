import { useEffect, useState } from "react";
import { useAccountingEntries } from "../../features/accounting/hooks/useManageAccountingEntries";
import { useChartOfAccounts } from "../../features/accounting/hooks/useManageChartOfAccounts";

export function useManageAccountingWorkspace({ api, page, selectedCompanyId, companyDetailTab, feedback }) {
  const accountingEntriesState = useAccountingEntries();
  const chartOfAccountsState = useChartOfAccounts();
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingBaixa, setSavingBaixa] = useState(false);
  const [savingCircular, setSavingCircular] = useState(false);
  const [approvingCircularEntryId, setApprovingCircularEntryId] = useState("");
  const [circularData, setCircularData] = useState(null);
  const [loadingCircular, setLoadingCircular] = useState(false);
  const [circularYear, setCircularYear] = useState(new Date().getFullYear());
  const [circularCompetencia, setCircularCompetencia] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [entriesMessage, setEntriesMessage] = useState("");
  const [entriesError, setEntriesError] = useState("");

  // Fiscal operation state
  const [runningFiscalAction, setRunningFiscalAction] = useState(null);
  const [lastFiscalResult, setLastFiscalResult] = useState(null);

  // Fiscal execution history
  const [fiscalExecutions, setFiscalExecutions] = useState([]);
  const [loadingFiscalExecutions, setLoadingFiscalExecutions] = useState(false);

  async function loadChartOfAccounts(companyId = selectedCompanyId) {
    if (!companyId) return;
    chartOfAccountsState.setLoading(true);
    try {
      const data = await api.getChartOfAccounts(companyId);
      chartOfAccountsState.setAccounts(data);
    } catch {
      chartOfAccountsState.setAccounts([]);
    } finally {
      chartOfAccountsState.setLoading(false);
    }
  }

  async function loadAccountingEntries(companyId = selectedCompanyId) {
    if (!companyId) return;
    accountingEntriesState.setLoading(true);
    setEntriesError("");
    try {
      const result = await api.getAccountingEntries(companyId, accountingEntriesState.filters);
      accountingEntriesState.setEntries(result.data);
      accountingEntriesState.setTotal(result.total);
    } catch (err) {
      setEntriesError(err?.message || "Falha ao carregar lançamentos.");
      accountingEntriesState.setEntries([]);
    } finally {
      accountingEntriesState.setLoading(false);
    }
  }

  async function loadCircular(year = circularYear, competencia = circularCompetencia) {
    if (!selectedCompanyId) return;
    setLoadingCircular(true);
    setEntriesError("");
    try {
      const yearly = await api.getCircular(selectedCompanyId, { year });
      let review = null;
      if (competencia) {
        try {
          review = await api.getCircularAccountingEntries(selectedCompanyId, competencia);
        } catch {
          review = null;
        }
      }
      setCircularData({
        ...yearly,
        circular: review?.circular || null,
        accountingReview: review || null,
        reviewEntries: Array.isArray(review?.entries) ? review.entries : [],
        reviewAllEntries: Array.isArray(review?.allEntries) ? review.allEntries : [],
      });
    } catch (err) {
      setEntriesError(err?.message || "Falha ao carregar circular.");
    } finally {
      setLoadingCircular(false);
    }
  }

  async function handleSaveCircular(input) {
    if (!selectedCompanyId) return;
    setSavingCircular(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      const competencia = circularCompetencia;
      await api.updateCircular(selectedCompanyId, competencia, input);
      await loadCircular(circularYear, competencia);
      setEntriesMessage("Circular atualizada e lançamentos regenerados.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao salvar circular.");
    } finally {
      setSavingCircular(false);
    }
  }

  async function handleApproveCircularEntry(entryId) {
    if (!selectedCompanyId || !entryId) return;
    setApprovingCircularEntryId(entryId);
    setEntriesError("");
    setEntriesMessage("");
    try {
      await api.approveAccountingEntry(selectedCompanyId, entryId);
      await loadCircular(circularYear, circularCompetencia);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento da circular aprovado.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao aprovar lançamento.");
    } finally {
      setApprovingCircularEntryId("");
    }
  }

  async function handleCreateBaixa(entryId, input) {
    if (!selectedCompanyId) return;
    setSavingBaixa(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      await api.createBaixa(selectedCompanyId, entryId, input);
      await loadAccountingEntries(selectedCompanyId);
      if (companyDetailTab === "circular") await loadCircular(circularYear, circularCompetencia);
      setEntriesMessage("Baixa registrada com sucesso.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao criar baixa.");
    } finally {
      setSavingBaixa(false);
    }
  }

  async function searchHistoricos(q) {
    if (!selectedCompanyId) return [];
    return api.searchHistoricos(selectedCompanyId, q);
  }

  async function getHistoricosByCode(codigo) {
    if (!selectedCompanyId) return [];
    return api.getHistoricosByCode(selectedCompanyId, codigo);
  }

  async function loadAllHistoricos() {
    if (!selectedCompanyId) return [];
    return api.getAllHistoricos(selectedCompanyId);
  }

  async function handleUpdateHistorico(id, input) {
    if (!selectedCompanyId) return { ok: false };
    return api.updateHistorico(selectedCompanyId, id, input);
  }

  async function handleDeleteHistorico(id) {
    if (!selectedCompanyId) return;
    return api.deleteHistorico(selectedCompanyId, id);
  }

  async function handleCreateEntry(input) {
    if (!selectedCompanyId) return null;
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      const result = await api.createAccountingEntry(selectedCompanyId, input);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento adicionado.");
      return result;
    } catch (err) {
      setEntriesError(err?.message || "Falha ao criar lançamento.");
      return null;
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleLoadPayrollTemplate(kind, competencia) {
    if (!selectedCompanyId) return null;
    return api.getPayrollTemplate(selectedCompanyId, kind, competencia);
  }

  async function handleLoadBaixaTemplate(entryId) {
    if (!selectedCompanyId) return null;
    return api.getBaixaTemplate(selectedCompanyId, entryId);
  }

  async function handleUpdateEntry(entryId, input) {
    if (!selectedCompanyId) return;
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      await api.updateAccountingEntry(selectedCompanyId, entryId, input);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento atualizado.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao atualizar lançamento.");
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleDeleteEntryNoConfirm(entryId) {
    if (!selectedCompanyId) return;
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      await api.deleteAccountingEntry(selectedCompanyId, entryId);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento excluído.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao excluir lançamento.");
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleDeleteEntry(entryId) {
    if (!selectedCompanyId) return;
    if (!window.confirm("Excluir este lançamento?")) return;
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      await api.deleteAccountingEntry(selectedCompanyId, entryId);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento excluído.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao excluir lançamento.");
    } finally {
      setSavingEntry(false);
    }
  }

  async function handleBulkDeleteEntries(entryIds) {
    if (!selectedCompanyId) return { ok: false };
    const ids = Array.isArray(entryIds) ? entryIds.filter(Boolean) : [];
    if (!ids.length) return { ok: false };
    const label = ids.length === 1 ? "este lançamento" : `estes ${ids.length} lançamentos`;
    if (!window.confirm(`Excluir ${label}? Esta ação não pode ser desfeita.`)) return { ok: false, cancelled: true };
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    let succeeded = 0;
    const errors = [];
    for (const id of ids) {
      try {
        await api.deleteAccountingEntry(selectedCompanyId, id);
        succeeded += 1;
      } catch (err) {
        errors.push({ id, message: err?.message || "erro" });
      }
    }
    await loadAccountingEntries(selectedCompanyId);
    setSavingEntry(false);
    if (succeeded > 0 && errors.length === 0) {
      setEntriesMessage(`${succeeded} lançamento${succeeded !== 1 ? "s" : ""} excluído${succeeded !== 1 ? "s" : ""}.`);
    } else if (succeeded > 0 && errors.length > 0) {
      setEntriesMessage(`${succeeded} excluído${succeeded !== 1 ? "s" : ""}; ${errors.length} falharam.`);
      setEntriesError(`Algumas exclusões falharam (provavelmente lançamentos já exportados).`);
    } else {
      setEntriesError(`Nenhum lançamento foi excluído. ${errors[0]?.message || ""}`);
    }
    return { ok: errors.length === 0, succeeded, failed: errors.length };
  }

  async function handlePreviewOFX(file) {
    return api.previewOFX(selectedCompanyId, file);
  }

  async function handleImportOFX(params) {
    const result = await api.importOFX(selectedCompanyId, params);
    await loadAccountingEntries(selectedCompanyId);
    return result;
  }

  async function handleCreateAccount(input) {
    if (!selectedCompanyId) return;
    const result = await api.createChartOfAccount(selectedCompanyId, input);
    await loadChartOfAccounts(selectedCompanyId);
    return result;
  }

  async function handleUpdateAccount(codigo, input) {
    if (!selectedCompanyId) return;
    const result = await api.updateChartOfAccount(selectedCompanyId, codigo, input);
    await loadChartOfAccounts(selectedCompanyId);
    return result;
  }

  async function handleDeleteAccount(codigo) {
    if (!selectedCompanyId) return;
    const result = await api.deleteChartOfAccount(selectedCompanyId, codigo);
    await loadChartOfAccounts(selectedCompanyId);
    return result;
  }

  async function handleImportAccountsFile(file) {
    if (!selectedCompanyId) return;
    const result = await api.importChartOfAccountsFile(selectedCompanyId, file);
    await loadChartOfAccounts(selectedCompanyId);
    return result;
  }

  async function handleExportEntriesCsv(rangeOptions = null) {
    if (!selectedCompanyId) return;
    // rangeOptions: { competenciaInicio, competenciaFim } | { competencia } | null (usa filtro atual)
    const params = rangeOptions || { competencia: accountingEntriesState.filters.competencia };
    try {
      const url = api.getEntriesExportCsvUrl(selectedCompanyId, params);
      if (!url || url.startsWith("#")) {
        setEntriesError("Exportação CSV não disponível no modo mock.");
        return;
      }
      const token = api.getAccessToken();
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error(`Falha na exportação: ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      const suffix =
        params.competenciaInicio && params.competenciaFim
          ? `${params.competenciaInicio}_a_${params.competenciaFim}`
          : params.competencia || "todos";
      link.download = `lancamentos-${suffix}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setEntriesError(err?.message || "Falha ao exportar CSV.");
    }
  }

  function handleCircularYearChange(year) {
    setCircularYear(year);
    loadCircular(year);
  }

  function resetWorkspace() {
    setEntriesMessage("");
    setEntriesError("");
    accountingEntriesState.setEntries([]);
    accountingEntriesState.setTotal(0);
    chartOfAccountsState.setAccounts([]);
    setCircularData(null);
  }

  async function loadFiscalExecutions(companyId = selectedCompanyId, competencia = circularCompetencia) {
    if (!companyId || !api.getFiscalExecutions) return;
    setLoadingFiscalExecutions(true);
    try {
      const data = await api.getFiscalExecutions(companyId, { competencia, limit: 20 });
      setFiscalExecutions(Array.isArray(data) ? data : []);
    } catch {
      setFiscalExecutions([]);
    } finally {
      setLoadingFiscalExecutions(false);
    }
  }

  // Fiscal action handlers
  async function handleRunFiscalAction(action, competencia = circularCompetencia) {
    if (!selectedCompanyId) return;
    if (runningFiscalAction) return; // Prevent concurrent executions

    setRunningFiscalAction(action);
    setEntriesError("");
    setEntriesMessage("");

    try {
      const result = await api.runCompanyFiscalAction(selectedCompanyId, {
        action,
        competencia,
      });

      setLastFiscalResult(result);

      if (result?.result?.status === "completed") {
        setEntriesMessage(`${action.replace("_", " ")}: operação concluída com sucesso.`);
        // Reload circular after successful action
        if (["search_guides", "sync_inss"].includes(action)) {
          await loadCircular(circularYear, competencia);
        }
      } else if (result?.result?.status === "skipped") {
        setEntriesMessage(`${action.replace("_", " ")}: operação ignorada. ${result?.result?.reason || ""}`);
      }

      // Refresh execution history after any action
      await loadFiscalExecutions(selectedCompanyId, competencia);
    } catch (err) {
      setEntriesError(err?.message || `Falha ao executar ${action}`);
      setLastFiscalResult(null);
      // Refresh history even on failure (backend logs the failed attempt)
      await loadFiscalExecutions(selectedCompanyId, competencia);
    } finally {
      setRunningFiscalAction(null);
    }
  }

  async function handleSearchGuides(competencia = circularCompetencia) {
    return handleRunFiscalAction("search_guides", competencia);
  }

  async function handleCheckPayments(competencia = circularCompetencia) {
    return handleRunFiscalAction("check_payments", competencia);
  }

  async function handleSyncInss(competencia = circularCompetencia) {
    return handleRunFiscalAction("sync_inss", competencia);
  }

  useEffect(() => {
    if (page === "companyDetail" && selectedCompanyId) {
      setEntriesMessage("");
      setEntriesError("");
      accountingEntriesState.setEntries([]);
      chartOfAccountsState.setAccounts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, selectedCompanyId]);

  // Load fiscal execution history when company or competencia changes
  useEffect(() => {
    if (selectedCompanyId && companyDetailTab === "circular") {
      loadFiscalExecutions(selectedCompanyId, circularCompetencia);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId, circularCompetencia, companyDetailTab]);

  return {
    accountingEntriesState,
    chartOfAccountsState,
    savingEntry,
    savingBaixa,
    circularData,
    loadingCircular,
    circularYear,
    circularCompetencia,
    savingCircular,
    approvingCircularEntryId,
    entriesMessage,
    entriesError,
    runningFiscalAction,
    lastFiscalResult,
    fiscalExecutions,
    loadingFiscalExecutions,
    loadFiscalExecutions,
    loadChartOfAccounts,
    loadAccountingEntries,
    loadCircular,
    handleCreateBaixa,
    handleDeleteEntryNoConfirm,
    searchHistoricos,
    getHistoricosByCode,
    loadAllHistoricos,
    handleUpdateHistorico,
    handleDeleteHistorico,
    handleCreateEntry,
    handleLoadPayrollTemplate,
    handleLoadBaixaTemplate,
    handleUpdateEntry,
    handleDeleteEntry,
    handleBulkDeleteEntries,
    handlePreviewOFX,
    handleImportOFX,
    handleCreateAccount,
    handleUpdateAccount,
    handleDeleteAccount,
    handleImportAccountsFile,
    handleExportEntriesCsv,
    handleCircularYearChange,
    setCircularCompetencia,
    handleSaveCircular,
    handleApproveCircularEntry,
    handleRunFiscalAction,
    handleSearchGuides,
    handleCheckPayments,
    handleSyncInss,
    resetWorkspace,
  };
}
