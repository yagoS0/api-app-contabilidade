import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

// Q8.C: mapeamento bidirecional URL ↔ "page name" (compat com código antigo que usava session.page).
// Quando consumimos `page` lemos da URL; quando consumimos `setPage(name)` traduzimos pra URL e chamamos navigate.
// Isso permite navegação real (deep link, browser back) sem reescrever todos os callsites de setPage de uma vez.
const PAGE_TO_PATH = {
  login: "/login",
  companies: "/companies",
  createCompany: "/companies/new",
  companyDetail: null, // depende de selectedCompanyId — tratado abaixo
  guideUpload: "/guides/upload",
  pendingReport: "/guides/pending",
  batchEmail: "/guides/batch-email",
  guideSettings: "/firm-settings/guides",
  chartOfAccountsGlobal: "/firm-settings/chart",
  apuracao: "/apuracao",
  pendencias: "/pendencias",
  serproFuncoes: "/funcoes-serpro",
  notasDownload: "/download-notas",
};

function pathToPageName(pathname) {
  if (pathname === "/" || pathname === "") return "companies";
  if (pathname === "/login") return "login";
  if (pathname === "/companies") return "companies";
  if (pathname === "/companies/new") return "createCompany";
  if (pathname.startsWith("/companies/")) return "companyDetail";
  if (pathname === "/guides/upload") return "guideUpload";
  if (pathname === "/guides/pending") return "pendingReport";
  if (pathname === "/guides/batch-email") return "batchEmail";
  if (pathname === "/firm-settings/guides") return "guideSettings";
  if (pathname === "/firm-settings/chart") return "chartOfAccountsGlobal";
  if (pathname === "/apuracao") return "apuracao";
  if (pathname === "/pendencias") return "pendencias";
  if (pathname === "/funcoes-serpro") return "serproFuncoes";
  if (pathname === "/download-notas") return "notasDownload";
  return "companies"; // fallback seguro
}

export function useManageAuthSession({ api, tokenStorageKey, feedback }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();

  const [user, setUser] = useState(null);
  const [loginIdentifier, setLoginIdentifier] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const page = pathToPageName(location.pathname);

  // setPage(name) — compat: callsites antigos seguem funcionando.
  // Para "companyDetail" o caller normalmente faz `setSelectedCompanyId(id)` antes e depois `setPage("companyDetail")`;
  // por isso resolvemos a URL com base no companyId já presente (via param ou via aviso).
  function setPage(name, { companyId } = {}) {
    if (name === "companyDetail") {
      const cid = companyId || params.companyId;
      if (!cid) {
        console.warn("[setPage(companyDetail)] companyId ausente, voltando pra /companies");
        return navigate("/companies");
      }
      // Q17: aba default = Lançamentos (era guides).
      return navigate(`/companies/${cid}/lancamentos`);
    }
    const target = PAGE_TO_PATH[name];
    if (target) navigate(target);
    else {
      console.warn(`[setPage] page desconhecida: ${name}`);
      navigate("/companies");
    }
  }

  async function ensureSession() {
    const tokenFromStorage = localStorage.getItem(tokenStorageKey) || "";
    if (!tokenFromStorage) {
      if (location.pathname !== "/login") navigate("/login");
      return false;
    }
    api.setAccessToken(tokenFromStorage);
    try {
      const me = await api.me();
      setUser(me);
      if (location.pathname === "/login" || location.pathname === "/") {
        navigate("/companies");
      }
      return true;
    } catch {
      localStorage.removeItem(tokenStorageKey);
      api.clearSession();
      setUser(null);
      navigate("/login");
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
      // Honra ?redirect= se vier do RequireAuth
      const search = new URLSearchParams(location.search);
      const redirect = search.get("redirect");
      navigate(redirect && redirect.startsWith("/") ? redirect : "/companies");
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
    navigate("/login");
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
