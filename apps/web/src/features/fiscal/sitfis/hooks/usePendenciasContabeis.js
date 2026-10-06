import { useCallback, useEffect, useRef, useState } from 'react';
export function usePendenciasContabeis({ api, companyId }) {
  const contexto = useRef({ api, companyId });
  if (contexto.current.api !== api || contexto.current.companyId !== companyId) contexto.current = { api, companyId };
  const [estado, setEstado] = useState({ contexto: null, itens: [], loading: false, error: null });
  const sequencia = useRef(0);
  const disponivel = Boolean(companyId && api?.listPendenciasContabeis);
  const reload = useCallback(async () => {
    if (!companyId || !api?.listPendenciasContabeis) return;
    const origem = contexto.current, pedido = ++sequencia.current;
    setEstado({ contexto: origem, itens: [], loading: true, error: null });
    try {
      const r = await api.listPendenciasContabeis(companyId);
      if (origem === contexto.current && pedido === sequencia.current) setEstado({ contexto: origem, itens: r.itens, loading: false, error: null });
    } catch (e) {
      if (origem === contexto.current && pedido === sequencia.current) setEstado({ contexto: origem, itens: [], loading: false, error: e.message || 'Falha ao ler pendências da contabilidade.' });
    }
  }, [api, companyId]);
  useEffect(() => { reload(); return () => { ++sequencia.current; }; }, [reload]);
  return { ...(estado.contexto === contexto.current ? estado : { itens: [], loading: disponivel, error: null }), disponivel, reload };
}
