import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

export function ConferirIdentificacao({ conversa, api, onConferido }) {
  const [aberto, setAberto] = useState(false), [previa, setPrevia] = useState(false);
  const [acao, setAcao] = useState("CONFIRMAR"), [evidencia, setEvidencia] = useState("");
  const [nome, setNome] = useState(""), [tipo, setTipo] = useState("PESSOA");
  const [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const [busca, setBusca] = useState(""), [destinos, setDestinos] = useState([]), [destino, setDestino] = useState(null);
  const [buscando, setBuscando] = useState(false), [erroBusca, setErroBusca] = useState("");
  const versao = useRef(null), trava = useRef(false);
  useEffect(() => {
    let vivo = true;
    setDestinos([]); setErroBusca("");
    if (!aberto || acao !== "ASSOCIAR_NUMERO" || busca.trim().length < 3) { setBuscando(false); return; }
    setBuscando(true);
    const timer = setTimeout(async () => {
      try {
        const r = await api.listarConversasWhatsapp("todas", { q: busca.trim(), limite: 30 });
        if (vivo) setDestinos((r.conversas || []).filter(c => c.capacidades?.conferirIdentidade && c.interlocutorId && c.interlocutorId !== conversa.interlocutorId));
      } catch (e) { if (vivo) setErroBusca(e.message || "Não foi possível buscar os contatos."); }
      finally { if (vivo) setBuscando(false); }
    }, 250);
    return () => { vivo = false; clearTimeout(timer); };
  }, [api, aberto, acao, busca, conversa.interlocutorId]);
  if (!conversa.capacidades?.conferirIdentidade || typeof api?.conferirIdentificacaoWhatsapp !== "function") return null;
  function alterar(fn) { setPrevia(false); fn(); }
  async function salvar() {
    if (trava.current || !previa || evidencia.trim().length < 10 || (acao === "ASSOCIAR_NUMERO" && !destino)) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      await api.conferirIdentificacaoWhatsapp(conversa.id, { acao, versao: versao.current, evidencia: evidencia.trim(), ...(acao === "ASSOCIAR_NUMERO" ? { destinoConversaId: destino.id, versaoDestino: destino.identidade.versao } : { ...(nome.trim() ? { nome: nome.trim() } : {}), tipo }) });
      setAberto(false); setPrevia(false); setEvidencia(""); await onConferido?.();
    } catch (e) { setErro(e.message || "A identificação não foi confirmada. Atualize antes de continuar."); }
    finally { trava.current = false; setOcupado(false); }
  }
  if (!aberto) return <Button variant="secondary" size="sm" onClick={() => { versao.current = conversa.identidade?.versao; setAberto(true); }}>Conferir identificação</Button>;
  return <section className="wa-identity-review" aria-label="Conferir identificação"><fieldset disabled={ocupado}>
    <legend>Conferência pelo escritório</legend><p>Registre a prova usada. Nome e CNPJ públicos, ou um código enviado apenas ao número novo, não comprovam representação da empresa.</p>
    <label>Resultado<select value={acao} onChange={e => alterar(() => setAcao(e.target.value))}><option value="CONFIRMAR">Cadastro e interlocutor conferidos</option><option value="CONTESTAR">Identificação contestada</option><option value="NOVO_TITULAR">Este número pertence a outro titular</option>{api.whatsappContratoV2 && <option value="ASSOCIAR_NUMERO">É a mesma pessoa de outro contato</option>}</select></label>
    {acao === "ASSOCIAR_NUMERO" && <div><label>Buscar contato já conhecido<input value={busca} placeholder="Nome, empresa ou telefone" onChange={e => alterar(() => { setBusca(e.target.value); setDestino(null); })} /></label><p>Digite pelo menos três caracteres. Confira o nome e o telefone com uma fonte independente.</p>{buscando && <p role="status">Buscando contatos…</p>}{erroBusca && <p role="alert">{erroBusca}</p>}<div className="wa-identity-matches">{destinos.map(c => <Button key={c.id} variant="secondary" aria-pressed={destino?.id === c.id} onClick={() => alterar(() => setDestino(c))}>{c.contato?.nome || c.nomePerfilProvedor || "Contato"} · {c.telefoneMascarado}{c.empresa?.razao ? ` · ${c.empresa.razao}` : ""}</Button>)}</div>{!buscando && busca.trim().length >= 3 && !destinos.length && !erroBusca && <p>Nenhum contato elegível encontrado. Refine a busca pelo telefone.</p>}{destino && <p>Contato escolhido: <strong>{destino.contato?.nome || destino.nomePerfilProvedor || "Contato"} · {destino.telefoneMascarado}</strong>.</p>}</div>}
    <label>Evidência da conferência<textarea value={evidencia} maxLength={1200} rows={3} onChange={e => alterar(() => setEvidencia(e.target.value))} /></label>
    {["CONFIRMAR", "NOVO_TITULAR"].includes(acao) && <><label>Nome conferido (opcional)<input value={nome} maxLength={120} onChange={e => alterar(() => setNome(e.target.value))} /></label><label>Uso do número<select value={tipo} onChange={e => alterar(() => setTipo(e.target.value))}><option value="PESSOA">Pessoa</option><option value="COMPARTILHADO">Equipe ou número compartilhado</option></select></label></>}
    {versao.current !== conversa.identidade?.versao ? <p role="alert">O cadastro mudou durante a conferência. Feche e prepare novamente.</p> : previa ? <div className="wa-draft-preview"><strong>Confira a consequência</strong><p>{acao === "ASSOCIAR_NUMERO" ? "Os históricos conferidos serão reunidos nesta pessoa. Isto não transfere destinatários de guias, permissões do portal ou consentimentos. Atualize os canais de comunicação no cadastro da empresa, quando necessário." : acao === "NOVO_TITULAR" ? "O vínculo anterior será encerrado. O novo titular não receberá o histórico, as permissões ou os consentimentos anteriores. Confirmações pendentes serão invalidadas." : acao === "CONTESTAR" ? "A automação sensível será interrompida até a identificação ser resolvida." : "A conferência ficará auditada. Não cria acesso ao portal nem permissão fiscal."}</p><p>{evidencia}</p><Button onClick={salvar}>Confirmar registro da identificação</Button></div> : <Button disabled={evidencia.trim().length < 10 || (acao === "ASSOCIAR_NUMERO" && !destino)} onClick={() => setPrevia(true)}>Revisar identificação</Button>}
    <Button variant="secondary" onClick={() => { setAberto(false); setPrevia(false); }}>Cancelar</Button>
    {erro && <p role="alert">{erro}</p>}
  </fieldset></section>;
}
