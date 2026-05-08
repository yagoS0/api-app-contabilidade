import { useRef, useState, useMemo } from "react";
import { Button } from "../../../../components/ui/Button";
import { fmtDate, fmtMoney } from "../../../../lib/format";

const GUIDE_TYPES = ["SIMPLES", "INSS", "FGTS", "DARF", "ISS", "PIS", "COFINS", "OUTRA"];

const S = {
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000,
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  modal: {
    background: "#24253A", border: "1px solid #44475A", borderRadius: 8,
    padding: "24px 28px", width: 380, maxWidth: "95vw", color: "#F8F8F2",
  },
  title: { margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#F8F8F2" },
  field: { marginBottom: 14 },
  label: { display: "block", fontSize: 12, color: "#6272A4", marginBottom: 4 },
  input: {
    width: "100%", background: "#1A1B26", border: "1px solid #44475A",
    borderRadius: 4, color: "#F8F8F2", padding: "6px 10px", fontSize: 14, boxSizing: "border-box",
  },
  select: {
    width: "100%", background: "#1A1B26", border: "1px solid #44475A",
    borderRadius: 4, color: "#F8F8F2", padding: "6px 10px", fontSize: 14, boxSizing: "border-box",
  },
  btnRow: { display: "flex", gap: 8, marginTop: 16 },
  error: { fontSize: 12, color: "#FF5555", marginBottom: 10 },
  checkbox: { width: 16, height: 16, cursor: "pointer", accentColor: "#BD93F9" },
};

function MetadataDialog({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState({
    tipo: initial?.tipo || "",
    competencia: initial?.competencia || "",
    valor: initial?.valor != null ? String(initial.valor) : "",
    vencimento: initial?.vencimento ? String(initial.vencimento).slice(0, 10) : "",
  });
  const [error, setError] = useState("");

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    if (!form.tipo) { setError("Selecione o tipo da guia."); return; }
    if (!form.competencia.match(/^\d{4}-\d{2}$/)) {
      setError("Competência deve estar no formato AAAA-MM (ex: 2026-01).");
      return;
    }
    setError("");
    onSave({
      tipo: form.tipo,
      competencia: form.competencia,
      valor: form.valor !== "" ? Number(form.valor) : null,
      vencimento: form.vencimento || null,
    });
  }

  return (
    <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div style={S.modal}>
        <h3 style={S.title}>Identificar guia</h3>
        <p style={{ fontSize: 13, color: "#6272A4", margin: "0 0 16px" }}>
          Não conseguimos identificar automaticamente esta guia. Preencha os dados abaixo.
        </p>

        {error && <div style={S.error}>{error}</div>}

        <div style={S.field}>
          <label style={S.label}>Tipo *</label>
          <select style={S.select} value={form.tipo} onChange={(e) => setField("tipo", e.target.value)}>
            <option value="">Selecione...</option>
            {GUIDE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div style={S.field}>
          <label style={S.label}>Competência * (AAAA-MM)</label>
          <input
            style={S.input} type="text" placeholder="2026-01"
            value={form.competencia}
            onChange={(e) => setField("competencia", e.target.value)}
          />
        </div>

        <div style={S.field}>
          <label style={S.label}>Valor (R$)</label>
          <input
            style={S.input} type="number" step="0.01" placeholder="0,00"
            value={form.valor}
            onChange={(e) => setField("valor", e.target.value)}
          />
        </div>

        <div style={S.field}>
          <label style={S.label}>Vencimento</label>
          <input
            style={S.input} type="date"
            value={form.vencimento}
            onChange={(e) => setField("vencimento", e.target.value)}
          />
        </div>

        <div style={S.btnRow}>
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar guia"}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}

function normalizeValue(value) {
  return String(value || "").trim().toUpperCase();
}

function formatGuideStatus(status) {
  const n = normalizeValue(status);
  if (n === "PROCESSED") return { label: "Processada", tone: "success" };
  if (n === "ERROR") return { label: "Aguardando envio", tone: "warning" };
  if (n === "PENDING") return { label: "Pendente", tone: "muted" };
  return { label: status || "-", tone: "default" };
}

function formatEmailStatus(status) {
  const n = normalizeValue(status);
  if (n === "PENDING") return { label: "Pendente", tone: "accent" };
  if (n === "SENT") return { label: "Enviado", tone: "success" };
  if (n === "ERROR") return { label: "Erro", tone: "danger" };
  return { label: status || "-", tone: "default" };
}

function formatPaymentStatus(status) {
  const n = normalizeValue(status);
  if (n === "PAID") return { label: "Paga", tone: "success" };
  if (n === "OVERDUE") return { label: "Vencida", tone: "danger" };
  return { label: "Em aberto", tone: "warning" };
}

export function CompanyGuidesTable({
  guides,
  loadingGuides,
  onResendGuide,
  onConfirmGuidePayment,
  onRecalculateGuide,
  onDeleteGuide,
  resendingGuideId,
  confirmingGuideId,
  recalculatingGuideId,
  onUploadGuide,
  uploadingGuide,
}) {
  const [filterCompetencia, setFilterCompetencia] = useState("all");
  const [filterTipo, setFilterTipo] = useState("all");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkResending, setBulkResending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [parsedPreFill, setParsedPreFill] = useState(null);
  const fileInputRef = useRef(null);

  const competenciaOptions = useMemo(
    () => [...new Set(guides.map((g) => g.competencia).filter(Boolean))].sort((a, b) => b.localeCompare(a)),
    [guides]
  );

  const tipoOptions = useMemo(
    () => [...new Set(guides.map((g) => g.tipo).filter(Boolean))].sort(),
    [guides]
  );

  const filteredGuides = useMemo(() => {
    return guides.filter((g) => {
      if (filterCompetencia !== "all" && g.competencia !== filterCompetencia) return false;
      if (filterTipo !== "all" && g.tipo !== filterTipo) return false;
      return true;
    });
  }, [filterCompetencia, filterTipo, guides]);

  const filteredIds = useMemo(
    () => filteredGuides.map((g) => g.guideId || g.id),
    [filteredGuides]
  );

  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someSelected = filteredIds.some((id) => selectedIds.has(id));
  const selectedCount = filteredIds.filter((id) => selectedIds.has(id)).length;

  // When exactly one guide is selected, expose it for single-guide actions
  const selectedGuide = useMemo(() => {
    if (selectedCount !== 1) return null;
    const selectedId = filteredIds.find((id) => selectedIds.has(id));
    return filteredGuides.find((g) => (g.guideId || g.id) === selectedId) ?? null;
  }, [selectedCount, filteredIds, filteredGuides, selectedIds]);

  const selectedGuideId = selectedGuide ? (selectedGuide.guideId || selectedGuide.id) : null;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  function toggleOne(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  async function handleBulkResend() {
    const ids = filteredIds.filter((id) => selectedIds.has(id));
    if (!ids.length || !onResendGuide) return;
    setBulkResending(true);
    for (const id of ids) {
      try { await onResendGuide(id); } catch { /* surfaced individually */ }
    }
    setBulkResending(false);
    clearSelection();
  }

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !onUploadGuide) return;
    setPendingFile(file);
    const result = await onUploadGuide(file, null);
    if (result?.needsMetadata) {
      setParsedPreFill(result.parsed || null);
      setShowDialog(true);
    } else {
      setPendingFile(null);
    }
  }

  async function handleDialogSave(metadata) {
    if (!pendingFile || !onUploadGuide) return;
    const result = await onUploadGuide(pendingFile, metadata);
    if (!result?.needsMetadata) {
      setShowDialog(false);
      setPendingFile(null);
      setParsedPreFill(null);
    }
  }

  function handleDialogCancel() {
    setShowDialog(false);
    setPendingFile(null);
    setParsedPreFill(null);
  }

  async function handleDelete() {
    if (!onDeleteGuide || selectedCount === 0) return;
    const ids = filteredIds.filter((id) => selectedIds.has(id));
    const label = ids.length === 1 ? "esta guia" : `estas ${ids.length} guias`;
    if (!window.confirm(`Tem certeza que deseja excluir ${label}? Esta ação não pode ser desfeita.`)) return;
    setDeleting(true);
    for (const id of ids) {
      try { await onDeleteGuide(id); } catch { /* surfaced by handler */ }
    }
    setDeleting(false);
    clearSelection();
  }

  const actionsBusy = bulkResending || deleting || !!confirmingGuideId || !!recalculatingGuideId;

  return (
    <section className="guides-page">
      {showDialog && (
        <MetadataDialog
          initial={parsedPreFill}
          onSave={handleDialogSave}
          onCancel={handleDialogCancel}
          saving={uploadingGuide}
        />
      )}

      {/* Filter bar */}
      <div className="guides-filters" aria-label="Filtros das guias">
        <strong className="guides-filters__title">Filtrar por:</strong>
        <label className="guides-filter-field">
          <span>Competência</span>
          <select value={filterCompetencia} onChange={(e) => setFilterCompetencia(e.target.value)}>
            <option value="all">Todas</option>
            {competenciaOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="guides-filter-field">
          <span>Tipo</span>
          <select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value)}>
            <option value="all">Todos</option>
            {tipoOptions.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>

        {onUploadGuide && (
          <>
            <input ref={fileInputRef} type="file" accept="application/pdf"
              style={{ display: "none" }} onChange={handleFileChange} />
            <Button
              variant="primary" size="sm" type="button"
              disabled={uploadingGuide}
              onClick={() => fileInputRef.current?.click()}
              style={{ marginLeft: "auto" }}
            >
              {uploadingGuide ? "Enviando..." : "+ Subir Guia"}
            </Button>
          </>
        )}
      </div>

      {/* Action toolbar — always visible above the table */}
      <div className="guides-toolbar">
        <div className="guides-toolbar__actions">
          <Button
            variant="secondary" size="sm"
            onClick={handleBulkResend}
            disabled={selectedCount === 0 || actionsBusy}
          >
            {bulkResending ? "Reenviando..." : "Reenviar"}
          </Button>

          {selectedCount > 0 && (
            <>
              <Button
                variant="secondary" size="sm"
                disabled={selectedCount !== 1 || !selectedGuide?.canConfirmPayment || !!confirmingGuideId}
                onClick={() => selectedGuideId && onConfirmGuidePayment(selectedGuideId)}
              >
                {confirmingGuideId === selectedGuideId ? "..." : "Confirmar pagamento"}
              </Button>
              <Button
                variant="secondary" size="sm"
                disabled={selectedCount !== 1 || !selectedGuide?.canRecalculate || !!recalculatingGuideId}
                onClick={() => selectedGuideId && onRecalculateGuide(selectedGuideId)}
              >
                {recalculatingGuideId === selectedGuideId ? "..." : "Recalcular"}
              </Button>
              {onDeleteGuide && (
                <Button
                  variant="danger" size="sm"
                  disabled={actionsBusy}
                  onClick={handleDelete}
                >
                  {deleting ? "Excluindo..." : "Excluir"}
                </Button>
              )}
            </>
          )}
        </div>

        {selectedCount > 0 && (
          <div className="guides-toolbar__selection">
            <span className="guides-toolbar__count">
              {selectedCount} selecionada{selectedCount !== 1 ? "s" : ""}
            </span>
            <button className="guides-toolbar__clear" onClick={clearSelection} type="button">
              Limpar
            </button>
          </div>
        )}
      </div>

      <div className="guides-list-panel">
        <h2 className="guides-list-panel__title">Guias</h2>

        {loadingGuides ? (
          <p className="text-muted">Carregando...</p>
        ) : filteredGuides.length === 0 ? (
          <p className="text-muted">Nenhuma guia encontrada para os filtros atuais.</p>
        ) : (
          <div className="guides-grid" role="table" aria-label="Lista de guias">
            <div className="guides-grid__head" role="rowgroup">
              <div className="guides-grid__row guides-grid__row--head" role="row">
                <span className="guides-grid__cell guides-grid__cell--check" role="columnheader">
                  <input
                    type="checkbox"
                    style={S.checkbox}
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleAll}
                    aria-label="Selecionar todas"
                  />
                </span>
                <span className="guides-grid__cell guides-grid__cell--type" role="columnheader">Tipo</span>
                <span className="guides-grid__cell guides-grid__cell--competencia" role="columnheader">Competência</span>
                <span className="guides-grid__cell guides-grid__cell--valor" role="columnheader">Valor</span>
                <span className="guides-grid__cell guides-grid__cell--competencia" role="columnheader">Vencimento</span>
                <span className="guides-grid__cell guides-grid__cell--status" role="columnheader">Status</span>
                <span className="guides-grid__cell guides-grid__cell--status" role="columnheader">Situação</span>
                <span className="guides-grid__cell guides-grid__cell--email" role="columnheader">E-mail</span>
              </div>
            </div>

            <div className="guides-grid__body" role="rowgroup">
              {filteredGuides.map((guide) => {
                const guideId = guide.guideId || guide.id;
                const isSelected = selectedIds.has(guideId);
                const status = formatGuideStatus(guide.status);
                const paymentStatus = formatPaymentStatus(guide.paymentStatus);
                const emailStatus = formatEmailStatus(guide.emailStatus);

                return (
                  <div
                    key={guideId}
                    className={`guides-grid__row${isSelected ? " guides-grid__row--selected" : ""}`}
                    role="row"
                    onClick={() => toggleOne(guideId)}
                    style={{ cursor: "pointer" }}
                  >
                    <span className="guides-grid__cell guides-grid__cell--check" role="cell"
                      onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        style={S.checkbox}
                        checked={isSelected}
                        onChange={() => toggleOne(guideId)}
                        aria-label={`Selecionar guia ${guide.tipo} ${guide.competencia}`}
                      />
                    </span>
                    <span className="guides-grid__cell guides-grid__cell--type" role="cell">{guide.tipo || "-"}</span>
                    <span className="guides-grid__cell guides-grid__cell--competencia" role="cell">{guide.competencia || "-"}</span>
                    <span className="guides-grid__cell guides-grid__cell--valor guides-grid__money" role="cell">
                      {fmtMoney(guide.valor)}
                    </span>
                    <span className="guides-grid__cell guides-grid__cell--competencia" role="cell">{fmtDate(guide.vencimento)}</span>
                    <span className={`guides-grid__cell guides-grid__cell--status guides-grid__tone guides-grid__tone--${status.tone}`} role="cell">
                      {status.label}
                    </span>
                    <span className={`guides-grid__cell guides-grid__cell--status guides-grid__tone guides-grid__tone--${paymentStatus.tone}`} role="cell">
                      {paymentStatus.label}
                    </span>
                    <span className={`guides-grid__cell guides-grid__cell--email guides-grid__tone guides-grid__tone--${emailStatus.tone}`} role="cell">
                      {emailStatus.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
