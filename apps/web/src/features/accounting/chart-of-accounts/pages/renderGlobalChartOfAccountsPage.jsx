import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "../../../../components/layout/AppShell";
import { PageShell } from "../../../../components/layout/PageShell";
import { ChartOfAccountsPage } from "./renderChartOfAccountsPage";

/**
 * Wrapper smart para o plano de contas GLOBAL — gerencia o próprio data loading
 * via api client e expõe os handlers para a ChartOfAccountsPage compartilhada.
 */
export function GlobalChartOfAccountsPage({ api, onBack }) {
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const currentApi = useRef(api);
  const loadedApi = useRef(null);
  currentApi.current = api;

  const load = useCallback(async () => {
    if (currentApi.current !== api) return;
    const id = ++request.current;
    const current = () => id === request.current && currentApi.current === api;
    setLoading(true);
    try {
      const data = await api.getGlobalChartOfAccounts();
      if (!current()) return;
      if (!Array.isArray(data)) throw new Error("Resposta inválida do plano de contas global.");
      loadedApi.current = api;
      setAccounts(data);
      setError("");
    } catch (err) {
      if (current()) setError(err?.message || "Falha ao carregar plano global.");
    } finally {
      if (current()) setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    setAccounts([]);
    setError("");
    load();
    return () => { request.current += 1; };
  }, [load]);

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
    <PageShell
      title="Plano de Contas Global"
      subtitle="Plano compartilhado entre todas as empresas. Cada empresa pode ter contas próprias."
      onBack={onBack}
    >
      <AppShell>
        <ChartOfAccountsPage
          scope="GLOBAL"
          accounts={loadedApi.current === api ? accounts : []}
          loading={loading}
          loadError={error}
          onReload={load}
          onCreateAccount={handleCreate}
          onUpdateAccount={handleUpdate}
          onDeleteAccount={handleDelete}
          onImportFile={handleImport}
          // Sem onBack: o PageShell já provê o Voltar à esquerda (padrão unificado).
          onBack={null}
        />
      </AppShell>
    </PageShell>
  );
}
