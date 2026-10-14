import { useEffect, useMemo, useState } from "react";
import { Modal } from "../../../../components/ui/Modal";
import "./guide-capture.css";
import { Button } from "../../../../components/ui/Button";

const PANEL = {
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "var(--text-muted)",
  accent: "#BD93F9",
  danger: "var(--danger)",
};

const GUIDE_TYPES = ["SIMPLES", "INSS", "FGTS", "DARF", "ISS", "PIS", "COFINS", "OUTRA"];

const fieldStyle = {
  width: "100%", background: PANEL.field, border: `1px solid ${PANEL.border}`,
  borderRadius: 6, color: PANEL.text, padding: "8px 10px",
  fontSize: "0.9rem", boxSizing: "border-box",
};

const labelStyle = {
  display: "block", fontSize: "0.875rem", color: PANEL.muted,
  marginBottom: 4, fontWeight: 500,
};

/**
 * Modal split de captura/identificação de guia.
 *
 * Layout: PDF e formulário lado a lado no desktop; empilhados no celular.
 *
 * Modos:
 *  - "upload": guia ainda não existe; recebe `pdfFile` (File local) e dispara
 *     onSave com {file, metadata}. Cria blob URL local para o iframe — não faz
 *     upload do PDF até o usuário clicar Salvar.
 *  - "complete": guia já existe; recebe `loadPdfBlob` callback que faz fetch
 *     autenticado e devolve um Blob. Salva via onSave(metadata) sem reupload.
 *
 * Sem extração automática: contador olha o PDF e digita. Tipo já vem pré-selecionado
 * quando o usuário escolheu via dropdown "Subir Guia → DAS/INSS/...".
 */
