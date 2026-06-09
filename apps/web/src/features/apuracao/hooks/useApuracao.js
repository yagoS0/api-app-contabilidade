// Q15.7: state da página global de Apuração (fluxo novo — fechamento + lote).

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
  const [selected, setSelected] = useState(new Set()); // portalClientIds selecionados
  const [batchJobId, setBatchJobId] = useState(null);

  const load = useCallback(async () => {
    if (!api || !enabled) return;
    setLoading(true);
    setError(null);
    try {
      const out = await api.listApuracao({ competencia, search });
      const lista = out?.items || [];
      setItems(lista);
      // mantém na seleção só quem continua "fechada"
      setSelected((prev) => {
        const fechadas = new Set(lista.filter((i) => i.estado === "fechada").map((i) => i.portalClientId));
        return new Set([...prev].filter((id) => fechadas.has(id)));
      });
    } catch (err) {
      setError(err?.message || "Falha ao carregar apuração.");
    } finally {
      setLoading(false);
    }
  }, [api, competencia, search, enabled]);

  useEffect(() => { load(); }, [load]);

  function toggleSelect(portalClientId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(portalClientId)) next.delete(portalClientId);
      else next.add(portalClientId);
      return next;
    });
  }
  function selectAllFechadas() {
    const fechadas = items.filter((i) => i.estado === "fechada").map((i) => i.portalClientId);
    setSelected((prev) => (prev.size === fechadas.length && fechadas.length > 0) ? new Set() : new Set(fechadas));
  }

  async function apurarEmLote() {
    const ids = [...selected];
    if (ids.length === 0) { feedback?.notifyError?.("Selecione empresas fechadas."); return; }
    try {
      const out = await api.criarApuracaoBatch({ portalClientIds: ids, competencia });
      if (!out?.ok) throw new Error(out?.message || out?.error || "Falha");
      feedback?.notifySuccess?.(`Lote criado: ${out.totalEmpresas} empresa(s)${out.ignoradas ? ` (${out.ignoradas} ignoradas)` : ""}.`);
      setBatchJobId(out.jobId);
      setSelected(new Set());
    } catch (err) {
      feedback?.notifyError?.(err?.message || "Erro ao criar lote");
    }
  }

  return {
    competencia, setCompetencia,
    search, setSearch,
    items, loading, error,
    selected, toggleSelect, selectAllFechadas,
    batchJobId, setBatchJobId,
    apurarEmLote,
    reload: load,
  };
}
