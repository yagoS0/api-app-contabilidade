import { useCallback, useEffect, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { ChartOfAccountsPage } from "./renderChartOfAccountsPage";

/**
 * Wrapper smart para o plano de contas GLOBAL — gerencia o próprio data loading
 * via api client e expõe os handlers para a ChartOfAccountsPage compartilhada.
 */
export function GlobalChartOfAccountsPage({ api, onBack }) {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const data = await api.getGlobalChartOfAccounts();
      setAccounts(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Falha ao carregar plano global.");
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(input) {
    await api.createGlobalChartOfAccount(input);
    await load();
  }
  async function handleUpdate(codigo, input) {
    await api.updateGlobalChartOfAccount(codigo, input);
    await load();
  }
  async function handleDelete(codigo) {
    await api.deleteGlobalChartOfAccount(codigo);
    await load();
  }
  async function handleImport(file) {
    const result = await api.importGlobalChartOfAccountsFile(file);
    await load();
    return result;
  }

  return (
    <AppShell>
      {error && (
        <div style={{ padding: 10, marginBottom: 10, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", color: "#FF5757", borderRadius: 6 }}>
          {error}
        </div>
      )}
      <ChartOfAccountsPage
        scope="GLOBAL"
        accounts={accounts}
        onCreateAccount={handleCreate}
        onUpdateAccount={handleUpdate}
        onDeleteAccount={handleDelete}
        onImportFile={handleImport}
        onBack={onBack}
      />
    </AppShell>
  );
}
