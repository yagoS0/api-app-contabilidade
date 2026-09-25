import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { CnpjDaConversa } from "./ConversaVisual";

export function CartaoArquivoMensagem({ mensagem, conversaId, api }) {
  const guia = mensagem.cartaoGuia, arquivo = guia?.arquivo || mensagem.arquivo;
  const [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false), [url, setUrl] = useState("");
  const urlRef = useRef(null), vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; if (urlRef.current) URL.revokeObjectURL(urlRef.current); }; }, []);
  if (!guia && !arquivo) return null;
  const original = guia?.origem === "ORIGINAL_REGISTRADO" && arquivo?.origem === "ORIGINAL_REGISTRADO";
  const aceita = ["enviado", "entregue", "lido"].includes(mensagem.statusEnvio || guia?.statusEnvio);
  async function abrir() {
    if (ocupado) return; setOcupado(true); setErro("");
    try {
      const retorno = await api.getArquivoMensagemWhatsapp(conversaId, mensagem.id);
      const r = retorno.arquivo || retorno;
      if (!["application/pdf", "image/jpeg", "image/png"].includes(r?.mimeType) || !r.base64) throw new Error("Arquivo indisponível para abertura nesta conversa.");
      const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: r.mimeType }));
      if (!vivo.current) { URL.revokeObjectURL(blobUrl); return; }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = blobUrl; setUrl(blobUrl);
    } catch (e) { if (vivo.current) setErro(e.message || "Não foi possível abrir o arquivo."); }
    finally { if (vivo.current) setOcupado(false); }
  }
  return <section className="wa-file-card" aria-label={guia ? "Guia enviada" : "Arquivo da mensagem"}>
    {guia && <><strong>{guia.empresa || "Empresa não registrada"}</strong>{guia.cnpj && <CnpjDaConversa cnpj={guia.cnpj} empresa={guia.empresa} />}<dl>
      <div><dt>Guia</dt><dd>{guia.tipo || "Tributo não registrado"} · {guia.competencia || "Competência não registrada"}</dd></div>
      <div><dt>Valor</dt><dd>{guia.valor !== null && guia.valor !== undefined && Number.isFinite(Number(guia.valor)) ? Number(guia.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "Não registrado"}</dd></div>
      <div><dt>Vencimento</dt><dd>{guia.vencimento ? String(guia.vencimento).slice(0,10).split("-").reverse().join("/") : "Não registrado"}</dd></div>
    </dl>{guia.origem !== "ORIGINAL_REGISTRADO" && <p>Dados recuperados do vínculo; a versão enviada não foi comprovada.</p>}
    {guia.historicoPendente && <p role="status">Aceita pelo WhatsApp; histórico em atualização.</p>}
    {guia.template && <details><summary>Detalhes do modelo enviado</summary><p>{guia.template.nome} · {guia.template.idioma}</p><p>Parâmetros registrados no envio; a aparência exata no WhatsApp não está disponível.</p>{guia.template.variaveis && <pre>{typeof guia.template.variaveis === "string" ? guia.template.variaveis : JSON.stringify(guia.template.variaveis, null, 2)}</pre>}</details>}</>}
    {arquivo && <><p>{arquivo.nomeArquivo || "Arquivo"}{arquivo.tamanho ? ` · ${Math.ceil(arquivo.tamanho / 1024)} KB` : ""}</p>
      {arquivo.podeAbrir && api?.getArquivoMensagemWhatsapp ? <Button size="sm" variant="secondary" disabled={ocupado} onClick={abrir}>{ocupado ? "Preparando arquivo…" : guia ? original ? aceita ? "Abrir PDF enviado" : "Abrir PDF da tentativa" : "Abrir documento associado" : "Abrir arquivo"}</Button> : <p>{arquivo.estado === "PROCESSANDO" ? "Arquivo em processamento." : "Arquivo indisponível neste histórico."}</p>}
      {url && <div><a href={url} target="_blank" rel="noopener noreferrer">Visualizar {arquivo.nomeArquivo || "arquivo"} ↗</a><a href={url} download={arquivo.nomeArquivo || "arquivo"}>Baixar arquivo</a></div>}
    </>}{erro && <p role="alert">{erro}</p>}
  </section>;
}
