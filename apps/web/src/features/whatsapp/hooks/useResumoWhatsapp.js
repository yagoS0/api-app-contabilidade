import { useEffect, useState } from "react";
import { leituraDoResumo } from "../lib/resumoTela";

export function useResumoWhatsapp({ api, enabled = true, area = '' }) {
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
        const r = await api.getResumoWhatsapp(...(area ? [{ area }] : []));
        if (!cancelado) setResumo(r?.ok === true ? r.resumo : null);
        if (area !== 'comercial' && api.getPendenciasSuporte && r?.ok) {
          try {
            const fila = await api.getPendenciasSuporte();
            if (!cancelado && fila?.ok) setResumo({ ...r.resumo, pendenciasSuporte: fila.total });
          } catch { /* A falha da fila não elimina a leitura dos não lidos. */ }
        }
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
  }, [api, enabled, area]);
  return { ...leituraDoResumo(resumo), carregando };
}
