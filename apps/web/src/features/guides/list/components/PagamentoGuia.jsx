import { useEffect, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import { fmtDataCivil } from "../../../../lib/format";

const ORIGENS = { CLIENTE: "Informado pelo cliente", SERPRO: "Confirmado na Receita", MANUAL: "Confirmado pelo contador" };

export function PagamentoGuia({ guide, companyId, api, fallback }) {
  const [aberto, setAberto] = useState(false);
  const pago = String(guide.paymentStatus).toUpperCase() === "PAID";
  const origem = String(guide.paymentStatusSource || "").toUpperCase();
  const arquivos = guide.comprovantesCliente || [];
  return <div style={{ display: "grid", gap: 5, minWidth: 0, whiteSpace: "normal" }}>
    <span style={origem === "CLIENTE" && pago ? { color: "var(--text)" } : undefined}>{pago ? ORIGENS[origem] || "Paga" : fallback}</span>
    {pago && guide.paymentConfirmedAt && <small style={{ color: "var(--text-muted)" }}>{fmtDataCivil(guide.paymentConfirmedAt)}</small>}
    {arquivos.length > 0 && <Button size="sm" style={{ whiteSpace: "normal", maxWidth: "100%" }} onClick={() => setAberto(true)}>Ver comprovante{arquivos.length > 1 ? "s" : ""}</Button>}
    {aberto && <ComprovantesGuia companyId={companyId} guide={guide} api={api} aoFechar={() => setAberto(false)} />}
  </div>;
}

function ComprovantesGuia({ companyId, guide, api, aoFechar }) {
  const [documento, setDocumento] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const ativo = useRef(true);
  const urls = useRef(new Set());
  useEffect(() => {
    ativo.current = true;
    return () => { ativo.current = false; for (const url of urls.current) URL.revokeObjectURL(url); urls.current.clear(); };
  }, []);
  async function abrir(arquivo) {
    setOcupado(arquivo.id); setErro(null); setDocumento(null);
    try {
      const r = await api.getConteudoArquivoWhatsapp(companyId, arquivo.id);
      if (!ativo.current) return;
      if (!["application/pdf", "image/png", "image/jpeg"].includes(r?.mimeType) || !r.base64) throw Error("Formato de comprovante indisponível para visualização.");
      const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current.clear();
      const url = URL.createObjectURL(new Blob([bytes], { type: r.mimeType })); urls.current.add(url);
      setDocumento({ url, nome: r.nomeArquivo || "Comprovante", mimeType: r.mimeType });
    } catch (e) { if (ativo.current) setErro(e.message || "Não foi possível abrir o comprovante."); }
    finally { if (ativo.current) setOcupado(null); }
  }
  return <Modal titulo={`Comprovantes · ${guide.tipo} · ${guide.competencia || ""}`} tamanho="lg" aoFechar={aoFechar}>
    <div style={{ color: "var(--text)", display: "grid", gap: 12, whiteSpace: "normal" }}>
      {String(guide.paymentStatusSource).toUpperCase() === "CLIENTE" && <p style={{ margin: 0 }}>Pagamento informado pelo cliente{guide.paymentConfirmedAt ? ` em ${fmtDataCivil(guide.paymentConfirmedAt)}` : ""}.</p>}
      {(guide.comprovantesCliente || []).map(a => <div key={a.id} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <span style={{ flex: 1, minWidth: 140, overflowWrap: "anywhere" }}>{a.nomeArquivo || "Comprovante"}</span>
        {a.estado === "DISPONIVEL" ? <Button size="sm" disabled={Boolean(ocupado)} onClick={() => abrir(a)}>{ocupado === a.id ? "Abrindo…" : "Abrir comprovante"}</Button> : <small>{["PENDENTE", "BAIXANDO"].includes(a.estado) ? "Recebendo arquivo…" : "Arquivo indisponível"}</small>}
      </div>)}
      {erro && <p role="alert">{erro}</p>}
      {documento && <>
        <a href={documento.url} download={documento.nome}>Baixar original</a>
        {documento.mimeType === "application/pdf" ? <iframe title="Comprovante de pagamento" src={documento.url} style={{ width: "100%", height: "55vh", border: "1px solid var(--border)", borderRadius: 8 }} /> : <img alt="Comprovante de pagamento" src={documento.url} style={{ maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" }} />}
      </>}
    </div>
  </Modal>;
}
