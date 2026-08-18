import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { assinarSessao, lerSessao } from "../api/sessionStore";

/** A sessão como estado de React, sem duplicar a fonte da verdade. */
export function useSessao() {
  return useSyncExternalStore(assinarSessao, lerSessao, lerSessao);
}

/**
 * Carregamento assíncrono com cancelamento.
 *
 * ⚠ O `descartado` não é cosmético: ao trocar de empresa, a requisição da
 * empresa ANTERIOR pode responder depois da nova. Sem a guarda, a tela mostraria
 * os números de uma empresa sob o nome de outra — que é o pior desfecho possível
 * num portal multi-empresa.
 *
 * `deps` segue a mesma regra do useEffect: mudou, recarrega.
 */
export function useCarregamento(fn, deps, { habilitado = true } = {}) {
  const [estado, setEstado] = useState({ dados: null, carregando: habilitado, erro: null });
  const [gatilho, setGatilho] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!habilitado) {
      setEstado({ dados: null, carregando: false, erro: null });
      return undefined;
    }
    let descartado = false;
    setEstado((anterior) => ({ ...anterior, carregando: true, erro: null }));
    Promise.resolve()
      .then(() => fnRef.current())
      .then((dados) => {
        if (!descartado) setEstado({ dados, carregando: false, erro: null });
      })
      .catch((erro) => {
        if (!descartado) setEstado({ dados: null, carregando: false, erro });
      });
    return () => {
      descartado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habilitado, gatilho, ...deps]);

  const recarregar = useCallback(() => setGatilho((n) => n + 1), []);
  return { ...estado, recarregar };
}

const ROTAS = ["home", "notas", "emitir", "guias"];
const ROTA_PADRAO = "home";

function rotaDaUrl() {
  const bruta = String(window.location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return ROTAS.includes(bruta) ? bruta : ROTA_PADRAO;
}

/**
 * Roteamento por hash — 20 linhas em vez de uma dependência.
 * Serve ao que o cliente espera do navegador: botão Voltar e link colável.
 */
export function useRota() {
  const [rota, setRota] = useState(rotaDaUrl);

  useEffect(() => {
    const aoMudar = () => setRota(rotaDaUrl());
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  const navegar = useCallback((destino) => {
    const alvo = ROTAS.includes(destino) ? destino : ROTA_PADRAO;
    window.location.hash = `#/${alvo}`;
  }, []);

  return { rota, navegar };
}
