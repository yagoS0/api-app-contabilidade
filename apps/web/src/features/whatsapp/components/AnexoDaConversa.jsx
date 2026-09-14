import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";

export function AnexoDaConversa({ api, conversa, disabled, onEnviado }) {
  const [arquivo, setArquivo] = useState(null), [legenda, setLegenda] = useState(""), [url, setUrl] = useState(""), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [incerto, setIncerto] = useState(false);
  const trava = useRef(false), vivo = useRef(true), input = useRef(null);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  useEffect(() => {
    if (!arquivo || !URL.createObjectURL) return;
    const u = URL.createObjectURL(arquivo); setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [arquivo]);
  async function enviar() {
    if (!arquivo || disabled || trava.current || incerto) return;
    trava.current = true; setOcupado(true); setErro("");
    try {
      await api.enviarAnexoWhatsapp(conversa.id, arquivo, legenda);
      if (vivo.current) { setArquivo(null); setLegenda(""); await onEnviado?.(); }
    } catch (e) {
      if (vivo.current) {
        setErro(e.message || "Não foi possível confirmar o envio. Confira o histórico.");
        // Uma falha de rede/servidor pode ter ocorrido depois do aceite da Meta.
        setIncerto(!e.status || e.status >= 500 || e.payload?.podeTentarDeNovo === false);
        await onEnviado?.();
      }
    } finally { trava.current = false; if (vivo.current) setOcupado(false); }
  }
  if (!api?.enviarAnexoWhatsapp) return null;
  return <>
    <Button type="button" size="sm" variant="secondary" disabled={disabled || ocupado} onClick={() => input.current?.click()}>Anexar PDF ou imagem</Button>
    <input ref={input} type="file" hidden accept="application/pdf,image/jpeg,image/png" aria-label="Arquivo para enviar no WhatsApp" onChange={e => {
      const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
      if (!["application/pdf", "image/jpeg", "image/png"].includes(f.type) || f.size > 5 * 1024 * 1024) { setErro("Escolha PDF, JPEG ou PNG de até 5 MB."); return; }
      setArquivo(f); setErro(""); setIncerto(false); setLegenda("");
    }} />
    {!arquivo && erro && <p role="alert">{erro}</p>}
    {arquivo && <Modal titulo="Enviar anexo pelo WhatsApp" tamanho="md" ocupado={ocupado} aoFechar={() => setArquivo(null)} rodape={<><Button variant="secondary" disabled={ocupado} onClick={() => setArquivo(null)}>Fechar</Button><Button disabled={disabled || ocupado || incerto} onClick={enviar}>{ocupado ? "Enviando…" : "Assumir e enviar anexo"}</Button></>}>
      <p>Destinatário: <strong>{conversa.contato?.nome || conversa.nomePerfilProvedor || conversa.telefoneMascarado}</strong> · {conversa.telefoneMascarado}</p>
      <p>{arquivo.name} · {Math.ceil(arquivo.size / 1024)} KB</p>
      {url && (arquivo.type.startsWith("image/") ? <img src={url} alt="Prévia do anexo" style={{ maxWidth: "100%", maxHeight: 260 }} /> : <a href={url} target="_blank" rel="noreferrer">Abrir PDF para conferir</a>)}
      <label>Legenda opcional<textarea value={legenda} maxLength={1024} onChange={e => setLegenda(e.target.value)} style={{ width: "100%" }} /></label>
      {erro && <p role="alert">{erro}</p>}{incerto && <p>Envio sem confirmação. Confira o histórico antes de preparar outro envio.</p>}
    </Modal>}
  </>;
}
