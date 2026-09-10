import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { FluxoComercial } from "../../onboarding/components/FluxoComercial";

// Remontar por conversa impede exibir dados ou uma prévia do destinatário anterior.
export function AtendimentoComercial(props) {
  return <AtendimentoDaConversa key={props.conversa.id} {...props} />;
}
function AtendimentoDaConversa({ api, conversa, onCriado, candidatos = [] }) {
  const [lead, setLead] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [origem, setOrigem] = useState(""), [carregando, setCarregando] = useState(true), [recarga, setRecarga] = useState(0);
  const vivo = useRef(true), trava = useRef(false);
  const path = `/conversas/${encodeURIComponent(conversa.id)}`;
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    let atual = true;
    setLead(null); setErro(""); setCarregando(true);
    if (!api.comercial) { setCarregando(false); return; }
    api.comercial(path).then(r => { if (atual) setLead(r.atendimento); }).catch(e => { if (atual) setErro(e.message); }).finally(() => { if (atual) setCarregando(false); });
    return () => { atual = false; };
  }, [api, path, recarga]);
  async function iniciar(body) {
    if (trava.current || carregando) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      const r = await api.comercial(path + "/iniciar", body);
      if (vivo.current) { setLead(r.atendimento); await onCriado?.(); }
    } catch (e) { if (vivo.current) setErro(e.message); }
    finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }
  if (!api.comercial) return <p>Atendimento comercial disponível com a API atualizada.</p>;
  return <section aria-label="Atendimento do interessado">
    <strong>Atendimento comercial</strong><p>A IA registra as respostas nesta conversa quando o piloto está habilitado. Você pode conferir os dados e preparar a proposta por aqui.</p>
    {erro && <div role="alert">{erro} <Button type="button" variant="secondary" disabled={ocupado} onClick={() => setRecarga(v => v + 1)}>Recarregar atendimento comercial</Button></div>}
    {carregando ? <p role="status">Carregando atendimento…</p> : lead?.onboardingId ? <FluxoComercial key={lead.onboardingId} api={api} onboardingId={lead.onboardingId} /> : <fieldset disabled={ocupado || !!erro} style={{ border: 0, padding: 0 }}>
      {candidatos.filter(c => !["CONVERTIDO", "DESISTIU", "CONCLUIDO_AVULSO"].includes(c.status)).map(c => <p key={c.id}><a href={`/onboardings/${encodeURIComponent(c.id)}`}>Conferir ficha {c.origem} · {c.status}</a>{" "}<Button type="button" onClick={() => iniciar({ onboardingId: c.id })}>Conferi: vincular esta ficha</Button></p>)}
      <label>Motivo do atendimento<select value={origem} onChange={e => setOrigem(e.target.value)}><option value="">Identificar durante a conversa</option><option value="ABERTURA">Abertura</option><option value="TRANSFERENCIA">Transferência</option><option value="INATIVA">Empresa parada</option></select></label>{" "}
      <Button type="button" onClick={() => iniciar({ origem: origem || null })}>{ocupado ? "Salvando…" : lead ? "Definir motivo do atendimento" : "Iniciar atendimento"}</Button>
    </fieldset>}
  </section>;
}

export function OrientacoesRapidas(props) {
  return <OrientacoesDaConversa key={props.conversa.id} {...props} />;
}
function OrientacoesDaConversa({ api, conversa, onEnviado, disabled }) {
  const [aberto, setAberto] = useState(false), [recursos, setRecursos] = useState([]), [id, setId] = useState(""), [previa, setPrevia] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [preparando, setPreparando] = useState(false), [carregando, setCarregando] = useState(false);
  const [vars, setVars] = useState({ nome: conversa.contato?.nome || conversa.nomePerfilProvedor || "", cnpj: conversa.empresa?.cnpj || "", servico: "" });
  const vivo = useRef(true), versaoPrevia = useRef(0), trava = useRef(false);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; versaoPrevia.current += 1; }; }, []);
  useEffect(() => {
    if (!aberto || !api.comercial) return;
    let atual = true;
    setCarregando(true); setErro("");
    api.comercial("/recursos").then(r => { if (atual) setRecursos(r.recursos.filter(x => x.tipo === "ORIENTACAO" && x.aprovadoEm)); }).catch(e => { if (atual) setErro(e.message); }).finally(() => { if (atual) setCarregando(false); });
    return () => { atual = false; };
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
      await api.enviarOrientacaoWhatsapp(conversa.id, { orientacaoId: conferida.orientacaoId, variaveis: conferida.variaveis, assumir: true });
      if (vivo.current) { invalidarPrevia(); setId(""); setAberto(false); await onEnviado?.(); }
    } catch (e) { if (vivo.current) setErro(e.message); }
    finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }
  if (!api.comercial) return null;
  return <div><Button type="button" variant="secondary" size="sm" disabled={ocupado} onClick={() => { invalidarPrevia(); setAberto(v => !v); }}>Mensagens rápidas</Button>
    {aberto && <fieldset disabled={ocupado} style={{ padding: 8, border: "1px solid var(--border)" }}>
      <legend>Preparar orientação para este contato</legend>
      <label>Orientação<select disabled={carregando} value={id} onChange={e => selecionar(e.target.value)}><option value="">Selecione uma orientação aprovada</option>{recursos.map(r => <option key={r.id} value={r.id}>/{r.chave} — {r.titulo} · v{r.versao}</option>)}</select></label>
      {[["nome", "Nome do destinatário"], ["cnpj", "CNPJ"], ["servico", "Serviço (quando solicitado pelo texto)"]].map(([k, rotulo]) => <label key={k} style={{ display: "block" }}>{rotulo}<input value={vars[k]} onChange={e => { invalidarPrevia(); setVars({ ...vars, [k]: e.target.value }); }} /></label>)}
      <Button type="button" size="sm" variant="secondary" disabled={!id || preparando || carregando} onClick={() => selecionar(id)}>Conferir mensagem</Button>
      {(carregando || preparando) && <p role="status">{carregando ? "Carregando orientações…" : "Preparando prévia…"}</p>}
      {previa && <><p style={{ whiteSpace: "pre-wrap" }}>{previa.texto}</p><Button type="button" disabled={disabled || ocupado} onClick={enviar}>Assumir e enviar orientação</Button></>}
      {erro && <p role="alert">{erro}</p>}
      {!carregando && !erro && !recursos.length && <p>Cadastre e aprove os textos na biblioteca do atendimento comercial.</p>}
    </fieldset>}
  </div>;
}
