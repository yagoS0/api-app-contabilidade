// A lista/quadro do funil.
//
// Fichas em preenchimento incluem as que aguardam o cliente responder ao link.
// Elas ficam visíveis por padrão, com opção de recolher a seção.

import { useCallback, useEffect, useRef, useState } from "react";

export function useOnboardings({ api }) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [filtros, setFiltros] = useState({ origem: "", status: "", q: "", incluirRascunhos: true });
  const leitura = useRef(0);

  const carregar = useCallback(async (override = null) => {
    const alvo = override || filtros;
    const revisao = ++leitura.current;
    setCarregando(true);
    try {
      const r = await api.listarOnboardings({
        origem: alvo.origem || undefined,
        status: alvo.status || undefined,
        q: alvo.q || undefined,
        incluirRascunhos: alvo.incluirRascunhos || undefined,
      });
      if (revisao !== leitura.current) return;
      if (!Array.isArray(r?.itens)) throw new Error("Não foi possível ler os atendimentos.");
      setItens(Array.isArray(r?.itens) ? r.itens : []);
      setErro(null);
    } catch (e) {
      if (revisao !== leitura.current) return;
      setErro(e);
      setItens([]);
    } finally {
      if (revisao === leitura.current) setCarregando(false);
    }
  }, [api, filtros]);

  useEffect(() => { carregar(); return () => { leitura.current += 1; }; }, [carregar]);

  const alterarFiltro = useCallback((campo, valor) => {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  }, []);

  const descartar = useCallback(async (id) => {
    await api.descartarOnboarding(id);
    await carregar();
  }, [api, carregar]);

  return { itens, carregando, erro, filtros, alterarFiltro, recarregar: carregar, descartar };
}

export default useOnboardings;
