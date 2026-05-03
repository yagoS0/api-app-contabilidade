import { useState } from "react";

export function useCompanyGuides() {
  const [guides, setGuides] = useState([]);
  const [loadingGuides, setLoadingGuides] = useState(false);
  const [resendingGuideId, setResendingGuideId] = useState("");
  const [confirmingGuideId, setConfirmingGuideId] = useState("");
  const [recalculatingGuideId, setRecalculatingGuideId] = useState("");

  return {
    guides,
    setGuides,
    loadingGuides,
    setLoadingGuides,
    resendingGuideId,
    setResendingGuideId,
    confirmingGuideId,
    setConfirmingGuideId,
    recalculatingGuideId,
    setRecalculatingGuideId,
  };
}
