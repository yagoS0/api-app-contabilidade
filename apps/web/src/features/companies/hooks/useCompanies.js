import { useMemo, useState } from "react";

export function useCompanies() {
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  const selectedCompany = useMemo(
    () => companies.find((item) => item.companyId === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  );

  return {
    companies,
    setCompanies,
    selectedCompanyId,
    setSelectedCompanyId,
    loadingCompanies,
    setLoadingCompanies,
    selectedCompany,
  };
}

