// Modais do parcelamento (escopo acoplado, padrão usado em Q6):
//   - ParcelamentoConfigModal:   contas de provisão/pagamento de um parcelamento
//   - ParcelamentoRescisaoModal: rescisão (estorno reverso da provisão)
//   - ParcelamentoCreateModal:   criação V1 por template (legado — ver nota abaixo)
//   - ParcelamentosList:         os CARDS dos contratos
//   - ConferenciaParcelasPanel:  fila de parcelas pagas a conferir
//
// ⚠ A CRIAÇÃO DE PARCELAMENTO NÃO MORA MAIS AQUI. Ela é o `ParcelamentoWizard.jsx`, aberto pelo
// "+ Novo parcelamento" da aba Parcelamentos, e cria o contrato SEM guia nenhuma. `ParcelamentoCreateModal`
// é o caminho V1 (`POST /parcelamentos`, com `AccountingFunction` de template) e continua alcançável
// por Lançamentos → Funções → "+ Novo parcelamento…". Ele não foi removido porque os templates que
// ele exige (`templatePaymentFunctionId` + seeds `PARCELAMENTO_PAYMENT`) estão marcados no
// `apps/api/src/application/accounting/CLAUDE.md` como leftover cuja remoção é DECISÃO DO DONO.

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { AccountCodeInput } from "../../entries/components/renderAccountingEntriesParts";
import { ParcelasDoAcordo } from "./ParcelasDoAcordo";
import {
  textoDoProgresso, alertaDeAtraso, proximaPrestacao, restantes as restantesDoContrato,
  rotuloFormaPagamento, tomDoStatus,
} from "../lib/cartaoParcelamento";
import { baseDaRescisao, valorPorPapelDaRescisao, somasDaRescisao } from "../lib/rescisaoParcelamento";

