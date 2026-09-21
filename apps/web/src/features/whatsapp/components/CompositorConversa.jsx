import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { AnexoDaConversa } from "./AnexoDaConversa";
import { OrientacoesRapidas } from "./AtendimentoComercial";
import { estadoDaResposta } from "../lib/conversasTela";
import { canaisDaConversa, chaveDoRascunho, escoposDeNota } from "../lib/identidadeAtendimento";

export function CompositorConversa({ conversa, hook, slotAcoes, onCanalSelecionado = null, usuarioId = null }) {
  const canais = canaisDaConversa(conversa);
  const [canalId, setCanalId] = useState(() => conversa.canalId || canais[0]?.id);
  const [modo, setModo] = useState("MENSAGEM");
  const escopos = escoposDeNota(conversa);
  const [escopoId, setEscopoId] = useState("");
  const escopo = escopos.find(e => e.id === escopoId) || (!escopoId && escopos.length === 1 ? escopos[0] : null);
  // Nunca seguir silenciosamente o canal de uma nova mensagem recebida.
  const canal = canais.find(c => c.id === canalId);
  const destino = canal?.conversaId || (canais.length === 1 ? conversa.id : null);
  const destinoAtual = { conversaId: destino, vinculoNumeroId: canal?.vinculoNumeroId || null };
  const conversaCanal = { ...conversa, id: destino, canalId, telefoneMascarado: canal?.telefoneMascarado || conversa.telefoneMascarado, janela: canal?.janela || (canais.length === 1 ? conversa.janela : null) };
  const resposta = canal?.podeResponder === false ? { pode: false, motivo: canal?.janela?.situacao === "ABERTA" ? "Este canal está indisponível para responder. Selecione um canal ativo e confira a mensagem." : estadoDaResposta(conversaCanal).motivo } : canal ? estadoDaResposta(conversaCanal) : { pode: false, motivo: "O canal preparado não está mais disponível. Selecione um canal e confira a mensagem." };
  const chave = chaveDoRascunho(conversa, { canalId, modo, escopo });
  const chaveRef = useRef(chave);
  const inicial = () => hook.rascunhosRef?.current.get(chave) || (conversa.interlocutorId ? "" : hook.rascunhosRef?.current.get(conversa.id)) || "";
  const [rascunho, setRascunho] = useState(inicial);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState(false);
  const [descartado, setDescartado] = useState(null);
  const textoRef = useRef(null);
  const trava = useRef(false), tentativas = useRef(new Map());
  const texto = typeof rascunho === "string" ? rascunho : rascunho.texto || "";
  const orientacao = typeof rascunho === "object" ? rascunho.orientacao : null;
  const editada = Boolean(orientacao?.orientacaoId && texto !== orientacao.texto);
  const destinoPreparado = typeof rascunho === "object" ? rascunho.destinoPreparado : null;
  const destinoMudou = modo === "MENSAGEM" && Boolean(texto.trim() && destinoPreparado && JSON.stringify(destinoPreparado) !== JSON.stringify(destinoAtual));
  useEffect(() => { if (canal && destino && !destinoMudou) onCanalSelecionado?.({ interlocutorId: conversa.interlocutorId || conversa.id, canalId, conversaId: destino, nome: canal.nome || canal.chave || canal.finalidade || "Principal" }); }, [canalId, destino, destinoMudou, conversa.interlocutorId, onCanalSelecionado]);
  useEffect(() => {
    chaveRef.current = chave;
    const salvo = hook.rascunhosRef?.current.get(chave) || "";
    // Migração do rascunho legado em memória. O destino fica salvo junto do texto,
    // inclusive ao sair deste contato e retornar depois de outro polling.
    const preparado = modo === "MENSAGEM" && salvo && !salvo.destinoPreparado
      ? { ...(typeof salvo === "string" ? { texto: salvo } : salvo), destinoPreparado: destinoAtual } : salvo;
    if (preparado !== salvo) hook.rascunhosRef?.current.set(chave, preparado);
    setRascunho(preparado);
    setErro(""); setPrevia(false); setDescartado(null);
  }, [chave, hook.rascunhosRef]);
  function salvarDraft(valor) {
    const preparado = modo === "MENSAGEM" ? { ...(typeof valor === "string" ? { texto: valor } : valor), destinoPreparado: valor?.destinoPreparado || destinoPreparado || destinoAtual } : valor;
    hook.rascunhosRef?.current.set(chave, preparado);
    setRascunho(preparado); setPrevia(false); setDescartado(null);
  }
  function mudarTexto(valor) { salvarDraft(orientacao ? { texto: valor, orientacao } : valor); }
  function descartar() {
    if (trava.current || hook.ocupado) return;
    setDescartado({ chave, rascunho });
    hook.rascunhosRef?.current.delete(chave);
    // O texto legado não pode reaparecer ao remontar este mesmo contato.
    if (!conversa.interlocutorId) hook.rascunhosRef?.current.delete(conversa.id);
    setRascunho(""); setErro(""); setPrevia(false);
    textoRef.current?.focus();
  }
  function desfazerDescarte() {
    if (!descartado || descartado.chave !== chave || trava.current || hook.ocupado) return;
    hook.rascunhosRef?.current.set(chave, descartado.rascunho);
    setRascunho(descartado.rascunho); setDescartado(null);
    textoRef.current?.focus();
  }
  async function enviar() {
    if (trava.current || hook.ocupado || !texto.trim() || !destino || destinoMudou || (modo === "MENSAGEM" && !resposta.pode) || (modo === "NOTA" && !escopo)) return;
    if (editada && !previa) { setPrevia(true); return; }
    trava.current = true; setOcupado(true); setErro("");
    const chaveEnviada = chave, conteudo = texto.trim();
    try {
      let r;
      if (modo === "NOTA") {
        const assinatura = JSON.stringify([escopo, conteudo]);
        let tentativa = tentativas.current.get(chave);
        if (!tentativa || tentativa.assinatura !== assinatura) {
          tentativa = { assinatura, id: globalThis.crypto?.randomUUID?.() || `nota-${Date.now()}-${Math.random().toString(36).slice(2)}` };
          tentativas.current.set(chave, tentativa);
        }
        r = await hook.salvarNota(destino, { texto: conteudo, escopo: escopo.escopo, ...(escopo.portalClientId ? { portalClientId: escopo.portalClientId } : {}), ...(escopo.atendimentoLeadId ? { atendimentoLeadId: escopo.atendimentoLeadId } : {}), chaveIdempotencia: tentativa.id });
      } else if (orientacao && typeof hook.api?.enviarOrientacaoWhatsapp === "function") {
        if (orientacao.conversaId !== destino || orientacao.canalId !== canalId) throw new Error("O destinatário da orientação mudou. Prepare a mensagem novamente.");
        r = await hook.api.enviarOrientacaoWhatsapp(destino, editada
          ? { texto: conteudo, assumir: true, orientacaoAdaptada: { id: orientacao.orientacaoId, versao: orientacao.versao, atendimentoLeadId: orientacao.atendimentoLeadId || null } }
          : orientacao.orientacaoId ? { orientacaoId: orientacao.orientacaoId, variaveis: orientacao.variaveis, assumir: true, ...(Number.isInteger(orientacao.versao) ? { orientacaoVersao: orientacao.versao } : {}), ...(orientacao.atendimentoLeadId ? { atendimentoLeadId: orientacao.atendimentoLeadId } : {}) } : { texto: conteudo, assumir: true });
        await hook.abrir(conversa.id, true);
      } else r = await hook.responder(destino, conteudo);
      if (!r || r.ok === false) throw r?.erro || new Error("O resultado não foi confirmado. Confira o histórico antes de reenviar.");
      const atual = hook.rascunhosRef?.current.get(chaveEnviada);
      if ((typeof atual === "string" ? atual : atual?.texto)?.trim() === conteudo) {
        hook.rascunhosRef?.current.delete(chaveEnviada);
        if (chaveRef.current === chaveEnviada) setRascunho("");
      }
      tentativas.current.delete(chaveEnviada); setPrevia(false);
    } catch (e) { if (chaveRef.current === chaveEnviada) setErro(e?.payload?.message || e.message || "Não foi possível enviar."); }
    finally { trava.current = false; setOcupado(false); }
  }
  const bloqueado = ocupado || hook.ocupado || destinoMudou || (modo === "NOTA" ? !escopo || !hook.salvarNota : !resposta.pode);
  return <div className="wa-composer" data-modo={modo}>
    <div className="wa-compose-tabs"><button type="button" aria-pressed={modo === "MENSAGEM"} onClick={() => setModo("MENSAGEM")} disabled={ocupado}>Mensagem</button>
      {escopos.length > 0 && typeof hook.api?.criarNotaInternaWhatsapp === "function" && <button type="button" aria-pressed={modo === "NOTA"} onClick={() => setModo("NOTA")} disabled={ocupado}>Nota interna · só a equipe</button>}
      {canais.length > 1 ? <label>Enviar por <select aria-label="Canal da resposta" value={canalId || ""} disabled={ocupado} onChange={e => setCanalId(e.target.value)}>{!canal && <option value="">Selecione</option>}{canais.map(c => <option key={c.id} value={c.id}>{c.nome || c.chave || c.finalidade}</option>)}</select></label> : <span className="wa-channel-label">WhatsApp · {canal?.nome || canal?.chave || "Principal"}</span>}
    </div>
    {destinoMudou && <div role="alert" className="wa-draft-preview"><strong>Confira o destinatário antes de continuar</strong><p>O número ou vínculo de destino deste canal mudou enquanto a mensagem estava preparada. Seu texto foi preservado. Destinatário atual: <strong>{conversaCanal.telefoneMascarado || "número a conferir no contato"}</strong>.</p><p>{texto}</p><Button variant="secondary" disabled={ocupado || hook.ocupado || !destino} onClick={() => salvarDraft({ texto, destinoPreparado: destinoAtual, ...(orientacao ? { orientacao: { ...orientacao, conversaId: destino, canalId } } : {}) })}>Conferi o destinatário: manter este rascunho</Button></div>}
    {modo === "NOTA" ? <div className="wa-note-scope"><label>Salvar nota para <select aria-label="Escopo da nota interna" value={escopo?.id || ""} onChange={e => setEscopoId(e.target.value)} disabled={ocupado}><option value="">Selecione o caso ou a empresa</option>{escopos.map(e => <option key={e.id} value={e.id}>{e.rotulo}</option>)}</select></label><p>Esta nota fica visível apenas à equipe autorizada. Não será enviada ao WhatsApp.</p></div> : <>
      {!resposta.pode && <p data-testid="resposta-bloqueada" className="wa-list-note">{resposta.motivo}</p>}
    </>}
    {orientacao && modo === "MENSAGEM" && <p className="wa-list-note">{editada ? "Texto adaptado: confira a prévia antes de enviar. Não certifica a orientação original." : "Orientação preparada da biblioteca aprovada."}<button type="button" onClick={() => salvarDraft(texto)}>Desvincular orientação</button></p>}
    {previa && <div className="wa-draft-preview"><strong>Confira o texto adaptado</strong><p>{texto}</p></div>}
    <div className="wa-composer-row"><textarea ref={textoRef} aria-label={modo === "NOTA" ? "Texto da nota interna" : "Responder ao cliente"} value={texto} onChange={e => mudarTexto(e.target.value)} disabled={bloqueado} placeholder={modo === "NOTA" ? "Anote o que a equipe precisa saber…" : "Escreva uma mensagem para este contato…"} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); } }} /></div>
    <div className="wa-compose-footer">
      <div className="wa-composer-tools">{modo === "MENSAGEM" && <>
        <AnexoDaConversa key={`anexo-${destino}`} api={hook.api} conversa={conversaCanal} disabled={bloqueado} onEnviado={() => hook.abrir(conversa.id, true)} />
        {hook.api?.comercial && <OrientacoesRapidas key={`orientacoes-${destino}`} api={hook.api} conversa={conversaCanal} usuarioId={usuarioId} disabled={bloqueado} onEnviado={() => hook.abrir(conversa.id, true)} onPreparado={p => { salvarDraft({ texto: p.texto, orientacao: { ...p, conversaId: destino, canalId } }); }} />}
        {(!conversa.atendimento || conversa.atendimento.contextoSelecionado) && slotAcoes && <details className="wa-composer-documents"><summary>Guias e documentos</summary>{slotAcoes}</details>}
      </>}</div>
      <Button variant="primary" disabled={bloqueado || !texto.trim()} onClick={enviar}>{modo === "NOTA" ? "Salvar nota interna" : editada ? previa ? "Conferi: enviar adaptação" : "Conferir adaptação" : "Responder"}</Button>
    </div>
    <div className="wa-composer-hint"><span>{modo === "NOTA" ? `Nota interna · ${escopo?.rotulo || "Escolha o escopo"}` : "Ctrl + Enter para enviar"}</span>{(texto || orientacao) && <button type="button" disabled={ocupado || hook.ocupado} onClick={descartar}>Descartar rascunho</button>}</div>
    {descartado?.chave === chave && <div className="wa-draft-undo" role="status">Rascunho descartado. <button type="button" disabled={ocupado || hook.ocupado} onClick={desfazerDescarte}>Desfazer</button></div>}
    {erro && !hook.erroAcao && <p role="alert" className="wa-list-note">{erro}</p>}
  </div>;
}
