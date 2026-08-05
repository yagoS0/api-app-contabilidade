import { useState } from "react";
// ⚠ `filters.competencia` deixou de ser filtro só desta aba: virou a COMPETÊNCIA GLOBAL da empresa,
// escrita pelo seletor do header (ver `useManageAccountingWorkspace`). O default mora em
// `lib/competencia` porque a Circular parte dele também — eram duas cópias com meses diferentes.
import { competenciaPadrao } from "../../../lib/competencia";

export function useAccountingEntries() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    competencia: competenciaPadrao(),
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
