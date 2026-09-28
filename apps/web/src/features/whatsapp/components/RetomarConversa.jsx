import { useRascunhoServidor } from "../hooks/useRascunhoServidor";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { novaIntencao, precisaConferirIntencao } from "../lib/atendimentoPwa";
import "./retomarConversa.css";

const CONFIRMADO = "Mensagem aceita pelo WhatsApp. Aguarde a resposta para continuar.";
export function RetomarConversa({ api, conversa, onEnviado }) {
  const [previa, setPrevia] = useState(null), [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState(""), [resultado, setResultado] = useState("");
  const [assunto, setAssunto] = useState(""), [incerto, setIncerto] = useState(false);
  const intencao = useRef(null), trava = useRef(false);
  const assuntoId = useId(), campoRef = useRef(null), gatilhoRef = useRef(null), esteveAberto = useRef(false);
  useEffect(() => {
    if (aberto) {
      esteveAberto.current = true;
      if (!ocupado && previa?.requerAssunto && !previa.disponivel) campoRef.current?.focus();
    } else if (esteveAberto.current) {
      gatilhoRef.current?.focus(); esteveAberto.current = false;
    }
  }, [aberto, ocupado, previa?.requerAssunto, previa?.disponivel]);
  const remoto = useRascunhoServidor({ api, conversaId: conversa.id, modo: "retomar", onRestaurar: conteudo => {
    if (conteudo.clientRequestId && conteudo.envioIncerto) { intencao.current = conteudo.clientRequestId; setIncerto(true); }
  } });
  if (!api?.getRetomadaWhatsapp) return null;
  async function carregar(acao = "consultar") {
    if (trava.current) return;
    setAberto(true); if (incerto) return;
    trava.current = true; setOcupado(true); setErro(""); setResultado(""); setPrevia(null);
    try {
      const r = acao === "solicitar" ? await api.solicitarModeloRetomadaWhatsapp(conversa.id)
        : acao === "previa" ? await api.prepararRetomadaWhatsapp(conversa.id, { assunto: assunto.trim() })
          : await api.getRetomadaWhatsapp(conversa.id);
      setPrevia(r);
    } catch(e) { setErro(e.message || "Não foi possível conferir o modelo de retomada. Atualize a aprovação para tentar novamente."); }
    finally { setOcupado(false); trava.current = false; }
  }
  async function enviar() {
    if (trava.current || !previa?.disponivel || incerto || !remoto.pronto) return;
    trava.current = true; setOcupado(true); setErro("");
    intencao.current ||= novaIntencao();
    let transporte = false;
    try {
      if (!(await remoto.salvar({ texto: previa.texto || "", clientRequestId: intencao.current, intencaoTexto: previa.previaHash, envioIncerto: true }, true))) throw new Error("Não foi possível guardar a tentativa. Nenhum modelo foi enviado.");
      transporte = true;
      await api.retomarConversaWhatsapp(conversa.id, { clientRequestId: intencao.current, previaHash: previa.previaHash, ...(previa.assunto ? { assunto: previa.assunto } : {}) });
      await remoto.excluir(); intencao.current = null; setIncerto(false);
      setResultado(CONFIRMADO); setPrevia(null);
    } catch(e) {
      const duvida = transporte && precisaConferirIntencao(e);
      setIncerto(duvida);
      if (!duvida) { await remoto.excluir(); intencao.current = null; setPrevia(null); }
      setErro(e.message || "Envio sem confirmação. Consulte o resultado antes de qualquer nova tentativa.");
    } finally { setOcupado(false); trava.current = false; }
    // Falha na atualização do histórico nunca transforma um envio aceito em tentativa incerta.
    if (transporte && !intencao.current) await Promise.resolve().then(() => onEnviado?.()).catch(() => {});
  }
  async function conferir() {
    if (!intencao.current || trava.current) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      const r = await api.getIntencaoWhatsapp(conversa.id, intencao.current);
      if (["ACEITA", "FALHOU"].includes(r?.intencao?.status)) {
        await remoto.excluir(); intencao.current = null; setIncerto(false); setPrevia(null);
        setResultado(r.intencao.status === "ACEITA" ? CONFIRMADO : "Mensagem não enviada. Feche a retomada para preparar uma nova tentativa.");
        await Promise.resolve().then(() => onEnviado?.()).catch(() => {});
      } else setErro("A tentativa continua sem confirmação. Nenhum modelo foi reenviado.");
    } catch(e) { setErro(e.message || "Não foi possível conferir esta tentativa."); }
    finally { setOcupado(false); trava.current = false; }
  }
  const editarAssunto = previa?.requerAssunto && !previa.disponivel;
  const assuntoValido = assunto.trim().length > 0 && assunto.trim().length <= 120 && !/[\r\n\t{}]/.test(assunto);
  const bloqueio = previa && !editarAssunto && !previa.disponivel;
  const nome = conversa.contato?.nome || conversa.nomePerfilProvedor || conversa.telefoneMascarado;
  const aviso = previa?.statusMeta === "PENDING" ? "Aguardando aprovação da Meta."
    : previa?.statusMeta === "AUSENTE" ? "Este número precisa de um modelo aprovado para retomar."
      : previa?.statusMeta === "REJECTED" ? "Modelo rejeitado pela Meta. Revise no WhatsApp Manager."
        : previa?.message || previa?.mensagem || "Não foi possível preparar a retomada.";
  if (!aberto) return <Button ref={gatilhoRef} variant="secondary" size="sm" disabled={!remoto.pronto} onClick={() => carregar()}>{incerto ? "Conferir retomada pendente" : "Retomar conversa"}</Button>;
  return <section className="wa-retomada" aria-label="Retomar conversa" aria-busy={ocupado} onKeyDown={e => {
    if (e.key === "Escape" && !ocupado) { e.stopPropagation(); setAberto(false); }
  }}>
    <div className="wa-retomada-topo">
      <div><strong>Retomar conversa</strong><span>{nome} · WhatsApp {conversa.canalNome || "do escritório"}</span></div>
      <Button variant="secondary" className="wa-retomada-fechar" aria-label="Fechar retomada" disabled={ocupado} onClick={() => setAberto(false)}>×</Button>
    </div>
    <div className="wa-retomada-corpo">
      {ocupado && <p role="status" className="wa-retomada-status">Conferindo…</p>}
      {incerto && <p role="status">Envio de retomada sem confirmação. Confira antes de tentar novamente.</p>}
      {!incerto && editarAssunto && <div className="wa-retomada-campo">
        <label htmlFor={assuntoId}>Assunto</label>
        <input ref={campoRef} id={assuntoId} value={assunto} maxLength={120} onChange={e => setAssunto(e.target.value)} placeholder="Ex.: o envio das guias" disabled={ocupado} onKeyDown={e => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing && assuntoValido && !ocupado) { e.preventDefault(); carregar("previa"); }
        }} />
      </div>}
      {!incerto && previa?.disponivel && <div className="wa-retomada-mensagem" aria-label="Prévia da mensagem">
        <p>{previa.texto}</p>{previa.botoes?.map(b => <span key={b} className="wa-retomada-botao-previa">{b}</span>)}
      </div>}
      {!incerto && bloqueio && <div className="wa-retomada-bloqueio">
        <p>{aviso}</p>
        {previa.podeSolicitarAprovacao && previa.textoModelo && <details><summary>Ver modelo</summary><p>{previa.textoModelo.replaceAll("{{1}}", "[assunto]")}</p><small>A solicitação não envia mensagens aos clientes.</small></details>}
      </div>}
      {erro && <p role="alert">{erro}</p>}
      {remoto.erro && <p role="alert">{remoto.erro}</p>}
      {resultado && <p role="status">{resultado}</p>}
    </div>
    {!resultado && <div className="wa-retomada-acoes">
      {incerto ? <Button variant="secondary" disabled={ocupado} onClick={conferir}>Conferir envio</Button>
        : previa?.disponivel ? <>
          {previa.requerAssunto && <Button variant="secondary" disabled={ocupado} onClick={() => setPrevia(p => ({...p, disponivel:false, texto:null, previaHash:null}))}>Alterar assunto</Button>}
          <Button disabled={ocupado || !remoto.pronto} onClick={enviar}>Enviar mensagem</Button>
        </> : editarAssunto ? <Button disabled={ocupado || !assuntoValido} onClick={() => carregar("previa")}>Ver mensagem</Button>
          : previa?.podeSolicitarAprovacao && api.solicitarModeloRetomadaWhatsapp ? <Button disabled={ocupado} onClick={() => carregar("solicitar")}>Solicitar aprovação</Button>
            : (bloqueio || erro) && <Button variant="secondary" disabled={ocupado} onClick={() => carregar()}>{bloqueio ? "Atualizar aprovação" : "Tentar novamente"}</Button>}
    </div>}
  </section>;
}
