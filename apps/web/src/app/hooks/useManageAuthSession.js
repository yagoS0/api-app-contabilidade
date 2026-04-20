import { useEffect, useState } from "react";

export function useManageAuthSession({ api, tokenStorageKey, feedback }) {
  const [page, setPage] = useState("login");
  const [user, setUser] = useState(null);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  async function ensureSession() {
    const tokenFromStorage = localStorage.getItem(tokenStorageKey) || "";
    if (!tokenFromStorage) return false;
    api.setAccessToken(tokenFromStorage);
    try {
      const me = await api.me();
      setUser(me);
      setPage("companies");
      return true;
    } catch {
      localStorage.removeItem(tokenStorageKey);
      api.clearSession();
      setUser(null);
      setPage("login");
      return false;
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    feedback.clearFeedback();
    setAuthLoading(true);
    try {
      const payload = await api.login({
        identifier: loginIdentifier,
        password: loginPassword,
      });
      const token = payload?.accessToken || api.getAccessToken();
      if (token) localStorage.setItem(tokenStorageKey, token);
      const me = await api.me();
      setUser(me);
      setPage("companies");
      setLoginPassword("");
    } catch (err) {
      feedback.setError(err?.message || "Falha ao autenticar");
    } finally {
      setAuthLoading(false);
    }
  }

  function clearSession() {
    api.clearSession();
    localStorage.removeItem(tokenStorageKey);
    setUser(null);
    setPage("login");
  }

  useEffect(() => {
    ensureSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    page,
    setPage,
    user,
    setUser,
    loginIdentifier,
    setLoginIdentifier,
    loginPassword,
    setLoginPassword,
    authLoading,
    handleLogin,
    clearSession,
  };
}
