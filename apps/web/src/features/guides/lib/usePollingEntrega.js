import { useEffect, useRef, useState } from "react";
import { devePolir } from "./envioNaTela";

// Uma nova tentativa tem orçamento próprio; re-render e atualização do mesmo status não o renovam.
export function chaveDasTentativas(guias = []) {
  return JSON.stringify(guias.flatMap(g => (g.envio?.canais || []).filter(c => c.canal === "WHATSAPP")
    .map(c => [g.guideId || g.id, c.destino, c.tentativaId || c.providerMessageId || c.ultimaTentativaEm || c.enviadoEm || c.id, c.tentativaId ? null : c.status])).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function usePollingEntrega(guias, atualizar, escopo) {
  const atualizarRef = useRef(atualizar);
  atualizarRef.current = atualizar;
  const chave = `${escopo || ""}:${chaveDasTentativas(guias)}`;
  const [espera, setEspera] = useState({ chave: null, ciclos: 0 });
  const [visivel, setVisivel] = useState(() => document.visibilityState !== "hidden");
  const ciclos = espera.chave === chave ? espera.ciclos : 0;
  useEffect(() => {
    const mudou = () => setVisivel(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", mudou);
    return () => document.removeEventListener("visibilitychange", mudou);
  }, []);
  useEffect(() => {
    if (!visivel || !atualizarRef.current || !devePolir(guias, ciclos)) return undefined;
    let viva = true;
    const t = setTimeout(async () => {
      try { await atualizarRef.current(); } catch { /* A próxima tentativa continua no orçamento deste envio. */ }
      if (viva) setEspera({ chave, ciclos: ciclos + 1 });
    }, 2500);
    return () => { viva = false; clearTimeout(t); };
  }, [chave, ciclos, visivel]);
  return { esgotou: ciclos >= 24 && devePolir(guias, 0), ciclos };
}
