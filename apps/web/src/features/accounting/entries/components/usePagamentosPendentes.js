import { useCallback, useEffect, useRef, useState } from 'react';
export function usePagamentosPendentes(api, companyId, competencia, revisao) {
  const contexto = companyId + ":" + competencia;
  const [estado, setEstado] = useState({ itens: [], loading: true, error: '' });
  const sequencia = useRef(0);
  const reload = useCallback(async () => {
    const pedido = ++sequencia.current;
    setEstado({ contexto, itens: [], loading: true, error: '' });
    try {
      const r = await api.getPagamentosPendentes(companyId, competencia);
      if (pedido === sequencia.current) setEstado({ contexto, itens: r.itens || [], loading: false, error: '' });
    } catch (e) {
      if (pedido === sequencia.current) setEstado({ contexto, itens: [], loading: false, error: e.message || 'Não foi possível carregar os pagamentos.' });
    }
  }, [api, companyId, competencia, contexto]);
  useEffect(() => { reload(); return () => { ++sequencia.current; }; }, [reload, revisao]);
  return { ...(estado.contexto === contexto ? estado : { itens: [], loading: true, error: "" }), reload };
}
