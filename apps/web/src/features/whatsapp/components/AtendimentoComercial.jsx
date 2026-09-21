import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { canalComercialDaConversa } from "../lib/identidadeAtendimento";
import { FluxoComercial } from "../../onboarding/components/FluxoComercial";
import { AbrirBiblioteca } from "../../onboarding/components/AbrirBiblioteca";
import { descricaoMensagem, lerUsosMensagens, normalizarBuscaMensagem, registrarUsoMensagem, ultimasOrientacoes } from "../lib/mensagensRapidas";

export const AtualizacaoAtendimento = createContext({ revisao: 0, atualizar: () => {} });

// Remontar por conversa impede exibir dados ou uma prévia do destinatário anterior.
export function AtendimentoComercial(props) {
  return <AtendimentoDaConversa key={props.conversa.interlocutorId || props.conversa.id} {...props} />;
}
function AtendimentoDaConversa({ api, conversa, onCriado, candidatos = [], onEstado, slotEmpresa = null, canalDeEnvio = null }) {
  const { revisao } = useContext(AtualizacaoAtendimento);
  const canalComercial = conversa.relacionamento?.tipo === "LEAD" ? canalComercialDaConversa(conversa) : null;
  const destinoEnvio = conversa.relacionamento?.tipo === "LEAD" ? canalComercial?.conversaId || null : conversa.id;
  const [anteriores, setAnteriores] = useState([]), [reinicio, setReinicio] = useState("");
  const [lead, setLead] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [origem, setOrigem] = useState(""), [carregando, setCarregando] = useState(true), [recarga, setRecarga] = useState(0);
  const vivo = useRef(true), trava = useRef(false);
  const path = `/conversas/${encodeURIComponent(conversa.id)}`;
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    let atual = true;
    setErro(""); setCarregando(true);
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
  return <section className="wa-commercial-intake" aria-label="Atendimento do interessado">
    {!lead?.onboardingId && <p>Escolha o motivo para iniciar o atendimento deste contato.</p>}
    {erro && <div role="alert">{erro} <Button type="button" variant="secondary" disabled={ocupado} onClick={() => setRecarga(v => v + 1)}>Recarregar atendimento comercial</Button></div>}
    {carregando && !lead ? <p role="status">Carregando atendimento…</p> : lead?.onboardingId ? <><div className="wa-case-toolbar"><a className="btn btn-secondary wa-case-link" aria-label="Abrir ficha do cliente em nova aba" href={`/onboardings/${encodeURIComponent(lead.onboardingId)}`} target="_blank" rel="noopener noreferrer">Ficha ↗</a><Button variant="secondary" onClick={() => setReinicio("CORRIGIR_MOTIVO")}>Recomeçar</Button><Button variant="secondary" onClick={() => setReinicio("NOVA_SOLICITACAO")}>Nova solicitação</Button>
      {anteriores.length > 0 && <details className="wa-previous-requests"><summary>Solicitações anteriores ({anteriores.length})</summary>{anteriores.map(a => <p key={a.id}>{a.onboarding ? <a href={`/onboardings/${a.onboarding.id}`}>{a.onboarding.origem} · {a.onboarding.status}</a> : "Atendimento sem ficha"}</p>)}</details>}
    </div>{reinicio && <fieldset disabled={ocupado}><legend>{reinicio === "CORRIGIR_MOTIVO" ? "Recomeçar atendimento" : "Iniciar outra solicitação"}</legend><p>A ficha e o histórico anteriores serão preservados.</p><label>Tipo da nova solicitação<select value={origem} onChange={e => setOrigem(e.target.value)}><option value="">Selecione</option><option value="ABERTURA">Abertura</option><option value="TRANSFERENCIA">Transferência</option><option value="INATIVA">Empresa parada</option></select></label><Button disabled={!origem} onClick={() => iniciar({ origem, reiniciarAtendimentoId: lead.id, motivoReinicio: reinicio })}>Preservar anterior e iniciar</Button><Button variant="secondary" onClick={() => setReinicio("")}>Cancelar</Button></fieldset>}<FluxoComercial key={lead.onboardingId} api={api} onboardingId={lead.onboardingId} conversaId={destinoEnvio} janela={canalComercial?.janela || conversa.janela} canalDisponivel={destinoEnvio !== null && (canalComercial?.podeResponder ?? conversa.podeResponder) !== false} canalDeEnvio={canalDeEnvio} /></> : <fieldset disabled={ocupado || !!erro} style={{ border: 0, padding: 0 }}>
      {candidatos.filter(c => !["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(c.status)).map(c => <p key={c.id}><a href={`/onboardings/${encodeURIComponent(c.id)}`}>Conferir ficha {c.origem} · {c.status}</a>{" "}<Button type="button" onClick={() => iniciar({ onboardingId: c.id })}>Conferi: vincular esta ficha</Button></p>)}
      <label>Motivo do atendimento<select value={origem} onChange={e => setOrigem(e.target.value)}><option value="">Ainda não definido</option><option value="ABERTURA">Abertura</option><option value="TRANSFERENCIA">Transferência</option><option value="INATIVA">Empresa parada</option></select></label>
      <Button type="button" onClick={() => iniciar({ origem: origem || null })}>{ocupado ? "Salvando…" : lead ? "Definir motivo do atendimento" : "Iniciar atendimento"}</Button>
    </fieldset>}
    {!carregando && !erro && !lead?.onboardingId && slotEmpresa}
  </section>;
}

export function OrientacoesRapidas(props) {
  return <OrientacoesDaConversa key={props.conversa.id} {...props} />;
}
function OrientacoesDaConversa({ api, conversa, onEnviado, disabled, onPreparado, usuarioId }) {
  const { atualizar, mensagemBiblioteca, onMensagemBibliotecaAberta } = useContext(AtualizacaoAtendimento);
  const [aberto, setAberto] = useState(Boolean(mensagemBiblioteca)), [recursos, setRecursos] = useState([]), [id, setId] = useState(""), [previa, setPrevia] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [preparando, setPreparando] = useState(false), [carregando, setCarregando] = useState(false);
  const [vars, setVars] = useState({ nome: conversa.contato?.nome || conversa.nomePerfilProvedor || "", cnpj: "", servico: "" });
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("MAIS_USADAS"), [usos, setUsos] = useState(() => lerUsosMensagens(usuarioId));
  useEffect(() => { setUsos(lerUsosMensagens(usuarioId)); }, [usuarioId]);
  const [casoId, setCasoId] = useState(conversa.solicitacaoComercial?.id || null);
  const abrirRef = useRef(null), fecharRef = useRef(null);
  const vivo = useRef(true), versaoPrevia = useRef(0), trava = useRef(false);
  const solicitadaRef = useRef(mensagemBiblioteca), varsRef = useRef(vars);
  varsRef.current = vars;
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; versaoPrevia.current += 1; }; }, []);
  useEffect(() => {
    if (!mensagemBiblioteca) return;
    solicitadaRef.current = mensagemBiblioteca; setAberto(true);
    onMensagemBibliotecaAberta?.();
  }, [mensagemBiblioteca, onMensagemBibliotecaAberta]);
  useEffect(() => {
    if (!aberto || !api.comercial) return;
    let atual = true, pedido = 0;
    async function carregar() {
      const n = ++pedido; setCarregando(true); setErro(""); invalidarPrevia(); setId("");
      try {
        const [r, caso] = await Promise.all([api.comercial("/recursos"), api.comercial(`/conversas/${encodeURIComponent(conversa.id)}`).catch(() => ({}))]);
        if (!atual || n !== pedido) return;
        const lista = r.recursos || [], o = caso.atendimento?.onboarding;
        const variaveis = { ...varsRef.current, cnpj: varsRef.current.cnpj || (o ? o.cnpj || "" : conversa.empresa?.cnpj || ""), nome: varsRef.current.nome || o?.responsavelNome || "" };
        const atendimentoLeadId = caso.atendimento?.id || null;
        setRecursos(lista); setVars(variaveis); setCasoId(atendimentoLeadId);
        if (solicitadaRef.current) {
          const escolhida = lista.find(recurso => recurso.id === solicitadaRef.current.id && recurso.tipo === "ORIENTACAO" && recurso.aprovadoEm);
          solicitadaRef.current = null;
          if (!escolhida) throw new Error("Esta mensagem não está disponível. Escolha uma mensagem aprovada na lista.");
          await selecionar(escolhida.id, { lista, variaveis, atendimentoLeadId });
        }
      }
      catch(e) { if (atual && n === pedido) setErro(e.message); }
      finally { if (atual && n === pedido) setCarregando(false); }
    }
    const aoVoltar = () => { if (document.visibilityState !== "hidden" && !trava.current) carregar(); };
    carregar(); window.addEventListener("focus", aoVoltar); document.addEventListener("visibilitychange", aoVoltar);
    return () => { atual = false; window.removeEventListener("focus", aoVoltar); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [aberto, api]);
  function invalidarPrevia() { versaoPrevia.current += 1; setPrevia(null); setPreparando(false); }
  async function selecionar(value, { lista = recursos, variaveis = { ...vars }, atendimentoLeadId = casoId } = {}) {
    if (trava.current) return;
    setId(value); setPrevia(null); setErro("");
    const versao = ++versaoPrevia.current;
    if (!value) { setPreparando(false); return; }
    setPreparando(true);
    try {
      const r = await api.comercial(`/recursos/${encodeURIComponent(value)}/previa`, { variaveis });
      if (typeof r?.previa?.texto !== "string" || !r.previa.texto.trim()) throw new Error("A mensagem está vazia. Revise o texto na biblioteca antes de usá-la.");
      if (vivo.current && versao === versaoPrevia.current) setPrevia({ texto: r.previa.texto, orientacaoId: value, variaveis, versao: lista.find(r => r.id === value)?.versao || null, atendimentoLeadId, usoId: `orientacao:${lista.find(r => r.id === value)?.chave}`, titulo: lista.find(r => r.id === value)?.titulo });
    } catch (e) { if (vivo.current && versao === versaoPrevia.current) setErro(e.message); }
    finally { if (vivo.current && versao === versaoPrevia.current) setPreparando(false); }
  }
  async function enviar() {
    if (disabled || trava.current || !previa || preparando) return;
    trava.current = true; setOcupado(true); setErro("");
    const conferida = previa;
    try {
      await api.enviarOrientacaoWhatsapp(conversa.id, conferida.orientacaoId ? { orientacaoId: conferida.orientacaoId, variaveis: conferida.variaveis, assumir: true, ...(Number.isInteger(conferida.versao) ? { orientacaoVersao: conferida.versao } : {}), ...(conferida.atendimentoLeadId ? { atendimentoLeadId: conferida.atendimentoLeadId } : {}) } : { texto: conferida.texto, assumir: true });
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
      if (vivo.current && versao === versaoPrevia.current) setPrevia({ usoId: `formulario:${origem}`, titulo: "Formulário preparado", texto: "Para continuarmos com " + ({ ABERTURA: "a abertura", TRANSFERENCIA: "a transferência", INATIVA: "a análise da empresa parada" }[origem]) + ", preencha este formulário: " + link + "\nVocê pode salvar por etapas. Ao concluir, os dados chegam diretamente ao nosso atendimento. Se tiver dúvida, pode responder por aqui." });
    } catch (e) { if (vivo.current && versao === versaoPrevia.current) setErro(e.message); }
    finally { trava.current = false; if (vivo.current && versao === versaoPrevia.current) setPreparando(false); }
  }
  function fechar() { solicitadaRef.current = null; invalidarPrevia(); setAberto(false); abrirRef.current?.focus(); }
  const orientacoes = ultimasOrientacoes(recursos);
  const formularios = conversa.capacidades?.podeCriarCasoComercial !== false && api.criarLinkOnboarding ? [["ABERTURA", "Formulário de abertura", "Pedir os dados necessários para abrir uma nova empresa."], ["TRANSFERENCIA", "Formulário de transferência", "Coletar os dados de quem quer trocar de contador."], ["INATIVA", "Formulário de empresa parada", "Coletar os dados para analisar uma empresa sem movimento."]].map(([origem,titulo,descricao]) => ({ usoId: `formulario:${origem}`, origem, titulo, descricao })) : [];
  const todas = [...orientacoes.map(r => ({ ...r, usoId: `orientacao:${r.chave}`, descricao: descricaoMensagem(r) })), ...formularios];
  const temUsos = todas.some(r => usos[r.usoId] > 0);
  const visiveis = todas.filter(r => (!busca && filtro === "FORMULARIOS" ? Boolean(r.origem) : true) && (!busca && filtro === "MAIS_USADAS" && temUsos ? usos[r.usoId] > 0 : true) && normalizarBuscaMensagem(`${r.titulo} ${r.descricao}`).includes(normalizarBuscaMensagem(busca))).sort((a,b) => (filtro === "MAIS_USADAS" ? (usos[b.usoId] || 0) - (usos[a.usoId] || 0) : 0) || a.titulo.localeCompare(b.titulo, "pt-BR"));
  function usarMensagem() {
    if (!previa || disabled || ocupado || preparando || !onPreparado) return;
    try {
      const { usoId, titulo, ...mensagem } = previa;
      onPreparado(mensagem);
      setUsos(registrarUsoMensagem(usuarioId, usoId, usos));
      fechar();
    } catch (e) { setErro(e.message || "Não foi possível inserir a mensagem. Seu texto foi preservado."); }
  }
  const preparandoMensagem = Boolean(id || previa || preparando);
  if (!api.comercial) return null;
  return <div className="wa-quick-library"><Button ref={abrirRef} type="button" variant="secondary" size="sm" disabled={ocupado} aria-expanded={aberto} onClick={() => { invalidarPrevia(); setAberto(v => !v); }}>Mensagens rápidas</Button>
    {aberto && <aside className="wa-quick-drawer" aria-label="Mensagens rápidas" onKeyDown={e => { if (e.key === "Escape" && !ocupado) { e.stopPropagation(); fechar(); } }}>
      <div className="wa-section-heading"><h2>Mensagens rápidas</h2><Button ref={fecharRef} variant="secondary" size="sm" disabled={ocupado} onClick={fechar}>Fechar</Button></div>
      <fieldset disabled={ocupado} style={{ border: 0, padding: 0 }}>
      {preparandoMensagem ? <div className="wa-quick-preview-heading"><Button type="button" variant="secondary" size="sm" disabled={ocupado || (preparando && !id)} onClick={() => { invalidarPrevia(); setId(""); setErro(""); }}>Voltar às mensagens</Button><h3>{previa?.titulo || recursos.find(r => r.id === id)?.titulo || "Preparar formulário"}</h3></div> : <>
      <label>Buscar mensagem rápida<input value={busca} onChange={e => setBusca(e.target.value)} /></label>
      <div className="wa-library-tabs" role="group" aria-label="Filtrar mensagens rápidas">{[["MAIS_USADAS", "Mais usadas"], ["TODAS", "Todas"], ["FORMULARIOS", "Formulários"]].map(([valor,rotulo]) => <button type="button" key={valor} aria-pressed={filtro === valor} onClick={() => setFiltro(valor)}>{rotulo}</button>)}</div>
      {filtro === "MAIS_USADAS" && !busca && <p className="wa-quick-description">{temUsos ? "Mais usadas por você neste navegador." : "Todas as mensagens até seu primeiro uso."}</p>}
      {visiveis.some(r => r.origem) && <p className="wa-quick-description">Preparar um formulário gera um link e substitui o anterior.</p>}
      <div className="wa-quick-list">{visiveis.map(r => <article className="wa-quick-card" key={r.usoId}><strong>{r.titulo}</strong><p className="wa-quick-description">{r.descricao}</p><Button variant="secondary" size="sm" disabled={carregando || Boolean(r.origem && preparando)} onClick={() => r.origem ? formulario(r.origem) : selecionar(r.id)}>{r.origem ? "Preparar formulário" : "Usar no chat"}</Button></article>)}</div>
      {!carregando && !erro && !visiveis.length && <p>Nenhuma mensagem encontrada. Tente outra palavra ou escolha Todas.</p>}
      {!carregando && !erro && !orientacoes.length && <p>Não há textos aprovados. Em Gerenciar biblioteca compartilhada, carregue os modelos iniciais, revise e aprove para disponibilizá-los aqui.</p>}
      </>}
      {id && [["nome", "Nome do destinatário"], ["cnpj", "CNPJ"], ["servico", "Serviço"]].filter(([k]) => recursos.find(r => r.id === id)?.texto?.includes("{{"+k+"}}")).map(([k,rotulo]) => <label key={k}>{rotulo}<input value={vars[k]} onChange={e => { invalidarPrevia(); setVars({ ...vars, [k]: e.target.value }); }} /></label>)}
      {id && !previa && !preparando && <Button type="button" size="sm" variant="secondary" disabled={carregando} onClick={() => selecionar(id)}>Conferir mensagem</Button>}
      {previa && <section className="wa-quick-preview" aria-label="Prévia para este contato"><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{previa.texto}</p>{onPreparado ? <><p className="wa-quick-description">Insira o texto, ajuste se precisar e clique em Responder para enviar.</p><Button type="button" disabled={disabled || ocupado || preparando} onClick={usarMensagem}>Inserir na conversa</Button></> : <Button type="button" disabled={disabled || ocupado || preparando} onClick={enviar}>Assumir e enviar orientação</Button>}</section>}
      </fieldset>
      {(carregando || preparando) && <p role="status">{carregando ? "Carregando orientações…" : "Preparando prévia…"}</p>}
      {erro && <p role="alert">{erro}</p>}
      <AbrirBiblioteca />
    </aside>}
  </div>;
}
