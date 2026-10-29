import { useWorkspaceEditor, useWorkspaceNavigation } from '../../app/navigation/WorkspaceNavigation.shared';
import { createContext, useContext, useEffect, useId, useRef } from 'react';

export const ContextoEdicao = createContext(null);

export function useEdicaoPendente(pendente) {
  const local = useRef({ dirty: Boolean(pendente) });
  // Changing the observable boolean replaces the lease; no remote state is inferred.
  if (local.current.dirty !== Boolean(pendente)) local.current = { dirty: Boolean(pendente) };
  const context = local.current;
  const workspace = useWorkspaceEditor({ context, kind: 'legacy',
    get dirty() { return context.dirty; },
  });
  const contexto = useContext(ContextoEdicao);
  const id = useId();
  const registrar = workspace ? null : contexto?.registrar;
  useEffect(() => {
    registrar?.(id, Boolean(pendente));
    return () => registrar?.(id, false);
  }, [registrar, id, pendente]);
}

export function useConfirmarSaida() {
  const workspace = useWorkspaceNavigation();
  const local = useContext(ContextoEdicao);
  return workspace?.confirmarSaida || local?.confirmarSaida || ((continuar) => continuar());
}
