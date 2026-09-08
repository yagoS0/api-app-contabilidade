import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { LogoAltan } from "../../components/ui/LogoAltan";

const WorkspaceNavigation = createContext(null);
export const useWorkspaceNavigation = () => useContext(WorkspaceNavigation);

// Track only routes visited inside this mounted workspace. A direct link never sends
// the user back to an external site or a previous authenticated session.
export function WorkspaceNavigationProvider({ children }) {
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  const history = useRef({ entries: [], index: -1 });
  const [modoVisao, setModoVisao] = useState("calendario");
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
    setModoVisao("calendario");
  }, []);
  return <WorkspaceNavigation.Provider value={{ goBack, navigate, modoVisao, setModoVisao, resetSession }}>
    {location.pathname !== "/login" && <div className="workspace-brandbar">
      <Link to="/companies" className="workspace-home" aria-label="Altan — página principal" title="Página principal">
        <LogoAltan altura={30} />
      </Link>
    </div>}
    {children}
  </WorkspaceNavigation.Provider>;
}
