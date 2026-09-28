import { useRascunhoServidor } from "../hooks/useRascunhoServidor";
import { useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { novaIntencao, precisaConferirIntencao } from "../lib/atendimentoPwa";
import "./retomarConversa.css";

const CONFIRMADO = "Modelo aceito pelo WhatsApp. Aguarde a resposta do cliente para enviar mensagens livres.";
export function RetomarConversa({ api, conversa, onEnviado }) {
  const [previa, setPrevia] = useState(null), [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false), [erro, setErro] = useState(""), [resultado, setResultado] = useState("");
  const [assunto, setAssunto] = useState(""), [incerto, setIncerto] = useState(false);
  const intencao = useRef(null), trava = useRef(false);
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
        setResultado(r.intencao.status === "ACEITA" ? CONFIRMADO : "O modelo não foi aceito. Feche esta janela e prepare uma nova tentativa.");
        await Promise.resolve().then(() => onEnviado?.()).catch(() => {});
      } else setErro("A tentativa continua sem confirmação. Nenhum modelo foi reenviado.");
    } catch(e) { setErro(e.message || "Não foi possível conferir esta tentativa."); }
    finally { setOcupado(false); trava.current = false; }
  }
  const editarAssunto = previa?.requerAssunto && !previa.disponivel;
  const assuntoValido = assunto.trim().length > 0 && assunto.trim().length <= 120 && !/[\r\n\t{}]/.test(assunto);
  const podeAtualizar = !ocupado && !incerto && !resultado;
  const texto = previa?.texto || previa?.textoModelo?.replaceAll("{{1}}", assunto.trim() || "[assunto do atendimento]");
  return <>
    <Button variant="secondary" size="sm" disabled={!remoto.pronto} onClick={() => carregar()}>{incerto ? "Conferir retomada pendente" : "Retomar conversa"}</Button>
    {aberto && <Modal titulo="Retomar conversa" tamanho="sm" ocupado={ocupado} aoFechar={() => setAberto(false)} rodape={<div className="wa-retomada-acoes">
      <Button variant="secondary" onClick={() => setAberto(false)} disabled={ocupado}>Fechar</Button>
      {!incerto && previa?.disponivel && <Button disabled={ocupado || !remoto.pronto} onClick={enviar}>Enviar modelo de retomada</Button>}
      {!incerto && editarAssunto && <Button disabled={ocupado || !assuntoValido} onClick={() => carregar("previa")}>Conferir mensagem</Button>}
      {!incerto && previa?.podeSolicitarAprovacao && api.solicitarModeloRetomadaWhatsapp && <Button disabled={ocupado} onClick={() => carregar("solicitar")}>Solicitar aprovação na Meta</Button>}
    </div>}>
      <div className="wa-retomada">
        <div className="wa-retomada-destino"><strong>{conversa.contato?.nome || conversa.nomePerfilProvedor || conversa.telefoneMascarado}</strong><span>{conversa.telefoneMascarado} · WhatsApp {conversa.canalNome || "do escritório"}</span></div>
        {!resultado && !incerto && <p>Envie uma mensagem de retomada para continuar este atendimento.</p>}
        {incerto && <div role="status"><p>Envio de retomada sem confirmação. Confira a mesma tentativa; ela não será reenviada automaticamente.</p><Button variant="secondary" disabled={ocupado} onClick={conferir}>Conferir resultado da retomada</Button></div>}
        {ocupado && <p role="status">Conferindo…</p>}
        {!incerto && previa && <>
          <div className="wa-retomada-status"><span>{previa.statusMeta === "APPROVED" ? "Aprovado pela Meta" : previa.statusMeta === "PENDING" ? "Aguardando a Meta" : "Configuração deste número"}</span>
            {podeAtualizar && <Button variant="secondary" size="sm" onClick={() => carregar()}>Atualizar aprovação</Button>}
          </div>
          {editarAssunto ? <div className="wa-retomada-campo"><label htmlFor="retomada-assunto">Qual é o assunto?</label><input id="retomada-assunto" value={assunto} maxLength={120} onChange={e => setAssunto(e.target.value)} placeholder="Ex.: o envio das guias de setembro" aria-describedby="retomada-assunto-ajuda" />
            <span id="retomada-assunto-ajuda">Escreva apenas o assunto combinado com o cliente.</span></div>
            : !previa.disponivel && <p>{previa.message || previa.mensagem || "Este canal ainda não tem modelo aprovado disponível para retomar a conversa."}</p>}
          {texto && <div><p className="wa-retomada-legenda">{previa.disponivel ? "Confira o que o cliente vai receber" : "Mensagem de retomada"}</p><div className="wa-retomada-mensagem"><p>{texto}</p>{previa.botoes?.map(b => <span key={b} className="wa-retomada-botao-previa">{b}</span>)}</div></div>}
          {previa.disponivel && previa.requerAssunto && <Button variant="secondary" className="wa-retomada-editar" disabled={ocupado} onClick={() => setPrevia(p => ({...p, disponivel:false, texto:null, previaHash:null}))}>Alterar assunto</Button>}
          {previa.podeSolicitarAprovacao && <p className="wa-retomada-ajuda">A solicitação cadastra este modelo na Meta. Não envia mensagens aos clientes.</p>}
        </>}
        {erro && <div role="alert"><p>{erro}</p>{podeAtualizar && <Button variant="secondary" onClick={() => carregar()}>Atualizar aprovação</Button>}</div>}
        {remoto.erro && <p role="alert">{remoto.erro}</p>}
        {resultado && <p role="status">{resultado}</p>}
        {!resultado && <p className="wa-retomada-ajuda">Você poderá enviar mensagens livres assim que o cliente responder.</p>}
      </div>
    </Modal>}
  </>;
}
