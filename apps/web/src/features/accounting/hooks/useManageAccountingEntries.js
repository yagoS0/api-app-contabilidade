import { useState } from "react";

export function useAccountingEntries() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ competencia: "", tipo: "", origem: "", status: "" });

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
