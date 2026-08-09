import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";

const PANEL = {
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
  danger: "#FF4757",
};

const GUIDE_TYPES = ["SIMPLES", "INSS", "FGTS", "DARF", "ISS", "PIS", "COFINS", "OUTRA"];

const fieldStyle = {
  width: "100%", background: PANEL.field, border: `1px solid ${PANEL.border}`,
  borderRadius: 6, color: PANEL.text, padding: "8px 10px",
  fontSize: "0.9rem", boxSizing: "border-box",
};

const labelStyle = {
  display: "block", fontSize: "0.75rem", color: PANEL.muted,
  marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em",
};

/**
 * Modal split de captura/identificação de guia.
 *
 * Layout: 60% PDF (iframe nativo) / 40% form, ocupando ~90% da tela.
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
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "5vh 5vw",
    }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
        width: "100%", height: "100%", display: "grid", gridTemplateColumns: "60% 40%",
        overflow: "hidden", color: PANEL.text, boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
      }}>
        {/* Lado esquerdo: PDF */}
        <div style={{ background: "#000", borderRight: `1px solid ${PANEL.border}`, position: "relative" }}>
          {pdfLoading && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center",
              justifyContent: "center", color: PANEL.muted, fontSize: "0.9rem",
            }}>
              Carregando PDF...
            </div>
          )}
          {pdfError && !pdfBlobUrl && (
            <div style={{
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
        <form onSubmit={handleSubmit} style={{
          padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700 }}>{title}</h3>
            <button
              type="button"
              onClick={onClose}
              style={{ background: "none", border: "none", color: PANEL.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}
              aria-label="Fechar"
            >
              ✕
            </button>
          </div>

          <p style={{ margin: 0, fontSize: "0.8125rem", color: PANEL.muted, lineHeight: 1.5 }}>
            Olhe o PDF ao lado e preencha os campos abaixo. Você pode dar zoom/scroll no PDF usando os controles do navegador.
          </p>

          {error && (
            <div style={{
              padding: 10, background: "rgba(255,87,87,0.15)", border: `1px solid ${PANEL.danger}`,
              borderRadius: 6, color: PANEL.danger, fontSize: "0.8125rem",
            }}>
              {error}
            </div>
          )}

          <div>
            <label style={labelStyle}>Tipo *</label>
            <select
              style={fieldStyle}
              value={form.tipo}
              onChange={(e) => setField("tipo", e.target.value)}
              autoFocus={!form.tipo}
            >
              <option value="">Selecione...</option>
              {GUIDE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Competência * (AAAA-MM)</label>
            <input
              style={fieldStyle}
              type="text"
              placeholder="2026-01"
              value={form.competencia}
              onChange={(e) => setField("competencia", e.target.value)}
              autoFocus={Boolean(form.tipo) && !form.competencia}
              autoComplete="off"
            />
          </div>

          <div>
            <label style={labelStyle}>Valor (R$)</label>
            <input
              style={fieldStyle}
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
            <label style={labelStyle}>Vencimento</label>
            <input
              style={fieldStyle}
              type="date"
              value={form.vencimento}
              onChange={(e) => setField("vencimento", e.target.value)}
            />
          </div>

          {/* ⚠ O CHECKBOX "Esta guia é de parcelamento" SAIU (R1). Ele era o gatilho do modal-surpresa
              que abria DEPOIS de salvar e podia criar um contrato de até 60 meses como efeito
              colateral de um upload. Guia de parcelamento agora tem caminho próprio e explícito:
              "+ Subir Guia → PARCELAMENTO", onde o contrato é escolhido ANTES do documento. */}

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 8, borderTop: `1px solid ${PANEL.border}` }}>
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Salvando..." : "Salvar guia"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default GuideCaptureModal;
