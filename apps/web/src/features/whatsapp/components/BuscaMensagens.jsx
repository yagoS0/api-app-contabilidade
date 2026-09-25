import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { Modal } from "../../../components/ui/Modal";
import { CartaoArquivoMensagem } from "./CartaoArquivoMensagem";
import { fmtDataHora } from "../lib/conversasTela";
export function BuscaMensagens({ api, conversaId, onFechar, onIr }) {
  const [q, setQ] = useState(""), [itens, setItens] = useState([]), [cursor, setCursor] = useState(null), [ocupado, setOcupado] = useState(false), [erro, setErro] = useState(""), [buscou, setBuscou] = useState(false);
  const versao = useRef(0);
  useEffect(() => () => { versao.current++; }, []);
  async function buscar(mais = false) {
    if (q.trim().length < 2 || ocupado) return;
    const v = ++versao.current; setOcupado(true); setErro("");
    try {
      const r = await api.buscarMensagensWhatsapp(conversaId, { q: q.trim(), ...(mais ? { cursor } : {}) });
      if (v !== versao.current) return;
      const encontrados = r.resultados || [];
      setItens(antigas => mais ? [...new Map([...antigas,...encontrados].map(m => [m.id,m])).values()] : encontrados); setCursor(r.proximoCursor || null); setBuscou(true);
    } catch(e) { if(v === versao.current) setErro(e.message || "Não foi possível pesquisar o histórico."); }
    finally { if(v === versao.current) setOcupado(false); }
  }
  return <Modal titulo="Buscar nesta conversa" tamanho="md" aoFechar={onFechar}>
    <p>Pesquisa apenas nas mensagens, guias e documentos já salvos para este contato.</p><form onSubmit={e => { e.preventDefault(); buscar(); }} className="wa-content-search"><label>Texto, competência ou documento<input autoFocus value={q} onChange={e => { versao.current++; setOcupado(false); setQ(e.target.value); setCursor(null); setBuscou(false); }} /></label><Button disabled={ocupado || q.trim().length < 2} type="submit">Buscar mensagens</Button></form>
    {erro && <p role="alert">{erro}</p>}{ocupado && <p role="status">Buscando…</p>}{buscou && !itens.length && <p role="status">Nenhuma mensagem encontrada.</p>}
    <ol className="wa-search-results">{itens.map(m => <li key={m.id}><time>{fmtDataHora(m.registradaEm)}</time><p>{m.corpo || m.resumo || (!m.cartaoGuia && !m.arquivo ? "Mensagem sem texto registrado" : "")}</p><CartaoArquivoMensagem mensagem={m} conversaId={m.conversaId || conversaId} api={api} /><Button variant="secondary" size="sm" onClick={() => onIr(m)}>Ver no histórico</Button></li>)}</ol>
    {cursor && <Button variant="secondary" disabled={ocupado} onClick={() => buscar(true)}>Mais resultados</Button>}
  </Modal>;
}
