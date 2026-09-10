import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";

export function ArquivosWhatsappNaoVinculados({ api, companyId, bloqueado, aoVincular }) {
  const [aberta, setAberta] = useState(false);
  const [arquivos, setArquivos] = useState([]);
  const [temMais, setTemMais] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  const [escolhido, setEscolhido] = useState(null);
  const [confirmado, setConfirmado] = useState(false);
  const versao = useRef(0);
  useEffect(() => () => { versao.current++; }, [api, companyId]);
  async function abrir(mais = null) {
    if (aberta && !mais) { setAberta(false); return; }
    const v = ++versao.current;
    setAberta(true); setOcupado(true); setErro(null); setEscolhido(null); setConfirmado(false);
    try {
      const r = await api.listarArquivosWhatsappNaoVinculados(companyId, ...(mais ? [{ cursor: mais }] : []));
      if (v !== versao.current) return;
      if (!Array.isArray(r?.arquivos)) throw new Error("Não foi possível conferir os arquivos sem empresa.");
      setArquivos(atuais => mais ? [...new Map([...atuais, ...r.arquivos].map(a => [a.id, a])).values()] : r.arquivos); setTemMais(Boolean(r.temMais)); setCursor(r.proximoCursor || null);
    } catch (e) { if (v === versao.current) setErro(e?.message || "Não foi possível carregar os arquivos sem empresa."); }
    finally { if (v === versao.current) setOcupado(false); }
  }
  async function vincular() {
    if (!escolhido || !confirmado || ocupado || bloqueado) return;
    const v = versao.current; setOcupado(true); setErro(null);
    try {
      const r = await api.vincularArquivoWhatsapp(companyId, escolhido.id);
      if (v !== versao.current) return;
      if (r?.ok === false) throw new Error(r.message || r.mensagem || "O vínculo não foi confirmado.");
      setArquivos(lista => lista.filter(a => a.id !== escolhido.id)); setEscolhido(null); setConfirmado(false);
      await aoVincular?.();
    } catch (e) { if (v === versao.current) setErro(e?.message || "Não foi possível vincular este arquivo."); }
    finally { if (v === versao.current) setOcupado(false); }
  }
  return <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
    <Button variant="secondary" disabled={ocupado || bloqueado} onClick={() => abrir()}>{aberta ? "Fechar arquivos sem empresa" : "Ver arquivos sem empresa"}</Button>
    {aberta ? <div>
      <p>Associe somente arquivos que pertencem à empresa aberta. O histórico das conversas permanece preservado. O original poderá ser aberto depois do vínculo.</p>
      {erro ? <p role="alert">{erro}</p> : null}
      {ocupado ? <p>Conferindo arquivos…</p> : !erro && !arquivos.length ? <p>Nenhum arquivo aguardando vínculo.</p> : null}
      {arquivos.map(a => <div key={a.id} style={{ display: "flex", gap: 12, alignItems: "center", margin: "8px 0" }}><span>{a.nomeArquivo || "Arquivo sem nome"}<small style={{ display: "block", color: "var(--text-muted)" }}>Remetente: {a.remetente || "nome não informado"} · {a.telefone || "telefone não informado"}</small></span><Button disabled={ocupado || bloqueado} onClick={() => { setEscolhido(a); setConfirmado(false); }}>Escolher arquivo</Button></div>)}
      {cursor ? <Button disabled={ocupado || bloqueado} onClick={() => abrir(cursor)}>Carregar mais sem empresa</Button> : temMais ? <p>Há mais arquivos. Feche e abra esta lista após vincular para consultar os demais.</p> : null}
      {escolhido ? <div style={{ padding: 12, border: "1px solid var(--border)" }}>
        <p><strong>{escolhido.nomeArquivo || "Arquivo sem nome"}</strong></p>
        <label><input type="checkbox" checked={confirmado} disabled={ocupado || bloqueado} onChange={e => setConfirmado(e.target.checked)} /> Confirmei que este arquivo pertence à empresa aberta nesta página.</label>
        <Button disabled={!confirmado || ocupado || bloqueado} onClick={vincular}>Vincular arquivo a esta empresa</Button>
      </div> : null}
    </div> : null}
  </div>;
}
