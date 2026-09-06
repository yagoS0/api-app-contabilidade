import { useEffect, useState } from "react";
import { leituraDoResumo } from "../lib/resumoTela";

export function useResumoWhatsapp({ api, enabled = true }) {
  const [resumo, setResumo] = useState(null);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    let cancelado = false;
    let timer;
    let pendente = false;
    setResumo(null);
    setCarregando(true);
    if (!enabled || typeof api?.getResumoWhatsapp !== "function") {
      setCarregando(false);
      return undefined;
    }
    async function ciclo() {
      clearTimeout(timer);
      if (cancelado || pendente || document.visibilityState === "hidden") return;
      pendente = true;
      try {
        const r = await api.getResumoWhatsapp();
        if (!cancelado) setResumo(r?.ok === true ? r.resumo : null);
      } catch {
        if (!cancelado) setResumo(null);
      } finally {
        pendente = false;
        if (!cancelado) {
          setCarregando(false);
          if (document.visibilityState !== "hidden") timer = setTimeout(ciclo, 30000);
        }
      }
    }
    function visibilidade() { clearTimeout(timer); if (document.visibilityState !== "hidden") ciclo(); }
    document.addEventListener("visibilitychange", visibilidade);
    ciclo();
    return () => { cancelado = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visibilidade); };
  }, [api, enabled]);
  return { ...leituraDoResumo(resumo), carregando };
}
