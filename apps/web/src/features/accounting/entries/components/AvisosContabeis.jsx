import { motivoDaBaixaPendente } from "../../circular/lib/procedenciaDoPagamento";
import { useEffect, useRef, useState } from "react";
import { useAvisosContabeis } from "../../hooks/useAvisosContabeis";
import { createApiClient } from "../../../../api/client";
import { Button } from "../../../../components/ui/Button";
const api = createApiClient();
const data = v => v ? new Date(v).toLocaleString("pt-BR") : "Data não informada";
function Snapshot({ valor }) {
  if (!valor) return <p>Sem registro anterior.</p>;
  const itens = Array.isArray(valor.entries) ? valor.entries : valor.lines ? [valor] : [];
  if (!itens.length) return <p>{valor.circular?.fechadoContabilEm ? `Mês fechado em ${data(valor.circular.fechadoContabilEm)}` : "Nenhum lançamento neste registro."}</p>;
  return <ul style={{ paddingLeft: 18 }}>{itens.map((e, i) => <li key={e.id || i} style={{ marginBlock: 8 }}><strong>{e.historico || e.descricao || "Lançamento"}</strong><div>{e.competencia || ""} {e.data ? ` · ${data(e.data)}` : ""}</div>{(e.lines || []).map((l, j) => <div key={l.id || j}>{l.tipo === "D" ? "Débito" : l.tipo === "C" ? "Crédito" : "Movimento"} · Conta {l.conta || "não informada"} · {l.valor == null ? "Valor não informado" : Number(l.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div>)}</li>)}</ul>;
}
function Historico({ item }) {
  return <details style={{ overflowWrap: "anywhere", marginTop: 6 }}><summary>Ver histórico · {item.competencia || item.competenciaPagamento || "pagamento"}</summary>
    <p>{item.origem === "CLIENTE" ? motivoDaBaixaPendente(item.motivo) : item.motivo || "Registro contábil"} · {data(item.em || item.confirmadoEm)}</p>
    <p>Autor: {typeof item.autor === "string" ? item.autor : item.autor?.nome || (item.autor?.id ? "Contador responsável" : item.origem || "Não informado")}</p>
    {item.antes && <details><summary>Antes da correção</summary><Snapshot valor={item.antes} /></details>}
    {item.depois && <details><summary>Após a correção</summary><Snapshot valor={item.depois} /></details>}
    {(item.alteracoes || []).map((a, i) => <details key={a.id || i}><summary>{!a.antes ? "Incluído" : !a.depois ? "Excluído" : "Alterado"} · {a.depois?.historico || a.antes?.historico || `Lançamento ${i + 1}`}</summary><strong>Antes</strong><Snapshot valor={a.antes} /><strong>Depois</strong><Snapshot valor={a.depois} /></details>)}
  </details>;
}
export function AvisosContabeis({ companyId, competencia, myRole, aoConcluirBaixa }) {
  const { dados, erro, carregando, atualizar } = useAvisosContabeis(companyId, competencia);
  const [ocupado, setOcupado] = useState(null);
  const [falha, setFalha] = useState(null);
  const contexto = useRef(null);
  useEffect(() => { const token = {}; contexto.current = token; setOcupado(null); setFalha(null); return () => { if (contexto.current === token) contexto.current = null; }; }, [companyId, competencia]);
  async function retomar(id) {
    if (ocupado || !["ACCOUNTANT", "FIRM_ADMIN"].includes(myRole)) return;
    const token = contexto.current; setOcupado(id); setFalha(null);
    try {
      const r = await api.retomarBaixaCliente(companyId, id);
      if (contexto.current !== token) return;
      if (r?.ok !== true || !r.confirmacao?.estadoBaixa) throw Error("A baixa não foi confirmada. Atualize os avisos para conferir o resultado.");
      if (r.confirmacao.estadoBaixa !== "CONCLUIDA") setFalha(motivoDaBaixaPendente(r.confirmacao.motivo));
      window.dispatchEvent(new Event("altan:avisos-contabeis"));
      if (r.confirmacao.estadoBaixa === "CONCLUIDA") await aoConcluirBaixa?.();
    } catch (e) { if (contexto.current === token) setFalha(e.message || "Não foi possível retomar a baixa."); }
    finally { if (contexto.current === token) setOcupado(null); }
  }
  if (carregando && !dados) return <small role="status">Consultando avisos contábeis…</small>;
  if (erro && !dados) return <div role="alert">Avisos indisponíveis. <Button size="sm" onClick={atualizar}>Tentar novamente</Button></div>;
  if (!dados || (!dados.total && !dados.historico.length && !erro && !carregando)) return null;
  return <section aria-label="Avisos contábeis" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 10, minWidth: 0, fontSize: "0.8125rem", color: "var(--text)" }}>
    {erro && <p role="alert">Não foi possível atualizar. Exibindo a última consulta. <Button size="sm" onClick={atualizar}>Atualizar avisos</Button></p>}
    {carregando && <small role="status">Atualizando…</small>}
    <strong style={{ color: dados.total ? "var(--state-warn)" : "var(--text-muted)" }}>{dados.total} {dados.total === 1 ? "aviso contábil" : "avisos contábeis"}</strong>
    {dados.correcoes.map(c => <div key={c.id}><p>⚠ {c.competencia} · Correção aguardando nova conferência. Confira os lançamentos e conclua o fechamento do mês.</p><Historico item={c} /></div>)}
    {dados.pagamentos.map(p => <div key={p.id}><p>⚠ {p.documento?.tipo === "SIMPLES" ? "DAS" : p.documento?.tipo || "Guia"} · pagamento em {p.competenciaPagamento || "mês não informado"} · Confirmado pelo cliente · baixa pendente.</p><p>{motivoDaBaixaPendente(p.motivo)}</p><small>O registro comprova a declaração do cliente, não o pagamento bancário.</small><Historico item={p} />{["ACCOUNTANT", "FIRM_ADMIN"].includes(myRole) && <Button size="sm" disabled={Boolean(ocupado)} onClick={() => retomar(p.id)}>{ocupado === p.id ? "Retomando…" : "Retomar baixa"}</Button>}</div>)}
    {falha && <p role="alert">{falha}</p>}
    {dados.historico.length > 0 && <details><summary>Histórico de correções e confirmações ({dados.historico.length})</summary>{dados.historico.map((h, i) => <Historico key={h.id || i} item={h} />)}</details>}
  </section>;
}
