import { useEffect, useRef, useState, useMemo } from "react";
import { createApiClient } from "../../../../api/client";
import { Button } from "../../../../components/ui/Button";
import { fmtDate, fmtMoney } from "../../../../lib/format";
import { GuideCaptureModal } from "../../capture/components/renderGuideCaptureModal";
import { ParcelamentoIngestaoModal, ParcelamentoEntradaModal } from "../../../accounting/parcelamento/components/ParcelamentoModals";

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

const expectedGuidesApi = createApiClient();

// Dropdown "Marcar vazio" — lista as guias OBRIGATÓRIAS que ainda faltam no mês e permite marcá-las
// como VAZIO (ausência confirmada). Ao marcar, a guia aparece na própria tabela de Guias como VAZIO.
function MarcarVazioDropdown({ companyId, competencia, refreshKey, onChanged }) {
  const [compliance, setCompliance] = useState(null);
  const [monthClosed, setMonthClosed] = useState(false); // Q18: mês fechado bloqueia
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [r, fech] = await Promise.all([
          expectedGuidesApi.getExpectedGuides(companyId, competencia),
          expectedGuidesApi.getFechamentoContabil(companyId, competencia).catch(() => null),
        ]);
        if (cancel) return;
        setCompliance(r?.compliance || null);
        setMonthClosed(Boolean(fech?.fechado));
      } catch { if (!cancel) setCompliance(null); }
    })();
    return () => { cancel = true; };
  }, [companyId, competencia, refreshKey]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // Candidatos = guias obrigatórias que ainda faltam (não presentes e ainda não marcadas vazio).
  const candidatos = EXPECTED_GUIDE_ROWS.filter((r) => {
    const node = compliance?.[r.key];
    return node?.required && node.state === "missing";
  });

  async function marcar(tipo) {
    setBusy(true);
    try {
      await expectedGuidesApi.markGuideVazio(companyId, tipo, competencia);
      setOpen(false);
      if (onChanged) await onChanged();
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(err?.message || "Falha ao marcar vazio.");
    } finally { setBusy(false); }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Button
        variant="secondary" size="sm" type="button"
        disabled={busy || monthClosed}
        title={monthClosed ? "Mês fechado — reabra a empresa para alterar." : "Marcar uma guia obrigatória como vazia neste mês"}
        onClick={() => setOpen((o) => !o)}
      >
        {monthClosed ? "🔒 Marcar vazio" : "Marcar vazio ▾"}
      </Button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "#24253A", border: "1px solid #44475A", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)", minWidth: 200, overflow: "hidden",
        }}>
          <div style={{
            padding: "8px 12px", fontSize: "0.7rem", color: "#6272A4",
            textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 700,
            borderBottom: "1px solid #44475A",
          }}>
            Marcar vazia ({competencia})
          </div>
          {candidatos.length === 0 ? (
            <div style={{ padding: "8px 12px", fontSize: "0.8rem", color: "#6272A4" }}>
              Nenhuma guia obrigatória pendente.
            </div>
          ) : candidatos.map((r) => (
            <button
              key={r.key} type="button" disabled={busy}
              onClick={() => marcar(r.tipo)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                background: "transparent", border: "none", color: "#F8F8F2",
                fontSize: "0.875rem", cursor: "pointer", fontWeight: 500,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
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

// Rótulo do tipo na tabela. LP vem como guia consolidada "OUTRA" com composição por tributo —
// mostra os tributos contidos (IRPJ · CSLL · PIS · COFINS) no lugar de "OUTRA/OUTROS".
function tipoGuiaLabel(guide) {
  const tipo = String(guide?.tipo || "");
  if (tipo.toUpperCase() === "OUTRA") {
    const comp = guide?.extracted?.composicao;
    if (Array.isArray(comp) && comp.length) {
      const tributos = [...new Set(comp.map((c) => c?.tributo || c?.denominacao).filter(Boolean))];
      if (tributos.length) return tributos.join(" · ");
    }
  }
  return tipo || "-";
}

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
  onRecalcularInss,   // Q53: recálculo/traga explícito do INSS por competência
  recalcInssBusy,
  onLiberarGuia,      // Portal Cliente: libera SÓ a guia selecionada ao cliente (envia só ela por e-mail)
  liberarGuiasBusy,
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
  // Sugestão de contas nos campos D/C do modal de ingestão de parcelamento — mesmo
  // autocomplete (plano de contas + históricos) usado em Lançamentos, Circular e OFX.
  accounts = [],
  onSearchHistoricos,
  onGetHistoricosByCode,
}) {
  // Q9.7: state do modal de linking (guia recém-identificada aguardando decisão de vincular)
  const [linkingGuide, setLinkingGuide] = useState(null);
  // Q28 Fase 1: modal de entrada (SERPRO × manual) + prefill vindo da consulta SERPRO (sem guia).
  const [entradaOpen, setEntradaOpen] = useState(false);
  const [serproPrefill, setSerproPrefill] = useState(null);
  // Anexar a um parcelamento ATIVO existente: a guia subida vira a próxima parcela dele.
  const [attachParc, setAttachParc] = useState(null);
  // "Marcar vazio": força recarga do dropdown + da lista de guias quando o estado muda.
  const [vazioRefreshKey, setVazioRefreshKey] = useState(0);
  async function refreshAfterVazio() {
    setVazioRefreshKey((k) => k + 1);
    if (onRefresh) await onRefresh();
  }
  async function handleUndoVazio(guide) {
    try {
      await expectedGuidesApi.undoGuideVazio(companyId, guide.tipo, guide.competencia);
      await refreshAfterVazio();
    } catch (err) {
      // eslint-disable-next-line no-alert
      window.alert(err?.message || "Falha ao desfazer vazio.");
    }
  }
  // Tipos disponíveis no dropdown filtrados pelo regime da empresa.
  // Simples não vê IRPJ/CSLL/PIS/COFINS/ISS; Presumido não vê SIMPLES.
  const availableUploadTypes = useMemo(
    () => getAvailableGuideTypes(companyRegime),
    [companyRegime],
  );
  // Q19: filtro único de competência (mês), default = mês anterior ao atual.
  const [filterCompetencia, setFilterCompetencia] = useState(prevMonthCompetencia());
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [deleting, setDeleting] = useState(false);
  // Guia já enviada aguardando confirmação de reenvio (modal do "Liberar ao cliente").
  const [resendConfirm, setResendConfirm] = useState(null);

  // Upload flow (modal split): tipo escolhido no dropdown + arquivo + estado de salvamento
  const [uploadTipo, setUploadTipo] = useState(null);  // "DAS"|"INSS"|... — null = modal fechado
  const [uploadAsParcelamento, setUploadAsParcelamento] = useState(false); // Q22: upload→ingestão parcelamento
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

  // Ações da guia selecionada -------------------------------------------------
  // Recalcular é UM botão só: detecta o tipo e chama o endpoint certo.
  //   INSS  → sync SERPRO DCTFweb da competência   ·  DAS/SIMPLES → recálculo PGDAS-D da guia.
  const selTipo = String(selectedGuide?.tipo || "").toUpperCase();
  const isInss = selTipo === "INSS";
  const isDas = selTipo === "SIMPLES";
  const canShowRecalcular = isInss || isDas;
  const inssPaid = String(selectedGuide?.paymentStatus || "").toUpperCase() === "PAID";
  const recalcDisabled = isDas
    ? (!selectedGuide?.canRecalculate || !!recalculatingGuideId)
    : (inssPaid || !!recalcInssBusy);
  const recalcBusy = isDas ? (recalculatingGuideId === selectedGuideId) : !!recalcInssBusy;
  // "Liberar ao cliente" substitui o Reenviar: se a guia já foi enviada, confirma reenvio no modal.
  const alreadySent = String(selectedGuide?.emailStatus || "").toUpperCase() === "SENT";

  function handleRecalcularDispatch() {
    if (!selectedGuide) return;
    if (isInss) onRecalcularInss?.(selectedGuide.competencia);
    else if (isDas) onRecalculateGuide?.(selectedGuideId);
  }

  function handleLiberarClick() {
    if (!selectedGuide) return;
    if (alreadySent) setResendConfirm(selectedGuide);           // já enviada → pergunta antes de reenviar
    else onLiberarGuia?.(selectedGuideId);                      // não enviada → libera + envia SÓ esta guia
  }

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

  // Fluxo novo de upload: usuário escolhe tipo no dropdown → file picker → modal split com PDF lado-a-lado
  // Q22: asParcelamento=true → ao salvar, abre o modal de ingestão de parcelamento (não fecha só).
  function handleStartUpload(tipo, asParcelamento = false) {
    setUploadMenuOpen(false);
    setUploadAsParcelamento(asParcelamento);
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
      // O checkbox do modal manda: o contador acabou de olhar o PDF. O `uploadAsParcelamento`
      // (vindo do dropdown "Subir Guia → ... parcelamento") só semeia o valor inicial dele.
      const isParc = metadata?.isParcelamento ?? uploadAsParcelamento;
      if (isParc && result?.guide) {
        setLinkingGuide(result.guide);
      }
      setUploadAsParcelamento(false);
      return { ok: true };
    }
    return { ok: false, message: result?.message || result?.error || "Falha ao enviar guia." };
  }

  function handleCaptureCancel() {
    setUploadFile(null);
    setUploadTipo(null);
    setUploadAsParcelamento(false);
  }

  // Fluxo de completar guia já existente (modal split com fetch do PDF)
  async function handleCompleteSave(metadata) {
    if (!completingGuide || !onIdentifyGuide) return { ok: false };
    const gid = completingGuide.guideId || completingGuide.id;
    setCompletingSaving(true);
    try {
      const result = await onIdentifyGuide(gid, metadata);
      if (result?.ok !== false) {
        const guideAfter = { ...completingGuide, ...metadata, guideId: gid, id: gid };
        // A escolha explícita do contador no modal vence. Antes, a heurística por tipo abria o
        // modal de vínculo em TODA guia SIMPLES/INSS/DARF — inclusive nas que não são parcela.
        // A heurística fica só como fallback pra quem chamar isto sem a flag.
        let abrirVinculo;
        if (metadata?.isParcelamento !== undefined) {
          abrirVinculo = metadata.isParcelamento;
        } else {
          const tipoUpper = String(guideAfter.tipo || metadata?.tipo || "").toUpperCase();
          abrirVinculo = ["SIMPLES", "INSS", "DARF", "PIS", "COFINS", "IRPJ", "CSLL", "ISS"].includes(tipoUpper);
        }
        // Q21: o modal de ingestão v2 não depende de accountingFunctions.
        if (parcelamentos && abrirVinculo) {
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

  const actionsBusy = deleting || !!confirmingGuideId || !!recalculatingGuideId;

  return (
    <section className="guides-page">
      {/* Modal split de upload: PDF lado-a-lado do form. Abre quando tipo + arquivo estão prontos. */}
      {uploadTipo && uploadFile && (
        <GuideCaptureModal
          mode="upload"
          initialTipo={uploadTipo}
          initialIsParcelamento={uploadAsParcelamento}
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

      {/* Confirmação de reenvio: "Liberar ao cliente" numa guia que já foi enviada. */}
      {resendConfirm && (
        <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && setResendConfirm(null)}>
          <div style={S.modal}>
            <h3 style={S.title}>Guia já enviada</h3>
            <p style={{ fontSize: 13, color: "#6272A4", margin: "0 0 16px" }}>
              Esta guia ({resendConfirm.tipo} · {resendConfirm.competencia}) já foi enviada ao cliente por
              e-mail. Deseja reenviar?
            </p>
            <div style={S.btnRow}>
              <Button
                variant="primary" size="sm"
                disabled={!!resendingGuideId}
                onClick={async () => {
                  const gid = resendConfirm.guideId || resendConfirm.id;
                  await onResendGuide?.(gid);
                  setResendConfirm(null);
                }}
              >
                {resendingGuideId ? "Reenviando..." : "Reenviar"}
              </Button>
              <Button
                variant="secondary" size="sm"
                disabled={!!resendingGuideId}
                onClick={() => setResendConfirm(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}

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
                    {/* Q28: abre o modal de ENTRADA (consultar nº no SERPRO ou subir guia). */}
                    <button
                      type="button"
                      onClick={() => { setUploadMenuOpen(false); setEntradaOpen(true); }}
                      style={{
                        display: "block", width: "100%", textAlign: "left",
                        padding: "8px 12px", background: "transparent", border: "none",
                        borderTop: "1px solid #44475A",
                        color: "#FFB347", fontSize: "0.875rem", cursor: "pointer", fontWeight: 600,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      Parcelamento…
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          {/* Marcar guias obrigatórias como VAZIO no mês (aparecem na tabela abaixo como vazio). */}
          <MarcarVazioDropdown
            companyId={companyId}
            competencia={filterCompetencia}
            refreshKey={vazioRefreshKey}
            onChanged={refreshAfterVazio}
          />
          {/* Barra única de ações da guia selecionada (uma guia por vez). */}
          {selectedCount === 1 && selectedGuide && (
            <>
              {/* Recalcular: um botão só — INSS (SERPRO DCTFweb) ou DAS (PGDAS-D), conforme o tipo. */}
              {canShowRecalcular && (
                <Button
                  variant="secondary" size="sm"
                  disabled={recalcDisabled}
                  onClick={handleRecalcularDispatch}
                  title={isInss
                    ? "Busca/recalcula no SERPRO a guia de INSS desta competência. Guia já paga é bloqueada."
                    : "Recalcula a guia do DAS no PGDAS-D."}
                >
                  {recalcBusy ? "Recalculando..." : "Recalcular"}
                </Button>
              )}
              <Button
                variant="secondary" size="sm"
                disabled={!selectedGuide?.canConfirmPayment || !!confirmingGuideId}
                onClick={() => selectedGuideId && onConfirmGuidePayment(selectedGuideId)}
              >
                {confirmingGuideId === selectedGuideId ? "..." : "Confirmar pagamento"}
              </Button>
              {/* Baixar o PDF da guia (se houver). */}
              {onFetchGuidePdf && selectedGuide.status === "PROCESSED" && (
                <Button
                  variant="secondary" size="sm"
                  onClick={async () => {
                    try {
                      const blob = await onFetchGuidePdf(selectedGuideId);
                      if (!blob) { window.alert("Esta guia não tem PDF para baixar."); return; }
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `guia-${selectedGuide.tipo || "guia"}-${selectedGuide.competencia || ""}.pdf`;
                      document.body.appendChild(a); a.click(); a.remove();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (err) {
                      window.alert(err?.message || "Falha ao baixar a guia.");
                    }
                  }}
                >
                  ⬇ Baixar
                </Button>
              )}
              {/* Liberar ao cliente = envio por e-mail SÓ desta guia (substitui o Reenviar).
                  Se já enviada, confirma reenvio no modal. */}
              {onLiberarGuia && (
                <Button
                  variant="secondary" size="sm"
                  disabled={selectedGuide?.status !== "PROCESSED" || !!liberarGuiasBusy}
                  onClick={handleLiberarClick}
                  title="Libera esta guia ao cliente e envia só ela por e-mail."
                >
                  {liberarGuiasBusy ? "Liberando..." : "Liberar ao cliente"}
                </Button>
              )}
              {/* Completar: aparece quando a guia selecionada está em ERROR ou faltando tipo/competência.
                  Abre o modal split com o PDF lado-a-lado pra editar metadados. */}
              {onIdentifyGuide && (selectedGuide.status === "ERROR" || !selectedGuide.tipo || !selectedGuide.competencia) && (
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          <h2 className="guides-list-panel__title" style={{ margin: 0 }}>Guias</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.8rem", color: "#aeb6d3", display: "flex", alignItems: "center", gap: 6 }}>
              Competência:
              <input
                type="month" value={filterCompetencia} onChange={(e) => setFilterCompetencia(e.target.value)}
                style={{ background: "#1A1B26", border: "1px solid #44475A", borderRadius: 6, color: "#F8F8F2", padding: "4px 8px", colorScheme: "dark" }}
              />
            </label>
          </div>
        </div>

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
                    <span className="guides-grid__cell guides-grid__cell--type" role="cell">
                      {guide.parcelamentoId
                        ? `Parc. ${guide.parcelamentoTipo || guide.tipo || ""}${guide.parcelamentoNumero ? ` nº${guide.parcelamentoNumero}` : ""}${guide.numeroParcela ? ` (${guide.numeroParcela})` : ""}`.trim()
                        : tipoGuiaLabel(guide)}
                    </span>
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
                    <span className={`guides-grid__cell guides-grid__cell--status guides-grid__tone guides-grid__tone--${paymentStatus.tone}`} role="cell"
                      onClick={(e) => e.stopPropagation()}>
                      {guide.status === "VAZIO" ? (
                        <button
                          type="button"
                          onClick={() => handleUndoVazio(guide)}
                          title="Desfazer marcação de vazio"
                          style={{ fontSize: "0.7rem", padding: "3px 8px", cursor: "pointer", background: "transparent", color: "#aeb6d3", border: "1px solid #44475A", borderRadius: 4 }}
                        >
                          desfazer vazio
                        </button>
                      ) : paymentStatus.label}
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
                      {/* Portal Cliente (#3.1): selo de guia liberada ao app do cliente. */}
                      {guide.liberadaCliente && (
                        <span
                          title={`Liberada ao cliente${guide.liberadaEm ? ` em ${fmtDate(guide.liberadaEm)}` : ""}`}
                          style={{ marginLeft: 6, color: "#69FF47", fontWeight: 700 }}
                        >
                          📤
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Q28 Fase 1: porta de entrada do parcelamento — consultar nº no SERPRO ou subir guia. */}
      {entradaOpen && parcelamentos && (
        <ParcelamentoEntradaModal
          parcelamentosAtivos={parcelamentos.parcelamentos || []}
          onChooseAttach={(parc) => { setEntradaOpen(false); setAttachParc(parc); handleStartUpload("SIMPLES", true); }}
          onConsultSerpro={parcelamentos.consultarSerpro}
          onResolved={(prefill) => { setEntradaOpen(false); setSerproPrefill(prefill); }}
          onChooseUpload={() => { setEntradaOpen(false); setAttachParc(null); handleStartUpload("SIMPLES", true); }}
          onClose={() => setEntradaOpen(false)}
        />
      )}

      {/* Q23/Q28: passo de config — provisão + pagamento. Com guia (manual) OU prefill SERPRO (sem guia). */}
      {(linkingGuide || serproPrefill) && parcelamentos && (
        <ParcelamentoIngestaoModal
          guide={linkingGuide}
          prefill={serproPrefill}
          existingParc={attachParc}
          saving={parcelamentos.saving}
          getContasProvisao={parcelamentos.getContasProvisao}
          accounts={accounts}
          onSearchHistoricos={onSearchHistoricos}
          onGetHistoricosByCode={onGetHistoricosByCode}
          onSkip={() => { setLinkingGuide(null); setSerproPrefill(null); setAttachParc(null); }}
          onClose={() => { setLinkingGuide(null); setSerproPrefill(null); setAttachParc(null); }}
          onIngest={async (body) => {
            // Propaga erro pro modal exibir (antes era engolido → "nada acontecia").
            await parcelamentos.ingest(body);
            // Anexo a parcelamento existente: contabiliza a parcela (gera a baixa "PARC X/Y").
            const gid = linkingGuide?.guideId || linkingGuide?.id;
            if (attachParc && gid && onConfirmGuidePayment) {
              try { await onConfirmGuidePayment(gid); } catch { /* handler já exibe o erro (ex.: mês fechado) */ }
            }
            setLinkingGuide(null);
            setSerproPrefill(null);
            setAttachParc(null);
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </section>
  );
}
