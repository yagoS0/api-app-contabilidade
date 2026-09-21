import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { AnexoDaConversa } from "./AnexoDaConversa";
import { OrientacoesRapidas } from "./AtendimentoComercial";
import { estadoDaResposta } from "../lib/conversasTela";
import { canaisDaConversa, canalInicialDaConversa, chaveDoRascunho, canalComercialDaConversa } from "../lib/identidadeAtendimento";

export function CompositorConversa({ conversa, hook, slotAcoes, onCanalSelecionado = null, pedidoCanal = null, usuarioId = null }) {
  const canais = canaisDaConversa(conversa);
  const comercialObrigatorio = conversa.relacionamento?.tipo === "LEAD";
  const comercialId = canalComercialDaConversa(conversa)?.id;
  const [canalId, setCanalId] = useState(() => canalInicialDaConversa(conversa));
  useEffect(() => { if (comercialObrigatorio) setCanalId(comercialId); }, [comercialObrigatorio, comercialId]);
  useEffect(() => {
    if (pedidoCanal?.interlocutorId === (conversa.interlocutorId || conversa.id) && (!comercialObrigatorio || pedidoCanal.canalId === comercialId) && canais.some(c => c.id === pedidoCanal.canalId)) setCanalId(pedidoCanal.canalId);
  }, [pedidoCanal]);

  // Nunca seguir silenciosamente o canal de uma nova mensagem recebida.
  const canal = canais.find(c => c.id === canalId);
  const destino = canal?.conversaId || (canais.length === 1 ? conversa.id : null);
  const destinoAtual = { conversaId: destino, vinculoNumeroId: canal?.vinculoNumeroId || null };
  const conversaCanal = { ...conversa, id: destino, canalId, telefoneMascarado: canal?.telefoneMascarado || conversa.telefoneMascarado, janela: canal?.janela || (canais.length === 1 ? conversa.janela : null) };
  const resposta = canal?.podeResponder === false ? { pode: false, motivo: canal?.janela?.situacao === "ABERTA" ? "Este canal está indisponível para responder. Selecione um canal ativo e confira a mensagem." : estadoDaResposta(conversaCanal).motivo } : canal ? estadoDaResposta(conversaCanal) : { pode: false, motivo: "O canal preparado não está mais disponível. Selecione um canal e confira a mensagem." };
  const chave = chaveDoRascunho(conversa, { canalId });
  const chaveRef = useRef(chave);
  const inicial = () => hook.rascunhosRef?.current.get(chave) || (conversa.interlocutorId ? "" : hook.rascunhosRef?.current.get(conversa.id)) || "";
  const [rascunho, setRascunho] = useState(inicial);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState(false);
  const [descartado, setDescartado] = useState(null);
  const textoRef = useRef(null);
  const trava = useRef(false);
  const texto = typeof rascunho === "string" ? rascunho : rascunho.texto || "";
  const orientacao = typeof rascunho === "object" ? rascunho.orientacao : null;
  const editada = Boolean(orientacao?.orientacaoId && texto !== orientacao.texto);
  const destinoPreparado = typeof rascunho === "object" ? rascunho.destinoPreparado : null;
  const destinoMudou = Boolean(texto.trim() && destinoPreparado && JSON.stringify(destinoPreparado) !== JSON.stringify(destinoAtual));
  useEffect(() => { if (canal && destino && !destinoMudou) onCanalSelecionado?.({ interlocutorId: conversa.interlocutorId || conversa.id, canalId, conversaId: destino, nome: canal.nome || canal.chave || canal.finalidade || "Principal" }); }, [canalId, destino, destinoMudou, conversa.interlocutorId, onCanalSelecionado]);
  useEffect(() => {
    chaveRef.current = chave;
    const salvo = hook.rascunhosRef?.current.get(chave) || "";
    // Migração do rascunho legado em memória. O destino fica salvo junto do texto,
    // inclusive ao sair deste contato e retornar depois de outro polling.
    const preparado = salvo && !salvo.destinoPreparado
      ? { ...(typeof salvo === "string" ? { texto: salvo } : salvo), destinoPreparado: destinoAtual } : salvo;
    if (preparado !== salvo) hook.rascunhosRef?.current.set(chave, preparado);
    setRascunho(preparado);
    setErro(""); setPrevia(false); setDescartado(null);
  }, [chave, hook.rascunhosRef]);
  function salvarDraft(valor) {
    const preparado = { ...(typeof valor === "string" ? { texto: valor } : valor), destinoPreparado: valor?.destinoPreparado || destinoPreparado || destinoAtual };
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
    if (trava.current || hook.ocupado || !texto.trim() || !destino || destinoMudou || !resposta.pode) return;
    if (editada && !previa) { setPrevia(true); return; }
    trava.current = true; setOcupado(true); setErro("");
    const chaveEnviada = chave, conteudo = texto.trim();
    try {
      let r;
      if (orientacao && typeof hook.api?.enviarOrientacaoWhatsapp === "function") {
        if (orientacao.conversaId !== destino || orientacao.canalId !== canalId) throw new Error("O destinatário da orientação mudou. Prepare a mensagem novamente.");
        r = await hook.api.enviarOrientacaoWhatsapp(destino, editada
          ? { texto: conteudo, assumir: true, orientacaoAdaptada: { id: orientacao.orientacaoId, versao: orientacao.versao, atendimentoLeadId: orientacao.atendimentoLeadId || null } }
          : orientacao.orientacaoId ? { orientacaoId: orientacao.orientacaoId, variaveis: orientacao.variaveis, assumir: true, ...(Number.isInteger(orientacao.versao) ? { orientacaoVersao: orientacao.versao } : {}), ...(orientacao.atendimentoLeadId ? { atendimentoLeadId: orientacao.atendimentoLeadId } : {}) } : { texto: conteudo, assumir: true });
        await hook.atualizarConversa(conversa.id);
      } else r = await hook.responder(destino, conteudo);
      if (!r || r.ok === false) throw r?.erro || new Error("O resultado não foi confirmado. Confira o histórico antes de reenviar.");
      const atual = hook.rascunhosRef?.current.get(chaveEnviada);
      if ((typeof atual === "string" ? atual : atual?.texto)?.trim() === conteudo) {
        hook.rascunhosRef?.current.delete(chaveEnviada);
        if (chaveRef.current === chaveEnviada) setRascunho("");
      }
      setPrevia(false);
    } catch (e) { if (chaveRef.current === chaveEnviada) setErro(e?.payload?.message || e.message || "Não foi possível enviar."); }
    finally { trava.current = false; setOcupado(false); }
  }
  const bloqueado = ocupado || hook.ocupado || destinoMudou || !resposta.pode;
  return <div className="wa-composer">
    <div className="wa-composer-row"><textarea ref={textoRef} aria-label="Responder ao cliente" value={texto} onChange={e => mudarTexto(e.target.value)} disabled={bloqueado} placeholder="Escreva uma mensagem para este contato…" onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); } }} /></div>
    <div className="wa-compose-footer">
      <div className="wa-composer-tools">
        <AnexoDaConversa key={`anexo-${destino}`} api={hook.api} conversa={conversaCanal} disabled={bloqueado} onEnviado={() => hook.atualizarConversa(conversa.id)} />
        {hook.api?.comercial && <OrientacoesRapidas key={`orientacoes-${destino}`} api={hook.api} conversa={conversaCanal} usuarioId={usuarioId} disabled={bloqueado} onEnviado={() => hook.atualizarConversa(conversa.id)} onPreparado={p => {
          if (bloqueado) throw new Error("Este canal não está disponível para preparar uma resposta.");
          if (texto.trim()) throw new Error("Você já tem um rascunho nesta conversa. Envie ou descarte esse texto antes de inserir a mensagem pronta.");
          salvarDraft({ texto: p.texto, orientacao: { ...p, conversaId: destino, canalId } });
          requestAnimationFrame(() => textoRef.current?.focus());
        }} />}
        {(!conversa.atendimento || conversa.atendimento.contextoSelecionado) && slotAcoes && <details className="wa-composer-documents"><summary>Guias e documentos</summary>{slotAcoes}</details>}
      </div>
      <Button variant="primary" disabled={bloqueado || !texto.trim()} onClick={enviar}>{editada ? previa ? "Conferi: enviar adaptação" : "Conferir adaptação" : "Responder"}</Button>
    </div>
    {destinoMudou && <div role="alert" className="wa-draft-preview"><strong>Confira o destinatário antes de continuar</strong><p>O número ou vínculo de destino deste canal mudou enquanto a mensagem estava preparada. Seu texto foi preservado. Destinatário atual: <strong>{conversaCanal.telefoneMascarado || "número a conferir no contato"}</strong>.</p><p>{texto}</p><Button variant="secondary" disabled={ocupado || hook.ocupado || !destino} onClick={() => salvarDraft({ texto, destinoPreparado: destinoAtual, ...(orientacao ? { orientacao: { ...orientacao, conversaId: destino, canalId } } : {}) })}>Conferi o destinatário: manter este rascunho</Button></div>}
    {!resposta.pode && <p data-testid="resposta-bloqueada" className="wa-list-note">{comercialObrigatorio && !comercialId ? "Leads são atendidos pelo WhatsApp Comercial. Este contato ainda não tem conversa nesse número." : resposta.motivo}</p>}
    {orientacao && <p className="wa-list-note">{editada ? "Texto adaptado: confira a prévia antes de enviar. Não certifica a orientação original." : "Mensagem inserida. Confira o texto e clique em Responder para enviar."}<button type="button" onClick={() => salvarDraft(texto)}>Desvincular orientação</button></p>}
    {previa && <div className="wa-draft-preview"><strong>Confira o texto adaptado</strong><p>{texto}</p></div>}
    <div className="wa-composer-hint"><span>{`WhatsApp ${comercialObrigatorio ? "Comercial" : canal?.nome || canal?.chave || ""} · Ctrl + Enter para enviar`}</span>{(texto || orientacao) && <button type="button" disabled={ocupado || hook.ocupado} onClick={descartar}>Descartar rascunho</button>}</div>
    {descartado?.chave === chave && <div className="wa-draft-undo" role="status">Rascunho descartado. <button type="button" disabled={ocupado || hook.ocupado} onClick={desfazerDescarte}>Desfazer</button></div>}
    {erro && !hook.erroAcao && <p role="alert" className="wa-list-note">{erro}</p>}
  </div>;
}
