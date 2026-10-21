import { useConfirmacao } from "../../../components/ui/useConfirmacao";
import { FluxoComercial } from "./FluxoComercial";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

const data = (v) => v ? new Date(v).toLocaleString("pt-BR") : "—";
const campoStyle = { display: "block", width: "100%", padding: 8, marginBottom: 12, background: "var(--bg-page)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 6 };

export function PainelComercial({ api, onboardingId, convertido = false, revisao = 0, coletaInicial = false, continuar = 0, onAtualizar, onAbrirExecucao }) {
  const { pedir: confirmar, dialogo } = useConfirmacao();
  const [estado, setEstado] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const [erroLeitura, setErroLeitura] = useState("");
  const [fase, setFase] = useState("LEAD"), [texto, setTexto] = useState(""), [valor, setValor] = useState("");
  const [link, setLink] = useState(""), [aviso, setAviso] = useState("");
  const [geracao, setGeracao] = useState(0);
  // Somente a primeira montagem escolhe a seção: atualizar a ficha não desfaz a escolha do usuário.
  const [formularioAberto, setFormularioAberto] = useState(() => coletaInicial || !api.comercial);

  useEffect(() => { if (continuar) { setFormularioAberto(false); } }, [continuar]);
  const carregadaRef = useRef(null);
  useEffect(() => {
    let vivo = true;
    if (carregadaRef.current !== onboardingId) { setEstado(null); setErro(""); setLink(""); }
    api.getOnboardingComercial(onboardingId).then((r) => {
      if (!vivo) return;
      setEstado(r);
      setErroLeitura("");
      if (carregadaRef.current !== onboardingId) {
        setFase(r.faseComercial || "LEAD"); setTexto(r.proposta?.texto || ""); setValor(r.proposta?.valorMensal == null ? "" : String(r.proposta.valorMensal));
        carregadaRef.current = onboardingId;
      }
    }).catch((e) => { if (vivo) setErroLeitura(e.message); });
    return () => { vivo = false; };
  }, [api, onboardingId, geracao, revisao]);
  async function executar(fn, mensagem) {
    if (ocupado) return; setOcupado(true); setErro(""); setAviso("");
    try { await fn(); setAviso(mensagem); setGeracao((v) => v + 1); }
    catch (e) { setErro(e.message); }
    finally { setOcupado(false); }
  }
  async function gerarLink() {
    if (ocupado) return;
    if ((estado?.links || []).some(l => !l.revokedAt && !l.submittedAt && new Date(l.expiresAt).getTime() > Date.now())) {
      const ok = await confirmar({ titulo: "Substituir link do cliente", texto: "O link atual deixará de funcionar. Quem estiver preenchendo precisará usar o novo link; os dados já salvos permanecem na ficha.", acao: "Substituir link" });
      if (!ok) return;
    }
    setOcupado(true); setErro(""); setAviso(""); setLink("");
    try {
      const r = await api.criarLinkOnboarding(onboardingId, { diasValidade: 7 });
      if (!r.token) throw new Error("O servidor não retornou o link. Confira os links ativos antes de gerar outro.");
      setLink(`${window.location.origin}/onboarding/publico#token=${encodeURIComponent(r.token)}`);
      setEstado((s) => ({ ...s, links: [...(s?.links || []).map((l) => ({ ...l, revokedAt: l.revokedAt || new Date().toISOString() })), r.link] }));
      setGeracao((v) => v + 1);
    } catch (e) { setErro(e.message); } finally { setOcupado(false); }
  }
  return <section className="onboarding-workspace onboarding-commercial" aria-label="Atendimento comercial">
    {dialogo}
    {api.mode === "mock" && <p role="status">Demonstração: consultas simuladas e links válidos somente enquanto esta sessão estiver aberta.</p>}
    {erro && <p role="alert">{erro}</p>}{aviso && <p role="status">{aviso}</p>}
    {erroLeitura && <p role="alert">{erroLeitura} <Button variant="secondary" onClick={() => setGeracao(v => v + 1)}>Atualizar atendimento</Button></p>}
    {!estado ? <Button onClick={() => setGeracao((v) => v + 1)} disabled={!erroLeitura}>{erroLeitura ? "Recarregar atendimento" : "Carregando atendimento…"}</Button> : <>
{(!api.comercial || coletaInicial || link) && <details className="onboarding-panel onboarding-form-link" open={formularioAberto} onToggle={e => setFormularioAberto(e.currentTarget.open)}><summary>Formulário do cliente</summary><p>Link pessoal · válido por 7 dias.</p>
        <Button disabled={ocupado || convertido} onClick={gerarLink}>Gerar link de preenchimento</Button>
      {link && <div className="onboarding-share"><p>Envio manual: copie o link ou a mensagem.</p><label>Link pessoal<input style={campoStyle} value={link} readOnly /></label><Button onClick={async () => { try { await navigator.clipboard.writeText(link); setAviso("Link copiado."); } catch { setErro("Não foi possível copiar. Selecione e copie o link acima."); } }}>Copiar link</Button><Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(`Olá! Preencha o formulário para iniciarmos seu atendimento: ${link}\nVocê pode salvar por etapas. Ao concluir, envie os dados ao escritório pelo próprio formulário.`); setAviso("Mensagem com link copiada. Cole na conversa com o cliente."); } catch { setErro("Não foi possível copiar. Selecione e copie o link acima."); } }}>Copiar mensagem com link</Button></div>}
      <ul className="onboarding-links">{(estado.links || []).map((l) => <li key={l.id}>Validade: {data(l.expiresAt)} · {l.revokedAt ? "Revogado" : l.submittedAt ? "Enviado pelo cliente" : new Date(l.expiresAt).getTime() <= Date.now() ? "Expirado" : "Ativo"} {!l.revokedAt && !l.submittedAt && new Date(l.expiresAt).getTime() > Date.now() && !convertido && <Button variant="secondary" disabled={ocupado} onClick={() => executar(async () => { await api.revogarLinkOnboarding(onboardingId, l.id); setLink(""); }, "Link revogado.")}>Revogar link</Button>}</li>)}</ul>
</details>}
      {api.comercial && <section className="onboarding-panel" aria-label="Jornada comercial"><FluxoComercial api={api} onboardingId={onboardingId} revisao={revisao} onAtualizar={onAtualizar} onAbrirExecucao={onAbrirExecucao} /></section>}
      <section className="onboarding-panel lead-notes" aria-label="Anotações">
        <fieldset disabled={ocupado || convertido || Boolean(erroLeitura)}>
          <label>Anotações<textarea rows={3} value={texto} maxLength={10000} onChange={e => setTexto(e.target.value)} /></label>
          {!api.comercial && <label>Honorários mensais (R$)<input inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} /></label>}
          <Button onClick={() => {
            const mensal = valor.trim().replace(",", ".");
            if (mensal && !/^\d+(\.\d{1,2})?$/.test(mensal)) { setErro("Informe honorários com até duas casas decimais, sem separador de milhar."); return; }
            executar(() => api.salvarOnboardingComercial(onboardingId, { faseComercial: fase, proposta: { texto, valorMensal: mensal ? Number(mensal) : null } }), "Anotação salva.");
          }}>Salvar</Button>
        </fieldset>
      </section>
      {!api.comercial && api.criarAnaliseOnboarding && <details className="onboarding-panel"><summary>Consulta pública</summary>
        <Button variant="secondary" disabled={ocupado || convertido || Boolean(erroLeitura)} onClick={() => executar(() => api.criarAnaliseOnboarding(onboardingId, { tipo: "PUBLICA" }), "Análise inicial registrada.")}>Consultar dados públicos</Button>
        {(estado.analises || []).filter(a => a.tipo === "PUBLICA").map(a => <article key={a.id}><p>{data(a.createdAt)} · {a.status} · CNPJ {a.cnpj || "—"}</p><ResultadoAnalise resultado={a.resultado} /></article>)}
      </details>}
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
