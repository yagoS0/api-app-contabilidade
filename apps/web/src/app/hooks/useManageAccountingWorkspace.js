import { useEffect, useState } from "react";
import { useAccountingEntries } from "../../features/accounting/hooks/useManageAccountingEntries";
import { useChartOfAccounts } from "../../features/accounting/hooks/useManageChartOfAccounts";

export function useManageAccountingWorkspace({ api, page, selectedCompanyId, companyDetailTab, feedback }) {
  const accountingEntriesState = useAccountingEntries();
  const chartOfAccountsState = useChartOfAccounts();
  const [savingEntry, setSavingEntry] = useState(false);
  const [savingBaixa, setSavingBaixa] = useState(false);
  const [circularData, setCircularData] = useState(null);
  const [loadingCircular, setLoadingCircular] = useState(false);
  const [circularYear, setCircularYear] = useState(new Date().getFullYear());
  const [entriesMessage, setEntriesMessage] = useState("");
  const [entriesError, setEntriesError] = useState("");

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

  async function loadCircular(year = circularYear) {
    if (!selectedCompanyId) return;
    setLoadingCircular(true);
    setEntriesError("");
    try {
      const result = await api.getCircular(selectedCompanyId, { year });
      setCircularData(result);
    } catch (err) {
      setEntriesError(err?.message || "Falha ao carregar circular.");
    } finally {
      setLoadingCircular(false);
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
      if (companyDetailTab === "circular") await loadCircular(circularYear);
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
    entriesMessage,
    entriesError,
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
    resetWorkspace,
  };
}
