import { useRascunhoServidor } from "../hooks/useRascunhoServidor";
import { useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { novaIntencao, precisaConferirIntencao } from "../lib/atendimentoPwa";
export function RetomarConversa({ api, conversa, onEnviado }) {
  const [previa, setPrevia] = useState(null), [aberto, setAberto] = useState(false), [ocupado, setOcupado] = useState(false), [erro, setErro] = useState(""), [resultado, setResultado] = useState("");
  const intencao = useRef(null), trava = useRef(false);
  const [incerto, setIncerto] = useState(false);
  const remoto = useRascunhoServidor({ api, conversaId: conversa.id, modo: "retomar", onRestaurar: conteudo => {
    if (conteudo.clientRequestId && conteudo.envioIncerto) { intencao.current = conteudo.clientRequestId; setIncerto(true); }
  } });
  if (!api?.getRetomadaWhatsapp) return null;
  async function preparar() {
    setAberto(true); if (incerto) return; setOcupado(true); setErro("");
    try { setPrevia(await api.getRetomadaWhatsapp(conversa.id)); } catch(e) { setErro(e.message || "Não foi possível conferir o modelo de retomada."); } finally { setOcupado(false); }
  }
  async function enviar() {
    if (trava.current || !previa?.disponivel || incerto || !remoto.pronto) return;
    trava.current = true; setOcupado(true); setErro("");
    intencao.current ||= novaIntencao();
    let transporte = false;
    try {
      if (!(await remoto.salvar({ texto: previa.texto || "", clientRequestId: intencao.current, intencaoTexto: previa.previaHash, envioIncerto: true }, true))) throw new Error("Não foi possível guardar a tentativa. Nenhum modelo foi enviado.");
      transporte = true;
      await api.retomarConversaWhatsapp(conversa.id, { clientRequestId: intencao.current, previaHash: previa.previaHash });
      await remoto.excluir(); intencao.current = null; setIncerto(false);
      setResultado("Modelo aceito pelo WhatsApp. Aguarde a resposta do cliente para enviar mensagens livres."); setPrevia(null); await onEnviado?.();
    } catch(e) {
      const duvida = transporte && precisaConferirIntencao(e);
      setIncerto(duvida);
      if (!duvida) { await remoto.excluir(); intencao.current = null; }
      setErro(e.message || "Envio sem confirmação. Consulte o resultado antes de qualquer nova tentativa.");
    }
    finally { setOcupado(false); trava.current = false; }
  }
  async function conferir() {
    if (!intencao.current || ocupado) return;
    setOcupado(true); setErro("");
    try {
      const r = await api.getIntencaoWhatsapp(conversa.id, intencao.current);
      if (["ACEITA", "FALHOU"].includes(r?.intencao?.status)) {
        await remoto.excluir(); intencao.current = null; setIncerto(false); setPrevia(null);
        setResultado(r.intencao.status === "ACEITA" ? "Modelo aceito pelo WhatsApp. Aguarde a resposta do cliente para enviar mensagens livres." : "O modelo não foi aceito. Feche esta janela e prepare uma nova tentativa.");
        await onEnviado?.();
      } else setErro("A tentativa continua sem confirmação. Nenhum modelo foi reenviado.");
    } catch(e) { setErro(e.message || "Não foi possível conferir esta tentativa."); }
    finally { setOcupado(false); }
  }
  return <><Button variant="secondary" size="sm" disabled={!remoto.pronto} onClick={preparar}>{incerto ? "Conferir retomada pendente" : "Retomar conversa"}</Button>{aberto && <Modal titulo="Retomar conversa pelo WhatsApp" tamanho="sm" ocupado={ocupado} aoFechar={() => setAberto(false)} rodape={<><Button variant="secondary" onClick={() => setAberto(false)} disabled={ocupado}>Fechar</Button>{previa?.disponivel && !incerto && <Button disabled={ocupado} onClick={enviar}>Enviar modelo de retomada</Button>}</>}>
    <p>Destinatário: <strong>{conversa.contato?.nome || conversa.nomePerfilProvedor || conversa.telefoneMascarado}</strong> · {conversa.telefoneMascarado}</p><p>Canal: WhatsApp {conversa.canalNome || "do escritório"}</p>
    {incerto && <div role="status"><p>Envio de retomada sem confirmação. Confira a mesma tentativa; ela não será reenviada automaticamente.</p><Button variant="secondary" disabled={ocupado} onClick={conferir}>Conferir resultado da retomada</Button></div>}{remoto.erro && <p role="alert">{remoto.erro}</p>}{ocupado && <p role="status">Conferindo…</p>}{previa?.disponivel ? <blockquote>{previa.texto || previa.previa?.texto || previa.modelo?.texto || "Modelo aprovado de retomada do escritório"}</blockquote> : previa && <><p>{previa.message || previa.mensagem || "Este canal ainda não tem modelo aprovado disponível para retomar a conversa."}</p><a href="/configuracoes/atendimento" target="_blank" rel="noopener noreferrer">Conferir configuração de atendimento ↗</a></>}
    <p>O envio deste modelo não abre a janela de mensagens livres. Ela será aberta quando o cliente responder.</p>{erro && <p role="alert">{erro}</p>}{resultado && <p role="status">{resultado}</p>}
  </Modal>}</>;
}
