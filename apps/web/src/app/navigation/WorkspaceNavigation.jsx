import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { LogoAltan } from "../../components/ui/LogoAltan";

import { WorkspaceNavigation, useWorkspaceNavigation } from "./WorkspaceNavigation.shared";

export function WorkspaceHomeLink() {
  const navigation = useWorkspaceNavigation();
  return <a href="/companies" className="workspace-home" aria-label="Altan — página principal" title="Página principal"
    onClick={(event) => {
      if (navigation && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        navigation.navigate("/companies");
      }
    }}><LogoAltan altura={28} variante="marca" /></a>;
}

// Track only routes visited inside this mounted workspace. A direct link never sends
// the user back to an external site or a previous authenticated session.
export function WorkspaceNavigationProvider({ children }) {
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  const companyRoute = /^\/companies\/[^/]+\/.+/.test(location.pathname);
  const history = useRef({ entries: [], index: -1 });
  const [modoVisao, guardarModoVisao] = useState("operacoes");
  useLayoutEffect(() => {
    const modo = new URLSearchParams(location.search).get('visao');
    if (location.pathname === '/companies' && ['calendario', 'operacoes', 'tabela'].includes(modo)) guardarModoVisao(modo);
  }, [location.pathname, location.search]);
  const setModoVisao = useCallback(modo => {
    if (!['calendario', 'operacoes', 'tabela'].includes(modo)) return;
    guardarModoVisao(modo);
    if (location.pathname === '/companies') {
      const q = new URLSearchParams(location.search); q.set('visao', modo);
      navigate(`/companies?${q.toString()}`);
    }
  }, [location.pathname, location.search, navigate]);
  useLayoutEffect(() => {
    const stack = history.current;
    if (location.pathname === "/login") {
      history.current = { entries: [], index: -1 };
      return;
    }
    if (stack.entries[stack.index] === location.key) return;
    const known = stack.entries.indexOf(location.key);
    if (action === "POP" && known >= 0) stack.index = known;
    else if (action === "REPLACE" && stack.index >= 0) stack.entries[stack.index] = location.key;
    else {
      stack.entries = [...stack.entries.slice(0, stack.index + 1), location.key];
      stack.index = stack.entries.length - 1;
    }
  }, [location.key, location.pathname, action]);
  const goBack = useCallback((fallback = "/companies") => {
    if (history.current.index > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate]);
  const resetSession = useCallback(() => {
    history.current = { entries: [], index: -1 };
    guardarModoVisao("operacoes");
  }, []);
  return <WorkspaceNavigation.Provider value={{ goBack, navigate, location, modoVisao, setModoVisao, resetSession }}>
    {/* A estrutura precisa permanecer a mesma: inserir/remover este div desmontava a sessão,
        os hooks e as tarefas ao passar entre a carteira e uma empresa. Só a classe muda. */}
    <div className={companyRoute ? "company-workspace" : undefined}>{children}</div>
  </WorkspaceNavigation.Provider>;
}
