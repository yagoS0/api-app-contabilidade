import { useCallback, useEffect, useRef, useState } from 'react';

export function usePendenciasManuais({ api, companyId }) {
  const contexto = useRef({ api, companyId });
  if (contexto.current.api !== api || contexto.current.companyId !== companyId) contexto.current = { api, companyId };
  const [estado, setEstado] = useState({ contexto: null, itens: [], loading: false, error: null });
  const leitura = useRef(0);
  const ocupado = useRef(false);
  const disponivel = Boolean(companyId && api?.listPendenciasManuais);
  const reload = useCallback(async () => {
    if (!companyId || !api?.listPendenciasManuais) return;
    const origem = contexto.current, pedido = ++leitura.current;
    setEstado(s => ({ contexto: origem, itens: s.contexto === origem ? s.itens : [], loading: true, error: null }));
    try {
      const res = await api.listPendenciasManuais(companyId);
      if (contexto.current === origem && leitura.current === pedido) setEstado({ contexto: origem, itens: res.itens, loading: false, error: null });
    } catch (e) {
      if (contexto.current === origem && leitura.current === pedido) setEstado(s => ({ ...s, loading: false, error: e.reason || e.message }));
    }
  }, [api, companyId]);
  useEffect(() => { reload(); }, [reload]);
  async function alterar(metodo, payload) {
    if (!disponivel || ocupado.current) throw new Error('Aguarde e tente novamente.');
    const origem = contexto.current;
    ocupado.current = true;
    ++leitura.current;
    try {
      const res = await api[metodo](companyId, payload);
      if (contexto.current !== origem) return;
      setEstado(s => ({ contexto: origem, loading: false, error: null, itens: metodo === 'deletePendenciaManual'
        ? s.itens.filter(i => i.id !== payload.id)
        : [...s.itens.filter(i => i.id !== res.item.id), res.item] }));
    } finally { ocupado.current = false; }
  }
  const atual = estado.contexto === contexto.current ? estado : { itens: [], loading: disponivel, error: null };
  return { ...atual, disponivel, reload,
    salvar: payload => alterar('savePendenciaManual', payload), excluir: payload => alterar('deletePendenciaManual', payload) };
}
