import { useEffect, useRef, useState } from "react";
import { createApiClient } from "../../../../api/client";
import { Button } from "../../../../components/ui/Button";
import { fmtMoney } from "../../../../lib/format";

const api = createApiClient();

export function GuiasPendentesContabilizacao({ companyId, competencia, fechado, aoContabilizar, apiClient = api }) {
  const [itens, setItens] = useState([]);
  const [erro, setErro] = useState("");
  const [ocupada, setOcupada] = useState(null);
  const contexto = `${companyId}:${competencia}`;
  const atual = useRef(contexto);
  atual.current = contexto;
  useEffect(() => { atual.current = contexto; return () => { atual.current = null; }; }, [contexto]);
  useEffect(() => {
    let vivo = true;
    setItens([]); setErro(""); setOcupada(null);
    if (!apiClient.getGuiasPendentesContabilizacao) return;
    apiClient.getGuiasPendentesContabilizacao(companyId, competencia)
      .then(r => { if (vivo) setItens(r?.itens || []); })
      .catch(() => { if (vivo) setErro("Não foi possível consultar as guias pendentes de contabilização."); });
    return () => { vivo = false; };
  }, [companyId, competencia, fechado, apiClient]);

  async function contabilizar(guia) {
    if (ocupada || fechado) return;
    setOcupada(guia.id); setErro("");
    try {
      await apiClient.contabilizarGuiaPendente(companyId, guia.id, guia.updatedAt);
      if (atual.current !== contexto) return;
      setItens(lista => lista.filter(item => item.id !== guia.id));
      try { await aoContabilizar?.(); }
      catch { if (atual.current === contexto) setErro("Guia contabilizada. Atualize os lançamentos para visualizar o resultado."); }
    } catch (e) {
      if (atual.current === contexto) setErro(e?.message || "Não foi possível contabilizar a guia. Atualize a lista antes de tentar novamente.");
    } finally { if (atual.current === contexto) setOcupada(null); }
  }

  if (!itens.length && !erro) return null;
  return <section aria-label="Guias pendentes de contabilização" style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 8, overflowWrap: "anywhere", fontSize: "0.8125rem" }}>
    {itens.length > 0 && <>
      <strong style={{ fontWeight: 600 }}>Guia{itens.length > 1 ? "s" : ""} pendente{itens.length > 1 ? "s" : ""} de contabilização · {itens.length}</strong>
      <p className="hint">{fechado ? "PDF salvo. Reabra o mês para contabilizar a guia." : "PDF salvo. Gere as provisões e confira os lançamentos."}</p>
      <ul style={{ paddingLeft: 18, margin: 0 }}>{itens.map(guia => <li key={guia.id} style={{ marginTop: 8 }}>
        <span>{guia.tipo} · {fmtMoney(guia.valor)}</span>
        {!fechado && <div style={{ marginTop: 6 }}><Button type="button" variant="secondary" disabled={Boolean(ocupada)} onClick={() => contabilizar(guia)}>{ocupada === guia.id ? "Contabilizando…" : "Contabilizar guia"}</Button></div>}
      </li>)}</ul>
    </>}
    {erro && <p role="alert">{erro}</p>}
  </section>;
}
