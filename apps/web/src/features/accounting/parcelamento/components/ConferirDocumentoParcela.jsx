import { useEffect, useRef, useState } from "react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
const field = { width: "100%", padding: 8, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)" };

export function ConferirDocumentoParcela({ api, companyId, item, onClose, onSaved }) {
  const [documento, setDocumento] = useState(null);
  const [erro, setErro] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [pdf, setPdf] = useState(null);
  const [abrindoPdf, setAbrindoPdf] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf); }, [pdf]);
  useEffect(() => {
    let active = true;
    setErro(""); setDocumento(null); setConfirmado(false);
    api.getDocumentoParcela(companyId, item.parcelaId).then(out => {
      if (!active) return;
      if (!out?.documento?.hash) { setErro("Não foi possível identificar a versão do PDF. Obtenha a guia novamente."); return; }
      setDocumento({ ...out.documento, valor: out.documento.valor ?? "", vencimento: String(out.documento.vencimento || "").slice(0, 10) });
    }).catch(e => { if (active) setErro(e.message || "Não foi possível carregar o documento."); });
    return () => { active = false; };
  }, [api, companyId, item.parcelaId, tentativa]);
  async function salvar() {
    if (!documento || !confirmado || busy) return;
    setBusy(true); setErro("");
    try {
      const valor = Number(String(documento.valor).replace(",", "."));
      if (!Number.isFinite(valor) || valor <= 0) throw new Error("Informe o valor total exibido no documento.");
      const out = await api.conferirDocumentoParcela(companyId, item.parcelaId, { cnpj: documento.cnpj, numeroParcelamento: documento.numeroParcelamento, anoMesParcela: documento.anoMesParcela, valor, vencimento: documento.vencimento, hash: documento.hash, confirmado: true });
      if (out?.ok === false) throw new Error(out.message || "Conferência recusada.");
      await onSaved(); onClose();
    } catch (e) { setErro(e.message || "Não foi possível salvar a conferência."); }
    finally { setBusy(false); }
  }
  async function abrirPdf() {
    setAbrindoPdf(true); setErro("");
    try { const blob = await api.fetchGuidePdfBlob(companyId, documento.guideId); if (mounted.current) setPdf(URL.createObjectURL(blob)); }
    catch (e) { if (mounted.current) setErro(e.message || "Não foi possível abrir o PDF. Tente novamente."); }
    finally { if (mounted.current) setAbrindoPdf(false); }
  }
  return <Modal titulo="Conferir documento da parcela" aoFechar={onClose} ocupado={busy} tamanho="md" rodape={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button><Button onClick={salvar} disabled={!documento || !confirmado || busy}>{busy ? "Salvando…" : "Confirmar documento"}</Button></>}>
    {!documento && !erro && <p role="status">Carregando documento…</p>}
    {documento && <>
      {api.fetchGuidePdfBlob ? <Button variant="secondary" size="sm" onClick={abrirPdf} disabled={abrindoPdf}>{abrindoPdf ? "Abrindo PDF…" : "Abrir PDF para conferir"}</Button> : <p>Abra a guia na área de documentos para comparar os dados do PDF.</p>}
      {pdf && <iframe title="PDF da parcela" src={pdf} style={{ width: "100%", height: 340, border: "1px solid var(--border)", marginTop: 10 }} />}
      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>{[["cnpj", "CNPJ", "text"], ["numeroParcelamento", "Número do parcelamento", "text"], ["anoMesParcela", "Referência da parcela (AAAAMM)", "text"], ["valor", "Valor do documento", "text"], ["vencimento", "Vencimento", "date"]].map(([key, label, type]) => <label key={key}>{label}<input style={field} type={type} value={documento[key] ?? ""} onChange={e => { setDocumento({ ...documento, [key]: e.target.value }); setConfirmado(false); }} /></label>)}</div>
      <label style={{ display: "flex", gap: 8, marginTop: 16 }}><input type="checkbox" checked={confirmado} onChange={e => setConfirmado(e.target.checked)} />Conferi estes dados no PDF da parcela.</label>
      <p style={{ color: "var(--text-muted)", fontSize: ".8125rem" }}>Esta conferência libera o documento para o fluxo de envio. Não confirma pagamento nem cria baixa contábil.</p>
    </>}
    {erro && <div role="alert" style={{ color: "var(--state-danger)", marginTop: 12 }}>{erro}{!documento && <Button variant="secondary" size="sm" onClick={() => setTentativa(t => t + 1)}>Tentar novamente</Button>}</div>}
  </Modal>;
}
