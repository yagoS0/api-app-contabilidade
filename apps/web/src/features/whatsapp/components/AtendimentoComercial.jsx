import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { FluxoComercial } from "../../onboarding/components/FluxoComercial";
import { AbrirBiblioteca } from "../../onboarding/components/AbrirBiblioteca";

export const AtualizacaoAtendimento = createContext({ revisao: 0, atualizar: () => {} });

// Remontar por conversa impede exibir dados ou uma prévia do destinatário anterior.
export function AtendimentoComercial(props) {
  return <AtendimentoDaConversa key={props.conversa.id} {...props} />;
}
function AtendimentoDaConversa({ api, conversa, onCriado, candidatos = [], onEstado, slotEmpresa = null }) {
  const { revisao } = useContext(AtualizacaoAtendimento);
  const [anteriores, setAnteriores] = useState([]), [reinicio, setReinicio] = useState("");
  const [lead, setLead] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [origem, setOrigem] = useState(""), [carregando, setCarregando] = useState(true), [recarga, setRecarga] = useState(0);
  const vivo = useRef(true), trava = useRef(false);
  const path = `/conversas/${encodeURIComponent(conversa.id)}`;
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    let atual = true;
    setLead(null); setErro(""); setCarregando(true);
    if (!api.comercial) { setCarregando(false); return; }
    api.comercial(path).then(r => { if (atual) { setLead(r.atendimento); setAnteriores(r.anteriores || []); onEstado?.(Boolean(r.atendimento?.onboardingId)); } }).catch(e => { if (atual) setErro(e.message); }).finally(() => { if (atual) setCarregando(false); });
    return () => { atual = false; };
  }, [api, path, recarga, revisao]);
  async function iniciar(body) {
    if (trava.current || carregando) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      const r = await api.comercial(path + "/iniciar", body);
      if (vivo.current) { setLead(r.atendimento); onEstado?.(Boolean(r.atendimento?.onboardingId)); setReinicio(""); setRecarga(v => v + 1); await onCriado?.(); }
    } catch (e) { if (vivo.current) setErro(e.message); }
    finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }
  if (!api.comercial) return <p>Atendimento comercial disponível com a API atualizada.</p>;
  return <section aria-label="Atendimento do interessado">
    <strong>Processo comercial</strong><p>Identifique o serviço e acompanhe a ficha vinculada a esta conversa.</p>
    {erro && <div role="alert">{erro} <Button type="button" variant="secondary" disabled={ocupado} onClick={() => setRecarga(v => v + 1)}>Recarregar atendimento comercial</Button></div>}
    {carregando ? <p role="status">Carregando atendimento…</p> : lead?.onboardingId ? <><p className="wa-case-link"><a href={`/onboardings/${encodeURIComponent(lead.onboardingId)}`} target="_blank" rel="noopener noreferrer">Abrir ficha do cliente em nova aba ↗</a></p><details className="wa-commercial-process"><summary>Continuar processo nesta conversa</summary><div className="wa-commercial-tabs"><Button variant="secondary" onClick={() => setReinicio("CORRIGIR_MOTIVO")}>Corrigir motivo / recomeçar</Button><Button variant="secondary" onClick={() => setReinicio("NOVA_SOLICITACAO")}>Nova solicitação deste contato</Button></div>{reinicio && <fieldset disabled={ocupado}><legend>{reinicio === "CORRIGIR_MOTIVO" ? "Recomeçar atendimento" : "Iniciar outra solicitação"}</legend><p>A ficha e o histórico anteriores serão preservados. A nova solicitação será atendida separadamente, uma por vez.</p><label>Tipo da nova solicitação<select value={origem} onChange={e => setOrigem(e.target.value)}><option value="">Selecione</option><option value="ABERTURA">Abertura</option><option value="TRANSFERENCIA">Transferência</option><option value="INATIVA">Empresa parada</option></select></label><Button disabled={!origem} onClick={() => iniciar({ origem, reiniciarAtendimentoId: lead.id, motivoReinicio: reinicio })}>Preservar anterior e iniciar</Button><Button variant="secondary" onClick={() => setReinicio("")}>Cancelar</Button></fieldset>}<FluxoComercial key={lead.onboardingId} api={api} onboardingId={lead.onboardingId} conversaId={conversa.id} /></details></> : <fieldset disabled={ocupado || !!erro} style={{ border: 0, padding: 0 }}>
      {candidatos.filter(c => !["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(c.status)).map(c => <p key={c.id}><a href={`/onboardings/${encodeURIComponent(c.id)}`}>Conferir ficha {c.origem} · {c.status}</a>{" "}<Button type="button" onClick={() => iniciar({ onboardingId: c.id })}>Conferi: vincular esta ficha</Button></p>)}
      <label>Motivo do atendimento<select value={origem} onChange={e => setOrigem(e.target.value)}><option value="">Identificar durante a conversa</option><option value="ABERTURA">Abertura</option><option value="TRANSFERENCIA">Transferência</option><option value="INATIVA">Empresa parada</option></select></label>{" "}
      <Button type="button" onClick={() => iniciar({ origem: origem || null })}>{ocupado ? "Salvando…" : lead ? "Definir motivo do atendimento" : "Iniciar atendimento"}</Button>
    </fieldset>}
    {!carregando && !erro && !lead?.onboardingId && slotEmpresa}
    {anteriores.length > 0 && <details><summary>Solicitações anteriores deste contato</summary>{anteriores.map(a => <p key={a.id}>{a.onboarding ? <a href={`/onboardings/${a.onboarding.id}`}>{a.onboarding.origem} · {a.onboarding.status}</a> : "Atendimento sem ficha"}</p>)}</details>}
  </section>;
}

export function OrientacoesRapidas(props) {
  return <OrientacoesDaConversa key={props.conversa.id} {...props} />;
}
function OrientacoesDaConversa({ api, conversa, onEnviado, disabled }) {
  const { atualizar } = useContext(AtualizacaoAtendimento);
  const [aberto, setAberto] = useState(false), [recursos, setRecursos] = useState([]), [id, setId] = useState(""), [previa, setPrevia] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [preparando, setPreparando] = useState(false), [carregando, setCarregando] = useState(false);
  const [vars, setVars] = useState({ nome: conversa.contato?.nome || conversa.nomePerfilProvedor || "", cnpj: conversa.empresa?.cnpj || "", servico: "" });
  const [busca, setBusca] = useState("");
  const abrirRef = useRef(null), fecharRef = useRef(null);
  const vivo = useRef(true), versaoPrevia = useRef(0), trava = useRef(false);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; versaoPrevia.current += 1; }; }, []);
  useEffect(() => {
    if (!aberto || !api.comercial) return;
    let atual = true, pedido = 0;
    async function carregar() {
      const n = ++pedido; setCarregando(true); setErro(""); invalidarPrevia(); setId("");
      try { const r = await api.comercial("/recursos"); if (atual && n === pedido) setRecursos(r.recursos || []); }
      catch(e) { if (atual && n === pedido) setErro(e.message); }
      finally { if (atual && n === pedido) setCarregando(false); }
    }
    const aoVoltar = () => { if (document.visibilityState !== "hidden" && !trava.current) carregar(); };
    carregar(); window.addEventListener("focus", aoVoltar); document.addEventListener("visibilitychange", aoVoltar);
    if (!conversa.portalClientId && !conversa.empresa?.cnpj) api.comercial(`/conversas/${encodeURIComponent(conversa.id)}`).then(r => {
      const o = r.atendimento?.onboarding;
      if (atual && o) setVars(v => ({ ...v, cnpj: v.cnpj || o.cnpj || "", nome: v.nome || o.responsavelNome || "" }));
    }).catch(() => {});
    return () => { atual = false; window.removeEventListener("focus", aoVoltar); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [aberto, api]);
  function invalidarPrevia() { versaoPrevia.current += 1; setPrevia(null); setPreparando(false); }
  async function selecionar(value) {
    if (trava.current) return;
    setId(value); setPrevia(null); setErro("");
    const versao = ++versaoPrevia.current;
    if (!value) { setPreparando(false); return; }
    setPreparando(true);
    const variaveis = { ...vars };
    try {
      const r = await api.comercial(`/recursos/${encodeURIComponent(value)}/previa`, { variaveis });
      if (vivo.current && versao === versaoPrevia.current) setPrevia({ texto: r.previa.texto, orientacaoId: value, variaveis });
    } catch (e) { if (vivo.current && versao === versaoPrevia.current) setErro(e.message); }
    finally { if (vivo.current && versao === versaoPrevia.current) setPreparando(false); }
  }
  async function enviar() {
    if (disabled || trava.current || !previa || preparando) return;
    trava.current = true; setOcupado(true); setErro("");
    const conferida = previa;
    try {
      await api.enviarOrientacaoWhatsapp(conversa.id, conferida.orientacaoId ? { orientacaoId: conferida.orientacaoId, variaveis: conferida.variaveis, assumir: true } : { texto: conferida.texto, assumir: true });
      if (vivo.current) { invalidarPrevia(); setId(""); setAberto(false); await onEnviado?.(); }
    } catch (e) { if (vivo.current) setErro(e.message); }
    finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }

  useEffect(() => { if (aberto) fecharRef.current?.focus(); }, [aberto]);
  async function formulario(origem) {
    if (trava.current || preparando) return;
    trava.current = true; setPreparando(true); setErro(""); setPrevia(null); setId("");
    const versao = ++versaoPrevia.current;
    try {
      const p = "/conversas/" + encodeURIComponent(conversa.id);
      const atual = await api.comercial(p);
      if (atual.atendimento?.onboarding?.origem && atual.atendimento.onboarding.origem !== origem) throw new Error("Este contato já tem outra solicitação ativa. Use Nova solicitação no Atendimento para preservar a anterior.");
      const lead = atual.atendimento?.onboardingId ? atual.atendimento : (await api.comercial(p + "/iniciar", { origem })).atendimento;
      if (!atual.atendimento?.onboardingId) atualizar();
      const r = await api.criarLinkOnboarding(lead.onboardingId, { diasValidade: 7 });
      const link = window.location.origin + "/onboarding/publico#token=" + encodeURIComponent(r.token);
      if (!r.token) throw new Error("Não foi possível confirmar o link. Confira o atendimento antes de gerar outro.");
      if (vivo.current && versao === versaoPrevia.current) setPrevia({ texto: "Para continuarmos com " + ({ ABERTURA: "a abertura", TRANSFERENCIA: "a transferência", INATIVA: "a análise da empresa parada" }[origem]) + ", preencha este formulário: " + link + "\nVocê pode salvar por etapas. Ao concluir, os dados chegam diretamente ao nosso atendimento. Se tiver dúvida, pode responder por aqui." });
    } catch (e) { if (vivo.current && versao === versaoPrevia.current) setErro(e.message); }
    finally { trava.current = false; if (vivo.current && versao === versaoPrevia.current) setPreparando(false); }
  }
  function fechar() { invalidarPrevia(); setAberto(false); abrirRef.current?.focus(); }
  const orientacoes = [...new Map(recursos.filter(r => r.tipo === "ORIENTACAO" && r.aprovadoEm).sort((a,b) => a.versao - b.versao).map(r => [r.chave,r])).values()];
  if (!api.comercial) return null;
  return <div className="wa-quick-library"><Button ref={abrirRef} type="button" variant="secondary" size="sm" disabled={ocupado} aria-expanded={aberto} onClick={() => { invalidarPrevia(); setAberto(v => !v); }}>Mensagens rápidas</Button>
    {aberto && <aside className="wa-quick-drawer" aria-label="Mensagens rápidas" onKeyDown={e => { if (e.key === "Escape" && !ocupado) { e.stopPropagation(); fechar(); } }}>
      <div className="wa-section-heading"><h2>Mensagens rápidas</h2><Button ref={fecharRef} variant="secondary" size="sm" disabled={ocupado} onClick={fechar}>Fechar</Button></div>
      <AbrirBiblioteca />
      <fieldset disabled={ocupado} style={{ border: 0, padding: 0 }}>
      <label>Buscar mensagem rápida<input value={busca} onChange={e => setBusca(e.target.value)} /></label>
      {!conversa.portalClientId && api.criarLinkOnboarding && [["ABERTURA", "Formulário de abertura", "Enviar formulário ao lead que deseja abrir uma nova empresa."], ["TRANSFERENCIA", "Formulário de transferência", "Coletar os dados para trocar de contador."], ["INATIVA", "Formulário de empresa parada", "Coletar os dados iniciais para analisar e regularizar a empresa."]].filter(([,t,d]) => (t+" "+d).toLowerCase().includes(busca.toLowerCase())).map(([origem,titulo,descricao]) => <article className="wa-quick-card" key={origem}><strong>{titulo}</strong><p>{descricao}</p><small>Cria ou usa o onboarding deste atendimento. Gerar novamente substitui o link anterior.</small><Button size="sm" variant="secondary" onClick={() => formulario(origem)}>Preparar formulário</Button></article>)}
      {orientacoes.filter(r => (r.titulo+" "+(r.dados?.descricao || "")).toLowerCase().includes(busca.toLowerCase())).map(r => <article className="wa-quick-card" key={r.id}><strong>{r.titulo}</strong><p>{r.dados?.descricao || (r.texto || "").slice(0,150)}</p><Button variant="secondary" size="sm" onClick={() => selecionar(r.id)}>Preparar mensagem</Button></article>)}
      {!carregando && !erro && !orientacoes.length && <p>Não há textos aprovados. Em Gerenciar biblioteca compartilhada, carregue os modelos iniciais, revise e aprove para disponibilizá-los aqui.</p>}
      {id && [["nome", "Nome do destinatário"], ["cnpj", "CNPJ"], ["servico", "Serviço"]].filter(([k]) => recursos.find(r => r.id === id)?.texto?.includes("{{"+k+"}}")).map(([k,rotulo]) => <label key={k}>{rotulo}<input value={vars[k]} onChange={e => { invalidarPrevia(); setVars({ ...vars, [k]: e.target.value }); }} /></label>)}
      {id && <Button type="button" size="sm" variant="secondary" disabled={preparando || carregando} onClick={() => selecionar(id)}>Conferir mensagem</Button>}
      {previa && <><h3>Prévia para este contato</h3><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{previa.texto}</p><Button type="button" disabled={disabled || ocupado || preparando} onClick={enviar}>Assumir e enviar orientação</Button></>}
      </fieldset>
      {(carregando || preparando) && <p role="status">{carregando ? "Carregando orientações…" : "Preparando prévia…"}</p>}
      {erro && <p role="alert">{erro}</p>}
    </aside>}
  </div>;
}
