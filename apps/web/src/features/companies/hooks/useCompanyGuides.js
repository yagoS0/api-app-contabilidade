import { useState } from "react";

export function useCompanyGuides() {
  const [guides, setGuides] = useState([]);
  const [loadingGuides, setLoadingGuides] = useState(false);
  const [resendingGuideId, setResendingGuideId] = useState("");

  return {
    guides,
    setGuides,
    loadingGuides,
    setLoadingGuides,
    resendingGuideId,
    setResendingGuideId,
  };
}

