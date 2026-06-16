import { useEffect, useRef, useState, useMemo } from "react";
import { createApiClient } from "../../../../api/client";
import { Button } from "../../../../components/ui/Button";
import { fmtDate, fmtMoney } from "../../../../lib/format";
import { GuideCaptureModal } from "../../capture/components/renderGuideCaptureModal";
import { GuideLinkParcelamentoModal } from "../../../accounting/parcelamento/components/ParcelamentoModals";

// Q17: guias ESPERADAS do mês (por regime/prolabore) com botão "Vazio" (ausência confirmada).
// Mapeia a chave do compliance → tipo de Guide pra marcar Vazio.
const EXPECTED_GUIDE_ROWS = [
  { key: "das", label: "DAS (Simples)", tipo: "SIMPLES" },
  { key: "inss", label: "INSS", tipo: "INSS" },
  { key: "irpj", label: "IRPJ", tipo: "IRPJ" },
  { key: "csll", label: "CSLL", tipo: "CSLL" },
  { key: "pisCofins", label: "PIS/COFINS", tipo: "PIS" },
  { key: "iss", label: "ISS", tipo: "ISS" },
];

function prevMonthCompetencia() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATE_STYLE = {
  present: { color: "#69FF47", label: "presente" },
  vazio: { color: "#FFB347", label: "vazio" },
  missing: { color: "#FF5757", label: "faltando" },
  na: { color: "#6272A4", label: "—" },
};

const expectedGuidesApi = createApiClient();

