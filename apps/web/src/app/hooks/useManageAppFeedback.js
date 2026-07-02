import { useCallback, useRef, useState } from "react";

export function useManageAppFeedback() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const dismissTimer = useRef(null);

  const clearFeedback = useCallback(() => {
    if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    setError("");
    setMessage("");
  }, []);

  // Q44: agenda auto-dismiss da mensagem de sucesso (erro permanece até nova ação/limpeza).
  const scheduleDismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => { setMessage(""); dismissTimer.current = null; }, 6000);
  }, []);

  // Q44: métodos que várias features (apuracao, apuracao-v2, notas, certificate) já esperavam.
  // Sem eles, as chamadas `feedback?.notifySuccess?.(...)` eram no-op silencioso (erros invisíveis).
  const notifySuccess = useCallback((msg) => {
    setError("");
    setMessage(String(msg || ""));
    scheduleDismiss();
  }, [scheduleDismiss]);

  const notifyError = useCallback((msg) => {
    if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    setMessage("");
    setError(String(msg || "Ocorreu um erro."));
  }, []);

  const notifyInfo = useCallback((msg) => {
    setError("");
    setMessage(String(msg || ""));
    scheduleDismiss();
  }, [scheduleDismiss]);

  return {
    error,
    setError,
    message,
    setMessage,
    clearFeedback,
    notifySuccess,
    notifyError,
    notifyInfo,
  };
}
