import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { useRascunhoServidor } from "../hooks/useRascunhoServidor";
import { novaIntencao, precisaConferirIntencao } from "../lib/atendimentoPwa";
import { RetomarConversa } from "./RetomarConversa";
import { AnexoDaConversa } from "./AnexoDaConversa";
import { WhatsappIcon } from "./ConversaVisual";
import { useTelaPequena } from "../hooks/useTelaPequena";
import { OrientacoesRapidas } from "./AtendimentoComercial";
import { estadoDaResposta } from "../lib/conversasTela";
import { canaisDaConversa, canalInicialDaConversa, chaveDoRascunho, canalComercialDaConversa } from "../lib/identidadeAtendimento";

export function CompositorConversa({ conversa, hook, slotAcoes, onCanalSelecionado = null, pedidoCanal = null, usuarioId = null }) {
  const mobile = useTelaPequena();
  const [acoesAbertas, setAcoesAbertas] = useState(false);
  const [acoesPendentes, setAcoesPendentes] = useState(false);
  const ferramentasRef = useRef(null);
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
  const conversaCanal = { ...conversa, id: destino, canalId, canalNome: canal?.nome || canal?.chave || canal?.finalidade, podeResponder: canal?.podeResponder, telefoneMascarado: canal?.telefoneMascarado || conversa.telefoneMascarado, janela: canal?.janela || (canais.length === 1 ? conversa.janela : null) };
  const resposta = canal?.podeResponder === false ? { pode: false, motivo: canal?.janela?.situacao === "ABERTA" ? "Este canal está indisponível para responder. Selecione um canal ativo e confira a mensagem." : estadoDaResposta(conversaCanal).motivo } : canal ? estadoDaResposta(conversaCanal) : { pode: false, motivo: "O canal preparado não está mais disponível. Selecione um canal e confira a mensagem." };
  const chave = chaveDoRascunho(conversa, { canalId });
  const chaveRef = useRef(chave);
  const inicial = () => hook.rascunhosRef?.current.get(chave) || (conversa.interlocutorId ? "" : hook.rascunhosRef?.current.get(conversa.id)) || "";
  const [rascunho, setRascunho] = useState(inicial);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [consultandoEnvio, setConsultandoEnvio] = useState(false);
  const [previa, setPrevia] = useState(false);
  const [descartado, setDescartado] = useState(null);
  const [versaoRemota, setVersaoRemota] = useState(null);
  const remoto = useRascunhoServidor({ api: hook.api, conversaId: destino, onRestaurar: valor => { hook.rascunhosRef?.current.set(chave, valor); if (chaveRef.current === chave) setRascunho(valor); } });
  const incerto = Boolean(rascunho?.envioIncerto);
  const textoRef = useRef(null);
  const trava = useRef(false);
  const texto = typeof rascunho === "string" ? rascunho : rascunho.texto || "";
  useEffect(() => {
    const el = textoRef.current;
    if (!el) return;
    if (!mobile) { el.style.height = ""; return; }
    el.style.height = "0px";
    el.style.height = `${Math.max(44, Math.min(96, el.scrollHeight))}px`;
  }, [texto, mobile]);
  useEffect(() => {
    const el = ferramentasRef.current;
    if (!el) return;
    const conferir = () => setAcoesPendentes(Boolean(el.querySelector('[data-envio-pendente="true"]')));
    const observer = new MutationObserver(conferir); conferir();
    observer.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-envio-pendente"] });
    return () => observer.disconnect();
  }, []);
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
    setErro(""); setPrevia(false); setDescartado(null); setVersaoRemota(null);
  }, [chave, hook.rascunhosRef]);
  function salvarDraft(valor) {
    const preparado = { ...(typeof valor === "string" ? { texto: valor } : valor), destinoPreparado: valor?.destinoPreparado || destinoPreparado || destinoAtual };
    hook.rascunhosRef?.current.set(chave, preparado);
    setRascunho(preparado); remoto.salvar(preparado); setPrevia(false); setDescartado(null);
  }
  function mudarTexto(valor) { salvarDraft(orientacao ? { texto: valor, orientacao } : valor); }
  async function descartar() {
    if (trava.current || hook.ocupado || incerto) return;
    if (hook.api?.excluirRascunhoWhatsapp && !(await remoto.excluir())) return;
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
    setRascunho(descartado.rascunho); remoto.salvar(descartado.rascunho); setDescartado(null);
    textoRef.current?.focus();
  }
  async function enviar() {
    if (trava.current || hook.ocupado || !texto.trim() || !destino || destinoMudou || !resposta.pode || incerto || !remoto.pronto) return;
    if (editada && !previa) { setPrevia(true); return; }
    trava.current = true; setOcupado(true); setErro("");
    const chaveEnviada = chave, conteudo = texto.trim();
    const clientRequestId = rascunho?.intencaoTexto === conteudo && rascunho?.clientRequestId ? rascunho.clientRequestId : novaIntencao();
    const preparado = { ...(typeof rascunho === "object" ? rascunho : {}), texto, destinoPreparado: destinoAtual, clientRequestId, intencaoTexto: conteudo, envioIncerto: true };
    hook.rascunhosRef?.current.set(chaveEnviada, preparado); setRascunho(preparado);
    let transporteIniciado = false;
    try {
      if (hook.api?.salvarRascunhoWhatsapp && !(await remoto.salvar(preparado, true))) throw new Error("Salve o rascunho antes de enviar; nenhuma mensagem foi enviada.");
      let r; transporteIniciado = true;
      if (orientacao && typeof hook.api?.enviarOrientacaoWhatsapp === "function") {
        if (orientacao.conversaId !== destino || orientacao.canalId !== canalId) throw new Error("O destinatário da orientação mudou. Prepare a mensagem novamente.");
        r = await hook.api.enviarOrientacaoWhatsapp(destino, { clientRequestId, ...(editada
          ? { texto: conteudo, assumir: true, orientacaoAdaptada: { id: orientacao.orientacaoId, versao: orientacao.versao, atendimentoLeadId: orientacao.atendimentoLeadId || null } }
          : orientacao.orientacaoId ? { orientacaoId: orientacao.orientacaoId, variaveis: orientacao.variaveis, assumir: true, ...(Number.isInteger(orientacao.versao) ? { orientacaoVersao: orientacao.versao } : {}), ...(orientacao.atendimentoLeadId ? { atendimentoLeadId: orientacao.atendimentoLeadId } : {}) } : { texto: conteudo, assumir: true }) });
        await hook.atualizarConversa(conversa.id);
      } else r = await hook.responder(destino, conteudo, { clientRequestId });
      if (!r || r.ok === false) throw r?.erro || new Error("O resultado não foi confirmado. Confira o histórico antes de reenviar.");
      const atual = hook.rascunhosRef?.current.get(chaveEnviada);
      if ((typeof atual === "string" ? atual : atual?.texto)?.trim() === conteudo) {
        await remoto.excluir();
        hook.rascunhosRef?.current.delete(chaveEnviada);
        if (chaveRef.current === chaveEnviada) setRascunho("");
      }
      setPrevia(false);
    } catch (e) {
      const semConfirmacao = transporteIniciado && precisaConferirIntencao(e);
      const preservado = { ...preparado, envioIncerto: semConfirmacao };
      hook.rascunhosRef?.current.set(chaveEnviada, preservado);
      if (chaveRef.current === chaveEnviada) { setRascunho(preservado); remoto.salvar(preservado); setErro(e?.payload?.message || e.message || "Não foi possível enviar."); }
    }
    finally { trava.current = false; setOcupado(false); }
  }
  async function conferirEnvio() {
    if (!rascunho?.clientRequestId || ocupado) return;
    setOcupado(true); setConsultandoEnvio(true); setErro("");
    try {
      const r = await hook.api.getIntencaoWhatsapp(destino, rascunho.clientRequestId);
      if (r?.intencao?.status === "ACEITA") {
        await remoto.excluir(); hook.rascunhosRef?.current.delete(chave); setRascunho("");
        await hook.atualizarConversa(conversa.id);
      } else if (r?.intencao?.status === "FALHOU") {
        const recuperado = { ...rascunho, envioIncerto: false, clientRequestId: null, intencaoTexto: null };
        salvarDraft(recuperado); setErro("O envio falhou antes de ser aceito. Confira a mensagem antes de tentar novamente.");
      } else setErro("O envio ainda está sem confirmação. Consulte novamente em instantes; nenhuma mensagem foi reenviada.");
    } catch (e) { setErro(e.message || "Não foi possível conferir o envio. A mensagem foi preservada."); }
    finally { setOcupado(false); setConsultandoEnvio(false); }
  }
  const bloqueado = ocupado || hook.ocupado || destinoMudou || !resposta.pode || !remoto.pronto || incerto;
  const assumir = !conversa.atendidaPor && !conversa.atendidaDesde;
  const nomeEnviar = editada ? previa ? "Conferi: enviar adaptação" : "Conferir adaptação" : assumir ? "Assumir e responder" : "Responder";
  const seletorCanal = !comercialObrigatorio && canais.length > 1 && <label className="wa-compose-channel">Enviar pelo WhatsApp<select aria-label="Canal da mensagem" value={canalId || ""} disabled={ocupado || hook.ocupado} onChange={e => setCanalId(e.target.value)}>
    {!canal && <option value="">Selecione o canal</option>}{canais.map(c => <option key={c.id} value={c.id}>{c.nome || c.chave || c.finalidade || "Principal"}</option>)}
  </select></label>;
  const dicas = <div className="wa-composer-hint"><span>{`WhatsApp ${comercialObrigatorio ? "Comercial" : canal?.nome || canal?.chave || ""}${mobile ? "" : " · Ctrl + Enter para enviar"}`}</span>{(texto || orientacao) && <button type="button" disabled={ocupado || hook.ocupado || incerto} onClick={descartar}>Descartar rascunho</button>}</div>;
  return <div className="wa-composer">
    <div className="wa-composer-row">
      {mobile && <Button variant="secondary" className="wa-composer-plus" aria-label="Ações da mensagem e arquivos" aria-expanded={acoesAbertas} onClick={() => setAcoesAbertas(!acoesAbertas)}>{acoesAbertas ? "×" : "+"}</Button>}
      <textarea ref={textoRef} rows={mobile ? 1 : 2} aria-label="Responder ao cliente" value={texto} onChange={e => mudarTexto(e.target.value)} disabled={bloqueado} placeholder={mobile ? "Mensagem…" : "Escreva uma mensagem para este contato…"} onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(); } }} />
      {mobile && <Button variant="primary" className="wa-composer-send" aria-label={nomeEnviar} title={nomeEnviar} disabled={bloqueado || !texto.trim()} onClick={enviar}><WhatsappIcon nome="enviar" size={21} /></Button>}
    </div>
    <div ref={ferramentasRef} className={`wa-compose-footer${mobile ? " wa-compose-sheet" : ""}`} hidden={mobile && !acoesAbertas} onKeyDown={e => { if (mobile && e.key === "Escape") setAcoesAbertas(false); }}>
      {mobile && <div className="wa-compose-sheet-heading"><strong>Mensagem e arquivos</strong><Button variant="secondary" aria-label="Fechar ações da mensagem" onClick={() => setAcoesAbertas(false)}><WhatsappIcon nome="fechar" size={18} /></Button></div>}
      <div className="wa-composer-tools">
        <AnexoDaConversa key={`anexo-${destino}`} api={hook.api} conversa={conversaCanal} disabled={bloqueado} onEnviado={() => hook.atualizarConversa(conversa.id)} />
        {hook.api?.comercial && <OrientacoesRapidas key={`orientacoes-${destino}`} api={hook.api} conversa={conversaCanal} usuarioId={usuarioId} disabled={bloqueado} onEnviado={() => hook.atualizarConversa(conversa.id)} onPreparado={p => {
          if (bloqueado) throw new Error("Este canal não está disponível para preparar uma resposta.");
          if (texto.trim()) throw new Error("Você já tem um rascunho nesta conversa. Envie ou descarte esse texto antes de inserir a mensagem pronta.");
          salvarDraft({ texto: p.texto, orientacao: { ...p, conversaId: destino, canalId } });
          requestAnimationFrame(() => textoRef.current?.focus());
        }} />}
        {slotAcoes && (typeof slotAcoes === "function" || !conversa.atendimento || conversa.atendimento.contextoSelecionado) && <details className="wa-composer-documents"><summary>Guias e documentos</summary>{typeof slotAcoes === "function" ? slotAcoes(conversaCanal) : slotAcoes}</details>}
      </div>
      {mobile ? <>{seletorCanal}{dicas}</> : <Button variant="primary" disabled={bloqueado || !texto.trim()} onClick={enviar}>{nomeEnviar}</Button>}
    </div>
    {mobile && acoesPendentes && !acoesAbertas && <button type="button" className="wa-pending-send" onClick={() => setAcoesAbertas(true)}>Envio aguardando confirmação · Conferir</button>}
    {remoto.estado === "salvando" && <p role="status" className={mobile ? "wa-visually-hidden" : "wa-list-note"}>Salvando rascunho…</p>}
    {remoto.estado === "salvo" && <p role="status" className={mobile ? "wa-visually-hidden" : "wa-list-note"}>Rascunho salvo</p>}
    {remoto.erro && <div role="alert" className="wa-draft-preview"><p>{remoto.erro}</p><Button variant="secondary" onClick={async () => { try { const valor = await remoto.conferir(); if (chaveRef.current === chave) setVersaoRemota(valor); } catch (e) { setErro(e.message); } }}>Ver versão salva</Button>{remoto.estado !== "conflito" && <Button variant="secondary" onClick={remoto.tentarSalvar}>Tentar salvar</Button>}</div>}
    {versaoRemota && <div className="wa-draft-preview"><strong>Texto salvo no servidor</strong><p>{versaoRemota.texto || "Sem texto salvo"}</p><p>Compare os textos. A versão de outro aparelho não foi sobrescrita.</p><Button variant="secondary" onClick={async () => { await remoto.resolverConflito(); setVersaoRemota(null); }}>Usar versão salva</Button><Button variant="secondary" onClick={async () => { await remoto.resolverConflito(typeof rascunho === "string" ? { texto: rascunho, destinoPreparado: destinoAtual } : rascunho); setVersaoRemota(null); }}>Conferi: salvar meu texto</Button><Button variant="secondary" onClick={() => setVersaoRemota(null)}>Fechar comparação</Button></div>}
    {ocupado && <p role="status" className="wa-list-note">{consultandoEnvio ? "Conferindo envio…" : "Enviando…"}</p>}
    {incerto && !ocupado && <div role="status" className="wa-draft-preview"><p>Envio sem confirmação. Seu texto está preservado e não será reenviado automaticamente.</p>{hook.api?.getIntencaoWhatsapp && <Button variant="secondary" onClick={conferirEnvio}>Conferir resultado do envio</Button>}</div>}
    {!resposta.pode && destino && <RetomarConversa key={`retomar-${destino}`} api={hook.api} conversa={conversaCanal} onEnviado={() => hook.atualizarConversa(conversa.id)} />}
    {destinoMudou && <div role="alert" className="wa-draft-preview"><strong>Confira o destinatário antes de continuar</strong><p>O número ou vínculo de destino deste canal mudou enquanto a mensagem estava preparada. Seu texto foi preservado. Destinatário atual: <strong>{conversaCanal.telefoneMascarado || "número a conferir no contato"}</strong>.</p><p>{texto}</p><Button variant="secondary" disabled={ocupado || hook.ocupado || !destino} onClick={() => salvarDraft({ texto, destinoPreparado: destinoAtual, ...(orientacao ? { orientacao: { ...orientacao, conversaId: destino, canalId } } : {}) })}>Conferi o destinatário: manter este rascunho</Button></div>}
    {!resposta.pode && <p data-testid="resposta-bloqueada" className="wa-list-note">{comercialObrigatorio && !comercialId ? "Leads são atendidos pelo WhatsApp Comercial. Este contato ainda não tem conversa nesse número." : resposta.motivo}</p>}
    {orientacao && <p className="wa-list-note">{editada ? "Texto adaptado: confira a prévia antes de enviar. Não certifica a orientação original." : "Mensagem inserida. Confira o texto e clique em Responder para enviar."}<button type="button" onClick={() => salvarDraft(texto)}>Desvincular orientação</button></p>}
    {previa && <div className="wa-draft-preview"><strong>Confira o texto adaptado</strong><p>{texto}</p></div>}
    {!mobile && <>{seletorCanal}{dicas}</>}
    {descartado?.chave === chave && <div className="wa-draft-undo" role="status">Rascunho descartado. <button type="button" disabled={ocupado || hook.ocupado} onClick={desfazerDescarte}>Desfazer</button></div>}
    {erro && !hook.erroAcao && <p role="alert" className="wa-list-note">{erro}</p>}
  </div>;
}
