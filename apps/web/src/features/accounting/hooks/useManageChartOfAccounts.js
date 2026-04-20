import { useState } from "react";

export function useChartOfAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(false);

  return {
    accounts,
    setAccounts,
    loading,
    setLoading,
  };
}
