import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import { MODALIDADES, FORMAS_PAGAMENTO } from "../lib/wizardParcelamento";
import { fmtDataCivil } from "../../../../lib/format";
import { ConferirDocumentoParcela } from "./ConferirDocumentoParcela";

const field = { width: "100%", padding: 9, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)" };
const row = { padding: "12px 0", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const money = (n) => n == null || n === "" ? "Valor não informado" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = (v) => v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toLocaleString("pt-BR") : "Ainda não consultado";
const labels = { IDENTIFICAR: "Identificação pendente", CONFERIR_PARCELA: "Conferência pendente", CONFERIR_DOCUMENTO: "Documento a conferir", CONSULTA_FALHOU: "Consulta não concluída", OBTER_GUIA: "Guia pendente", ENVIAR: "Pronta para enviar", CONSULTAR_PAGAMENTO: "Pagamento a confirmar", CONTABILIZAR: "Pagamento confirmado · falta contabilizar", DIVERGENCIA: "Conferir divergência", RESOLVIDA: "Concluída" };

export function filtrarAcompanhamento(itens, filtro, mes) {
  return (itens || []).filter((i) => filtro === "todos" || (filtro === "anteriores" ? i.anterior : filtro === "mes" ? (i.vencimento?.slice(0, 7) || i.referencia) === mes || (!i.referencia && !i.vencimento) : i.estado !== "RESOLVIDA"));
}

function CadastroFiscal({ api, companyId, contrato = null, onClose, onSaved }) {
  const [form, setForm] = useState({ tipo: contrato?.tipo || "PARCSN", numeroParcelamento: contrato?.numeroParcelamento || "", label: contrato?.label || "", formaPagamento: contrato?.formaPagamento || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function salvar(e) {
    e?.preventDefault();
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (!form.numeroParcelamento.trim()) throw new Error("Informe o número do parcelamento.");
      if (contrato) await api.editarAcompanhamentoParcelamento(companyId, contrato.id, { label: form.label, formaPagamento: form.formaPagamento || null });
      else await api.criarAcompanhamentoParcelamento(companyId, form);
      await onSaved(); onClose();
    } catch (err) { setError(err.message || "Não foi possível cadastrar o acompanhamento."); }
    finally { setBusy(false); }
  }
  return <Modal titulo={contrato ? "Editar acompanhamento" : "Acompanhar parcelamento"} aoFechar={onClose} ocupado={busy} tamanho="md" rodape={<><Button variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button><Button disabled={busy} onClick={salvar}>{busy ? "Salvando…" : contrato ? "Salvar acompanhamento" : "Iniciar acompanhamento"}</Button></>}>
    <p style={{ color: "var(--text-muted)", marginTop: 0 }}>Cadastre um acordo já existente. Isso não faz uma adesão na Receita nem cria lançamentos contábeis.</p>
    <form onSubmit={salvar} style={{ display: "grid", gap: 12 }}>
      <label>Modalidade<select style={field} disabled={Boolean(contrato)} value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>{MODALIDADES.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
      <label>Número do parcelamento<input style={field} disabled={Boolean(contrato)} value={form.numeroParcelamento} onChange={e => setForm({ ...form, numeroParcelamento: e.target.value })} /></label>
      <label>Descrição (opcional)<input style={field} value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></label>
      <label>Forma de pagamento<select style={field} value={form.formaPagamento} onChange={e => setForm({ ...form, formaPagamento: e.target.value })}>{FORMAS_PAGAMENTO.map(([v, text]) => <option key={v} value={v}>{text}</option>)}</select></label>
    </form>
    {error && <p role="alert" style={{ color: "var(--state-danger)" }}>{error}</p>}
  </Modal>;
}

function ResolverIndicacao({ indicacao, contratos, api, companyId, onClose, onSaved }) {
  const [contrato, setContrato] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function salvar() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      if (motivo.trim().length < 5) throw new Error("Explique o resultado da conferência (ao menos 5 caracteres).");
      await api.resolverIndicacaoParcelamento(companyId, indicacao.id, { status: contrato ? "VINCULADO" : "DESCARTADO", parcelamentoId: contrato || undefined, motivo: motivo.trim() });
      await onSaved(); onClose();
    } catch (err) { setError(err.message || "Não foi possível registrar a conferência."); }
    finally { setBusy(false); }
  }
  return <Modal titulo="Conferir indicação de parcelamento" aoFechar={onClose} ocupado={busy} tamanho="md" rodape={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={salvar} disabled={busy}>{busy ? "Salvando…" : "Registrar conferência"}</Button></>}>
    <p>{indicacao.descricao || "Indicação encontrada no relatório fiscal."}</p>
    <label>Resultado<select style={field} value={contrato} onChange={e => setContrato(e.target.value)}><option value="">Descartar indicação após conferência</option>{contratos.map(c => <option key={c.id} value={c.id}>Vincular: {c.tipo} nº {c.numeroParcelamento}</option>)}</select></label>
    <label style={{ display: "block", marginTop: 12 }}>Motivo<textarea style={field} value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} /></label>
    <p style={{ color: "var(--text-muted)" }}>A decisão fica no histórico. Descartar a indicação não rescinde nenhum acordo na Receita.</p>
    {error && <p role="alert" style={{ color: "var(--state-danger)" }}>{error}</p>}
  </Modal>;
}

