import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { LogoAltan } from "../../components/ui/LogoAltan";

import { oNavegadorAssumeCliqueNoWorkspace } from "./workspaceLinkClick";
import { WorkspaceNavigation, useWorkspaceNavigation } from "./WorkspaceNavigation.shared";

export function WorkspaceHomeLink() {
  const navigation = useWorkspaceNavigation();
  return <a href="/companies" className="workspace-home" aria-label="Altan — página principal" title="Página principal"
    onClick={(event) => {
      if (navigation && !oNavegadorAssumeCliqueNoWorkspace(event)) {
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
  const editors = useRef(new Map());
  const intent = useRef(null);
  const operationRef = useRef(null);
  const bypass = useRef(false);
  const [decision, setDecision] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const activeEditors = useCallback(() => [...editors.current.values()].filter(lease => lease.read().dirty), []);
  const registerEditor = useCallback((id, read) => {
    const lease = { read };
    editors.current.set(id, lease);
    return () => {
      if (editors.current.get(id) === lease) editors.current.delete(id);
      if (intent.current?.leases.includes(lease)) intent.current.invalid = true;
    };
  }, []);
  const blocker = useBlocker(useCallback(({ nextLocation }) => {
    if (bypass.current) { bypass.current = false; return false; }
    return nextLocation.pathname !== '/login' && (Boolean(intent.current) || activeEditors().length > 0);
  }, [activeEditors]));
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;
  const clearIntent = useCallback((resume = true) => {
    const old = intent.current;
    intent.current = null;
    if (old) {
      old.invalid = true;
      if (resume) old.leases.forEach(lease => lease.read().resume?.());
    }
    setDecision(null); setFailure(null); setBusy(false);
  }, []);
  const begin = useCallback((transition) => {
    if (intent.current) return;
    const leases = transition.leases || activeEditors();
    leases.forEach(lease => lease.read().suspend?.());
    const next = { ...transition, leases, contexts: leases.map(lease => lease.read().context), busy: Boolean(operationRef.current) };
    intent.current = next;
    setDecision(next); setFailure(null); setBusy(next.busy);
  }, [activeEditors]);
  useLayoutEffect(() => {
    if (blocker.state === 'blocked') {
      const leases = intent.current?.leases;
      if (intent.current && intent.current.location !== blocker.location) clearIntent(false);
      begin({ location: blocker.location, leases });
    } else if (blocker.state === 'unblocked' && intent.current?.location) clearIntent();
  }, [blocker, begin, clearIntent]);
  const confirmarSaida = useCallback(continuar => {
    if (intent.current) return;
    if (!activeEditors().length) return continuar();
    begin({ continuar });
  }, [activeEditors, begin]);
  const cancel = useCallback(() => {
    if (intent.current?.busy) return;
    if (blockerRef.current.state === 'blocked') blockerRef.current.reset();
    clearIntent();
  }, [clearIntent]);
  async function resolveDecision(operation) {
    const current = intent.current;
    if (!current || current.busy) return;
    operationRef.current = current;
    current.busy = true; current.operation = operation; setBusy(true); setFailure(null);
    const valid = () => intent.current === current && !current.invalid &&
      current.leases.every((lease, i) => [...editors.current.values()].includes(lease) && lease.read().context === current.contexts[i]);
    try {
      for (const lease of current.leases) {
        if (!valid()) throw new Error('O contexto da edição mudou. Cancele e tente novamente.');
        const editor = lease.read();
        if (!editor.dirty) continue;
        if (editor.kind === 'legacy') {
          if (operation !== 'leaveLegacy') throw new Error('Este editor só permite confirmar a saída sem garantia de gravação.');
          continue; // Consent belongs to this intent, never to editor state.
        }
        const result = await editor[operation === 'leaveLegacy' ? 'discard' : operation]?.();
        if (!valid() || result?.ok !== true || result.context !== editor.context || result.revision == null) {
          throw new Error('Não foi possível confirmar a operação. A edição continua protegida.');
        }
      }
      if (!valid() || activeEditors().some(lease => operation !== 'leaveLegacy' ||
          !current.leases.includes(lease) || lease.read().kind !== 'legacy')) {
        throw new Error('Há alterações posteriores. Confira e tente novamente.');
      }
      intent.current = null; setDecision(null); setBusy(false);
      current.leases.forEach(lease => lease.read().resume?.());
      bypass.current = true;
      try {
        if (current.location && blockerRef.current.state === 'blocked' && blockerRef.current.location === current.location) blockerRef.current.proceed();
        else if (current.continuar) current.continuar();
      } finally { bypass.current = false; }
    } catch (error) {
      if (intent.current === current) { current.busy = false; setBusy(false); setFailure(error.message); }
    } finally {
      if (operationRef.current === current) operationRef.current = null;
      if (intent.current && intent.current !== current) { intent.current.busy = false; setBusy(false); }
    }
  }
  useEffect(() => {
    const warn = event => { if (activeEditors().length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [activeEditors]);
  useLayoutEffect(() => {
    if (location.pathname === '/login') {
      editors.current.forEach(lease => lease.read().invalidate?.());
      editors.current.clear(); clearIntent(false);
    }
  }, [location.pathname, clearIntent]);
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
    editors.current.forEach(lease => lease.read().invalidate?.());
    editors.current.clear(); clearIntent(false);
    if (blockerRef.current.state === 'blocked') blockerRef.current.reset();
    history.current = { entries: [], index: -1 };
    guardarModoVisao("operacoes");
  }, [clearIntent]);
  return <WorkspaceNavigation.Provider value={{ goBack, navigate, location, modoVisao, setModoVisao, resetSession, registerEditor, confirmarSaida }}>
    {/* A estrutura precisa permanecer a mesma: inserir/remover este div desmontava a sessão,
        os hooks e as tarefas ao passar entre a carteira e uma empresa. Só a classe muda. */}
    <div className={companyRoute ? "company-workspace" : undefined} onClick={event => {
      if (oNavegadorAssumeCliqueNoWorkspace(event)) return;
      const link = event.target.closest?.('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin) return;
      event.preventDefault(); navigate(target.pathname + target.search + target.hash);
    }}>{children}</div>
    {decision && <Modal titulo="Alterações não salvas" tamanho="sm" ocupado={busy} aoFechar={cancel} rodape={<>
      <Button disabled={busy} variant="secondary" onClick={cancel}>Cancelar</Button>
      {decision.leases.some(lease => lease.read().kind === 'legacy') &&
        decision.leases.every(lease => lease.read().kind === 'legacy' || typeof lease.read().discard === 'function') &&
        <Button disabled={busy} variant="secondary" onClick={() => resolveDecision('leaveLegacy')}>Sair sem confirmação</Button>}
      {decision.leases.every(lease => lease.read().kind !== 'legacy' && typeof lease.read().discard === 'function') &&
        <Button disabled={busy} variant="secondary" onClick={() => resolveDecision('discard')}>Descartar e sair</Button>}
      {decision.leases.every(lease => lease.read().kind !== 'legacy' && typeof lease.read().save === 'function') &&
        <Button disabled={busy} onClick={() => resolveDecision('save')}>Guardar e sair</Button>}
    </>}>
      {busy ? <p role="status">{decision.operation === 'leaveLegacy' ? 'Confirmando esta saída; operações dos editores explícitos ainda precisam terminar.' : decision.operation === 'save'
        ? 'Guardando alterações. Aguarde a confirmação do salvamento.'
        : 'Aguardando a gravação já iniciada. Ela não pode ser cancelada; somente alterações ainda não enviadas serão descartadas.'}</p>
        : <p>{decision.leases.some(lease => lease.read().kind !== 'legacy' && typeof lease.read().discard !== 'function')
          ? 'Há alterações ou gravações pendentes. Volte ao editor para concluir ou conferir o salvamento antes de sair.'
          : 'Há alterações pendentes. Como deseja sair?'}</p>}
      {decision.leases.some(lease => lease.read().kind === 'legacy') && <p>
        Sair pode perder edições locais. Gravações já iniciadas podem continuar e não serão canceladas.
        Esta confirmação não comprova salvamento nem descarte nesses editores.
        {decision.leases.some(lease => lease.read().kind !== 'legacy') && ' Nos outros editores, o descarte local precisa ser confirmado antes de sair.'}
      </p>}
      {failure && <p role="alert">{failure}</p>}
    </Modal>}
  </WorkspaceNavigation.Provider>;
}