function ExpectedGuidesPanel({ companyId, competencia, onCompetenciaChange }) {
  // Q19: competência é controlada pelo pai (mesmo seletor filtra a tabela de guias abaixo).
  const [compliance, setCompliance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busyTipo, setBusyTipo] = useState(null);
  const [monthClosed, setMonthClosed] = useState(false); // Q18: mês fechado bloqueia Vazio/upload

  async function load(comp) {
    setLoading(true);
    try {
      const [r, fech] = await Promise.all([
        expectedGuidesApi.getExpectedGuides(companyId, comp),
        expectedGuidesApi.getFechamentoContabil(companyId, comp).catch(() => null),
      ]);
      setCompliance(r?.compliance || null);
      setMonthClosed(Boolean(fech?.fechado));
    } catch { setCompliance(null); }
    setLoading(false);
  }
  useEffect(() => { load(competencia); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId, competencia]);

  async function setVazio(tipo, undo) {
    setBusyTipo(tipo);
    try {
      if (undo) await expectedGuidesApi.undoGuideVazio(companyId, tipo, competencia);
      else await expectedGuidesApi.markGuideVazio(companyId, tipo, competencia);
      await load(competencia);
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(err?.message || "Falha ao atualizar status.");
    } finally { setBusyTipo(null); }
  }

  const rows = EXPECTED_GUIDE_ROWS.filter((r) => compliance?.[r.key]?.required);

  return (
    <div style={{
      marginBottom: 16, padding: "12px 14px", background: "#24253A",
      border: "1px solid #44475A", borderRadius: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <strong style={{ color: "#F8F8F2", fontSize: "0.9rem" }}>Guias do mês (esperadas)</strong>
        <label style={{ fontSize: "0.8rem", color: "#aeb6d3", display: "flex", alignItems: "center", gap: 6 }}>
          Competência:
          <input type="month" value={competencia} onChange={(e) => onCompetenciaChange(e.target.value)}
            style={{ background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "#F8F8F2", padding: "4px 8px", colorScheme: "dark" }} />
        </label>
        {loading && <span style={{ color: "#6272A4", fontSize: "0.75rem" }}>carregando…</span>}
        {monthClosed && <span style={{ color: "#8BE9FD", fontSize: "0.75rem", fontWeight: 700 }}>🔒 Mês fechado</span>}
      </div>
      {!loading && rows.length === 0 && (
        <div style={{ color: "#6272A4", fontSize: "0.8rem" }}>Nenhuma guia obrigatória para esta empresa/competência.</div>
      )}
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((r) => {
          const node = compliance[r.key] || {};
          const st = STATE_STYLE[node.state] || STATE_STYLE.na;
          const isVazio = node.state === "vazio";
          const isPresent = node.state === "present";
          return (
            <div key={r.key} style={{
              display: "grid", gridTemplateColumns: "1fr 110px 130px", gap: 8, alignItems: "center",
              padding: "6px 8px", borderBottom: "1px solid #2a2c3d",
            }}>
              <span style={{ color: "#F8F8F2", fontSize: "0.82rem" }}>{r.label}</span>
              <span style={{
                justifySelf: "start", fontSize: "0.7rem", fontWeight: 700, padding: "2px 8px",
                borderRadius: 999, color: st.color, background: `${st.color}22`, border: `1px solid ${st.color}`,
              }}>
                {st.label}
              </span>
              <span style={{ justifySelf: "end" }}>
                {isPresent ? null : isVazio ? (
                  <button type="button" disabled={busyTipo === r.tipo || monthClosed}
                    onClick={() => setVazio(r.tipo, true)}
                    title={monthClosed ? "Mês fechado — reabra a empresa para alterar." : undefined}
                    style={{ fontSize: "0.7rem", padding: "3px 8px", cursor: monthClosed ? "not-allowed" : "pointer", background: "transparent", color: "#aeb6d3", border: "1px solid #44475A", borderRadius: 4, opacity: monthClosed ? 0.5 : 1 }}>
                    desfazer
                  </button>
                ) : (
                  <button type="button" disabled={busyTipo === r.tipo || monthClosed}
                    onClick={() => setVazio(r.tipo, false)}
                    title={monthClosed ? "Mês fechado — reabra a empresa para alterar." : undefined}
                    style={{ fontSize: "0.7rem", padding: "3px 8px", cursor: monthClosed ? "not-allowed" : "pointer", background: monthClosed ? "#44475A" : "#FFB347", color: monthClosed ? "#888" : "#1A1B26", border: "none", borderRadius: 4, fontWeight: 700 }}>
                    Vazio
                  </button>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Tipos sempre disponíveis (qualquer regime).
const GUIDE_TYPES = ["SIMPLES", "INSS", "FGTS", "DARF", "ISS", "PIS", "COFINS", "IRPJ", "CSLL", "OUTRA"];

// Filtro contextual: empresas Simples não têm IRPJ/CSLL/PIS/COFINS/ISS (são exclusivos de Presumidos).
// Quando o regime não é conhecido, mostra tudo (comportamento conservador — usuário não fica travado).
const GUIDE_TYPES_BY_REGIME = {
  SIMPLES: ["SIMPLES", "INSS", "FGTS", "OUTRA"],
  LUCRO_PRESUMIDO: ["IRPJ", "CSLL", "PIS", "COFINS", "ISS", "DARF", "INSS", "FGTS", "OUTRA"],
  LUCRO_REAL: ["IRPJ", "CSLL", "PIS", "COFINS", "ISS", "DARF", "INSS", "FGTS", "OUTRA"],
};

function getAvailableGuideTypes(regimeTributario) {
  const r = String(regimeTributario || "").trim().toUpperCase();
  return GUIDE_TYPES_BY_REGIME[r] || GUIDE_TYPES;
}

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
  companyId,
  companyRegime,  // regime tributário da empresa: filtra opções do dropdown "+ Subir Guia"
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
  // Novos: identificação/completar guia já existente + fetch do PDF para o iframe.
  onIdentifyGuide,
  onFetchGuidePdf,
  // Q9.7: hook de parcelamentos + funções; quando setados, dispara modal de linking
  // após identificação bem-sucedida da guia.
  parcelamentos,
  accountingFunctions,
}) {
  // Q9.7: state do modal de linking (guia recém-identificada aguardando decisão de vincular)
  const [linkingGuide, setLinkingGuide] = useState(null);
  // Tipos disponíveis no dropdown filtrados pelo regime da empresa.
  // Simples não vê IRPJ/CSLL/PIS/COFINS/ISS; Presumido não vê SIMPLES.
  const availableUploadTypes = useMemo(
    () => getAvailableGuideTypes(companyRegime),
    [companyRegime],
  );
  // Q19: filtro único de competência (mês), default = mês anterior ao atual.
  const [filterCompetencia, setFilterCompetencia] = useState(prevMonthCompetencia());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkResending, setBulkResending] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Upload flow (modal split): tipo escolhido no dropdown + arquivo + estado de salvamento
  const [uploadTipo, setUploadTipo] = useState(null);  // "DAS"|"INSS"|... — null = modal fechado
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);
  const fileInputRef = useRef(null);
  const uploadMenuRef = useRef(null);

  // Completar flow (modal split p/ guia já existente)
  const [completingGuide, setCompletingGuide] = useState(null);
  const [completingSaving, setCompletingSaving] = useState(false);

  const filteredGuides = useMemo(() => {
    return guides.filter((g) => {
      // Competência vazia = mostra todas; senão filtra pelo mês escolhido.
      if (filterCompetencia && g.competencia !== filterCompetencia) return false;
      return true;
    });
  }, [filterCompetencia, guides]);

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

  // Fluxo novo de upload: usuário escolhe tipo no dropdown → file picker → modal split com PDF lado-a-lado
  function handleStartUpload(tipo) {
    setUploadMenuOpen(false);
    setUploadTipo(tipo);
    // Dispara file picker no próximo tick (precisa do input já no DOM)
    requestAnimationFrame(() => fileInputRef.current?.click());
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      // Cancelou o picker — fecha o estado de upload
      setUploadTipo(null);
      return;
    }
    setUploadFile(file);
    // O modal split abre quando uploadFile + uploadTipo estão setados
  }

  async function handleCaptureSave(metadata) {
    if (!uploadFile || !onUploadGuide) return { ok: false };
    const result = await onUploadGuide(uploadFile, { ...metadata, tipo: uploadTipo || metadata.tipo });
    if (result?.ok || (result && !result.needsMetadata)) {
      // Sucesso: fecha modal
      setUploadFile(null);
      setUploadTipo(null);
      return { ok: true };
    }
    return { ok: false, message: result?.message || result?.error || "Falha ao enviar guia." };
  }

  function handleCaptureCancel() {
    setUploadFile(null);
    setUploadTipo(null);
  }

  // Fluxo de completar guia já existente (modal split com fetch do PDF)
  async function handleCompleteSave(metadata) {
    if (!completingGuide || !onIdentifyGuide) return { ok: false };
    const gid = completingGuide.guideId || completingGuide.id;
    setCompletingSaving(true);
    try {
      const result = await onIdentifyGuide(gid, metadata);
      if (result?.ok !== false) {
        // Q9.7: se o hook de parcelamentos estiver disponível e o tipo da guia for
        // candidato a parcelamento (SIMPLES/INSS/DARF), abre modal de linking.
        const guideAfter = { ...completingGuide, ...metadata, guideId: gid, id: gid };
        const tipoUpper = String(guideAfter.tipo || metadata?.tipo || "").toUpperCase();
        const isParcelamentoCandidate = ["SIMPLES", "INSS", "DARF", "PIS", "COFINS", "IRPJ", "CSLL", "ISS"].includes(tipoUpper);
        if (parcelamentos && accountingFunctions && isParcelamentoCandidate) {
          setLinkingGuide(guideAfter);
        }
        setCompletingGuide(null);
        return { ok: true };
      }
      return { ok: false, message: result?.message || result?.error || "Falha ao identificar guia." };
    } finally {
      setCompletingSaving(false);
    }
  }

  // Fecha o menu de upload ao clicar fora
  useEffect(() => {
    if (!uploadMenuOpen) return undefined;
    function onDocClick(e) {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target)) {
        setUploadMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [uploadMenuOpen]);

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
      {/* Modal split de upload: PDF lado-a-lado do form. Abre quando tipo + arquivo estão prontos. */}
      {uploadTipo && uploadFile && (
        <GuideCaptureModal
          mode="upload"
          initialTipo={uploadTipo}
          pdfFile={uploadFile}
          onSave={handleCaptureSave}
          onClose={handleCaptureCancel}
          saving={uploadingGuide}
        />
      )}

      {/* Modal split de completar: para guias já no banco que estão pendentes/erro */}
      {completingGuide && (
        <GuideCaptureModal
          mode="complete"
          initialMetadata={completingGuide}
          loadPdfBlob={onFetchGuidePdf ? () => onFetchGuidePdf(completingGuide.guideId || completingGuide.id) : null}
          onSave={handleCompleteSave}
          onClose={() => setCompletingGuide(null)}
          saving={completingSaving}
        />
      )}

      {/* Q19: guias esperadas do mês + botão Vazio. O seletor de competência deste
          painel é o ÚNICO filtro — controla também a tabela de guias abaixo. */}
      <ExpectedGuidesPanel
        companyId={companyId}
        competencia={filterCompetencia}
        onCompetenciaChange={setFilterCompetencia}
      />

      {/* Action toolbar — always visible above the table */}
      <div className="guides-toolbar">
        <div className="guides-toolbar__actions">
          {onUploadGuide && (
            <>
              <input ref={fileInputRef} type="file" accept="application/pdf"
                style={{ display: "none" }} onChange={handleFileChange} />
              <div ref={uploadMenuRef} style={{ position: "relative" }}>
                <Button
                  variant="primary" size="sm" type="button"
                  disabled={uploadingGuide}
                  onClick={() => setUploadMenuOpen((o) => !o)}
                >
                  {uploadingGuide ? "Enviando..." : "+ Subir Guia ▾"}
                </Button>
                {uploadMenuOpen && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
                    background: "#24253A", border: "1px solid #44475A", borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 180, overflow: "hidden",
                  }}>
                    <div style={{
                      padding: "8px 12px", fontSize: "0.7rem", color: "#6272A4",
                      textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700,
                      borderBottom: "1px solid #44475A",
                    }}>
                      Tipo de guia
                    </div>
                    {availableUploadTypes.map((tipo) => (
                      <button
                        key={tipo}
                        type="button"
                        onClick={() => handleStartUpload(tipo)}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          padding: "8px 12px", background: "transparent", border: "none",
                          color: "#F8F8F2", fontSize: "0.875rem", cursor: "pointer", fontWeight: 500,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      >
                        {tipo}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
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
              {/* Completar: aparece quando a guia selecionada está em ERROR ou faltando tipo/competência.
                  Abre o modal split com o PDF lado-a-lado pra editar metadados. */}
              {onIdentifyGuide && selectedCount === 1 && selectedGuide && (selectedGuide.status === "ERROR" || !selectedGuide.tipo || !selectedGuide.competencia) && (
                <Button
                  variant="secondary" size="sm"
                  onClick={() => setCompletingGuide(selectedGuide)}
                >
                  ✎ Completar
                </Button>
              )}
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
                      {guide.valorRecalculado != null && (
                        <span
                          style={{ marginLeft: 6, fontSize: "0.7rem", color: "#92400e", fontWeight: 700 }}
                          title={`Guia recalculada pelo SERPRO. Valor do extrato (apuração): R$ ${fmtMoney(guide.valor)}. Valor atual da guia: R$ ${fmtMoney(guide.valorRecalculado)}.`}
                        >
                          ↻ R$ {fmtMoney(guide.valorRecalculado)}
                        </span>
                      )}
                    </span>
                    <span className="guides-grid__cell guides-grid__cell--competencia" role="cell">{fmtDate(guide.vencimento)}</span>
                    <span className={`guides-grid__cell guides-grid__cell--status guides-grid__tone guides-grid__tone--${status.tone}`} role="cell">
                      {status.label}
                    </span>
                    <span className={`guides-grid__cell guides-grid__cell--status guides-grid__tone guides-grid__tone--${paymentStatus.tone}`} role="cell">
                      {paymentStatus.label}
                    </span>
                    <span
                      className={`guides-grid__cell guides-grid__cell--email guides-grid__tone guides-grid__tone--${emailStatus.tone}`}
                      role="cell"
                      onClick={guide.emailLastError ? () => {
                        // eslint-disable-next-line no-alert
                        window.prompt("Erro no envio do e-mail (Ctrl+C para copiar):", guide.emailLastError);
                      } : undefined}
                      style={guide.emailLastError ? { cursor: "pointer", textDecoration: "underline" } : undefined}
                    >
                      {emailStatus.label}
                      {guide.emailLastError ? " ⓘ" : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Q9.7: modal de linking de guia a parcelamento (3 opções: não / existente / novo) */}
      {linkingGuide && parcelamentos && accountingFunctions && (
        <GuideLinkParcelamentoModal
          guide={linkingGuide}
          parcelamentos={parcelamentos.parcelamentos}
          accountingFunctions={accountingFunctions}
          saving={parcelamentos.saving}
          onSkip={async () => {
            setLinkingGuide(null);
          }}
          onLink={async (parcId, numeroParcela) => {
            const guideId = linkingGuide.guideId || linkingGuide.id;
            try {
              await parcelamentos.linkGuide(parcId, { guideId, numeroParcela });
            } catch {}
            setLinkingGuide(null);
          }}
          onCreateAndLink={async (body) => {
            try {
              await parcelamentos.create(body);
            } catch {}
            setLinkingGuide(null);
          }}
          onClose={() => setLinkingGuide(null)}
        />
      )}
    </section>
  );
}
