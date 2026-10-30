import { useWorkspaceEditor } from "../../../app/navigation/WorkspaceNavigation.shared";
import { useRascunhoServidor } from "../hooks/useRascunhoServidor";
import { novaIntencao, precisaConferirIntencao } from "../lib/atendimentoPwa";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";

let contextoAnexo = 0;
export function AnexoDaConversa(props) {
  const sessao = props.api?.getAccessToken?.() || null;
  const contexto = useMemo(() => ++contextoAnexo, [props.api, sessao, props.conversa.id, props.conversa.canalId, props.conversa.vinculoNumeroId]);
  return <AnexoContexto key={contexto} {...props} />;
}
function AnexoContexto({ api, conversa, disabled, onEnviado }) {
  const [arquivo, setArquivo] = useState(null), [legenda, setLegenda] = useState(""), [url, setUrl] = useState(""), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [incerto, setIncerto] = useState(false);
  const intencao = useRef(null);
  const preparacaoSemTransporte = useRef(null);
  const [preparacaoConferida, setPreparacaoConferida] = useState(null), [recuperando, setRecuperando] = useState(false);
  const [baseVaziaConferida, setBaseVaziaConferida] = useState(false);
  const remoto = useRascunhoServidor({ api, conversaId: conversa.id, modo: "anexo", canalId: conversa.canalId || null, vinculoId: conversa.vinculoNumeroId || null, onRestaurar: r => { if (r.envioIncerto && r.clientRequestId && r.clientRequestId !== preparacaoSemTransporte.current?.clientRequestId) { intencao.current = r.clientRequestId; setIncerto(true); setErro(`Envio de ${r.intencaoTexto || "anexo"} sem confirmação.`); } } });
  const trava = useRef(false), vivo = useRef(true), input = useRef(null);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    if (!arquivo || !URL.createObjectURL) return;
    const u = URL.createObjectURL(arquivo); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [arquivo]);
  const arquivoPendente = useRef(false);
  arquivoPendente.current = Boolean(arquivo);
  useWorkspaceEditor({
    context: remoto.context,
    get dirty() { return arquivoPendente.current || incerto || ocupado || remoto.pendente; },
    suspend: remoto.suspend, resume: remoto.resume,
    invalidate: () => { remoto.invalidate(); arquivoPendente.current = false; setArquivo(null); setLegenda(""); },
    save: async () => { throw new Error(incerto || ocupado ? "Confira o resultado do envio do anexo antes de sair." : "O arquivo está somente na memória e não pode ser guardado como rascunho. Cancele para continuar ou descarte o anexo."); },
    discard: async () => {
      if (incerto || ocupado) throw new Error("Confira o envio antes de descartar. O descarte não cancela uma saída já iniciada.");
      if (remoto.pendente) {
        const resultado = await remoto.descartarConfirmado();
        if (!resultado.ok) return resultado;
      }
      arquivoPendente.current = false; setArquivo(null); setLegenda(""); intencao.current = null;
      return { ok: true, context: remoto.context, revision: 0 };
    },
  });
  async function enviar() {
    if (!arquivo || disabled || trava.current || incerto || recuperando || !remoto.pronto) return;
    trava.current = true; setOcupado(true); setErro("");
    let transporteIniciado = false;
    try {
      intencao.current ||= novaIntencao();
      const preparacao = { texto: legenda, clientRequestId: intencao.current, intencaoTexto: arquivo.name, envioIncerto: true };
      preparacaoSemTransporte.current = preparacao; setPreparacaoConferida(null);
      if (!(await remoto.salvar(preparacao, true))) throw Object.assign(new Error("Salve a identificação da tentativa antes de enviar."), { status: 409 });
      if (!vivo.current || !remoto.estaAtivo()) return;
      transporteIniciado = true; preparacaoSemTransporte.current = null;
      const envio = await api.enviarAnexoWhatsapp(conversa.id, arquivo, legenda, { clientRequestId: intencao.current });
      if (!envio || envio.ok === false) throw new Error("O resultado do envio não foi confirmado. Confira a tentativa.");
      await remoto.excluir(); intencao.current = null;
      if (vivo.current && remoto.estaAtivo()) { setArquivo(null); setLegenda(""); await onEnviado?.(); }
    } catch (e) {
      if (vivo.current && remoto.estaAtivo()) {
        setErro(e.message || "Não foi possível confirmar o envio. Confira o histórico.");
        // Uma falha de rede/servidor pode ter ocorrido depois do aceite da Meta.
        const duvida = transporteIniciado && precisaConferirIntencao(e);
        setIncerto(duvida);
        if (transporteIniciado && !duvida) { await remoto.excluir(); intencao.current = null; }
        await onEnviado?.();
      }
    } finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }
  async function conferir() {
    if (!intencao.current || ocupado) return;
    setOcupado(true);
    try { const r = await api.getIntencaoWhatsapp(conversa.id, intencao.current);
      if (!vivo.current || !remoto.estaAtivo()) return;
      if (["ACEITA", "FALHOU"].includes(r?.intencao?.status)) { await remoto.excluir(); setIncerto(false); setArquivo(null); intencao.current = null; setErro(r.intencao.status === "ACEITA" ? "Anexo aceito pelo WhatsApp; confira a entrega no histórico." : "O anexo não foi aceito. Selecione o arquivo novamente para uma nova tentativa."); await onEnviado?.(); }
      else setErro("O envio continua sem confirmação. Nenhum anexo foi reenviado.");
    } catch(e) { setErro(e.message); } finally { setOcupado(false); }
  }
  async function conferirPreparacao() {
    const local = preparacaoSemTransporte.current;
    if (!local || ocupado || incerto || recuperando) return;
    setRecuperando(true); setPreparacaoConferida(null); setBaseVaziaConferida(false);
    try {
      const salvo = await remoto.conferir();
      if (!remoto.estaAtivo() || preparacaoSemTransporte.current !== local) return;
      if (remoto.ausenciaConferida) { setBaseVaziaConferida(true); setPreparacaoConferida(local); return; }
      if (!salvo || salvo.clientRequestId !== local.clientRequestId || salvo.intencaoTexto !== local.intencaoTexto || salvo.texto !== local.texto || salvo.envioIncerto !== local.envioIncerto) throw new Error("A preparação salva não corresponde a esta tentativa. O arquivo e a identidade locais foram preservados; nenhuma mensagem foi enviada.");
      setPreparacaoConferida(local);
    } catch (e) { if (remoto.estaAtivo()) setErro(e.message); }
    finally { if (remoto.estaAtivo()) setRecuperando(false); }
  }
  async function adotarPreparacao() {
    if (!preparacaoConferida || preparacaoConferida !== preparacaoSemTransporte.current || ocupado || incerto || recuperando) return;
    setRecuperando(true);
    try {
      await remoto.resolverConflito();
      if (!remoto.estaAtivo()) return;
      if (remoto.pendente) throw new Error("Não foi possível confirmar a preparação. Confira o rascunho novamente.");
      setPreparacaoConferida(null); setErro("Preparação conferida. O arquivo permanece local; nenhum anexo foi enviado.");
    } catch (e) { if (remoto.estaAtivo()) setErro(e.message); }
    finally { if (remoto.estaAtivo()) setRecuperando(false); }
  }
  const recuperacao = remoto.erro && !incerto && preparacaoSemTransporte.current && <div>
    <p>A gravação da preparação não foi confirmada. O transporte ainda não começou.</p>
    <Button variant="secondary" disabled={ocupado || recuperando} onClick={conferirPreparacao}>Conferir rascunho da tentativa</Button>
    {preparacaoConferida && <><p>{baseVaziaConferida ? "Não há rascunho salvo para esta tentativa. O arquivo e os dados preparados continuam nesta tela. Esta leitura não cancela gravações já iniciadas. Nada será enviado." : "Esta preparação corresponde ao arquivo e à identidade desta tentativa."}</p><Button variant="secondary" disabled={ocupado || recuperando} onClick={adotarPreparacao}>{baseVaziaConferida ? "Manter preparação local" : "Usar preparação salva"}</Button></>}
  </div>;
  if (!api?.enviarAnexoWhatsapp) return null;
  return <>
    <Button type="button" size="sm" variant="secondary" disabled={disabled || ocupado || incerto || !remoto.pronto} onClick={() => input.current?.click()}>Anexar PDF ou imagem</Button>
    <input ref={input} type="file" hidden accept="application/pdf,image/jpeg,image/png" aria-label="Arquivo para enviar no WhatsApp" onChange={e => {
      const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
      if (!["application/pdf", "image/jpeg", "image/png"].includes(f.type) || f.size > 5 * 1024 * 1024) { setErro("Escolha PDF, JPEG ou PNG de até 5 MB."); return; }
      intencao.current = null; setArquivo(f); setErro(""); setIncerto(false); setLegenda("");
    }} />
    {!arquivo && erro && <p role="status">{erro}</p>}
    {!arquivo && recuperacao}
    {incerto && api.getIntencaoWhatsapp && <Button data-envio-pendente="true" variant="secondary" disabled={ocupado} onClick={conferir}>Conferir envio do anexo</Button>}
    {remoto.erro && <p role="alert">{remoto.erro}</p>}
    {arquivo && <Modal titulo="Enviar anexo pelo WhatsApp" tamanho="md" ocupado={ocupado || recuperando} aoFechar={() => setArquivo(null)} rodape={<><Button variant="secondary" disabled={ocupado || recuperando} onClick={() => setArquivo(null)}>Fechar</Button><Button disabled={disabled || ocupado || incerto || recuperando || !remoto.pronto} onClick={enviar}>{ocupado ? "Enviando…" : "Assumir e enviar anexo"}</Button></>}>
      <div className="wa-attachment-preview">
      <p>Destinatário: <strong>{conversa.contato?.nome || conversa.nomePerfilProvedor || conversa.telefoneMascarado}</strong> · {conversa.telefoneMascarado}</p>
      <p>{arquivo.name} · {Math.ceil(arquivo.size / 1024)} KB</p>
      {url && (arquivo.type.startsWith("image/") ? <img src={url} alt="Prévia do anexo" style={{ maxWidth: "100%", maxHeight: 260 }} /> : <a href={url} target="_blank" rel="noreferrer">Abrir PDF para conferir</a>)}
      <label>Legenda opcional<textarea value={legenda} maxLength={1024} disabled={ocupado || recuperando} onChange={e => setLegenda(e.target.value)} style={{ width: "100%" }} /></label>
      {recuperacao}
      {erro && <p role="alert">{erro}</p>}{incerto && <p>Envio sem confirmação. Confira o histórico antes de preparar outro envio.</p>}
      </div>
    </Modal>}
  </>;
}
