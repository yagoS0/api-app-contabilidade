import { useCallback, useEffect, useState } from "react";

export function useAccountingFunctions({ api, companyId }) {
  const [functions, setFunctions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listAccountingFunctions(companyId);
      setFunctions(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err?.message || "Falha ao listar funções.");
      setFunctions([]);
    } finally {
      setLoading(false);
    }
  }, [api, companyId]);

  useEffect(() => { load(); }, [load]);

  async function create(body) {
    setSaving(true); setError(null);
    try {
      const res = await api.createAccountingFunction(companyId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao criar função.");
      throw err;
    } finally { setSaving(false); }
  }

  async function update(functionId, body) {
    setSaving(true); setError(null);
    try {
      const res = await api.updateAccountingFunction(companyId, functionId, body);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao atualizar função.");
      throw err;
    } finally { setSaving(false); }
  }

  async function remove(functionId) {
    setSaving(true); setError(null);
    try {
      const res = await api.deleteAccountingFunction(companyId, functionId);
      await load();
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao excluir função.");
      throw err;
    } finally { setSaving(false); }
  }

  async function apply(functionId, { competencia, entryValores }) {
    setSaving(true); setError(null);
    try {
      const res = await api.applyAccountingFunction(companyId, functionId, { competencia, entryValores });
      return res;
    } catch (err) {
      setError(err?.message || "Falha ao aplicar função.");
      throw err;
    } finally { setSaving(false); }
  }

  return { functions, loading, error, saving, load, create, update, remove, apply };
}
