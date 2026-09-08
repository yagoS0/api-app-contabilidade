import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

const FASES = { LEAD: "Primeiro contato", ANALISE: "Em análise", PROPOSTA: "Proposta", CONTRATADO: "Contratado" };
const data = (v) => v ? new Date(v).toLocaleString("pt-BR") : "—";
const campoStyle = { display: "block", width: "100%", padding: 8, marginBottom: 12, background: "var(--bg-page)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 };

export function PainelComercial({ api, onboardingId, convertido = false }) {
  const [estado, setEstado] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const [fase, setFase] = useState("LEAD"), [texto, setTexto] = useState(""), [valor, setValor] = useState("");
  const [link, setLink] = useState(""), [aviso, setAviso] = useState("");
  const [geracao, setGeracao] = useState(0);
  const carregadaRef = useRef(null);
  useEffect(() => {
    let vivo = true;
    if (carregadaRef.current !== onboardingId) { setEstado(null); setErro(""); setLink(""); }
    api.getOnboardingComercial(onboardingId).then((r) => {
      if (!vivo) return;
      setEstado(r);
      if (carregadaRef.current !== onboardingId) {
        setFase(r.faseComercial || "LEAD"); setTexto(r.proposta?.texto || ""); setValor(r.proposta?.valorMensal == null ? "" : String(r.proposta.valorMensal));
        carregadaRef.current = onboardingId;
      }
    }).catch((e) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [api, onboardingId, geracao]);
  async function executar(fn, mensagem) {
    if (ocupado) return; setOcupado(true); setErro(""); setAviso("");
    try { await fn(); setAviso(mensagem); setGeracao((v) => v + 1); }
    catch (e) { setErro(e.message); }
    finally { setOcupado(false); }
  }
  async function gerarLink() {
    if (ocupado) return; setOcupado(true); setErro(""); setAviso(""); setLink("");
    try {
      const r = await api.criarLinkOnboarding(onboardingId, { diasValidade: 7 });
      if (!r.token) throw new Error("O servidor não retornou o link. Confira os links ativos antes de gerar outro.");
      setLink(`${window.location.origin}/onboarding/publico#token=${encodeURIComponent(r.token)}`);
      setEstado((s) => ({ ...s, links: [...(s?.links || []).map((l) => ({ ...l, revokedAt: l.revokedAt || new Date().toISOString() })), r.link] }));
      setGeracao((v) => v + 1);
    } catch (e) { setErro(e.message); } finally { setOcupado(false); }
  }
  return <section style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 18, marginBottom: 24 }} aria-label="Atendimento comercial">
    <h2>Atendimento comercial</h2>
    {api.mode === "mock" && <p role="status">Demonstração: consultas simuladas e links válidos somente enquanto esta sessão estiver aberta.</p>}
    <p>O atendimento permanece nesta ficha até a conversão em empresa. As análises mostram a situação na data da consulta.</p>
    {erro && <p role="alert">{erro}</p>}{aviso && <p role="status">{aviso}</p>}
    {!estado ? <Button onClick={() => setGeracao((v) => v + 1)} disabled={!erro}>{erro ? "Recarregar atendimento" : "Carregando atendimento…"}</Button> : <>
      <fieldset disabled={ocupado || convertido} style={{ border: 0, padding: 0 }}>
        <legend>Etapa e proposta</legend>
        <label>Etapa comercial<select style={campoStyle} value={fase} onChange={(e) => setFase(e.target.value)}>{Object.entries(FASES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        <label>Proposta e condições<textarea style={campoStyle} value={texto} maxLength={10000} onChange={(e) => setTexto(e.target.value)} /></label>
        <label>Honorários mensais (R$)<input style={campoStyle} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
        <Button onClick={() => {
          const mensal = valor.trim().replace(",", ".");
          if (mensal && (!/^\d+(\.\d{1,2})?$/.test(mensal) || Number(mensal) < 0)) { setErro("Informe honorários com até duas casas decimais, sem separador de milhar."); return; }
          executar(() => api.salvarOnboardingComercial(onboardingId, { faseComercial: fase, proposta: { texto, valorMensal: mensal ? Number(mensal) : null } }), "Etapa e proposta salvas.");
        }}>Salvar atendimento</Button>
        <h3>Análises</h3>
        <p>A análise inicial consulta dados públicos. A análise fiscal depende de procuração válida, verificada pelo serviço.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button onClick={() => executar(() => api.criarAnaliseOnboarding(onboardingId, { tipo: "PUBLICA" }), "Análise inicial registrada.")}>Consultar dados públicos</Button>
          <Button variant="secondary" onClick={() => executar(() => api.criarAnaliseOnboarding(onboardingId, { tipo: "SITFIS" }), "Análise fiscal registrada.")}>Consultar situação fiscal autorizada</Button>
        </div>
        <h3>Formulário do cliente</h3><p>Link pessoal válido por 7 dias. O cliente salva em etapas e envia ao concluir. Não solicita senha ou certificado.</p>
        <Button onClick={gerarLink}>Gerar link de preenchimento</Button>
      </fieldset>
      {link && <div><label>Link pessoal<input style={campoStyle} value={link} readOnly /></label><Button onClick={async () => { try { await navigator.clipboard.writeText(link); setAviso("Link copiado."); } catch { setErro("Não foi possível copiar. Selecione e copie o link acima."); } }}>Copiar link</Button></div>}
      <ul>{(estado.links || []).map((l) => <li key={l.id}>Validade: {data(l.expiresAt)} · {l.revokedAt ? "Revogado" : l.submittedAt ? "Enviado pelo cliente" : new Date(l.expiresAt).getTime() <= Date.now() ? "Expirado" : "Ativo"} {!l.revokedAt && !l.submittedAt && new Date(l.expiresAt).getTime() > Date.now() && !convertido && <Button variant="secondary" disabled={ocupado} onClick={() => executar(() => api.revogarLinkOnboarding(onboardingId, l.id), "Link revogado.")}>Revogar link</Button>}</li>)}</ul>
      <h3>Resultados das análises</h3>
      {(estado.analises || []).length === 0 && <p>Nenhuma análise registrada.</p>}
      {(estado.analises || []).map((a) => <article key={a.id} style={{ padding: 12, borderBottom: "1px solid var(--border)" }}><strong>{a.tipo === "SITFIS" ? "Situação fiscal" : "Dados públicos"}</strong><p>{data(a.createdAt)} · {a.status} · CNPJ {a.cnpj || "—"}</p><ResultadoAnalise resultado={a.resultado} />{a.resultado?.relatorioDisponivel && <Button onClick={async () => { try { const blob = await api.baixarAnaliseOnboarding(onboardingId, a.id); const url = URL.createObjectURL(blob); const el = document.createElement("a"); el.href = url; el.download = "analise-fiscal.pdf"; el.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); } catch (e) { setErro(e.message); } }}>Baixar relatório fiscal</Button>}</article>)}
      <details><summary>Histórico do atendimento</summary><ul>{(estado.eventos || []).map((e) => <li key={e.id}>{data(e.createdAt)} · {e.tipo}</li>)}</ul></details>
    </>}
  </section>;
}

const ROTULOS_RESULTADO = { fonte: "Fonte", consultadoEm: "Consultado em", mensagem: "Resultado", razaoSocial: "Razão social", situacaoCadastral: "Situação cadastral", cnaePrincipal: "CNAE principal", municipio: "Município", uf: "UF", procuracao: "Procuração", status: "Situação", validUntil: "Válida até", systems: "Sistemas autorizados", checkedAt: "Verificada em", procuradorCnpj: "CNPJ do procurador" };
function ResultadoAnalise({ resultado }) {
  if (!resultado) return null;
  if (typeof resultado === "string") return <p>{resultado}</p>;
  if (Array.isArray(resultado)) return <span>{resultado.map((v) => String(v)).join(", ")}</span>;
  return <dl>{Object.entries(resultado).filter(([k]) => ROTULOS_RESULTADO[k]).map(([k, v]) => <div key={k}><dt>{ROTULOS_RESULTADO[k]}</dt><dd>{v && typeof v === "object" ? <ResultadoAnalise resultado={v} /> : String(v ?? "—")}</dd></div>)}</dl>;
}
