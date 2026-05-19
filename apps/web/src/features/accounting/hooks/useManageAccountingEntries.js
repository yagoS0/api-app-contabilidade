import { useState } from "react";

// Competência inicial do filtro: mês ANTERIOR ao atual (formato YYYY-MM).
// Contadores trabalham com competência fechada — mês corrente normalmente está vazio.
function getPreviousMonthCompetencia() {
  const now = new Date();
  // Setar dia 1 evita problemas de fim-de-mês (ex: 31 jan → fev). Recuamos um mês daí.
  const ref = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
}

export function useAccountingEntries() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    competencia: getPreviousMonthCompetencia(),
    tipo: "",
    origem: "",
    status: "",
  });

  function setFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return {
    entries,
    setEntries,
    total,
    setTotal,
    loading,
    setLoading,
    filters,
    setFilter,
  };
}
