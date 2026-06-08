// Q12.C.2: state da página global de Apuração.

import { useCallback, useEffect, useState } from "react";

function defaultCompetencia() {
  const d = new Date();
  // mês anterior (referência típica de apuração)
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function useApuracao({ api, feedback, enabled = true }) {
  const [competencia, setCompetencia] = useState(defaultCompetencia);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    if (!api || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const out = await api.listApuracao({ competencia, search });
      setItems(out?.items || []);
    } catch (err) {
      setError(err?.message || "Falha ao carregar apuração.");
    } finally {
      setLoading(false);
    }
  }, [api, competencia, search, enabled]);

  useEffect(() => { load(); }, [load]);

  async function fechar(portalClientId) {
    setActingId(portalClientId);
    try {
      const out = await api.fecharCompetencia(portalClientId, competencia);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.(`Competência ${competencia} fechada.`);
      await load();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro ao fechar");
    } finally { setActingId(null); }
  }

  async function reabrir(portalClientId, reason) {
    setActingId(portalClientId);
    try {
      const out = await api.reabrirCompetencia(portalClientId, competencia, reason);
      if (!out?.ok) throw new Error(out?.message || "Falha");
      feedback?.notifySuccess?.(`Competência reaberta.`);
      await load();
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro ao reabrir");
    } finally { setActingId(null); }
  }

  return {
    competencia, setCompetencia,
    search, setSearch,
    items, loading, error,
    actingId,
    reload: load,
    fechar, reabrir,
  };
}
