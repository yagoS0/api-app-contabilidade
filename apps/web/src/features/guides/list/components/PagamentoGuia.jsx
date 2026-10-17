import { motivoDaBaixaPendente } from "../../../accounting/circular/lib/procedenciaDoPagamento";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { Modal } from "../../../../components/ui/Modal";
import { fmtDataCivil } from "../../../../lib/format";

const ORIGENS = { CLIENTE: "Informado pelo cliente", SERPRO: "Confirmado na Receita", MANUAL: "Confirmado pelo contador" };

export function PagamentoGuia({ guide, companyId, api, fallback }) {
  const [aberto, setAberto] = useState(false);
  const [historico, setHistorico] = useState(false);
  const pago = String(guide.paymentStatus).toUpperCase() === "PAID";
  const origem = String(guide.paymentStatusSource || "").toUpperCase();
  const arquivos = guide.comprovantesCliente || [];
  const confirmacao = guide.confirmacaoCliente;
  return <div style={{ display: "grid", gap: 5, minWidth: 0, whiteSpace: "normal" }}>
    <span style={origem === "CLIENTE" && pago ? { color: "var(--text)" } : undefined}>{pago ? ORIGENS[origem] || "Paga" : fallback}</span>
    {pago && guide.paymentConfirmedAt && <small style={{ color: "var(--text-muted)" }}>{fmtDataCivil(guide.paymentConfirmedAt)}</small>}
    {pago && confirmacao?.id && <details style={{ fontSize: "0.8125rem" }}><summary>{confirmacao.estadoBaixa === "CONCLUIDA" ? "Baixa concluída · cliente" : "Baixa pendente · cliente"}</summary>
      <p>Declaração do cliente, não comprovante bancário.</p>
      <p>Canal: {confirmacao.canal || "Não informado"} · Confirmado em {confirmacao.confirmadoEm ? new Date(confirmacao.confirmadoEm).toLocaleString("pt-BR") : "data não informada"}</p>
      {confirmacao.motivo && <p>{motivoDaBaixaPendente(confirmacao.motivo)}</p>}
      <Button size="sm" onClick={() => setHistorico(true)}>Ver registro da confirmação</Button>
      {confirmacao.estadoBaixa !== "CONCLUIDA" && <p>Confira os avisos em Contabilidade → Lançamentos para retomar a baixa.</p>}
    </details>}
    {arquivos.length > 0 && <Button size="sm" style={{ whiteSpace: "normal", maxWidth: "100%" }} onClick={() => setAberto(true)}>Ver comprovante{arquivos.length > 1 ? "s" : ""}</Button>}
    {historico && <RegistroConfirmacao key={`${companyId}:${confirmacao?.id}`} companyId={companyId} id={confirmacao?.id} api={api} aoFechar={() => setHistorico(false)} />}
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
    const arquivosLocais = urls.current;
    ativo.current = true;
    return () => { ativo.current = false; for (const url of arquivosLocais) URL.revokeObjectURL(url); arquivosLocais.clear(); };
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

function RegistroConfirmacao({ companyId, id, api, aoFechar }) {
  const [dados, setDados] = useState(null), [erro, setErro] = useState(null);
  useEffect(() => {
    let ativo = true;
    Promise.resolve().then(() => api.getConfirmacaoPagamentoCliente(companyId, id)).then(r => {
      if (r?.ok !== true || r.confirmacao?.id !== id) throw Error("Registro indisponível.");
      if (ativo) setDados(r);
    }).catch(e => { if (ativo) setErro(e.message || "Não foi possível ler o registro."); });
    return () => { ativo = false; };
  }, [companyId, id, api]);
  const c = dados?.confirmacao;
  return <Modal titulo="Registro da confirmação" aoFechar={aoFechar}>
    {erro ? <p role="alert">{erro}</p> : !c ? <p role="status">Consultando registro…</p> : <div style={{ overflowWrap: "anywhere" }}>
      <p>Declaração do cliente, não comprovante bancário.</p>
      <p>Canal: {c.canal || "Não informado"}</p><p>Declarado em: {c.confirmadoEm ? new Date(c.confirmadoEm).toLocaleString("pt-BR") : "Não informado"}</p>
      <p>Data do pagamento: {c.pagoEm ? fmtDataCivil(c.pagoEm) : "Não informada"}</p>
      <p>{c.estadoBaixa === "CONCLUIDA" ? "Baixa contábil concluída" : "Baixa contábil pendente"}{c.motivo ? ` · ${motivoDaBaixaPendente(c.motivo)}` : ""}</p>
      <p>Autor da declaração: {c.autor?.nome || (c.autor?.userId || c.autor?.contatoId ? "Cliente autenticado" : "Identificação indisponível")}</p>
      <p>Referência do evento: {c.eventId || c.id}</p>
    </div>}
  </Modal>;
}
