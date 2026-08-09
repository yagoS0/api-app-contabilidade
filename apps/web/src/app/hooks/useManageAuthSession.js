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
  rotinas: "/rotinas",
  // `calendario` e `pendencias` saíram: nunca tiveram bloco correspondente no App.jsx, então as
  // URLs caíam no dashboard em silêncio. O calendário é visão do dashboard; Pendências virou aba
  // dentro de Consultas.
  obrigacoes: "/obrigacoes",
  // Funil pré-cadastro. `onboardingDetail` e `onboardingWizard` ficam `null` porque a URL leva um
  // id — o mapa não resolve rota com id, e por isso os dois têm RAMO PRÓPRIO em `setPage` (é o
  // mesmo motivo de `companyDetail` estar null aqui).
  onboardings: "/onboardings",
  onboardingDetail: null,
  onboardingWizard: null,
  // Simulacao livre nao exige empresa: e a tela de reuniao com prospect.
  planejamento: "/planejamento",
  serproFuncoes: "/funcoes-serpro",
};

// ⚠ EXPORTADA SÓ PARA TESTE. A última linha desta função é um fallback SILENCIOSO para
// `companies`: uma página nova cujo ramo esteja faltando fica inalcançável sem erro nenhum, sem
// log, sem 404 — foi o destino de `/calendario` e `/pendencias` por um tempo. Um teste é a única
// forma de essa falha aparecer antes do usuário.
export function pathToPageName(pathname) {
  if (pathname === "/" || pathname === "") return "companies";
  if (pathname === "/login") return "login";
  if (pathname === "/companies") return "companies";
  if (pathname === "/companies/new") return "createCompany";
  // Q49: companyDetail exige um id real no path. "/companies/" (vazio) caía como detalhe de
  // empresa sem id → tela fantasma; agora volta pra lista.
  if (pathname.startsWith("/companies/")) {
    const seg = pathname.split("/")[2] || "";
    return seg && seg !== "new" ? "companyDetail" : "companies";
  }
  if (pathname === "/guides/upload") return "guideUpload";
  if (pathname === "/guides/pending") return "pendingReport";
  if (pathname === "/guides/batch-email") return "batchEmail";
  if (pathname === "/firm-settings/guides") return "guideSettings";
  if (pathname === "/firm-settings/chart") return "chartOfAccountsGlobal";
  if (pathname === "/apuracao") return "apuracao";
  if (pathname === "/rotinas") return "rotinas";
  if (pathname === "/planejamento") return "planejamento";
  if (pathname === "/obrigacoes") return "obrigacoes";
  // ⚠ Estes três ramos precisam existir ANTES do fallback da última linha. O `return "companies"`
  // lá embaixo é SILENCIOSO: faltando um ramo, a URL abre o dashboard sem nenhum erro — foi o
  // destino de `/calendario` e `/pendencias` por um tempo, e ninguém percebeu.
  if (pathname === "/onboardings") return "onboardings";
  if (pathname === "/onboardings/new") return "onboardings";
  if (pathname.startsWith("/onboardings/")) {
    const seg = pathname.split("/")[2] || "";
    const sufixo = pathname.split("/")[3] || "";
    if (!seg) return "onboardings";
    return sufixo === "editar" ? "onboardingWizard" : "onboardingDetail";
  }
  if (pathname === "/funcoes-serpro") return "serproFuncoes";
  // O download de notas virou aba dentro de "Funções em lote" — links antigos caem lá.
  if (pathname === "/download-notas") return "serproFuncoes";
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
  function setPage(name, { companyId, onboardingId } = {}) {
    // ⚠ RAMO PRÓPRIO para rota com id: `PAGE_TO_PATH` só sabe traduzir caminho fixo, e sem isto
    // o `else` mandaria a navegação para `/companies` com um `console.warn` que ninguém lê.
    if (name === "onboardingDetail" || name === "onboardingWizard") {
      const oid = onboardingId || params.onboardingId;
      if (!oid) {
        console.warn(`[setPage(${name})] onboardingId ausente, voltando pra /onboardings`);
        return navigate("/onboardings");
      }
      return navigate(name === "onboardingWizard" ? `/onboardings/${oid}/editar` : `/onboardings/${oid}`);
    }
    if (name === "companyDetail") {
      const cid = companyId || params.companyId;
      if (!cid) {
        console.warn("[setPage(companyDetail)] companyId ausente, voltando pra /companies");
        return navigate("/companies");
      }
      // Q17: aba default = Lançamentos (era guides).
      return navigate(`/companies/${cid}/anotacoes`);
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
