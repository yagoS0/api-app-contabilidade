import { useCallback, useEffect, useRef, useState } from 'react';
export function usePagamentosPendentes(api, companyId, competencia, revisao) {
  const contexto = companyId + ":" + competencia;
  const [estado, setEstado] = useState({ itens: [], loading: true, error: '' });
  const sequencia = useRef(0);
  const reload = useCallback(async () => {
    const pedido = ++sequencia.current;
    setEstado(anterior => ({ contexto, itens: anterior.contexto === contexto ? anterior.itens : [], loading: true, error: '', anterior: anterior.contexto === contexto && anterior.itens.length > 0 }));
    try {
      const r = await api.getPagamentosPendentes(companyId, competencia);
      if (r?.ok === false || !Array.isArray(r?.itens)) throw new Error('Não foi possível confirmar a lista de pagamentos.');
      if (pedido === sequencia.current) setEstado({ contexto, itens: r.itens || [], loading: false, error: '' });
    } catch (e) {
      if (pedido === sequencia.current) setEstado(anterior => ({ contexto, itens: anterior.contexto === contexto ? anterior.itens : [], loading: false, anterior: true, error: e.message || 'Não foi possível carregar os pagamentos.' }));
    }
  }, [api, companyId, competencia, contexto]);
  useEffect(() => { const contador = sequencia; reload(); return () => { ++contador.current; }; }, [reload, revisao]);
  return { ...(estado.contexto === contexto ? estado : { itens: [], loading: true, error: "" }), reload };
}
