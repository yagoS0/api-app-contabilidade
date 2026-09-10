import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui/Button";
import { ArquivosWhatsappNaoVinculados } from "./ArquivosWhatsappNaoVinculados";
import { ImportOFXModal } from "../../accounting/ofx-import/components/renderImportOfxModal";

const ESTADO = { PENDENTE: "Aguardando arquivo", BAIXANDO: "Baixando arquivo", DISPONIVEL: "Disponível para conferência", FALHOU: "Não foi possível baixar", NAO_SUPORTADO: "Tipo de arquivo não suportado", EXPIRADO: "Original expirado" };
function data(iso) { return iso ? new Date(iso).toLocaleDateString("pt-BR") : "não informada"; }
export function arquivoDoConteudo(r) {
  if (!r?.nomeArquivo || typeof r.base64 !== "string" || !r.base64) throw new Error("O servidor não devolveu o conteúdo do arquivo.");
  const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
  return new File([bytes], r.nomeArquivo, { type: ["application/pdf", "image/png", "image/jpeg"].includes(r.mimeType) ? r.mimeType : "text/plain" });
}

export function PainelArquivosWhatsapp({ api, companyId, contas = [], podeEscrever = false, aoImportar }) {
  const [arquivos, setArquivos] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState(null);
  const [erro, setErro] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ofx, setOfx] = useState(null);
  const [aberto, setAberto] = useState(null);
  const versao = useRef(0);
  const importando = useRef(false);
  const urls = useRef(new Set());
  const importacoesIncertas = useRef(new Set());
  useEffect(() => {
    setArquivos([]); setCursor(null); setErro(null); setAviso(null); setOfx(null); setAberto(null); setOcupado(null);
    return () => { versao.current++; for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); };
  }, [api, companyId]);
  const carregar = useCallback(async (mais = null) => {
    const v = ++versao.current; setCarregando(true); setErro(null);
    try {
      const r = await api.listarArquivosWhatsapp(companyId, ...(mais ? [{ cursor: mais }] : []));
      if (v !== versao.current) return;
      if (!Array.isArray(r?.arquivos)) throw new Error("Não foi possível conferir os arquivos recebidos.");
      setArquivos(atuais => mais ? [...new Map([...atuais, ...r.arquivos].map(a => [a.id, a])).values()] : r.arquivos);
      setCursor(r.proximoCursor || null);
    } catch (e) { if (v === versao.current) setErro(e?.message || "Não foi possível carregar os arquivos do WhatsApp."); }
    finally { if (v === versao.current) setCarregando(false); }
  }, [api, companyId]);
  useEffect(() => { if (companyId) carregar(); }, [companyId, carregar]);
  async function abrir(a, importar) {
    if (ocupado || carregando) return;
    const v = versao.current; setOcupado(a.id); setErro(null); setAviso(null);
    try {
      const file = arquivoDoConteudo(await api.getConteudoArquivoWhatsapp(companyId, a.id));
      if (v !== versao.current) return;
      if (importar) setOfx({ arquivo: a, file });
      else {
        if (aberto?.url) { URL.revokeObjectURL(aberto.url); urls.current.delete(aberto.url); }
        const url = URL.createObjectURL(file); urls.current.add(url); setAberto({ arquivo: a, file, url });
      }
    } catch (e) { if (v === versao.current) setErro(e?.message || "Não foi possível abrir o arquivo."); }
    finally { if (v === versao.current) setOcupado(null); }
  }
  async function importar(transactions) {
    if (importando.current) throw new Error("A importação deste arquivo está em andamento.");
    const id = ofx.arquivo.id;
    if (importacoesIncertas.current.has(id)) throw new Error("A tentativa anterior não foi confirmada. Confira os lançamentos da empresa antes de repetir a importação.");
    importando.current = true; setOcupado(id);
    try {
      let r;
      try { r = await api.importOFX(companyId, { transactions, arquivoWhatsappId: id }); }
      catch (e) {
        if (!e?.status || Number(e.status) >= 500) {
          importacoesIncertas.current.add(id);
          setAviso("A importação não foi confirmada. Os lançamentos podem ter sido criados; confira a empresa antes de repetir.");
        }
        throw e;
      }
      if (r?.ok && Number(r.created) > 0) {
        importacoesIncertas.current.add(id);
        if (!Number(r.failed)) {
          setAviso(r.repetido ? "Esta importação já estava registrada; nenhum lançamento foi duplicado." : "Importação registrada. Os lançamentos permanecem após a expiração do original.");
          await carregar();
        }
        else setAviso("A importação teve falhas parciais. Confira os lançamentos criados antes de importar o arquivo novamente.");
      }
      if (r?.ok) {
        try { await aoImportar?.(); } catch { setAviso("A importação foi registrada, mas a lista de lançamentos não foi atualizada. Atualize a página para conferir."); }
      }
      return r;
    } finally { importando.current = false; setOcupado(null); }
  }
  return <section data-testid="arquivos-whatsapp" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><h3 style={{ margin: 0 }}>Arquivos recebidos pelo WhatsApp</h3><Button size="sm" disabled={carregando || Boolean(ocupado)} onClick={() => carregar()}>Atualizar arquivos</Button></div>
    <p style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Abra e confira o original antes de importar. Ele fica disponível por 90 dias; os lançamentos já importados são preservados.</p>
    {erro ? <p role="alert">{erro}</p> : null}
    {aviso ? <p role="status">{aviso}</p> : null}
    {carregando ? <p>Carregando arquivos…</p> : !erro && arquivos.length === 0 ? <p>Nenhum arquivo recebido nesta empresa.</p> : null}
    {arquivos.map(a => <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderTop: "1px solid var(--border)", padding: "10px 0" }}>
      <div style={{ flex: 1, minWidth: 180 }}><strong>{a.nomeArquivo || "Arquivo sem nome"}</strong><div style={{ color: "var(--text-muted)", fontSize: "0.76rem" }}>{a.importadoEm ? "Importação registrada" : ESTADO[a.estado] || a.estado || "Estado não informado"} · recebido em {data(a.recebidoEm)} · original até {data(a.expiraEm)}</div></div>
      <Button size="sm" disabled={!a.podeAbrir || Boolean(ocupado) || carregando} onClick={() => abrir(a, false)}>Abrir arquivo</Button>
      {a.podeImportarOfx ? <Button size="sm" disabled={!podeEscrever || Boolean(a.importadoEm) || importacoesIncertas.current.has(a.id) || Boolean(ocupado) || carregando} onClick={() => abrir(a, true)}>Conferir e importar OFX</Button> : null}
    </div>)}
    {cursor ? <Button disabled={carregando || Boolean(ocupado)} onClick={() => carregar(cursor)}>Carregar mais arquivos</Button> : null}
    {aberto ? <div style={{ marginTop: 12 }}><strong>{aberto.file.name}</strong> · <a href={aberto.url} target="_blank" rel="noopener noreferrer">Abrir em outra aba</a> · <a href={aberto.url} download={aberto.file.name}>Baixar original</a></div> : null}
    {podeEscrever ? <ArquivosWhatsappNaoVinculados api={api} companyId={companyId} bloqueado={Boolean(ocupado)} aoVincular={carregar} /> : null}
    {ofx ? <ImportOFXModal key={ofx.arquivo.id} initialFile={ofx.file} accounts={contas}
      onPreview={file => api.previewOFX(companyId, file)} onImport={importar}
      onSearchHistoricos={q => api.searchHistoricos(companyId, q)} onGetHistoricosByCode={codigo => api.getHistoricosByCode(companyId, codigo)}
      onClose={() => setOfx(null)} /> : null}
  </section>;
}
