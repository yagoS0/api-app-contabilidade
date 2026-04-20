import { useState } from "react";

export function useManageAppFeedback() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function clearFeedback() {
    setError("");
    setMessage("");
  }

  return {
    error,
    setError,
    message,
    setMessage,
    clearFeedback,
  };
}
