import { useEffect, useRef, useState } from "react";
import { createApiClient } from "../../../../api/client";
import { Button } from "../../../../components/ui/Button";
import { fmtMoney } from "../../../../lib/format";

const api = createApiClient();

export function GuiasPendentesContabilizacao({ companyId, competencia, myRole, fechado, aoContabilizar, apiClient = api }) {
  const [itens, setItens] = useState([]);
  const [erro, setErro] = useState("");
  const [ocupada, setOcupada] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [releitura, setReleitura] = useState(0);
  const [aviso, setAviso] = useState("");
  const resultadoRef = useRef(null), secaoRef = useRef(null), devolverFoco = useRef(false);
  useEffect(() => { if (aviso && devolverFoco.current) resultadoRef.current?.focus(); devolverFoco.current = false; }, [aviso]);
  const podeContabilizar = ['ACCOUNTANT', 'FIRM_ADMIN'].includes(String(myRole || '').toUpperCase());
  const permissaoAtual = useRef(podeContabilizar);
  permissaoAtual.current = podeContabilizar;
  const contexto = `${companyId}:${competencia}`;
  const atual = useRef(contexto);
  atual.current = contexto;
  useEffect(() => { atual.current = contexto; setAviso(""); return () => { atual.current = null; }; }, [contexto]);
  useEffect(() => {
    let vivo = true;
    setItens([]); setErro(""); setOcupada(null); setCarregando(true);
    if (!apiClient.getGuiasPendentesContabilizacao) { setCarregando(false); return; }
    apiClient.getGuiasPendentesContabilizacao(companyId, competencia)
      .then(r => { if (vivo) setItens(r?.itens || []); })
      .catch(() => { if (vivo) setErro("Não foi possível consultar as guias pendentes de contabilização."); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [companyId, competencia, fechado, apiClient, releitura]);

  async function contabilizar(guia) {
    if (ocupada || fechado || !permissaoAtual.current) return;
    setOcupada(guia.id); setErro(""); setAviso("");
    try {
      await apiClient.contabilizarGuiaPendente(companyId, guia.id, guia.updatedAt);
      if (atual.current !== contexto) return;
      devolverFoco.current = Boolean(secaoRef.current?.contains(document.activeElement));
      setItens(lista => lista.filter(item => item.id !== guia.id));
      setAviso("Guia contabilizada.");
      try { await aoContabilizar?.(); }
      catch { if (atual.current === contexto) setErro("Guia contabilizada. Atualize os lançamentos para visualizar o resultado."); }
    } catch (e) {
      if (atual.current === contexto) setErro(e?.message || "Não foi possível contabilizar a guia. Atualize a lista antes de tentar novamente.");
    } finally { if (atual.current === contexto) setOcupada(null); }
  }

  if (!itens.length && !erro && !carregando && !aviso && !releitura) return null;
  return <section ref={secaoRef} aria-label="Guias pendentes de contabilização" style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 8, overflowWrap: "anywhere", fontSize: "0.8125rem" }}>
    {carregando && <p role="status">Carregando guias pendentes de contabilização…</p>}
    {aviso && <p ref={resultadoRef} tabIndex={-1} role="status">{aviso}</p>}
    {!carregando && !itens.length && !erro && releitura > 0 && <p>Nenhuma guia pendente nesta competência.</p>}
    {itens.length > 0 && <>
      <strong style={{ fontWeight: 600 }}>Guia{itens.length > 1 ? "s" : ""} pendente{itens.length > 1 ? "s" : ""} de contabilização · {itens.length}</strong>
      <p className="hint">{fechado ? "PDF salvo. Reabra o mês para contabilizar a guia." : "PDF salvo. Gere as provisões e confira os lançamentos."}</p>
      {!podeContabilizar && <p className="hint">Seu acesso permite apenas consultar estas guias.</p>}
      <ul style={{ paddingLeft: 18, margin: 0 }}>{itens.map(guia => <li key={guia.id} style={{ marginTop: 8 }}>
        <span>{guia.tipo} · {fmtMoney(guia.valor)}</span>
        {!fechado && podeContabilizar && <div style={{ marginTop: 6 }}><Button type="button" variant="secondary" disabled={Boolean(ocupada)} onClick={() => contabilizar(guia)}>{ocupada === guia.id ? "Contabilizando…" : "Contabilizar guia"}</Button></div>}
      </li>)}</ul>
    </>}
    {erro && <p role="alert">{erro}</p>}
    <Button type="button" variant="secondary" style={{ marginTop: 12 }} disabled={carregando || Boolean(ocupada)} onClick={() => setReleitura(v => v + 1)}>Atualizar guias pendentes</Button>
  </section>;
}
