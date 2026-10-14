import { useEffect, useState } from "react";
import { leituraDoResumo } from "../lib/resumoTela";
import { LEITURA_WHATSAPP_CONFIRMADA, DEMANDA_SUPORTE_ATUALIZADA } from "../lib/leituraConfirmada";

export function useResumoWhatsapp({ api, enabled = true, area = '' }) {
  const [resumo, setResumo] = useState(null);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    let cancelado = false;
    let timer;
    let pendente = false;
    let revisao = 0;
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
      const revisaoInicio = revisao;
      const atual = () => !cancelado && revisaoInicio === revisao;
      try {
        const r = await api.getResumoWhatsapp(...(area ? [{ area }] : []));
        if (atual()) setResumo(r?.ok === true ? r.resumo : null);
        if (atual() && area !== 'comercial' && api.getPendenciasSuporte && r?.ok) {
          try {
            const fila = await api.getPendenciasSuporte();
            if (atual() && fila?.ok) setResumo({ ...r.resumo, pendenciasSuporte: fila.total });
          } catch { /* A falha da fila não elimina a leitura dos não lidos. */ }
        }
      } catch {
        if (atual()) setResumo(null);
      } finally {
        pendente = false;
        if (!cancelado) {
          setCarregando(false);
          if (document.visibilityState !== "hidden") {
            if (revisaoInicio !== revisao) ciclo();
            else timer = setTimeout(ciclo, 30000);
          }
        }
      }
    }
    function visibilidade() { clearTimeout(timer); if (document.visibilityState !== "hidden") ciclo(); }
    function leituraConfirmada() { revisao++; ciclo(); }
    document.addEventListener("visibilitychange", visibilidade);
    window.addEventListener(LEITURA_WHATSAPP_CONFIRMADA, leituraConfirmada);
    window.addEventListener(DEMANDA_SUPORTE_ATUALIZADA, leituraConfirmada);
    ciclo();
    return () => { cancelado = true; clearTimeout(timer); document.removeEventListener("visibilitychange", visibilidade); window.removeEventListener(LEITURA_WHATSAPP_CONFIRMADA, leituraConfirmada); window.removeEventListener(DEMANDA_SUPORTE_ATUALIZADA, leituraConfirmada); };
  }, [api, enabled, area]);
  return { ...leituraDoResumo(resumo), carregando };
}