// Fechamento dos modais deste arquivo: ESC fecha, clicar fora NÃO.
// Clique no backdrop fechava e fazia perder o preenchimento inteiro sem confirmação —
// esses modais são formulários longos (linhas de provisão/pagamento). Saída = ✕, Cancelar ou ESC.
function useEscapeToClose(onClose) {
  useEffect(() => {
    if (!onClose) return undefined;
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

const PANEL = {
  surface: "#21222C", field: "#282A36", border: "#44475A",
  text: "#F8F8F2", muted: "#aeb6d3",
};
const FIELD_STYLE = {
  background: PANEL.field,
  border: `1px solid ${PANEL.border}`,
  color: PANEL.text,
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: "0.85rem",
  width: "100%",
};

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function addMonths(competencia, n) {
  const [yyyy, mm] = String(competencia || "").split("-").map(Number);
  if (!yyyy || !mm) return competencia;
  const date = new Date(Date.UTC(yyyy, mm - 1 + n, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const TIPOS_PARC = [
  ["PARCSN", "Simples Nacional (PARCSN)"],
  ["PARCSN_ESPECIAL", "Simples Nacional Especial"],
  ["PERT_SN", "PERT-SN"],
  ["RELP_SN", "RELP-SN"],
  ["PARCMEI", "MEI (PARCMEI)"],
  ["PARCMEI_ESPECIAL", "MEI Especial"],
  ["PERT_MEI", "PERT-MEI"],
  ["RELP_MEI", "RELP-MEI"],
  ["INSS", "INSS / Previdenciário"],
  ["OUTRO", "Outro"],
];

// ⚠ DOIS MODAIS SAÍRAM DAQUI (R1) — eles ERAM o desenho guia-first:
//
//   · `ParcelamentoIngestaoModal` — o modal-surpresa "Registrar 1ª parcela do parcelamento", que
//     abria SOZINHO depois de salvar uma guia (pelo checkbox "Esta guia é de parcelamento" ou pela
//     heurística por tipo) e fazia um contrato de até 60 meses nascer como efeito colateral de um
//     upload;
//   · `ParcelamentoEntradaModal` — o "Novo parcelamento" de três opções (anexar a existente /
//     consultar no SERPRO / subir guia), que forçava o tipo da guia a "SIMPLES" nos dois caminhos
//     de upload, inclusive numa parcela de INSS.
//
// O que os substitui: `ParcelamentoWizard.jsx` cria o CONTRATO sem guia nenhuma, e
// `features/guides/list/components/GuiaDeParcelamentoModal.jsx` anexa a guia a um contrato que já
// existe — com o parcelamento no primeiro campo, o vínculo derivado do cronograma e o tipo da guia
// sugerido pela modalidade em vez de forçado.

// ─────────────────────────────────────────────────────────────────────────
// Q28 Fase 2: ParcelamentoConfigModal — ver/editar a config de lançamento (provisão + pagamento)
// de um parcelamento específico (acessível pela Circular/aba Guias).
// ─────────────────────────────────────────────────────────────────────────
// Sem JUROS, pelo mesmo motivo de `PROV_LINHAS_PADRAO`: a provisão da adesão carrega só o principal.
const CFG_PROV_PADRAO = [{ tipoLinha: "PRINCIPAL", tipo: "D", conta: "" }, { tipoLinha: "PARC", tipo: "C", conta: "" }];
const CFG_PAG_PADRAO = [{ tipoLinha: "PARC", tipo: "D", conta: "" }, { tipoLinha: "JUROS", tipo: "D", conta: "" }, { tipoLinha: "CAIXA", tipo: "C", conta: "" }];
const ROLE_LABEL = { PRINCIPAL: "Principal", JUROS: "Juros", MULTA: "Multa", PARC: "Parcelamento a pagar (passivo)", CAIXA: "Caixa / Banco", CONTRAPARTIDA: "Contrapartida (despesa/reclasse)" };
const normCfgRow = (r) => ({ tipoLinha: r?.tipoLinha || "PARC", tipo: r?.tipo === "C" ? "C" : "D", conta: r?.conta || "" });

export function ParcelamentoConfigModal({ parcId, label, getConfig, saveConfig, onClose, onSaved, accounts = [], onSearchHistoricos, onGetHistoricosByCode }) {
  useEscapeToClose(onClose);
  const [prov, setProv] = useState([]);
  const [pag, setPag] = useState([]);
  const [obs, setObs] = useState(""); // Q31: descrição (competências parceladas)
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const p = await getConfig(parcId);
        if (cancel) return;
        setProv(Array.isArray(p?.configProvisao) && p.configProvisao.length ? p.configProvisao.map(normCfgRow) : CFG_PROV_PADRAO.map((r) => ({ ...r })));
        setPag(Array.isArray(p?.configPagamento) && p.configPagamento.length ? p.configPagamento.map(normCfgRow) : CFG_PAG_PADRAO.map((r) => ({ ...r })));
        setObs(p?.observacoes || "");
      } catch (e) { if (!cancel) setErro(e?.message || "Falha ao carregar config."); }
      finally { if (!cancel) setLoading(false); }
    })();
    return () => { cancel = true; };
  }, [parcId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ROLES = Object.keys(ROLE_LABEL);
  const setRow = (which, i, k, v) => (which === "prov" ? setProv : setPag)((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  const addRow = (which) => (which === "prov" ? setProv : setPag)((p) => [...p, { tipoLinha: "PARC", tipo: "D", conta: "" }]);
  const rmRow = (which, i) => (which === "prov" ? setProv : setPag)((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p));

  async function save() {
    setErro(""); setBusy(true);
    try {
      await saveConfig(parcId, { configProvisao: prov, configPagamento: pag, observacoes: obs });
      if (onSaved) onSaved();
      onClose();
    } catch (e) { setErro(e?.message || "Falha ao salvar."); }
    finally { setBusy(false); }
  }

  const lbl = { fontSize: "0.72rem", color: PANEL.muted, display: "block", marginBottom: 4 };
  const tbl = (which, rows) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
      <thead><tr style={{ color: PANEL.muted }}>
        <th style={{ textAlign: "left", padding: 3 }}>Papel</th>
        <th style={{ padding: 3, width: 56 }}>D/C</th>
        <th style={{ padding: 3, width: 120 }}>Conta</th>
        <th style={{ width: 28 }} />
      </tr></thead>
      <tbody>
        {rows.map((l, i) => (
          <tr key={i}>
            <td style={{ padding: 3 }}>
              <select value={l.tipoLinha} onChange={(e) => setRow(which, i, "tipoLinha", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </td>
            <td style={{ padding: 3 }}>
              <select value={l.tipo} onChange={(e) => setRow(which, i, "tipo", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                <option value="D">D</option><option value="C">C</option>
              </select>
            </td>
            <td style={{ padding: 3 }}>
              <AccountCodeInput
                value={l.conta}
                onChange={(v) => setRow(which, i, "conta", v)}
                accounts={accounts}
                onSearchHistoricos={onSearchHistoricos}
                onGetHistoricosByCode={onGetHistoricosByCode}
                placeholder="—"
              />
            </td>
            <td style={{ padding: 3, textAlign: "center" }}><button onClick={() => rmRow(which, i)} style={{ background: "transparent", border: "none", color: "var(--state-danger)", cursor: "pointer" }}>×</button></td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1100, padding: 16 }}>
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 20, width: "min(96vw, 860px)", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", overflowWrap: "anywhere", color: PANEL.text, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "1.0rem" }}>Configuração de lançamento — {label}</strong>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>
        {loading ? <div style={{ color: PANEL.muted, fontSize: "0.85rem" }}>Carregando…</div> : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={lbl}>Provisão (adesão)</span>
              <button onClick={() => addRow("prov")} style={{ ...FIELD_STYLE, width: 26, height: 26, padding: 0, cursor: "pointer" }}>+</button>
            </div>
            {tbl("prov", prov)}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
              <span style={lbl}>Pagamento (baixa)</span>
              <button onClick={() => addRow("pag")} style={{ ...FIELD_STYLE, width: 26, height: 26, padding: 0, cursor: "pointer" }}>+</button>
            </div>
            {tbl("pag", pag)}
            <div style={{ marginTop: 6 }}>
              <span style={lbl}>Descrição (competências parceladas)</span>
              <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2}
                placeholder="Ex.: DAS de SET/OUT/NOV/2024 e MAR..NOV/2025"
                style={{ ...FIELD_STYLE, resize: "vertical" }} />
            </div>
            {erro && <div style={{ color: "var(--state-danger)", fontSize: "0.8rem" }}>{erro}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={onClose} disabled={busy} style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.muted, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: "0.85rem" }}>Cancelar</button>
              <Button variant="primary" onClick={save} disabled={busy}>{busy ? "Salvando…" : "Salvar config"}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Q31: ParcelamentoRescisaoModal — 3 linhas pré-configuradas (estorno reverso da provisão),
// editáveis, com saldo remanescente sugerido. Ao confirmar, lança a rescisão (single-leg por linha).
// ─────────────────────────────────────────────────────────────────────────
export function ParcelamentoRescisaoModal({ parc, getConfig, saving, onConfirm, onClose, accounts = [], onSearchHistoricos, onGetHistoricosByCode }) {
  useEscapeToClose(onClose);
  const [lines, setLines] = useState([]);
  const [dataRescisao, setDataRescisao] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmando, setConfirmando] = useState(null); // 2ª etapa da confirmação

  // ⚠ A REGRA (E A RECUSA) MORAM NA LIB, com teste próprio. O que o `|| 0` de antes fazia era
  // transformar "não sei quanto falta" em "não falta nada" — R$ 0,00 pré-preenchido num lançamento
  // que manda o saldo para a Dívida Ativa da União.
  const rescisao = useMemo(() => baseDaRescisao(parc), [parc]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const valorPorPapel = valorPorPapelDaRescisao(rescisao);
      // ⚠ VALOR AUSENTE VIRA CAMPO VAZIO, NUNCA "0". É o mesmo `?? ""` que o `FechamentoModal` usa
      // pelo mesmo motivo: com `|| 0` o input renderiza um zero fabricado e a recusa fica invisível.
      const texto = (papel) => (valorPorPapel[papel] != null ? String(valorPorPapel[papel]) : "");

      let cfg = null;
      try { const p = await getConfig(parc.id); cfg = Array.isArray(p?.configProvisao) ? p.configProvisao : null; } catch { /* sem config */ }
      if (cancel) return;
      // Estorno reverso: inverte D↔C de cada linha da provisão; mantém a conta; valor = remanescente do papel.
      const base = (cfg && cfg.length)
        ? cfg.map((l) => ({
          tipoLinha: l.tipoLinha,
          label: ROLE_LABEL[l.tipoLinha] || l.tipoLinha,
          tipo: l.tipo === "C" ? "D" : "C",
          conta: l.conta || "",
          valor: texto(l.tipoLinha),
        }))
        : [
          { tipoLinha: "PARC", label: ROLE_LABEL.PARC, tipo: "D", conta: "", valor: texto("PARC") },
          { tipoLinha: "PRINCIPAL", label: ROLE_LABEL.PRINCIPAL, tipo: "C", conta: "", valor: texto("PRINCIPAL") },
          { tipoLinha: "JUROS", label: ROLE_LABEL.JUROS, tipo: "C", conta: "", valor: texto("JUROS") },
        ];
      setLines(base);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [parc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ROLES = Object.keys(ROLE_LABEL);
  function setLine(i, k, v) { setLines((p) => p.map((l, idx) => (idx === i ? { ...l, [k]: v } : l))); }
  function addLine() { setLines((p) => [...p, { tipoLinha: "PARC", label: "", tipo: "D", conta: "", valor: "" }]); }
  function rmLine(i) { setLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p)); }

  // ⚠ UMA LEITURA SÓ, E ELA É A GRAMÁTICA DO PROJETO (`entries/lib/valorFormula.js`, via
  // `somasDaRescisao`). O que existia aqui era um `String(v).replace(",", ".")` escrito à mão: ele
  // lia `12.000` como R$ 12,00 e `6.900,00` como ZERO, e as duas guardas abaixo não pegavam nada
  // porque Σ D e Σ C erravam na mesma proporção. Ver o cabeçalho de `lib/rescisaoParcelamento.js`.
  const somas = useMemo(() => somasDaRescisao(lines), [lines]);
  const { somaD, somaC, ilegiveis } = somas;
  // ⚠ D ≠ C BLOQUEIA AQUI. Antes só pintava de âmbar e deixava passar — e um lote de rescisão
  // desbalanceado trava o FECHAMENTO do mês (`computeFechamentoBlockers` soma o grupo do
  // `parcelamentoId`), semanas depois, longe deste modal. Tolerância de 1 centavo, a mesma do gate.
  const desbalanceado = somas.desbalanceado;
  // ⚠ RESCISÃO DE R$ 0,00 NÃO É RESCISÃO — e ela era ALCANÇÁVEL: com as contas vindo da
  // `configProvisao` e os valores em branco, `clean` tinha três linhas, Σ D = Σ C = 0, o gate de
  // balanço achava tudo certo e o lote ia para o razão zerado. O zero pré-preenchido tornava esse
  // caminho o DEFAULT nos contratos sem `principalTotal`.
  const semValor = somas.semValor;

  async function submit() {
    setErro("");
    // ⚠ CAMPO ILEGÍVEL BLOQUEIA — antes ele virava 0 em silêncio. Isto APERTA a guarda: o que
    // passava mudo agora nomeia a linha e o motivo.
    if (ilegiveis > 0) {
      const i = somas.leituras.findIndex((r) => !r.ok);
      setErro(`Linha ${i + 1} (${lines[i]?.label || lines[i]?.tipoLinha}): ${somas.leituras[i].mensagem} Corrija antes de rescindir.`);
      return;
    }
    // ⚠ MAPEIA ANTES DE FILTRAR: o índice de `leituras` é o da linha na TELA, e filtrar primeiro
    // faria o `map` receber o índice da lista já encurtada — cada linha herdaria o valor de outra.
    const clean = lines
      .map((l, i) => ({ tipoLinha: l.tipoLinha || (l.tipo === "C" ? "PRINCIPAL" : "PARC"), tipo: l.tipo, conta: String(l.conta).trim(), valor: somas.leituras[i].valor }))
      .filter((l) => l.conta || l.valor);
    if (!clean.length) { setErro("Preencha ao menos uma linha da rescisão."); return; }
    if (semValor) {
      setErro(
        "A rescisão está sem valor. O sistema não preenche esse número por você quando não o sabe — "
        + "informe quanto ainda resta do parcelamento, conferindo o contrato.",
      );
      return;
    }
    if (desbalanceado) {
      setErro(`Σ Débito (${fmtMoney(somaD)}) ≠ Σ Crédito (${fmtMoney(somaC)}). Um lote desbalanceado trava o fechamento do mês — corrija antes de rescindir.`);
      return;
    }
    // ⚠ SEGUNDA ETAPA: a rescisão manda o saldo remanescente para a Dívida Ativa da União e
    // restabelece as reduções de multa da adesão. É irreversível pelo app, e o passo anterior é
    // só um formulário de lançamento — nada nele diz o que a confirmação provoca.
    setConfirmando({ clean, dataRescisao });
  }

  async function confirmarDeVerdade() {
    const pedido = confirmando;
    if (!pedido) return;
    setConfirmando(null);
    setBusy(true);
    try {
      await onConfirm({ rescisaoLines: pedido.clean, dataRescisao: pedido.dataRescisao });
    } catch (e) { setErro(e?.message || "Falha ao rescindir."); }
    finally { setBusy(false); }
  }

  const lbl = { fontSize: "0.72rem", color: PANEL.muted, display: "block", marginBottom: 2 };
  const iconBtn = { background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.text, borderRadius: 6, width: 26, height: 26, lineHeight: "22px", textAlign: "center", cursor: "pointer", fontSize: "1rem", padding: 0 };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1700, padding: 16 }}>
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 20, width: "min(96vw, 900px)", maxHeight: "92vh", overflowY: "auto", overflowX: "hidden", overflowWrap: "anywhere", color: PANEL.text, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: "1.0rem" }}>Rescindir — {parc?.label}</strong>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.2rem" }}>✕</button>
        </div>
        {loading ? <div style={{ color: PANEL.muted, fontSize: "0.85rem" }}>Carregando…</div> : (
          <>
            {/* ⚠ A RECUSA APARECE NO LUGAR DO NÚMERO, e é o ponto desta mudança. Antes, contrato sem
                principal declarado abria com R$ 0,00 nas três linhas — um formulário que PARECE
                pronto, num ato que manda o saldo para a Dívida Ativa da União. */}
            {!rescisao.podePrePreencher && (
              <div
                data-testid="rescisao-recusa"
                style={{ fontSize: "0.78rem", color: "var(--state-danger)", background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)", borderRadius: 6, padding: "8px 10px", lineHeight: 1.5 }}
              >
                <strong>Não dá para sugerir os valores desta rescisão.</strong><br />
                {rescisao.motivo}
              </div>
            )}
            {rescisao.avisoDivergencia && (
              <div
                data-testid="rescisao-divergencia"
                style={{ fontSize: "0.78rem", color: "var(--state-warn)", background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)", borderRadius: 6, padding: "8px 10px", lineHeight: 1.5 }}
              >
                {rescisao.avisoDivergencia}
              </div>
            )}
            <label style={{ maxWidth: 200 }}><span style={lbl}>Data da rescisão</span>
              <input type="date" value={dataRescisao} onChange={(e) => setDataRescisao(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }} />
            </label>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
              <div style={{ fontSize: "0.78rem", color: PANEL.muted }}>Linhas da rescisão</div>
              <button onClick={addLine} title="Adicionar linha" style={iconBtn}>+</button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
              <thead><tr style={{ color: PANEL.muted }}>
                <th style={{ textAlign: "left", padding: 3 }}>Papel</th>
                <th style={{ padding: 3, width: 56 }}>D/C</th>
                <th style={{ padding: 3, width: 110 }}>Conta</th>
                <th style={{ padding: 3, width: 120, textAlign: "right" }}>Valor</th>
                <th style={{ width: 28 }} />
              </tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ padding: 3 }}>
                      <select value={l.tipoLinha} onChange={(e) => setLine(i, "tipoLinha", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 3 }}>
                      <select value={l.tipo} onChange={(e) => setLine(i, "tipo", e.target.value)} style={{ ...FIELD_STYLE, padding: "4px 6px", colorScheme: "dark" }}>
                        <option value="D">D</option><option value="C">C</option>
                      </select>
                    </td>
                    <td style={{ padding: 3 }}>
                      <AccountCodeInput
                        value={l.conta}
                        onChange={(v) => setLine(i, "conta", v)}
                        accounts={accounts}
                        onSearchHistoricos={onSearchHistoricos}
                        onGetHistoricosByCode={onGetHistoricosByCode}
                        placeholder="—"
                      />
                    </td>
                    {/* ⚠ A PRÉVIA DO VALOR LIDO — é ela que torna a gramática do separador segura,
                        e é ela que teria denunciado este defeito na primeira digitação. `12.000`
                        pode ser doze mil ou doze reais e o texto não distingue; o que a tela pode
                        fazer é mostrar COMO ELA LEU, antes do clique. Mesmo padrão do
                        `DraftEntryRow` (célula de valor da aba Lançamentos), pelo mesmo motivo. */}
                    <td style={{ padding: 3 }}>
                      <input
                        value={l.valor}
                        onChange={(e) => setLine(i, "valor", e.target.value)}
                        placeholder="0,00"
                        aria-label={`Valor — ${l.label || l.tipoLinha}`}
                        style={{ ...FIELD_STYLE, padding: "4px 6px", textAlign: "right" }}
                      />
                      {!somas.leituras[i]?.vazio && (
                        <div
                          data-testid={`rescisao-previa-${i}`}
                          style={{ fontSize: "0.7rem", marginTop: 2, textAlign: "right", color: somas.leituras[i]?.ok ? PANEL.muted : "var(--state-danger)" }}
                        >
                          {somas.leituras[i]?.ok ? `= ${fmtMoney(somas.leituras[i].valor)}` : somas.leituras[i]?.mensagem}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 3, textAlign: "center" }}><button onClick={() => rmLine(i)} style={{ background: "transparent", border: "none", color: "var(--state-danger)", cursor: "pointer" }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* ⚠ COM CAMPO ILEGÍVEL NÃO SE CARIMBA "✓". As somas descrevem só as linhas que deram
                para ler — um "D = C ✓" por cima de uma linha ilegível é número certo ao lado de
                soma incompleta, com selo de conferido (o mesmo defeito do rodapé da aba
                Lançamentos quando ela paginava sem dizer). */}
            <div style={{ textAlign: "right", fontSize: "0.78rem", color: (desbalanceado || ilegiveis > 0) ? "var(--state-danger)" : PANEL.muted }}>
              Σ Débito: <strong style={{ color: PANEL.text }}>{fmtMoney(somaD)}</strong> · Σ Crédito: <strong style={{ color: PANEL.text }}>{fmtMoney(somaC)}</strong>
              {ilegiveis > 0
                ? `  ⚠ ${ilegiveis} ${ilegiveis === 1 ? "valor ilegível" : "valores ilegíveis"} — a soma está incompleta`
                : (desbalanceado ? "  ⚠ D ≠ C — bloqueia" : " ✓")}
            </div>
            {erro && <div style={{ color: "var(--state-danger)", fontSize: "0.8rem" }}>{erro}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button type="button" onClick={onClose} disabled={saving || busy} style={{ background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.muted, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: "0.85rem" }}>Cancelar</button>
              <Button
                variant="danger" type="button" onClick={submit} disabled={saving || busy || desbalanceado || semValor || ilegiveis > 0}
                title={ilegiveis > 0
                  ? "Há valor que não dá para ler — a prévia embaixo do campo diz o que está errado."
                  : (desbalanceado
                    ? "Σ Débito ≠ Σ Crédito: um lote de rescisão desbalanceado trava o fechamento do mês."
                    : (semValor
                      ? "A rescisão está sem valor — informe quanto ainda resta do parcelamento."
                      : "Pede uma confirmação final antes de gravar."))}
              >
                {saving || busy ? "Rescindindo…" : "Rescindir e lançar"}
              </Button>
            </div>
          </>
        )}
      </div>

      {/* ⚠ CONFIRMAÇÃO EM DUAS ETAPAS, repetindo os dados. */}
      {confirmando && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1800, padding: 16 }}>
          <div style={{ background: PANEL.surface, border: "1px solid var(--state-danger)", borderRadius: 10, padding: 18, width: "min(94vw, 520px)", color: PANEL.text, display: "flex", flexDirection: "column", gap: 10 }}>
            <strong style={{ fontSize: "0.95rem", color: "var(--state-danger)" }}>Rescindir {parc?.label}?</strong>
            <div style={{ fontSize: "0.78rem", color: PANEL.muted, lineHeight: 1.5 }}>
              Rescindido, o <strong style={{ color: PANEL.text }}>saldo remanescente vai para a Dívida Ativa da União</strong> e
              as reduções de multa da adesão são restabelecidas. O app não desfaz isso.
            </div>
            <div style={{ fontSize: "0.76rem", color: PANEL.muted, background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, padding: "8px 10px", lineHeight: 1.5 }}>
              Data da rescisão: <strong style={{ color: PANEL.text }}>{confirmando.dataRescisao}</strong><br />
              Serão gravados <strong style={{ color: PANEL.text }}>{confirmando.clean.length}</strong> lançamentos,
              somando <strong style={{ color: PANEL.text }}>R$ {fmtMoney(somaD)}</strong> em débitos
              e <strong style={{ color: PANEL.text }}>R$ {fmtMoney(somaC)}</strong> em créditos.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" type="button" onClick={() => setConfirmando(null)}>Voltar</Button>
              <Button variant="danger" type="button" onClick={confirmarDeVerdade}>Confirmar rescisão</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ParcelamentoCreateModal — criação stand-alone (sem guia de origem)
// ─────────────────────────────────────────────────────────────────────────
export function ParcelamentoCreateModal({
  accountingFunctions, // hook useAccountingFunctions (functions[], etc)
  saving, onCreate, onClose,
  // Se vier sourceGuide (guia que originou), modal mostra esse contexto
  // e cria a guia já linkada à 1ª parcela (entrada).
  sourceGuide = null,
  defaultLinkGuideAsParcelaNum = 1,
}) {
  useEscapeToClose(onClose);
  const [kind, setKind] = useState("SIMPLES");
  const [label, setLabel] = useState(sourceGuide ? `Parcelamento ${sourceGuide.tipo || ""} ${new Date().toLocaleDateString("pt-BR")}` : "");
  const [templateOpeningId, setTemplateOpeningId] = useState("");
  const [templatePaymentId, setTemplatePaymentId] = useState("");
  const [templateRescisionId, setTemplateRescisionId] = useState("");
  const [numParcelas, setNumParcelas] = useState(12);
  const [numEntradas, setNumEntradas] = useState(0);
  const [principalPerParcela, setPrincipalPerParcela] = useState("");
  const [principalTotal, setPrincipalTotal] = useState("");
  const [jurosTotal, setJurosTotal] = useState("");
  const [dataAbertura, setDataAbertura] = useState(new Date().toISOString().slice(0, 10));
  const [competenciaInicial, setCompetenciaInicial] = useState(
    sourceGuide?.competencia || new Date().toISOString().slice(0, 7)
  );
  const [diaPagamento, setDiaPagamento] = useState(20);
  const [periodosReferenciados, setPeriodosReferenciados] = useState("");
  const [linkGuideAsParcelaNum, setLinkGuideAsParcelaNum] = useState(defaultLinkGuideAsParcelaNum);
  const [err, setErr] = useState(null);

  const allFunctions = accountingFunctions?.functions || [];
  const openingTemplates = allFunctions.filter((f) => f.kind === "PARCELAMENTO_OPENING");
  const paymentTemplates = allFunctions.filter((f) => f.kind === "PARCELAMENTO_PAYMENT");
  const rescisionTemplates = allFunctions.filter((f) => f.kind === "PARCELAMENTO_RESCISION");

  // Auto-select templates baseado no kind (procura nome contendo o tipo)
  useEffect(() => {
    const match = (templates) => templates.find((t) => t.name.toUpperCase().includes(kind));
    setTemplateOpeningId((cur) => cur || match(openingTemplates)?.id || "");
    setTemplatePaymentId((cur) => cur || match(paymentTemplates)?.id || "");
    setTemplateRescisionId((cur) => cur || match(rescisionTemplates)?.id || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, accountingFunctions?.functions]);

  // Preview: gera as N parcelas
  const preview = useMemo(() => {
    const n = Number(numParcelas) || 0;
    const principal = Number(principalPerParcela) || 0;
    const rows = [];
    for (let i = 1; i <= Math.min(n, 60); i++) {
      const comp = addMonths(competenciaInicial, i - 1);
      const isEntrada = i <= Number(numEntradas);
      rows.push({ numero: i, comp, principal, label: isEntrada ? `Entrada ${i}` : `Parc ${i}/${n}` });
    }
    return rows;
  }, [numParcelas, numEntradas, principalPerParcela, competenciaInicial]);

  const totalCalc = useMemo(() => {
    const pTotal = Number(principalTotal) || 0;
    const jTotal = Number(jurosTotal) || 0;
    if (pTotal > 0) return pTotal + jTotal;
    return (Number(principalPerParcela) || 0) * (Number(numParcelas) || 0);
  }, [principalTotal, jurosTotal, principalPerParcela, numParcelas]);

  async function handleCreate() {
    setErr(null);
    if (!label.trim()) return setErr("Label obrigatório.");
    // A abertura é obrigatória (é a única provisão da dívida) — exige template + principal total.
    if (!templateOpeningId) return setErr("Selecione um template de abertura.");
    if (!templatePaymentId) return setErr("Selecione um template de pagamento.");
    if (!numParcelas || numParcelas < 1) return setErr("Número de parcelas inválido.");
    if (!Number(principalPerParcela) || Number(principalPerParcela) <= 0) return setErr("Valor por parcela inválido.");
    if (!Number(principalTotal) || Number(principalTotal) <= 0) return setErr("Informe o principal total da dívida (vem do PDF da guia de abertura).");
    if (!competenciaInicial) return setErr("Competência inicial obrigatória.");
    try {
      await onCreate({
        label: label.trim(), kind,
        templateOpeningFunctionId: templateOpeningId,
        templatePaymentFunctionId: templatePaymentId,
        templateRescisionFunctionId: templateRescisionId || null,
        numEntradas: Number(numEntradas) || 0,
        numParcelas: Number(numParcelas),
        principalPerParcela: Number(principalPerParcela),
        principalTotal: Number(principalTotal),
        jurosTotal: Number(jurosTotal) || 0,
        dataAbertura,
        competenciaInicial,
        diaPagamento: Number(diaPagamento) || 1,
        periodosReferenciados: periodosReferenciados.trim() || null,
        sourceGuideId: sourceGuide?.guideId || sourceGuide?.id || null,
        linkGuideAsParcelaNum: sourceGuide ? Number(linkGuideAsParcelaNum) : null,
      });
    } catch (e) {
      setErr(e?.message || "Falha ao criar.");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1600,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }}>
      <div style={{
        background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
        padding: 20, width: "100%", maxWidth: 760, maxHeight: "92vh", overflowY: "auto", overflowX: "hidden",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, color: PANEL.text }}>
            Novo Parcelamento {sourceGuide ? "(a partir de guia)" : ""}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.4rem" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
              Tipo
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={FIELD_STYLE}>
                <option value="SIMPLES">SIMPLES NACIONAL</option>
                <option value="INSS">INSS</option>
                <option value="DARF">DARF</option>
                <option value="OUTRO">OUTRO</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: PANEL.muted }}>
              Label
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: RE-PARCELAMENTO SIMPLES NACIONAL DE SET/2024..." style={FIELD_STYLE} />
            </label>
          </div>

          <div style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
              Templates (funções globais)
            </div>
            {openingTemplates.length === 0 && (
              <div style={{ marginBottom: 8, padding: "6px 10px", fontSize: "0.72rem", color: "#FFB347", background: "rgba(255,179,71,0.12)", border: "1px solid #FFB347", borderRadius: 6 }}>
                ⚠ Nenhum template de abertura disponível. Configure as funções de parcelamento antes de criar.
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
                Abertura *
                <select value={templateOpeningId} onChange={(e) => setTemplateOpeningId(e.target.value)} style={FIELD_STYLE}>
                  <option value="">— selecione —</option>
                  {openingTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
                Pagamento *
                <select value={templatePaymentId} onChange={(e) => setTemplatePaymentId(e.target.value)} style={FIELD_STYLE}>
                  <option value="">— selecione —</option>
                  {paymentTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
                Rescisão (opcional)
                <select value={templateRescisionId} onChange={(e) => setTemplateRescisionId(e.target.value)} style={FIELD_STYLE}>
                  <option value="">— sem rescisão —</option>
                  {rescisionTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Nº parcelas total
              <input type="number" min="1" value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} style={FIELD_STYLE} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Entradas (das primeiras)
              <input type="number" min="0" value={numEntradas} onChange={(e) => setNumEntradas(e.target.value)} style={FIELD_STYLE} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Valor por parcela
              <input type="number" step="0.01" min="0" value={principalPerParcela} onChange={(e) => setPrincipalPerParcela(e.target.value)} style={FIELD_STYLE} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Dia pagamento
              <input type="number" min="1" max="31" value={diaPagamento} onChange={(e) => setDiaPagamento(e.target.value)} style={FIELD_STYLE} />
            </label>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Principal total RFB
              <input type="number" step="0.01" min="0" value={principalTotal} onChange={(e) => setPrincipalTotal(e.target.value)} placeholder="ex: 13.454,69" style={FIELD_STYLE} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Juros total RFB
              <input type="number" step="0.01" min="0" value={jurosTotal} onChange={(e) => setJurosTotal(e.target.value)} placeholder="ex: 3.600,89" style={FIELD_STYLE} />
            </label>
            <div style={{ alignSelf: "end", padding: "6px 10px", background: PANEL.field, borderRadius: 6, fontSize: "0.85rem", color: PANEL.text, textAlign: "right" }}>
              <span style={{ color: PANEL.muted, fontSize: "0.7rem" }}>Total: </span>
              <strong>R$ {fmtMoney(totalCalc)}</strong>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Data abertura
              <input type="date" value={dataAbertura} onChange={(e) => setDataAbertura(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Competência da 1ª parcela
              <input type="month" value={competenciaInicial} onChange={(e) => setCompetenciaInicial(e.target.value)} style={{ ...FIELD_STYLE, colorScheme: "dark" }} />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: "0.7rem", color: PANEL.muted }}>
              Períodos referenciados
              <input value={periodosReferenciados} onChange={(e) => setPeriodosReferenciados(e.target.value)} placeholder="SET/OUT/NOV/2024 E MAR/.../NOV/2025" style={FIELD_STYLE} />
            </label>
          </div>

          {sourceGuide && (
            <div style={{ background: "rgba(189,147,249,0.10)", border: "1px solid #BD93F9", borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: "0.75rem", color: "#BD93F9", fontWeight: 700, marginBottom: 4 }}>
                📎 Esta guia será vinculada como uma parcela
              </div>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.75rem", color: PANEL.muted }}>
                Vincular como parcela número:
                <input type="number" min="1" max={numParcelas} value={linkGuideAsParcelaNum} onChange={(e) => setLinkGuideAsParcelaNum(e.target.value)} style={{ ...FIELD_STYLE, width: 80 }} />
                <span style={{ color: PANEL.muted, fontSize: "0.7rem" }}>(1 = entrada/1ª parcela; pode ser qualquer outra)</span>
              </label>
            </div>
          )}

          {preview.length > 0 && (
            <details style={{ background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, padding: 10 }}>
              <summary style={{ cursor: "pointer", color: PANEL.text, fontSize: "0.8rem", fontWeight: 700 }}>
                Preview ({preview.length} parcelas)
              </summary>
              <div style={{ maxHeight: 200, overflowY: "auto", overflowX: "hidden", marginTop: 8, fontSize: "0.75rem", color: PANEL.text }}>
                {preview.map((p) => (
                  <div key={p.numero} style={{ display: "grid", gridTemplateColumns: "60px 100px 100px 1fr", gap: 8, padding: "2px 0", borderBottom: `1px solid ${PANEL.border}` }}>
                    <span style={{ color: PANEL.muted }}>{p.label}</span>
                    <span>{p.comp}</span>
                    <span style={{ textAlign: "right" }}>R$ {fmtMoney(p.principal)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {err && (
            <div style={{ color: "#FF4757", fontSize: "0.8rem", padding: "8px 10px", background: "rgba(255,71,87,0.12)", border: "1px solid #FF4757", borderRadius: 6 }}>
              {err}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
            <Button variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button variant="primary" onClick={handleCreate} disabled={saving}>
              {saving ? "Criando…" : "Criar parcelamento"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ParcelamentosList — embed na Circular
// ─────────────────────────────────────────────────────────────────────────
// Q31: métrica compacta do card.
function ParcMetric({ label, value, accent, title }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }} title={title}>
      <span style={{ fontSize: "0.62rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <span style={{ fontSize: "0.85rem", fontWeight: 700, color: accent || PANEL.text }}>{value}</span>
    </div>
  );
}

/** Data de vencimento em pt-BR. UTC de propósito: a data vem em meio-dia UTC do cronograma. */
function fmtVencimento(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/**
 * O ALERTA DE ATRASO — a informação que muda o dia do contador, com o botão de agir DENTRO dele.
 *
 * ⚠ Rescindido, o saldo remanescente vai para a Dívida Ativa da União e as reduções de multa da
 * adesão são restabelecidas. E isso chega por ACÚMULO SILENCIOSO — ninguém decide rescindir. Este
 * aviso é a única coisa na tela que antecipa o desfecho.
 *
 * ⚠ SEM ATRASO NÃO APARECE NADA. Uma tarja verde de "em dia" em todo card treinaria o olho a
 * ignorar a faixa inteira, e aí a vermelha também passaria batido.
 *
 * ⚠ A REGRA VEM CONTEXTUALIZADA — "Rescinde com 3 em atraso, está com 2" —, não como texto genérico:
 * o número que importa é onde ESTE contrato está dentro da regra. A citação legal só é impressa
 * quando conferida (`regra.citacaoConferida`): a regra em texto orienta, o NÚMERO do artigo o
 * contador confia e age.
 *
 * ⚠ O "Dar baixa" fica AQUI, no alerta, e não só na barra de ações: quem lê "2 prestações em
 * atraso" está a um clique de resolver, e mandá-lo procurar o botão em outro canto do card é onde a
 * intenção se perde.
 */
function AlertaDeAtraso({ parcelamento, onDarBaixa }) {
  const alerta = alertaDeAtraso(parcelamento);
  if (!alerta) return null;

  const cor = alerta.critico ? "var(--state-danger)" : "var(--state-warn)";
  const fundo = alerta.critico ? "var(--state-danger-surface)" : "var(--state-warn-surface)";

  return (
    <div role="status" style={{ padding: "7px 9px", borderRadius: 6, background: fundo, border: `1px solid ${cor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ color: cor, fontWeight: 700, fontSize: "0.72rem" }}>{alerta.titulo}</div>
        {onDarBaixa && (
          <button
            type="button"
            onClick={onDarBaixa}
            title="Vai para a fila de parcelas pagas aguardando lançamento, no topo desta aba."
            style={{
              flexShrink: 0, fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px", borderRadius: 4,
              background: "transparent", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)", cursor: "pointer",
            }}
          >
            Dar baixa
          </button>
        )}
      </div>
      <div style={{ color: PANEL.muted, fontSize: "0.66rem", marginTop: 2, lineHeight: 1.4 }}>
        {alerta.contextualizada}
        {alerta.citacao ? ` (${alerta.citacao})` : ""}
        {alerta.regraCompleta ? ` Regra: ${alerta.regraCompleta}.` : ""}
      </div>
      {alerta.numeros.length > 0 && (
        <div style={{ color: PANEL.muted, fontSize: "0.66rem", marginTop: 2 }}>
          Em atraso: {alerta.numeros.join(", ")}
        </div>
      )}
    </div>
  );
}

/** Barra de progresso do contrato — `{pagas} de {total} (N históricas)`. */
function ProgressoDoContrato({ parcelamento }) {
  const p = textoDoProgresso(parcelamento);
  const semEvidencia = Number(parcelamento?.parcelasSemEvidencia) || 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "0.78rem", color: PANEL.text, fontWeight: 700 }}>{p.texto}</span>
        <span style={{ fontSize: "0.66rem", color: PANEL.muted }}>
          {Math.max(0, p.total - p.pagas)} restante{p.total - p.pagas === 1 ? "" : "s"}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.pagas}
        aria-label={`Prestações quitadas: ${p.texto}`}
        style={{ marginTop: 4, height: 6, borderRadius: 999, background: "var(--state-neutral-surface)", overflow: "hidden" }}
      >
        <div style={{ width: `${Math.round(p.fracao * 100)}%`, height: "100%", background: "var(--state-ok)" }} />
      </div>
      {/* ⚠ "0 de 52" NÃO é "52 em atraso". Prestação sem evidência fica fora do cálculo de risco de
          propósito (ausência de guia não é prova de não-pagamento) e viaja NOMEADA. */}
      {semEvidencia > 0 && (
        <div style={{ fontSize: "0.64rem", color: PANEL.muted, marginTop: 3, lineHeight: 1.35 }}>
          {semEvidencia} {semEvidencia === 1 ? "prestação" : "prestações"} sem evidência de pagamento — ficam fora do
          cálculo de atraso (ausência de guia não é prova de não-pagamento).
        </div>
      )}
    </div>
  );
}

/** Menu `⋯` do card. Fecha ao clicar fora e ao ESC. */
function MenuDoCard({ itens }) {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (!aberto) return undefined;
    const fechar = () => setAberto(false);
    const onKey = (e) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fechar);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", fechar); window.removeEventListener("keydown", onKey); };
  }, [aberto]);

  const disponiveis = itens.filter(Boolean);
  if (!disponiveis.length) return null;

  return (
    <div style={{ position: "relative" }} onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label="Mais ações do parcelamento"
        onClick={() => setAberto((a) => !a)}
        style={{ fontSize: "0.8rem", padding: "3px 9px", cursor: "pointer", background: "transparent", color: PANEL.muted, border: `1px solid ${PANEL.border}`, borderRadius: 4, fontWeight: 700 }}
      >
        ⋯
      </button>
      {aberto && (
        <div role="menu" style={{
          position: "absolute", right: 0, bottom: "calc(100% + 4px)", zIndex: 60, minWidth: 190,
          background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 8, overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        }}>
          {disponiveis.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              title={it.title}
              onClick={() => { setAberto(false); it.onClick?.(); }}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "7px 11px",
                background: "transparent", border: "none", borderTop: it.separador ? `1px solid ${PANEL.border}` : "none",
                color: it.disabled ? PANEL.muted : (it.tom || PANEL.text),
                fontSize: "0.78rem", cursor: it.disabled ? "not-allowed" : "pointer", fontWeight: 600,
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ParcelamentosList({
  parcelamentos, loading, onRescindir, onOpenCreate, getConfig, saveConfig,
  accounts = [], onSearchHistoricos, onGetHistoricosByCode,
  // Busca do pagamento na LINHA da parcela (pedido do dono). Opcionais: a Circular embeda esta
  // mesma lista e lá a confirmação de pagamento já vive no popover da célula, então sem os dois
  // handlers o bloco simplesmente não aparece.
  onBuscarPagamentoParcela, onParcelaAtualizada,
  // R3 — a barra de ações do card. Todos opcionais pelo mesmo motivo: a Circular embeda esta lista
  // e lá não há fila de baixa nem aba Guias para onde ir.
  onDarBaixa, onBaixaEmLote, onSubirGuia,
  // ⚠ EXCLUIR O CONTRATO — pedido do dono. Opcional pelo mesmo motivo dos outros; quem o passa é a
  // aba Parcelamentos, que tem o modal de confirmação com os números reais.
  onExcluir,
}) {
  const [configParc, setConfigParc] = useState(null); // { id, label }
  const [rescParc, setRescParc] = useState(null);      // parcelamento sendo rescindido
  const [rescBusy, setRescBusy] = useState(false);
  // Histórico das parcelas: controlado aqui para que o item "Histórico" do menu ⋯ e o acordeão do
  // `ParcelasDoAcordo` abram o MESMO bloco — dois estados dariam duas respostas para "está aberto?".
  const [abertos, setAbertos] = useState(() => new Set());
  const alternarHistorico = (id) => setAbertos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // ⚠ RECARGA NÃO DESMONTA A LISTA — e isso não é polimento.
  //
  // `useParcelamentos.load()` liga `loading` em TODA recarga, e toda ação da tela recarrega
  // (rescindir, salvar config, e agora localizar um pagamento). Trocando a lista inteira por
  // "Carregando…" nesse instante, os cards são DESMONTADOS e voltam zerados: o bloco de parcelas
  // que estava aberto fecha sozinho e o desfecho da busca — *"Pagamento localizado em 13/07/2026"* —
  // é apagado no mesmo tick em que apareceria. Quem clicou vê o acordeão fechar e mais nada, que é
  // indistinguível de "o botão não fez nada". Numa chamada PAGA ao SERPRO, o convite é clicar de
  // novo.
  //
  // O spinner só faz sentido quando não há NADA para mostrar; sobre uma lista já carregada, a
  // recarga acontece por baixo.
  if (loading && !(parcelamentos && parcelamentos.length)) {
    return <div style={{ padding: 20, color: PANEL.muted, textAlign: "center" }}>Carregando parcelamentos…</div>;
  }
  if (!parcelamentos || parcelamentos.length === 0) {
    return (
      <div style={{ padding: 20, color: PANEL.muted, textAlign: "center", border: `1px dashed ${PANEL.border}`, borderRadius: 8 }}>
        Nenhum parcelamento ativo.{" "}
        {onOpenCreate && (
          <button type="button" onClick={onOpenCreate} style={{ background: "none", border: "none", color: "var(--accent-purple)", cursor: "pointer", fontWeight: 700, textDecoration: "underline" }}>
            Criar parcelamento
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <strong style={{ color: PANEL.text, fontSize: "0.95rem" }}>Parcelamentos ({parcelamentos.length})</strong>
        {onOpenCreate && <Button size="sm" variant="primary" onClick={onOpenCreate}>+ Novo parcelamento</Button>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
        {parcelamentos.map((p) => {
          // ⚠ AS CORES ESTAVAM INVERTIDAS: ATIVO era VERDE e QUITADO era ciano. Verde significa
          // CONCLUÍDO neste app; um contrato ativo é trabalho em curso. `tomDoStatus` traz o par
          // cor + `-surface` — o fundo NÃO é mais derivado por concatenação de hex (`${cor}33`),
          // que quebra em silêncio assim que a cor vira `var(--…)`.
          const tom = tomDoStatus(p.status);
          const proxima = proximaPrestacao(p);
          const forma = rotuloFormaPagamento(p.formaPagamento);
          const faltam = restantesDoContrato(p);
          const historicoAberto = abertos.has(p.id);
          return (
            /* ⚠ O CARD ABERTO OCUPA A LINHA INTEIRA — e isto é o conserto do vazamento, não
               estética. O card fechado vive numa coluna de ~360px; a tabela de parcelas precisa de
               ~640px (parcela · vencimento · valor · situação · ação). Ela cabia num `overflowX:
               auto`, o que quer dizer que a coluna da AÇÃO — o botão e o motivo — ficava fora da
               área visível, alcançável só por rolagem horizontal. Rolando, o texto do motivo
               aparecia cortado no meio da palavra, pela ESQUERDA. Uma tabela que só se lê rolando
               dentro de um card de 360px não é uma tabela; é informação escondida atrás de um
               gesto que ninguém adivinha. Aberto, o card ganha a linha e a tabela cabe. */
            <div key={p.id} style={{ gridColumn: historicoAberto ? "1 / -1" : "auto", background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Cabeçalho: modalidade + nº, e o badge de status. */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div>
                  <div style={{ color: PANEL.text, fontWeight: 700, fontSize: "0.9rem" }}>
                    {p.tipo || "Parcelamento"}{p.numeroParcelamento ? ` Nº ${p.numeroParcelamento}` : ""}
                  </div>
                  <div style={{ color: PANEL.muted, fontSize: "0.68rem", marginTop: 1 }}>{p.label}</div>
                </div>
                <span style={{ flexShrink: 0, padding: "1px 7px", borderRadius: 999, background: tom.fundo, color: tom.cor, fontWeight: 700, fontSize: "0.62rem", border: `1px solid ${tom.cor}` }}>
                  {p.status}
                </span>
              </div>

              <ProgressoDoContrato parcelamento={p} />

              <AlertaDeAtraso
                parcelamento={p}
                onDarBaixa={onDarBaixa ? () => onDarBaixa(p) : null}
              />

              {/* Próxima parcela — a linha que responde "o que vence agora?". */}
              <div style={{ fontSize: "0.72rem", color: PANEL.muted, lineHeight: 1.45 }}>
                {proxima
                  ? (
                    <>
                      Próxima prestação: <strong style={{ color: PANEL.text }}>{proxima.numeroParcela ?? "?"}</strong>
                      {p.parcelasTotal ? ` de ${p.parcelasTotal}` : ""}
                      {proxima.vencimento ? ` · vence ${fmtVencimento(proxima.vencimento)}` : " · sem data de vencimento conhecida"}
                      {proxima.temGuia ? " · com guia" : " · sem guia"}
                    </>
                  )
                  : (faltam === 0 && p.parcelasTotal
                    ? "Todas as prestações contratadas estão quitadas."
                    : "Cronograma ainda não materializado — não há prestação para acompanhar.")}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <ParcMetric label="Valor da parcela" value={`R$ ${fmtMoney(p.principalPerParcela)}`} />
                <ParcMetric label="Consolidado" value={`R$ ${fmtMoney(p.totalValue)}`} accent="var(--accent-cyan)" />
                {/* ⚠ INFORMATIVO — o saldo declarado NÃO é lançamento, e o rótulo diz isso. */}
                <ParcMetric
                  label="Saldo declarado"
                  value={p.saldoConsolidado != null ? `R$ ${fmtMoney(p.saldoConsolidado)}` : "—"}
                  title="Informado na adesão, para conferência. Não gera lançamento."
                />
              </div>

              <div style={{ fontSize: "0.68rem", color: PANEL.muted, lineHeight: 1.4 }}>
                <span title={forma.detalhe} style={{ color: p.formaPagamento ? PANEL.text : PANEL.muted }}>{forma.texto}</span>
                {p.diaPagamento ? ` · vencimento no dia ${p.diaPagamento}` : ""}
              </div>

              {p.observacoes && (
                <div style={{ fontSize: "0.72rem", color: PANEL.muted, whiteSpace: "pre-wrap", borderTop: `1px solid ${PANEL.border}`, paddingTop: 8 }}>
                  <span style={{ color: PANEL.text, fontWeight: 600 }}>Descrição: </span>{p.observacoes}
                </div>
              )}

              {onBuscarPagamentoParcela && (
                <ParcelasDoAcordo
                  parcelamento={p}
                  onBuscar={onBuscarPagamentoParcela}
                  onBuscou={onParcelaAtualizada}
                  aberto={historicoAberto}
                  onAlternar={() => alternarHistorico(p.id)}
                />
              )}

              {/* Barra de ações: `Dar baixa` | `Baixa em lote` | menu ⋯.
                  ⚠ RESCINDIR SAIU DO DESTAQUE. Ele era um botão vermelho permanente ao lado do
                  Config — a ação mais destrutiva do card, à mesma distância da mais rotineira.
                  Agora vive no ⋯, com confirmação em duas etapas dentro do próprio modal. */}
              <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center", marginTop: "auto", flexWrap: "wrap" }}>
                {onDarBaixa && (
                  <button
                    type="button"
                    onClick={() => onDarBaixa(p)}
                    title="Vai para a fila de parcelas pagas aguardando lançamento, no topo desta aba."
                    style={{ fontSize: "0.7rem", padding: "4px 10px", cursor: "pointer", background: "transparent", color: "var(--accent-purple)", border: "1px solid var(--accent-purple)", borderRadius: 4, fontWeight: 700 }}
                  >
                    Dar baixa
                  </button>
                )}
                {onBaixaEmLote && (
                  <button
                    type="button"
                    onClick={() => onBaixaEmLote(p)}
                    title="Lança a baixa de TODAS as parcelas pagas deste contrato que ainda não têm lançamento (pede confirmação com a lista)."
                    style={{ fontSize: "0.7rem", padding: "4px 10px", cursor: "pointer", background: "transparent", color: PANEL.muted, border: `1px solid ${PANEL.border}`, borderRadius: 4, fontWeight: 700 }}
                  >
                    Baixa em lote
                  </button>
                )}
                <MenuDoCard
                  itens={[
                    getConfig && saveConfig && {
                      label: "⚙ Configuração de contas",
                      onClick: () => setConfigParc({ id: p.id, label: p.label }),
                    },
                    {
                      label: "📎 Subir guia desta parcela",
                      onClick: onSubirGuia ? () => onSubirGuia(p) : undefined,
                      disabled: !onSubirGuia,
                      title: onSubirGuia
                        ? "Abre a aba Guias, onde PARCELAMENTO é um tipo do menu “+ Subir Guia”."
                        : "A guia se anexa na aba Guias desta empresa: + Subir Guia → PARCELAMENTO.",
                    },
                    onBuscarPagamentoParcela && {
                      label: historicoAberto ? "▾ Fechar histórico das parcelas" : "▸ Histórico das parcelas",
                      onClick: () => alternarHistorico(p.id),
                    },
                    p.status === "ATIVO" && onRescindir && {
                      label: "Rescindir…",
                      onClick: () => setRescParc(p),
                      tom: "var(--state-danger)",
                      separador: true,
                    },
                    // ⚠ EXCLUIR ≠ RESCINDIR, e o menu tem de deixar isso claro — são as duas ações
                    // mais parecidas na aparência e as mais opostas no significado. RESCINDIR é um
                    // FATO DO MUNDO: o acordo caiu, o saldo vai para a Dívida Ativa, as reduções da
                    // adesão são restabelecidas — e o app não desfaz isso na Receita. EXCLUIR é um
                    // ato sobre o REGISTRO: este contrato não deveria estar aqui. Quem confunde os
                    // dois rescinde um acordo saudável para apagar um cadastro errado.
                    onExcluir && {
                      label: "Excluir parcelamento…",
                      onClick: () => onExcluir(p),
                      title: "Para contrato lançado errado. Mostra o que será desfeito, com números, "
                        + "e exige motivo. NÃO é a rescisão do acordo perante a Receita.",
                      tom: "var(--state-danger)",
                    },
                  ]}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de configuração (provisão/pagamento + descrição). */}
      {configParc && getConfig && saveConfig && (
        <ParcelamentoConfigModal
          parcId={configParc.id}
          label={configParc.label}
          getConfig={getConfig}
          saveConfig={saveConfig}
          onClose={() => setConfigParc(null)}
          onSaved={() => setConfigParc(null)}
          accounts={accounts}
          onSearchHistoricos={onSearchHistoricos}
          onGetHistoricosByCode={onGetHistoricosByCode}
        />
      )}

      {/* Q31: modal de rescisão com 3 linhas pré-configuradas (estorno reverso). */}
      {rescParc && onRescindir && getConfig && (
        <ParcelamentoRescisaoModal
          parc={rescParc}
          getConfig={getConfig}
          saving={rescBusy}
          onConfirm={async (body) => {
            setRescBusy(true);
            try { await onRescindir(rescParc.id, body); setRescParc(null); }
            finally { setRescBusy(false); }
          }}
          onClose={() => setRescParc(null)}
          accounts={accounts}
          onSearchHistoricos={onSearchHistoricos}
          onGetHistoricosByCode={onGetHistoricosByCode}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Q28 Fase 3: ConferenciaParcelasPanel — fila de parcelas pagas a conferir / divergentes.
// Aprovar em lote confirma os lançamentos de baixa (RASCUNHO → CONFIRMADO).
// ─────────────────────────────────────────────────────────────────────────
export function ConferenciaParcelasPanel({ listConferencia, aprovarConferencia }) {
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    setLoading(true);
    setErro(null);
    try {
      setItems(await listConferencia());
    } catch (err) {
      // ⚠ AUSÊNCIA NUNCA É RESPOSTA. Este painel fazia `if (loading || !items.length) return null`
      // por cima de um `catch` que devolvia `[]`: falha de rede produzia EXATAMENTE o mesmo pixel
      // que "não há nada a conferir" — nenhum. E é a fila de conferência: o que ela esconde é
      // pagamento aguardando confirmação contábil.
      setErro(err?.message || "Não foi possível carregar a fila de conferência.");
    } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    // Mesma disciplina do vazio: uma linha, não um card. "Carregando" e "não há nada" são estados
    // distintos e continuam distintos — o que some é a moldura que os fazia pesar como a fila cheia.
    return (
      <div style={{ marginBottom: 4, color: PANEL.muted, fontSize: "0.78rem" }}>
        Carregando a fila de conferência de parcelas…
      </div>
    );
  }

  if (erro) {
    return (
      <div role="status" style={{ background: PANEL.surface, border: "1px solid var(--state-danger)", borderRadius: 8, padding: "10px 14px", marginBottom: 12 }}>
        <strong style={{ color: "var(--state-danger)", fontSize: "0.85rem" }}>Não foi possível saber se há parcelas a conferir</strong>
        <div style={{ color: PANEL.muted, fontSize: "0.74rem", marginTop: 2, lineHeight: 1.4 }}>
          {erro} — isto <strong>não</strong> quer dizer que a fila está vazia.
        </div>
        <button type="button" onClick={reload} style={{ marginTop: 6, background: "transparent", border: "1px solid var(--accent-purple)", color: "var(--accent-purple)", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: "0.72rem", fontWeight: 700 }}>
          Tentar de novo
        </button>
      </div>
    );
  }

  // ⚠ NADA A CONFERIR, NADA NA TELA — decisão do dono, 21/08/2026: *"se esses campos não têm
  // nenhuma, não preciso dizer isso, pois quando tiver vai aparecer"*.
  //
  // ⚠ Isto REVERTE de propósito o argumento de 19/08 escrito aqui (o card virou linha para deixar
  // de ser ruído, mas "o texto continua na tela"). O dono tirou o texto também. O painel VOLTA
  // sozinho quando houver parcela a conferir — que é quando ele diz alguma coisa.
  if (!items.length) return null;

  const selecionaveis = items.filter((it) => it.estado === "PAGA_A_CONFERIR");
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function aprovar() {
    if (!sel.size) return;
    // ⚠ ATO DE CONSEQUÊNCIA CONFIRMA REPETINDO OS DADOS. "Aprovar" confirma lançamentos de baixa
    // (RASCUNHO → CONFIRMADO) — antes saía num clique só, sem nomear o que estava sendo aprovado.
    const escolhidas = items.filter((it) => sel.has(it.guideId));
    const lista = escolhidas
      .map((it) => `· parcela ${it.numeroParcela || "?"} — ${it.competencia || it.anoMesParcela || "sem competência"} — R$ ${fmtMoney(it.valor)}`)
      .join("\n");
    // ⚠ O NOME DA AÇÃO É O MESMO no botão, na confirmação e no desfecho. O botão diz "Aprovar" e a
    // confirmação dizia "Confirmar os lançamentos de baixa" — dois nomes para o mesmo ato fazem o
    // contador procurar, depois, um "Confirmar" que não existe em lugar nenhum.
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Aprovar a baixa de ${escolhidas.length} parcela(s)?\n\n${lista}\n\nOs lançamentos passam de RASCUNHO para CONFIRMADO.`)) return;
    setBusy(true);
    try { await aprovarConferencia([...sel]); setSel(new Set()); await reload(); } finally { setBusy(false); }
  }

  return (
    <div style={{ background: PANEL.surface, border: "1px solid var(--state-warn)", borderRadius: 8, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${PANEL.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ color: "var(--state-warn)", fontSize: "0.9rem" }}>Conferência de parcelas ({items.length})</strong>
        <Button
          size="sm" variant="primary" onClick={aprovar} disabled={busy || !sel.size}
          title={sel.size
            ? `Confirma os lançamentos de baixa das ${sel.size} parcela(s) selecionada(s).`
            : (selecionaveis.length
              ? "Selecione ao menos uma parcela em PAGA_A_CONFERIR."
              : "Nenhuma parcela nesta fila está em PAGA_A_CONFERIR — as divergentes precisam ser resolvidas antes.")}
        >
          {busy ? "Aprovando…" : `Aprovar (${sel.size})`}
        </Button>
      </div>
      {items.map((it) => {
        const conferivel = it.estado === "PAGA_A_CONFERIR";
        const divergente = it.estado === "DIVERGENTE";
        // ⚠ DESABILITADO SEMPRE COM O MOTIVO. O checkbox nascia `disabled` sem `title` nenhum: quem
        // via a linha DIVERGENTE não tinha como saber por que ela não deixava marcar.
        const motivo = conferivel
          ? "Marque para confirmar o lançamento de baixa desta parcela."
          : divergente
            ? "Parcela DIVERGENTE: o valor pago não bate com o esperado. Resolva a divergência antes de aprovar."
            : `Parcela em ${it.estado}: só parcelas em PAGA_A_CONFERIR podem ser aprovadas aqui.`;
        return (
          <label key={it.guideId} title={motivo} style={{ display: "grid", gridTemplateColumns: "24px 1fr auto", gap: 10, alignItems: "start", padding: "8px 14px", borderBottom: `1px solid ${PANEL.border}`, cursor: conferivel ? "pointer" : "default" }}>
            <input type="checkbox" disabled={!conferivel} title={motivo} checked={sel.has(it.guideId)} onChange={() => toggle(it.guideId)} />
            <div style={{ fontSize: "0.78rem", color: PANEL.text }}>
              {it.parcelamentoLabel || "Parcelamento"} · parc {it.numeroParcela || "?"} · {it.competencia || it.anoMesParcela || ""}
              <span style={{ color: PANEL.muted, marginLeft: 8 }}>R$ {fmtMoney(it.valor)}</span>
              {/* O motivo do bloqueio também fica VISÍVEL, não só no hover: `title` não existe em
                  toque, e este é o mesmo padrão que `ParcelasDoAcordo` já usa. */}
              {!conferivel && (
                <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 2, lineHeight: 1.35 }}>{motivo}</div>
              )}
            </div>
            <span style={{
              fontSize: "0.65rem", fontWeight: 700, padding: "1px 6px", borderRadius: 999,
              background: divergente ? "var(--state-danger-surface)" : "var(--state-warn-surface)",
              color: divergente ? "var(--state-danger)" : "var(--state-warn)",
              border: `1px solid ${divergente ? "var(--state-danger)" : "var(--state-warn)"}`,
            }}>{it.estado}</span>
          </label>
        );
      })}
    </div>
  );
}

// ⚠ DUAS UIs FORAM REMOVIDAS DAQUI (F2.3), junto com as rotas que elas serviam:
//
//   · `ParcelaPaymentModal`         → `POST /parcelamentos/:parcId/parcelas/:num/pagar`
//   · `GuideLinkParcelamentoModal`  → `POST /parcelamentos/:parcId/link-guide`
//
// As duas rotas foram removidas no backend: elas operavam sobre as LINHAS LEVES `tipo="PARCELA"`
// que só o V1 cria, e produção não tem um único parcelamento V1. Nenhuma das duas telas tinha
// chamador — `ParcelaPaymentModal` e `GuideLinkParcelamentoModal` eram exportadas e ninguém as
// importava. Mantê-las era manter no repositório o desenho ANTIGO ("esta guia é parcela?"), que é
// exatamente o guia-first que esta fase inverteu.
//
// A baixa de parcela é UMA só e vive na aba Parcelamento:
// `POST /parcelamentos/parcelas/:guideId/baixa`, com o juros LIDO da composição.