export function GuideCaptureModal({
  mode,                 // "upload" | "complete"
  initialTipo,          // tipo pré-selecionado vindo do dropdown
  initialMetadata,      // {tipo, competencia, valor, vencimento} pré-existentes (complete)
  pdfFile,              // File local (modo upload)
  loadPdfBlob,          // () => Promise<Blob> (modo complete)
  onSave,               // (metadata) => Promise<{ok, error?, message?}>
  onClose,
  saving = false,
}) {
  const [form, setForm] = useState({
    tipo: initialMetadata?.tipo || initialTipo || "",
    competencia: initialMetadata?.competencia || "",
    valor: initialMetadata?.valor != null ? String(initialMetadata.valor) : "",
    vencimento: initialMetadata?.vencimento ? String(initialMetadata.vencimento).slice(0, 10) : "",
  });
  const [error, setError] = useState("");

  // Blob URL para o iframe. No modo "upload" vem do File local; no modo "complete"
  // chamamos loadPdfBlob() que faz fetch autenticado. Revoga no unmount.
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfError, setPdfError] = useState("");
  const [pdfLoading, setPdfLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let createdUrl = null;

    async function load() {
      if (pdfFile) {
        // upload: file local → blob URL direto, sem rede
        createdUrl = URL.createObjectURL(pdfFile);
        if (!cancelled) setPdfBlobUrl(createdUrl);
      } else if (loadPdfBlob) {
        // complete: fetch autenticado, blob URL local
        setPdfLoading(true);
        try {
          const blob = await loadPdfBlob();
          if (cancelled) return;
          createdUrl = URL.createObjectURL(blob);
          setPdfBlobUrl(createdUrl);
        } catch (err) {
          if (!cancelled) setPdfError(err?.message || "Falha ao carregar PDF.");
        } finally {
          if (!cancelled) setPdfLoading(false);
        }
      }
    }
    load();

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!form.tipo) { setError("Selecione o tipo da guia."); return; }
    if (!form.competencia.match(/^\d{4}-\d{2}$/)) {
      setError("Competência deve estar no formato AAAA-MM (ex: 2026-01).");
      return;
    }
    setError("");
    const payload = {
      tipo: form.tipo,
      competencia: form.competencia,
      valor: form.valor !== "" ? Number(form.valor) : null,
      vencimento: form.vencimento || null,
    };
    try {
      const res = await onSave(payload);
      if (res?.ok === false) {
        setError(res?.message || res?.error || "Falha ao salvar guia.");
      }
      // Se ok, o pai fecha o modal.
    } catch (err) {
      setError(err?.message || "Falha ao salvar guia.");
    }
  }

  const title = useMemo(() => {
    if (mode === "complete") return `Completar guia ${initialMetadata?.tipo || ""}`.trim();
    return initialTipo ? `Subir guia ${initialTipo}` : "Subir guia";
  }, [mode, initialTipo, initialMetadata?.tipo]);

  return (
    <Modal titulo={title} tamanho="lg" ocupado={saving} aoFechar={onClose} fecharAoClicarFundo={false}
      rodape={<><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button><Button type="submit" form="guide-capture-form" disabled={saving}>{saving ? "Salvando..." : "Salvar guia"}</Button></>}>
      <div className="guide-capture-grid">
        {/* Lado esquerdo: PDF */}
        <div className="guide-capture-pdf">
          {pdfLoading && (
            <div role="status" style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center",
              justifyContent: "center", color: PANEL.muted, fontSize: "0.9rem",
            }}>
              Carregando PDF...
            </div>
          )}
          {pdfError && !pdfBlobUrl && (
            <div role="alert" style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center",
              justifyContent: "center", color: PANEL.danger, fontSize: "0.9rem",
              padding: 20, textAlign: "center",
            }}>
              ⚠ {pdfError}
            </div>
          )}
          {pdfBlobUrl && (
            <iframe
              src={pdfBlobUrl}
              title="PDF da guia"
              style={{ width: "100%", height: "100%", border: 0 }}
            />
          )}
        </div>

        {/* Lado direito: form */}
        <form id="guide-capture-form" onSubmit={handleSubmit} style={{ minWidth: 0,
          padding: 0, display: "flex", flexDirection: "column", gap: 14,
        }}>
          <p style={{ margin: 0, fontSize: "0.875rem", color: PANEL.muted }}>Confira os dados no PDF antes de salvar.</p>
          {error && (
            <div role="alert" style={{
              padding: 10, background: "rgba(255,87,87,0.15)", border: `1px solid ${PANEL.danger}`,
              borderRadius: 6, color: PANEL.danger, fontSize: "0.8125rem",
            }}>
              {error}
            </div>
          )}

          <div>
            <label htmlFor="guia-captura-tipo" style={labelStyle}>Tipo *</label>
            <select id="guia-captura-tipo" disabled={saving}
              style={fieldStyle}
              value={form.tipo}
              onChange={(e) => setField("tipo", e.target.value)}
              data-modal-autofocus={!form.tipo || undefined}
            >
              <option value="">Selecione...</option>
              {GUIDE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="guia-captura-competencia" style={labelStyle}>Competência * (AAAA-MM)</label>
            <input
              style={fieldStyle}
              id="guia-captura-competencia" disabled={saving}
              type="text"
              placeholder="2026-01"
              value={form.competencia}
              onChange={(e) => setField("competencia", e.target.value)}
              data-modal-autofocus={Boolean(form.tipo) && !form.competencia || undefined}
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="guia-captura-valor" style={labelStyle}>Valor (R$)</label>
            <input
              style={fieldStyle}
              id="guia-captura-valor" disabled={saving}
              type="number"
              step="0.01"
              min="0"
              placeholder="0,00"
              value={form.valor}
              onChange={(e) => setField("valor", e.target.value)}
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="guia-captura-vencimento" style={labelStyle}>Vencimento</label>
            <input
              style={fieldStyle}
              id="guia-captura-vencimento" disabled={saving}
              type="date"
              value={form.vencimento}
              onChange={(e) => setField("vencimento", e.target.value)}
            />
          </div>

          {/* ⚠ O CHECKBOX "Esta guia é de parcelamento" SAIU (R1). Ele era o gatilho do modal-surpresa
              que abria DEPOIS de salvar e podia criar um contrato de até 60 meses como efeito
              colateral de um upload. Guia de parcelamento agora tem caminho próprio e explícito:
              "+ Subir Guia → PARCELAMENTO", onde o contrato é escolhido ANTES do documento. */}

        </form>
      </div>
    </Modal>
  );
}

export default GuideCaptureModal;