export function AcompanhamentoParcelamentos(props) {
  return <AcompanhamentoFiscal key={props.companyId || "sem-empresa"} {...props} />;
}

function AcompanhamentoFiscal({ companyId, api, refreshKey = 0, onAtualizado, onContabilizar, onDarBaixa, onIrParaGuias }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState("");
  const [filtro, setFiltro] = useState("pendentes");
  const [cadastro, setCadastro] = useState(false);
  const [resolver, setResolver] = useState(null);
  const [conferirDocumento, setConferirDocumento] = useState(null);
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const available = typeof api?.getAcompanhamentoParcelamentos === "function";
  const load = useCallback(async () => {
    if (!available || !companyId || !mounted.current) return;
    const version = ++request.current;
    setLoading(true); setError("");
    try {
      const out = await api.getAcompanhamentoParcelamentos(companyId);
      if (version !== request.current) return;
      if (!Array.isArray(out?.itens) || !Array.isArray(out?.contratos)) throw new Error("A resposta do acompanhamento não pôde ser lida.");
      setData(out);
    } catch (err) { if (version === request.current) setError(err.message || "Não foi possível carregar o acompanhamento."); }
    finally { if (version === request.current) setLoading(false); }
  }, [api, available, companyId]);
  useEffect(() => { load(); return () => { request.current += 1; }; }, [load, refreshKey]);
  async function agir(key, fn, sucesso) {
    if (busy) return;
    setBusy(key); setError(""); setResult("");
    try {
      const out = await fn();
      if (!mounted.current) return;
      const falhas = (out?.parcelas || out?.resultados || []).filter(p => p.status === "erro" || p.ok === false);
      await load(); if (!mounted.current) return; await onAtualizado?.();
      if (out?.skipped === "already_paid" || out?.reason === "already_paid") { setResult("Pagamento já confirmado. Acompanhamento atualizado."); return; }
      if (out?.proximaConsultaEm) { setResult(out.message || `Nova consulta disponível em ${dateTime(out.proximaConsultaEm)}.`); return; }
      if (out?.ok === false || out?.skipped) throw new Error(out.message || out.reason || out.motivo || "A operação não foi concluída.");
      if (falhas.length) setError(`${falhas.length} consulta(s) não foram concluídas. ${falhas[0].message || falhas[0].reason || "Confira os detalhes do contrato."}`);
      else setResult(out?.message || sucesso);
    } catch (err) { if (mounted.current) setError(err.message || "Não foi possível concluir a operação."); }
    finally { if (mounted.current) setBusy(""); }
  }
  if (!available) return null;
  const contratos = data?.contratos || [];
  const indicacoes = data?.indicacoes || [];
  const itens = filtrarAcompanhamento(data?.itens, filtro, data?.mesOperacional);
  const localizar = () => agir("localizar", () => api.localizarParcelamentos(companyId, { modalidades: ["PARCSN", "PARCMEI"] }), "Consulta concluída. Confira os acordos e as pendências abaixo.");
  const saved = async () => { if (!mounted.current) return; await load(); if (!mounted.current) return; await onAtualizado?.(); setResult("Acompanhamento atualizado."); };
  function action(item) {
    if (item.estado === "IDENTIFICAR") return <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={localizar}>Localizar acordos</Button>;
    if (["CONFERIR_PARCELA", "OBTER_GUIA"].includes(item.estado)) {
      const supported = ["PARCSN", "PARCMEI"].includes(item.tipo);
      return supported ? <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => agir(item.id, () => api.capturarContratoParcelamento(companyId, item.parcelamentoId), "Consulta de parcelas concluída.")}>{busy === item.id ? "Consultando…" : item.estado === "OBTER_GUIA" ? "Obter guia" : "Conferir parcelas"}</Button> : <Button size="sm" variant="secondary" onClick={() => onIrParaGuias?.(item)}>Importar guia</Button>;
    }
    if (item.estado === "ENVIAR") return <Button size="sm" variant="secondary" onClick={() => onIrParaGuias?.(item)}>Ver guia e enviar</Button>;
    if (item.estado === "CONFERIR_DOCUMENTO") return <Button size="sm" variant="secondary" onClick={() => setConferirDocumento(item)}>Conferir documento</Button>;
    if (["CONSULTAR_PAGAMENTO", "CONSULTA_FALHOU"].includes(item.estado) && item.parcelaId) return <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => agir(item.id, () => api.consultarPagamentoParcela(companyId, item.parcelaId), "Consulta concluída. Confira a situação do pagamento.")}>{busy === item.id ? "Consultando…" : "Consultar pagamento"}</Button>;
    if (item.estado === "DIVERGENCIA") return <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button size="sm" variant="secondary" onClick={e => { const d = e.currentTarget.closest("article")?.querySelector("details"); if (d) { d.open = true; d.querySelector("summary")?.focus(); } }}>Conferir divergência</Button>{item.guideId && <Button size="sm" variant="secondary" onClick={() => onIrParaGuias?.(item)}>Ver guia</Button>}{item.parcelaId && <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => agir(item.id, () => api.consultarPagamentoParcela(companyId, item.parcelaId), "Pagamento consultado novamente.")}>Consultar novamente</Button>}</div>;
    if (item.estado === "CONTABILIZAR") {
      const contrato = contratos.find(c => c.id === item.parcelamentoId);
      return <Button size="sm" variant="secondary" onClick={() => contrato?.aberturaEntryId ? onDarBaixa?.(contrato) : onContabilizar?.(contrato)}>Contabilizar pagamento</Button>;
    }
    return null;
  }
  return <section aria-label="Acompanhamento fiscal dos parcelamentos" style={{ color: "var(--text)", minWidth: 0 }}>
    <div style={{ ...row, borderBottom: 0, paddingTop: 0 }}>
      <h2 style={{ fontSize: "1rem", margin: 0 }}>Atenção {data ? `(${data.resumo?.pendentes || 0})` : ""}</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => setCadastro(true)}>Acompanhar acordo</Button><Button variant="secondary" size="sm" disabled={Boolean(busy)} onClick={localizar}>{busy === "localizar" ? "Localizando…" : "Localizar na Receita"}</Button></div>
    </div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {[["pendentes", "Pendências"], ["mes", "Do mês"], ["anteriores", "Anteriores"], ["todos", "Todos"]].map(([v, text]) => <Button key={v} size="sm" variant={filtro === v ? "primary" : "secondary"} aria-pressed={filtro === v} onClick={() => setFiltro(v)}>{text}</Button>)}
      <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => agir("relatorio", () => api.reprocessarIndiciosParcelamento(companyId), "Relatório salvo conferido.")}>Conferir relatório salvo</Button>
    </div>
    {result && <p role="status">{result}</p>}
    {data?.acompanhamentoAutomatico && <p style={{ color: "var(--text-muted)", fontSize: ".8125rem" }}>Obtenção de parcelas: {data.acompanhamentoAutomatico.parcelamento ? "consulta automática configurada" : "acompanhamento manual"} · Pagamento: {data.acompanhamentoAutomatico.pagamento ? "consulta automática configurada" : "acompanhamento manual"}.</p>}
    {error && <div role="alert" style={{ marginTop: 12, color: "var(--state-danger)" }}>{error} <Button size="sm" variant="secondary" onClick={load}>Atualizar acompanhamento</Button><div style={{ fontSize: ".8rem" }}>As pendências conhecidas continuam válidas.</div></div>}
    {loading && <p role="status" style={{ color: "var(--text-muted)" }}>Atualizando acompanhamento…</p>}
    {!loading && !error && itens.length === 0 && <p style={{ color: "var(--text-muted)" }}>{data?.itens?.length ? "Nenhuma parcela neste filtro." : "Nenhum acompanhamento cadastrado. Confira o relatório salvo ou localize os acordos na Receita."}</p>}
    {itens.map(item => {
      const indicacao = indicacoes.find(i => i.id === item.indicacaoId || i.id === item.id || item.id === `indicacao:${i.id}`);
      return <article key={item.id} style={row}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <strong>{item.tipo || "Parcelamento"}{item.numeroParcelamento ? ` nº ${item.numeroParcelamento}` : " · acordo a identificar"}{item.numeroParcela ? ` · parcela ${item.numeroParcela}` : ""}</strong>
          <div style={{ fontSize: ".8125rem", color: item.atrasada ? "var(--state-danger)" : "var(--text-muted)", marginTop: 4 }}>{labels[item.estado] || item.label || "Conferência pendente"}{item.anterior ? " · anterior" : ""}{item.atrasada ? item.estado === "IDENTIFICAR" ? " · atrasos informados" : " · vencida" : ""}</div>
          {item.referencia && <div style={{ fontSize: ".8125rem", marginTop: 4 }}>{item.referencia} · {money(item.valor)} · {item.vencimento ? `vence ${fmtDataCivil(item.vencimento)}${item.vencimentoPrevisto ? " (previsto)" : ""}` : "Vencimento não informado"}</div>}
          {indicacao && <div style={{ fontSize: ".8125rem", marginTop: 4 }}>{indicacao.parcelasEmAtraso != null ? `${indicacao.parcelasEmAtraso} parcela(s) em atraso informadas no relatório. ` : ""}Referências e valores precisam ser conferidos.</div>}
          <details style={{ fontSize: ".8125rem", marginTop: 6 }}><summary style={{ cursor: "pointer", color: "var(--text-muted)" }}>Detalhes</summary><p>{item.label || indicacao?.descricao || labels[item.estado]}</p>{indicacao && <p>Origem: {indicacao.origem} · {dateTime(indicacao.evidenciaEm)}</p>}{item.pagamentoConsultadoEm && <p>Pagamento consultado em {dateTime(item.pagamentoConsultadoEm)}</p>}{(item.consultaErro || item.documentoErro) && <p role="status">{item.consultaErro || item.documentoErro}</p>}{item.estado === "DIVERGENCIA" && <p>{item.divergenciaMotivo || "Confira a identificação e os valores antes de registrar a baixa."}{item.valorPago != null ? ` Valor encontrado: ${money(item.valorPago)}.` : ""}</p>}{indicacao && <Button size="sm" variant="secondary" onClick={() => setResolver(indicacao)}>Registrar conferência da indicação</Button>}</details>
        </div>
        {action(item)}
      </article>;
    })}
    {contratos.some(c => !c.aberturaEntryId) && <div style={{ marginTop: 20 }}><h2 style={{ fontSize: "1rem" }}>Acordos em acompanhamento</h2>{contratos.filter(c => !c.aberturaEntryId).map(c => <div key={c.id} style={row}><div><strong>{c.tipo} nº {c.numeroParcelamento}</strong><div style={{ color: "var(--text-muted)", fontSize: ".8125rem", marginTop: 4 }}>{c.fiscalSituacao === "NAO_CONFERIDO" ? "Cadastro local · falta conferir na Receita" : c.fiscalSituacao || "Situação a conferir"} · sem contabilização</div><div style={{ fontSize: ".8125rem", marginTop: 4 }}>Última conferência: {dateTime(c.ultimaConsultaParcelasEm || c.fiscalConfirmadoEm)}</div></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button size="sm" variant="secondary" onClick={() => setCadastro(c)}>Editar acompanhamento</Button><Button size="sm" variant="secondary" onClick={() => onContabilizar?.(c)}>Preparar contabilização</Button></div></div>)}</div>}
    {cadastro && <CadastroFiscal api={api} companyId={companyId} contrato={typeof cadastro === "object" ? cadastro : null} onSaved={saved} onClose={() => setCadastro(false)} />}
    {resolver && <ResolverIndicacao indicacao={resolver} contratos={contratos} api={api} companyId={companyId} onSaved={saved} onClose={() => setResolver(null)} />}
    {conferirDocumento && <ConferirDocumentoParcela api={api} companyId={companyId} item={conferirDocumento} onSaved={saved} onClose={() => setConferirDocumento(null)} />}
    {api.definirCenarioAcompanhamento && <details style={{ marginTop: 16, color: "var(--text-muted)", fontSize: ".8125rem" }}><summary>Demonstração</summary><label>Resultado das próximas consultas<select style={{ ...field, maxWidth: 340, display: "block", marginTop: 6 }} defaultValue="sucesso" onChange={e => api.definirCenarioAcompanhamento(companyId, e.target.value)}><option value="sucesso">Sucesso</option><option value="nao_localizado">Pagamento ainda não localizado</option><option value="parcial">Pagamento parcial</option><option value="erro">Falha de consulta</option><option value="documento">Documento requer conferência</option></select></label></details>}
  </section>;
}
