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
    if (!selectedCompanyId) return;
    setSavingEntry(true);
    setEntriesError("");
    setEntriesMessage("");
    try {
      await api.createAccountingEntry(selectedCompanyId, input);
      await loadAccountingEntries(selectedCompanyId);
      setEntriesMessage("Lançamento adicionado.");
    } catch (err) {
      setEntriesError(err?.message || "Falha ao criar lançamento.");
    } finally {
      setSavingEntry(false);
    }
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

  async function handleExportEntriesCsv() {
    if (!selectedCompanyId) return;
    try {
      const url = api.getEntriesExportCsvUrl(selectedCompanyId, accountingEntriesState.filters);
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
      const competencia = accountingEntriesState.filters.competencia || "todos";
      link.download = `lancamentos-${competencia}.csv`;
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
    } catch (err) {
      setEntriesError(err?.message || `Falha ao executar ${action}`);
      setLastFiscalResult(null);
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
    loadChartOfAccounts,
    loadAccountingEntries,
    loadCircular,
    handleCreateBaixa,
    searchHistoricos,
    getHistoricosByCode,
    loadAllHistoricos,
    handleUpdateHistorico,
    handleDeleteHistorico,
    handleCreateEntry,
    handleUpdateEntry,
    handleDeleteEntry,
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
