import { createContext, useContext, useEffect, useId } from 'react';

export const ContextoEdicao = createContext(null);

export function useEdicaoPendente(pendente) {
  const contexto = useContext(ContextoEdicao);
  const id = useId();
  const registrar = contexto?.registrar;
  useEffect(() => {
    registrar?.(id, Boolean(pendente));
    return () => registrar?.(id, false);
  }, [registrar, id, pendente]);
}

export function useConfirmarSaida() {
  return useContext(ContextoEdicao)?.confirmarSaida || ((continuar) => continuar());
}
