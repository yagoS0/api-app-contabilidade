import { useEffect, useState, useMemo } from "react";
import { BaixaModal } from "../../baixa/components/renderBaixaModal";
import { SmartHistoricoInput, LineEditor, hasDuplicateAccountAcrossSides } from "../../entries/components/renderAccountingEntriesParts";
import { ACCOUNTING_PANEL, PANEL_FIELD_STYLE, SUBTIPO_OPTIONS } from "../../entries/lib/accountingEntriesShared";
// Cliente próprio: a busca de pagamento é uma chamada pontual da própria aba (mesmo padrão
// auto-contido de FechamentoContabilPanel/ExpectedGuidesPanel).
import { createApiClient } from "../../../../api/client";
// A regra que separa "a vencer" de "vencida" — uma leitura para a cor da célula, o chip do popover
// e os totais do rodapé. Ver `lib/estadoGuia.js`.
import { aparenciaDaGuia, totaisEmAberto } from "../lib/estadoGuia";

// Subtipos universais + flag de regimes que os exibem.
// "all" = qualquer regime; array = só esses regimes.
// Simples NÃO tem IRPJ/CSLL/PIS_COFINS/ISS (esses são exclusivos de Presumido/Real).
// Presumido/Real NÃO tem DAS (esse é exclusivo de Simples).
const SUBTIPO_ROWS_ALL = [
  { key: "DAS",             label: "DAS / Simples Nacional",        regimes: ["SIMPLES"] },
  // PARC_DAS — parcelamento Simples Nacional. Aparece logo abaixo de DAS por proximidade temática.
  // Só faz sentido para empresas regime SIMPLES (que pagam DAS via Simples Nacional).
  { key: "PARC_DAS",        label: "Parc. Simples Nacional",        regimes: ["SIMPLES"] },
  { key: "IRPJ",            label: "IRPJ",                          regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "CSLL",            label: "CSLL",                          regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  // ⚠ PIS e COFINS têm LINHA PRÓPRIA — eram uma só ("PIS/COFINS"), e isso escondia um lançamento.
  // A matriz é indexada por `subtipo__competencia`: com o mesmo subtipo, as duas provisões caíam na
  // mesma célula e uma era DESCARTADA. A célula mostrava o valor de um tributo enquanto o "Total em
  // aberto" somava os dois, e dar baixa pela célula deixava a outra aberta e invisível.
  // O DARF continua sendo UM documento para gerar e enviar (ver `guideCompliance`); o que se separa
  // aqui é a BAIXA, que é por tributo e em contas diferentes.
  { key: "PIS",             label: "PIS",                           regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "COFINS",          label: "COFINS",                        regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "ISS",             label: "ISS",                           regimes: ["LUCRO_PRESUMIDO", "LUCRO_REAL"] },
  { key: "INSS",            label: "INSS / CPP",                    regimes: "all" },
  { key: "IRRF",            label: "IRRF",                          regimes: "all" },
  { key: "FGTS",            label: "FGTS",                          regimes: "all" },
  { key: "FERIAS",          label: "Férias",                        regimes: "all" },
  { key: "DECIMO_TERCEIRO", label: "13º Salário",                   regimes: "all" },
  { key: "OUTROS_TRIBUTOS", label: "Outros Tributos",               regimes: "all" },
];

function getSubtipoRowsForRegime(regime) {
  const r = String(regime || "").trim().toUpperCase();
  if (!r) return SUBTIPO_ROWS_ALL;  // sem regime conhecido → mostra tudo (fallback)
  return SUBTIPO_ROWS_ALL.filter(
    (row) => row.regimes === "all" || row.regimes.includes(r),
  );
}

// Mantido como fallback para código legado que ainda importava esta constante.
const SUBTIPO_ROWS = SUBTIPO_ROWS_ALL;

// Frente B: subtipo da matriz → chave(s) do tributo em circular.acrescimos.
// Agora é 1:1 — PIS e COFINS têm linha própria, então cada um lê o SEU acréscimo. Enquanto
// `PIS_COFINS` mapeava para os dois, o juros/multa de um aparecia somado ao do outro na única
// célula que existia.
const SUBTIPO_TO_ACRESCIMO = {
  DAS: ["DAS"], INSS: ["INSS"], IRPJ: ["IRPJ"], CSLL: ["CSLL"], PIS: ["PIS"], COFINS: ["COFINS"], ISS: ["ISS"],
};

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Q31: largura ÚNICA de coluna do quadro (todas iguais — header, célula, subtotal).
const COL_W = 120;

const TIPO_LABELS = { DESPESA: "Despesa", RECEITA: "Receita", FOLHA: "Folha", PROVISAO: "Provisão", BAIXA: "Baixa", OUTRO: "Outro" };

function fmtValor(val) {
  const n = Number(val);
  if (!n) return null;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(value) {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

// ─── Entry Edit Modal ────────────────────────────────────────────────────────

function CircularEntryEditModal({ entry, accounts, saving, onSave, onClose, onSearchHistoricos, acrescimosComp }) {
  const [form, setForm] = useState({
    data: entry.data ? String(entry.data).slice(0, 10) : "",
    historico: entry.historico || "",
    tipo: entry.tipo || "PROVISAO",
    subtipo: entry.subtipo || "",
    lines: (entry.lines || []).map((l) => ({
      tipo: l.tipo,
      conta: l.conta || "",
      valor: String(Number(l.valor || 0).toFixed(2)),
    })),
  });
  const [saveError, setSaveError] = useState(null);

  const isDuplicate = hasDuplicateAccountAcrossSides(form.lines);
  const subtipoLabel = SUBTIPO_ROWS.find((r) => r.key === entry.subtipo)?.label || entry.subtipo || "Lançamento";

  // Acréscimo (juros/multa) — e, p/ INSS sintético, o valor principal — editado no MESMO modal.
  // INSS não tem lançamento real (synthetic): modo "acréscimo-only" edita só valor/juros/multa.
  const isAcrOnly = entry.synthetic === true;
  const acrKeys = SUBTIPO_TO_ACRESCIMO[entry.subtipo] || [];
  const [acr, setAcr] = useState(() =>
    acrKeys.map((k) => {
      const src = (acrescimosComp && acrescimosComp[k]) || {};
      return {
        key: k,
        principal: src.principal != null ? String(src.principal) : (isAcrOnly && src.principal == null ? String(Number(entry.valor || entry.totalD || 0).toFixed(2)) : ""),
        juros: src.juros != null ? String(src.juros) : "",
        multa: src.multa != null ? String(src.multa) : "",
      };
    }),
  );
  const setAcrField = (i, field, val) => setAcr((p) => p.map((t, idx) => (idx === i ? { ...t, [field]: val } : t)));
  // Payload do acréscimo: real → só juros/multa (principal preservado no parent); INSS → inclui principal.
  const buildAcrescimo = () => acr.map((t) => (isAcrOnly ? { key: t.key, principal: t.principal, juros: t.juros, multa: t.multa } : { key: t.key, juros: t.juros, multa: t.multa }));

  // Detecta linhas com conta vazia — ajuda o contador a entender por que o save vai falhar.
  const linesWithEmptyConta = form.lines.filter((l) => !String(l.conta || "").trim()).length;
  const linesWithoutValor = form.lines.filter((l) => {
    const v = parseFloat(String(l.valor || "0").replace(",", "."));
    return !Number.isFinite(v) || v <= 0;
  }).length;

  async function handleSave() {
    setSaveError(null);
    // INSS sintético: não há lançamento pra validar/atualizar — salva só valor/juros/multa.
    if (isAcrOnly) {
      try {
        await onSave({ acrescimoOnly: true, acrescimoTributos: buildAcrescimo() });
      } catch (err) {
        setSaveError(err?.message || "Falha ao salvar.");
      }
      return;
    }
    if (isDuplicate) return;
    if (linesWithEmptyConta > 0) {
      setSaveError(`Há ${linesWithEmptyConta} linha(s) sem código de conta. Preencha as contas antes de salvar.`);
      return;
    }
    if (linesWithoutValor > 0) {
      setSaveError(`Há ${linesWithoutValor} linha(s) sem valor (ou com valor ≤ 0).`);
      return;
    }
    try {
      // passa também o eventType (pra backend memorizar D/C no AccountingHistorico) + acréscimo
      await onSave({ ...form, eventType: entry.eventType || null, acrescimoTributos: buildAcrescimo() });
    } catch (err) {
      setSaveError(err?.message || "Falha ao salvar lançamento.");
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: ACCOUNTING_PANEL.surface, border: `1px solid ${ACCOUNTING_PANEL.border}`, borderRadius: 10, padding: 20, width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontWeight: 700, color: ACCOUNTING_PANEL.text, fontSize: "0.9375rem" }}>
            Editar: {subtipoLabel}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: ACCOUNTING_PANEL.muted, cursor: "pointer", fontSize: "1.4rem", lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {!isAcrOnly && (<>
          {/* Data */}
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
            Data
            <input
              type="date"
              value={form.data}
              onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))}
              style={{ ...PANEL_FIELD_STYLE, colorScheme: "dark", height: 34, padding: "0 10px" }}
            />
          </label>

          {/* Histórico */}
          <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
            Histórico
            <SmartHistoricoInput
              value={form.historico}
              onChange={(v) => setForm((p) => ({ ...p, historico: v }))}
              onFillFromHistory={(h, ls) =>
                setForm((p) => ({
                  ...p,
                  historico: h,
                  lines: ls?.length
                    ? ls.map((l) => ({ tipo: l.tipo, conta: l.conta || "", valor: l.valor ? String(l.valor) : "" }))
                    : p.lines,
                }))
              }
              onSearchHistoricos={onSearchHistoricos}
              accounts={accounts}
              competencia={entry.competencia}
            />
          </label>

          {/* Tipo + Subtipo */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
              Tipo
              <select
                value={form.tipo}
                onChange={(e) =>
                  setForm((p) => ({ ...p, tipo: e.target.value, subtipo: e.target.value !== "PROVISAO" ? "" : p.subtipo }))
                }
                style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", colorScheme: "dark" }}
              >
                {Object.entries(TIPO_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </label>
            {form.tipo === "PROVISAO" && (
              <label style={{ display: "grid", gap: 4, fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted }}>
                Subtipo
                <select
                  value={form.subtipo || ""}
                  onChange={(e) => setForm((p) => ({ ...p, subtipo: e.target.value }))}
                  style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 8px", colorScheme: "dark" }}
                >
                  <option value="">—</option>
                  {SUBTIPO_OPTIONS.map(({ key, label }) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {/* Linhas */}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "0.75rem", color: ACCOUNTING_PANEL.muted, marginBottom: 4 }}>Linhas (D/C)</div>
            {/* Colunas fixas do LineEditor: em telas estreitas rola só aqui, não o modal todo. */}
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <LineEditor
                lines={form.lines}
                onChange={(ls) => setForm((p) => ({ ...p, lines: ls }))}
                accounts={accounts}
              />
            </div>
          </div>
          </>)}

          {/* Acréscimo: juros/multa (e o valor principal, no caso do INSS sintético) */}
          {acr.length > 0 && (
            <div style={{ display: "grid", gap: 10, padding: "10px 12px", borderRadius: 8, background: "rgba(255,179,71,0.06)", border: "1px solid rgba(255,179,71,0.35)" }}>
              {acr.map((t, i) => (
                <div key={t.key} style={{ display: "grid", gap: 6 }}>
                  {acr.length > 1 && <strong style={{ color: ACCOUNTING_PANEL.text, fontSize: "0.78rem" }}>{t.key}</strong>}
                  <div style={{ display: "grid", gridTemplateColumns: isAcrOnly ? "1fr 1fr 1fr" : "1fr 1fr", gap: 8 }}>
                    {isAcrOnly && (
                      <label style={{ display: "grid", gap: 3, fontSize: "0.7rem", color: ACCOUNTING_PANEL.muted }}>
                        Valor
                        <input value={t.principal} onChange={(e) => setAcrField(i, "principal", e.target.value)} placeholder="0,00" style={{ ...PANEL_FIELD_STYLE, width: "100%" }} />
                      </label>
                    )}
                    <label style={{ display: "grid", gap: 3, fontSize: "0.7rem", color: "#FFB347" }}>
                      Juros
                      <input value={t.juros} onChange={(e) => setAcrField(i, "juros", e.target.value)} placeholder="0,00" style={{ ...PANEL_FIELD_STYLE, width: "100%" }} />
                    </label>
                    <label style={{ display: "grid", gap: 3, fontSize: "0.7rem", color: "#FFB347" }}>
                      Multa
                      <input value={t.multa} onChange={(e) => setAcrField(i, "multa", e.target.value)} placeholder="0,00" style={{ ...PANEL_FIELD_STYLE, width: "100%" }} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isAcrOnly && isDuplicate && (
            <div style={{ color: "#FF4757", fontSize: "0.8125rem", fontWeight: 600 }}>
              Débito e crédito não podem usar a mesma conta.
            </div>
          )}
          {saveError && (
            <div style={{
              color: "#FF4757", fontSize: "0.8125rem", fontWeight: 600,
              padding: "8px 10px", borderRadius: 6,
              background: "rgba(255, 71, 87, 0.12)", border: "1px solid #FF4757",
            }}>
              {saveError}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={onClose}
              style={{ ...PANEL_FIELD_STYLE, height: 34, padding: "0 16px", cursor: "pointer", borderRadius: 4 }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || (!isAcrOnly && isDuplicate)}
              style={{
                height: 34, padding: "0 20px",
                background: "#69FF47", color: "#1A1B26",
                border: "none", borderRadius: 4,
                fontWeight: 700, fontSize: "0.875rem",
                cursor: saving || (!isAcrOnly && isDuplicate) ? "default" : "pointer",
                opacity: saving || (!isAcrOnly && isDuplicate) ? 0.6 : 1,
              }}
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ResumoDaGuia (cabeçalho do popover da célula) ───────────────────────────

/** Uma linha "rótulo · valor" do resumo. Valor ausente não vira linha — ausência não é resposta. */
function LinhaResumo({ rotulo, valor, cor, forte }) {
  if (valor == null || valor === "") return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 4px", fontSize: "0.72rem" }}>
      <span style={{ color: "#8A8FA3" }}>{rotulo}</span>
      <span style={{ color: cor || "#F8F8F2", fontWeight: forte ? 800 : 600, whiteSpace: "nowrap" }}>{valor}</span>
    </div>
  );
}

/**
 * O cabeçalho do popover: que guia é, em que estado, por quanto e até quando.
 *
 * ⚠ O ENVIO SAI DE `envios_guia`, não de `emailStatus`. `emailStatus` é detalhe de transporte do
 * e-mail; com o WhatsApp no ar ele não sabe dizer "enviada por WhatsApp". `foiEnviadaComLegado` é a
 * regra do backend — aqui a leitura é a mesma, incluindo a tolerância à guia ainda não convertida
 * pelo backfill (envios vazio + emailStatus SENT = enviada).
 */
function ResumoDaGuia({ entry, acrescimo, aparencia }) {
  const guia = entry?.sourceGuide || null;
  const principal = Number(acrescimo?.principal ?? entry?.valor ?? entry?.totalD ?? 0) || 0;
  const juros = Number(acrescimo?.acrescimo || 0) || 0;
  const atualizado = entry?.recalculatedToValor != null ? Number(entry.recalculatedToValor) : (principal + juros);

  const TERMINAIS = ["enviado", "entregue", "lido"];
  const envios = guia?.envios || [];
  const envio = envios.find((e) => TERMINAIS.includes(String(e.status)));
  const enviadaLegado = !envios.length && String(guia?.emailStatus || "").toUpperCase() === "SENT";
  const canal = envio ? (String(envio.canal) === "WHATSAPP" ? "WhatsApp" : "e-mail") : null;
  const dataEnvio = envio ? (envio.lidoEm || envio.entregueEm || envio.enviadoEm) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "2px 4px 6px" }}>
        <strong style={{ fontSize: "0.78rem", color: "#F8F8F2" }}>
          {guia?.tipo || entry?.subtipo || "Guia"}
          {entry?.competencia ? ` · ${fmtCompetenciaLonga(entry.competencia)}` : ""}
        </strong>
        <span style={{ fontSize: "0.65rem", fontWeight: 700, color: aparencia.cor, border: `1px solid ${aparencia.cor}`, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
          {aparencia.rotulo}
        </span>
      </div>

      <LinhaResumo rotulo="Valor original" valor={principal ? `R$ ${fmtValor(principal)}` : null} />
      {juros > 0 && (
        <LinhaResumo
          rotulo={entry?.recalculatedAt ? `Juros/multa (${fmtDate(entry.recalculatedAt)})` : "Juros/multa"}
          valor={`+ R$ ${fmtValor(juros)}`}
          cor="#FFB347"
        />
      )}
      {juros > 0 && <LinhaResumo rotulo="Valor atualizado" valor={`R$ ${fmtValor(atualizado)}`} forte />}
      <LinhaResumo rotulo="Vencimento" valor={guia?.vencimento ? fmtDate(guia.vencimento) : null} />
      {Number.isFinite(Number(entry?.saldo)) && String(entry?.statusPagamento).toUpperCase() === "PARCIAL" && (
        <LinhaResumo rotulo="Saldo a pagar" valor={`R$ ${fmtValor(entry.saldo)}`} cor="#6EA8FF" forte />
      )}

      {/* ⚠ O DESTINO VEM DO ENVIO, não do cadastro. Mostrar o e-mail cadastrado ao lado de "enviada
          por WhatsApp" já produziu na tela a frase "Enviada por WhatsApp para <e-mail>". */}
      {(envio || enviadaLegado) ? (
        <LinhaResumo
          rotulo="Enviada ao cliente"
          valor={`✓ ${dataEnvio ? fmtDate(dataEnvio) : "sim"}${canal ? ` · ${canal}` : ""}`}
          cor="#69FF47"
        />
      ) : (
        // Princípio 7: ausência nunca é resposta. Sem esta linha, "ainda não enviada" e "não sei"
        // se pareceriam — os dois seriam a falta de uma linha.
        guia && <LinhaResumo rotulo="Enviada ao cliente" valor="ainda não" cor="#8A8FA3" />
      )}
    </div>
  );
}

/** "2026-06" → "Junho/2026". Serve ao cabeçalho do popover. */
function fmtCompetenciaLonga(comp) {
  const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const [yyyy, mm] = String(comp || "").split("-");
  const i = Number(mm) - 1;
  return (!yyyy || i < 0 || i > 11) ? String(comp || "") : `${meses[i]}/${yyyy}`;
}

// ─── PagamentoCell ───────────────────────────────────────────────────────────

// Q31: célula só com NÚMERO; cor implícita (vermelho=aberto, verde=pago, amarelo=vinculado a
// parcelamento). Clicar abre o menu de ações (Editar / Dar baixa / Vincular a parcelamento).
function PagamentoCell({ entry, onBaixa, onEdit, onCancelBaixa, parcelamentosAtivos = [], onVincular, onDesvincular, acrescimo = null, onBuscarPagamento }) {
  const [open, setOpen] = useState(false);
  const [selParc, setSelParc] = useState("");
  const temAcrescimo = acrescimo && acrescimo.acrescimo > 0;

  // Célula sem provisão: mostra "—" (ou o split, se houver — ex.: LP sem lançamento ainda).
  if (!entry) {
    if (!acrescimo) {
      return <td style={{ width: COL_W, minWidth: COL_W, padding: "8px 4px", textAlign: "center", fontSize: "0.85rem", color: "#44475A", borderRight: "1px solid #44475A" }}>—</td>;
    }
    return (
      <td style={{ width: COL_W, minWidth: COL_W, padding: "8px 4px", textAlign: "center", borderRight: "1px solid #44475A", color: "#F8F8F2" }}>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", whiteSpace: "nowrap" }}>R$ {fmtValor(acrescimo.principal) || "0,00"}</div>
        {temAcrescimo && <div title={`Juros/multa R$ ${fmtValor(acrescimo.acrescimo)}`} style={{ fontSize: "0.6rem", fontWeight: 700, color: "#FFB347", whiteSpace: "nowrap" }}>+R$ {fmtValor(acrescimo.acrescimo)} j/m</div>}
      </td>
    );
  }

  const placeholder = entry.placeholder || entry.origem === "TEMPLATE";
  const isAberto = entry.statusPagamento === "ABERTO";
  const isParcial = entry.statusPagamento === "PARCIAL"; // baixa parcial por quota — ainda tem saldo
  const isOpenLike = isAberto || isParcial; // pode receber (nova) baixa
  const isVinculado = Boolean(entry.parcelamentoId);
  const isSynthetic = entry.synthetic === true;
  const valor = entry.valor || entry.totalD;
  // baixas existem quando parcial ou pago; usado tanto p/ cancelar a última quota quanto p/ INSS.
  // ⚠ UMA GUIA PODE TER TRÊS BAIXAS (principal, juros, multa). `baixas[0]` é o principal — serve
  // para saber SE existe baixa e para editar. Cancelar, não: cancelar um de três deixa dois
  // lançamentos órfãos com a guia reaberta, então o cancelamento leva a lista inteira.
  const baixaId = entry.baixas?.[0]?.id ?? null;
  const baixaIds = (entry.baixas || []).map((b) => b.id).filter(Boolean);
  const saldo = Number(entry.saldo);

  // ⚠ A COR SAI DE `estadoDaGuia`, e ela olha o VENCIMENTO.
  // Antes toda guia em aberto era vermelha: a que vence daqui a duas semanas com a mesma força da
  // que venceu há dois meses. Ver `lib/estadoGuia.js` para o porquê e para os testes.
  const aparencia = aparenciaDaGuia(entry);
  let color = aparencia.cor;
  let bg = aparencia.fundo;
  // Vinculada a parcelamento vence a leitura de prazo: a dívida está sendo gerenciada, não atrasada.
  if (isVinculado && isAberto) { color = "#FFB347"; bg = "rgba(255,179,71,0.08)"; }
  // Pagamento LOCALIZADO no SERPRO mas ainda SEM lançamento: continua "em aberto" na cor (há
  // trabalho a fazer), mas ganha a tag "paga" — o dinheiro saiu, falta o contador lançar.
  const pagamentoLocalizado = Boolean(entry.pagamentoLocalizado) && isOpenLike;

  const menuBtn = { display: "block", width: "100%", textAlign: "left", padding: "6px 8px", background: "transparent", border: "none", color: "#F8F8F2", fontSize: "0.78rem", cursor: "pointer", borderRadius: 4 };

  // Lançamentos reais: editar/baixar/vincular. INSS sintético (vem da guia) agora tem o fluxo
  // completo igual ao DAS (Q52): "Dar baixa" (abre modal, gera a baixa contábil), "Editar baixa"
  // (edita o lançamento gerado) e "Cancelar baixa" (apaga a baixa e reabre a guia).
  const canBaixaInss = isSynthetic && isAberto && Boolean(onBaixa);
  // INSS aberto: pode editar valor/juros/multa (não há lançamento — vai p/ acrescimos.INSS).
  const canEditInss = isSynthetic && isAberto && Boolean(onEdit);
  // INSS pago: pode editar a baixa (entry.baixaEntry é o lançamento real) e cancelá-la.
  const canManageInssBaixa = isSynthetic && !isAberto && Boolean(baixaId);
  const hasActions =
    canBaixaInss
    || canEditInss
    || (canManageInssBaixa && (Boolean(onCancelBaixa) || (Boolean(onEdit) && Boolean(entry.baixaEntry))))
    || (!isSynthetic && (Boolean(onEdit) || (isOpenLike && Boolean(onBaixa)) || (Boolean(baixaId) && Boolean(onCancelBaixa)) || Boolean(onVincular)));
  const numText = fmtValor(valor) ? `R$ ${fmtValor(valor)}` : "—";

  return (
    <td style={{ position: "relative", background: bg, padding: "8px 4px", textAlign: "center", borderRight: "1px solid #44475A", width: COL_W, minWidth: COL_W, color: "#F8F8F2" }}>
      {/* AFFORDANCE: célula com ação ganha hover (superfície elevada), cursor e foco visível; a
          célula "—" (sem provisão) não é interativa e sai antes, lá em cima. Teclado: Tab foca,
          Enter/Espaço abrem (é um <button>), Esc fecha. Sem isso, "clique na célula" era uma regra
          que só quem já sabia descobria. */}
      {hasActions ? (
        <button
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}
          aria-expanded={open}
          aria-haspopup="dialog"
          title={isVinculado && isAberto ? "Vinculado a parcelamento — abra para ver os detalhes." : `${aparencia.titulo} Clique para ver os detalhes.`}
          style={{
            background: open ? "#2b2d45" : "transparent",
            border: "1px solid transparent", borderRadius: 6, cursor: "pointer",
            color, fontWeight: 700, fontSize: "0.95rem", whiteSpace: "nowrap", width: "100%", padding: "2px 0",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; e.currentTarget.style.borderColor = "#44475A"; }}
          onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; } }}
        >
          {numText}
        </button>
      ) : (
        <span
          title={isSynthetic ? `Gerada a partir da guia INSS. ${aparencia.titulo}` : aparencia.titulo}
          style={{ color, fontWeight: 700, fontSize: "0.95rem", whiteSpace: "nowrap", display: "inline-block", padding: "2px 0" }}
        >
          {numText}
        </span>
      )}
      {/* ⚠ NA CÉLULA, NO MÁXIMO UM ÍCONE.
          Aqui empilhavam-se até QUATRO linhas de 6px numa coluna de ~90px — "↻ R$ …", "+R$ … j/m",
          "paga dd/mm", "saldo R$ …" — cada uma com a informação de verdade escondida num `title`,
          que só aparece para quem para o mouse em cima. Todas essas linhas migraram para o
          `ResumoDaGuia`, onde têm rótulo e espaço. O que sobra na célula é um sinal por vez:

          • ⚠  juros/multa correndo (o valor está no popover)
          • ⏳ pagamento localizado no SERPRO, falta lançar a baixa
          • ✅ quitada
      */}
      {!placeholder && (temAcrescimo || entry.recalculatedAt) && isOpenLike && !pagamentoLocalizado && (
        <div style={{ fontSize: "0.7rem", lineHeight: 1.1, color: "#FFB347" }} title="Tem juros/multa — abra a célula para ver o valor atualizado.">⚠</div>
      )}
      {pagamentoLocalizado && (
        <div
          style={{ fontSize: "0.7rem", lineHeight: 1.1 }}
          title={entry.comprovante?.dataArrecadacao
            ? `Pagamento localizado no SERPRO em ${entry.comprovante.dataArrecadacao} — falta lançar a baixa.`
            : "Pagamento localizado no SERPRO — falta lançar a baixa."}
        >
          ⏳
        </div>
      )}
      {/* ✓ simples, não ✅. O emoji desenha um check DENTRO DE UM QUADRADO verde e lê como caixa
          marcada — sugerindo uma interação que não existe (ele é só indicador). Além disso emoji
          não respeita a paleta: chegava sempre no mesmo verde, ao lado de um número que pode estar
          em quatro cores diferentes. */}
      {!placeholder && !isOpenLike && (
        <div
          style={{ fontSize: "0.8rem", lineHeight: 1.1, color: "#69FF47", fontWeight: 800 }}
          title={`Pagamento confirmado${entry.sourceGuide?.paymentConfirmedAt ? ` em ${fmtDate(entry.sourceGuide.paymentConfirmedAt)}` : ""}${entry.sourceGuide?.paymentStatusSource === "SERPRO" ? " (via SERPRO)" : ""}${entry.sourceGuide?.comprovantePdfFileId ? " — comprovante de arrecadação disponível" : ""}.`}
        >
          ✓
        </div>
      )}
      {open && hasActions && (
        <div
          onMouseLeave={() => setOpen(false)}
          style={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)", zIndex: 50, background: "#24253A", border: "1px solid #44475A", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.45)", padding: 6, minWidth: 250, display: "flex", flexDirection: "column", gap: 2 }}
        >
          {/* ⚠ O POPOVER DEIXOU DE SER SÓ UM MENU DE AÇÕES.
              Valor original, juros/multa, valor atualizado, vencimento e envio ao cliente moravam
              como micro-anotações DENTRO da célula — uma coluna de ~90px com até quatro linhas de
              6px empilhadas, cada uma com a informação real escondida num `title`. Aqui elas têm
              rótulo e cabem. Na célula fica o número e, no máximo, um ícone. */}
          <ResumoDaGuia entry={entry} acrescimo={acrescimo} aparencia={aparencia} />
          <div style={{ borderTop: "1px solid #44475A", margin: "4px 0 2px" }} />
          {onEdit && !isSynthetic && <button onClick={() => { setOpen(false); onEdit(entry); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>✎ Editar</button>}
          {/* INSS sintético aberto: edita valor/juros/multa (vai p/ acrescimos.INSS) no mesmo modal. */}
          {canEditInss && <button onClick={() => { setOpen(false); onEdit(entry); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>✎ Editar valor/juros/multa</button>}
          {/* Q52: INSS pago — edita o lançamento de baixa real (não a provisão sintética). */}
          {onEdit && isSynthetic && !isAberto && entry.baixaEntry && <button onClick={() => { setOpen(false); onEdit(entry.baixaEntry); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>✎ Editar baixa</button>}
          {/* Busca o comprovante no SERPRO: marca "paga" e guarda data/valores, SEM lançar.
              O lançamento continua sendo o "Dar baixa" abaixo, já pré-preenchido. */}
          {isOpenLike && onBuscarPagamento && entry.sourceGuide?.id && (
            <button
              onClick={() => { setOpen(false); onBuscarPagamento(entry); }}
              style={menuBtn}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              🔎 Buscar pagamento
            </button>
          )}
          {/* "Dar baixa" — provisões reais E INSS sintético (Q47). Em PARCIAL, abre nova quota. */}
          {isOpenLike && onBaixa && <button onClick={() => { setOpen(false); onBaixa(entry); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>{isParcial ? "Dar baixa (próxima quota)" : "Dar baixa"}</button>}
          {/* "Cancelar baixa" — DAS/quota (provisão real) E INSS sintético (Q52). Em PARCIAL cancela a última quota. */}
          {/* ⚠ "DESFAZER BAIXA", não "cancelar" — e leva a guia inteira.
              Uma guia tem até TRÊS baixas (principal, juros e multa são lançamentos separados, em
              contas diferentes). Desfazer uma de três deixaria dois lançamentos órfãos com a guia
              reaberta; por isso `baixaIds` inteiro. O rótulo diz quantos lançamentos vão embora
              justamente para que ninguém descubra depois. */}
          {baixaId && onCancelBaixa && <button onClick={() => { setOpen(false); onCancelBaixa(baixaIds); }} style={menuBtn} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>{isParcial ? "↩ Desfazer última quota" : (baixaIds.length > 1 ? `↩ Desfazer baixa (${baixaIds.length} lançamentos)` : "↩ Desfazer baixa")}</button>}
          {onVincular && !isSynthetic && (
            isVinculado ? (
              <button onClick={() => { setOpen(false); onDesvincular(entry); }} style={{ ...menuBtn, color: "#FFB347" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d45"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>Desvincular do parcelamento</button>
            ) : (
              <div style={{ borderTop: `1px solid #44475A`, marginTop: 2, paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <select value={selParc} onChange={(e) => setSelParc(e.target.value)} style={{ background: "#1A1B26", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2", padding: "4px 6px", fontSize: "0.72rem", colorScheme: "dark" }}>
                  <option value="">— parcelamento —</option>
                  {parcelamentosAtivos.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                <button disabled={!selParc} onClick={() => { if (selParc) { setOpen(false); onVincular(entry, selParc); } }} style={{ ...menuBtn, color: selParc ? "#FFB347" : "#6272A4", cursor: selParc ? "pointer" : "default" }}>Vincular a parcelamento</button>
              </div>
            )
          )}
        </div>
      )}
    </td>
  );
}

function FaturamentoCell({ valor }) {
  return (
    <td style={{ padding: "6px 4px", textAlign: "center", fontSize: "0.75rem", borderRight: "1px solid #44475A" }}>
      {valor ? (
        <span style={{ fontWeight: 700, color: "#8BE9FD" }}>R$ {fmtValor(valor)}</span>
      ) : (
        <span style={{ color: "#44475A" }}>—</span>
      )}
    </td>
  );
}

// Q7.2: painel "Operações Fiscais" foi removido — as ações (Buscar Guias, Verificar Pagtos,
// Sincronizar INSS) ficam nas abas Guias / Configurações. Circular foca só na tabela.

// ─── CircularTab ─────────────────────────────────────────────────────────────

const circularApi = createApiClient();

/**
 * O EXTRATO do mês, na coluna do mês.
 *
 * Os PDFs da declaração e do recibo do PGDAS-D já eram salvos no storage desde sempre — só não
 * havia rota que os servisse, então ficavam guardados e invisíveis. É aqui que eles aparecem: ao
 * lado do mês, junto do que foi gerado a partir deles.
 *
 * ⚠ E é aqui que a DECLARAÇÃO ZERADA deixa de ser silêncio. Um extrato sem valor não gera
 * lançamento nenhum (`amount > 0` no gerador), então a linha do mês ficava idêntica à de um mês em
 * que ninguém buscou nada. O selo "zerado" é a diferença entre "não há imposto" e "não sabemos".
 */
/**
 * CÉLULA da coluna "Extrato" — os PDFs da declaração e do recibo do PGDAS-D.
 *
 * ⚠ ISTO MORAVA DENTRO DA CÉLULA DO MÊS. Eram dois links de 0.62rem ("extrato" "recibo")
 * espremidos embaixo de "Abr/26", e o aviso de arquivo ausente — uma frase inteira — quebrava em
 * duas linhas dentro de uma coluna de ~90px, empurrando a altura da linha da tabela inteira. Dois
 * documentos que se ABREM não são um detalhe do rótulo do mês: são uma ação, e ação tem coluna.
 */
function ExtratoDoMes({ comp, info, companyId }) {
  const [erro, setErro] = useState("");
  if (!info) return null;

  async function abrir(tipo) {
    setErro("");
    try {
      const blob = await circularApi.fetchPgdasPdfBlob(companyId, comp, tipo);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      // O Railway apaga o filesystem a cada deploy sem volume: "registro existe, arquivo não" é
      // caso real. Avisa em vez de quebrar — mesmo tratamento da aba Situação Fiscal.
      setErro(e?.message || "O arquivo não está mais no armazenamento.");
    }
  }

  // Botões de verdade, com área clicável: os links de 0.62rem tinham ~40px de alvo.
  const botao = {
    display: "inline-flex", alignItems: "center", gap: 3,
    background: "transparent", border: "1px solid #44475A", borderRadius: 6,
    padding: "3px 7px", cursor: "pointer",
    font: "inherit", fontSize: "0.7rem", color: "#8BE9FD",
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: 3, fontWeight: 400 }}>
      <span style={{ display: "inline-flex", gap: 4 }}>
        {info.temDeclaracao && (
          <button type="button" onClick={() => abrir("declaracao")} style={botao} title="Extrato da declaração do PGDAS-D (PDF)">
            📄 Extrato
          </button>
        )}
        {info.temRecibo && (
          <button type="button" onClick={() => abrir("recibo")} style={botao} title="Recibo de entrega da declaração (PDF)">
            🧾 Recibo
          </button>
        )}
      </span>
      {/* "Zerado" fica AQUI e não no rótulo do mês: é atributo da declaração transmitida, que é
          exatamente o assunto desta coluna. */}
      {info.semFaturamento && (
        <span title="Declaração do PGDAS-D transmitida sem valor — o mês foi marcado como sem faturamento"
          style={{ fontSize: "0.66rem", color: "#A7B0C0", whiteSpace: "nowrap" }}>
          ◌ zerado
        </span>
      )}
      {erro && <span style={{ fontSize: "0.62rem", color: "#FF5757", lineHeight: 1.25 }}>{erro}</span>}
    </span>
  );
}

export function CircularTab({
  companyId,
  circularData,
  loading,
  year,
  competencia,
  onCompetenciaChange,
  onYearChange,
  onLoad,
  accounts,
  companyRegime,  // regime tributário da empresa: filtra linhas exibidas (DAS só Simples; IRPJ/CSLL/PIS_COFINS/ISS só Presumido)
  companyName,    // só para o cabeçalho da impressão (o papel sai sem o header do app)
  onCreateBaixa,
  savingBaixa,
  onLoadBaixaTemplate,
  error,
  message,
  onUpdateEntry,
  onSearchHistoricos,
  onGetHistoricosByCode, // sugestão de contas por código no config de parcelamento
  onCancelBaixa,
  parcelamentos, // Q9: hook completo (parcelamentos, payParcela, rescindir, etc)
  onSaveCircular, // Frente B: salva acrescimos (principal/juros/multa) da circular
  savingCircular,
}) {
  const [baixaEntry, setBaixaEntry] = useState(null);
  // Busca o comprovante no SERPRO (custo por chamada → só sob clique). NÃO lança nada: marca a
  // guia como paga e guarda data/valores, que depois pré-preenchem o "Dar baixa".
  const [buscandoPagamento, setBuscandoPagamento] = useState(null);
  async function handleBuscarPagamento(entry) {
    const guideId = entry?.sourceGuide?.id;
    if (!guideId || !circularApi?.buscarPagamentoGuia || buscandoPagamento) return;
    setBuscandoPagamento(guideId);
    try {
      const r = await circularApi.buscarPagamentoGuia(guideId);
      if (r?.encontrado) {
        const c = r.comprovante;
        window.alert(c?.dataArrecadacao
          ? `Pagamento localizado em ${c.dataArrecadacao} — total R$ ${Number(c.total || 0).toFixed(2)}.

A baixa continua com você: use "Dar baixa" (já vem preenchida).`
          : "Pagamento localizado no SERPRO. Use \"Dar baixa\" para lançar.");
      } else {
        window.alert(r?.motivo || "Pagamento ainda não localizado no SERPRO.");
      }
      await onLoad?.();
    } catch (err) {
      window.alert(err?.message || "Falha ao buscar o pagamento no SERPRO.");
    } finally {
      setBuscandoPagamento(null);
    }
  }
  const [editEntry, setEditEntry] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancellingBaixaId, setCancellingBaixaId] = useState(null);
  const [imprimindo, setImprimindo] = useState(false);
  const currentYear = new Date().getFullYear();

  // Q31: o quadro NÃO mostra os lançamentos do parcelamento (subtipo PARC_*) — eles ficam só nos
  // cards de parcelamento abaixo. (Competências DAS/INSS vinculadas a um parcelamento continuam, em amarelo.)
  const quadroProvisoes = useMemo(
    () => (circularData?.provisoes || []).filter((p) => !String(p.subtipo || "").toUpperCase().startsWith("PARC")),
    [circularData],
  );

  const matrix = useMemo(() => {
    const map = {};
    for (const p of quadroProvisoes) {
      if (!p.subtipo) continue;
      const k = `${p.subtipo}__${p.competencia}`;
      const existing = map[k];
      if (!existing) { map[k] = p; continue; }
      const isTemplate = (e) => e.placeholder || e.origem === "TEMPLATE";
      if (isTemplate(existing) && !isTemplate(p)) { map[k] = p; continue; }
      // Provisão ainda com saldo (ABERTO ou PARCIAL) prevalece sobre uma duplicata PAGA.
      if (!isTemplate(existing) && ["ABERTO", "PARCIAL"].includes(p.statusPagamento) && !isTemplate(p)) { map[k] = p; }
    }
    return map;
  }, [quadroProvisoes]);

  // Linhas da matriz são filtradas em 2 passos:
  // 1) Por regime tributário da empresa (Simples não tem IRPJ/CSLL/etc; Presumido não tem DAS)
  // 2) Apenas linhas que tenham pelo menos 1 entrada com dados (estética — esconde linhas vazias)
  const visibleRows = useMemo(() => {
    const byRegime = getSubtipoRowsForRegime(companyRegime);
    const usedSubtipos = new Set(quadroProvisoes.map((p) => p.subtipo).filter(Boolean));
    return byRegime.filter((r) => usedSubtipos.has(r.key));
  }, [quadroProvisoes, companyRegime]);

  // ⚠ "Em aberto" DIVIDIDO em vencido × a vencer.
  // Um total único soma dívida atrasada com compromisso futuro e responde a pergunta errada: em
  // agosto, "R$ 8.400 em aberto" pode ser tudo vencido ou tudo com prazo, e é a diferença entre
  // pagar hoje com multa e programar. A separação sai de `totaisEmAberto` — a mesma regra que
  // pinta as células, para o rodapé não discordar da coluna acima dele.
  const abertoByMonth = useMemo(() => {
    const totals = {};
    const porMes = new Map();
    for (const p of quadroProvisoes) {
      if (!porMes.has(p.competencia)) porMes.set(p.competencia, []);
      porMes.get(p.competencia).push(p);
    }
    for (const [comp, itens] of porMes) {
      const t = totaisEmAberto(itens);
      totals[comp] = {
        vencido: t.vencido,
        // Parcial entra aqui pelo SALDO: tem prazo corrente e ainda deve.
        aVencer: t.aVencer + t.parcial,
        semData: t.semData,
        total: t.vencido + t.aVencer + t.parcial + t.semData,
      };
    }
    return totals;
  }, [quadroProvisoes]);

  const monthKeys = MONTH_LABELS.map((_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  // A coluna "Extrato" só aparece se ALGUM mês do ano tiver declaração/recibo do PGDAS-D. Coluna
  // vazia os doze meses seria largura tirada das que têm número — e no Lucro Presumido, onde não
  // existe PGDAS-D, ela nunca teria conteúdo nenhum.
  const temExtratoNoAno = monthKeys.some((c) => circularData?.extrato?.[c]);

  // Q31: quadro transposto — meses nas linhas, impostos nas colunas (+ Faturamento, Total em aberto).
  // Valor numérico de uma coluna num mês (impostos via matrix; colunas especiais por chave).
  const yy = String(year).slice(2);
  const cellNum = (colKey, comp) => {
    if (colKey === "__FAT__") return Number(circularData?.receitas?.[comp]) || 0;
    // Trimestre e ano continuam somando o TOTAL em aberto — a divisão vencido × a vencer é uma
    // leitura do mês, e agregar "vencido" num trimestre já encerrado não diria nada de novo.
    if (colKey === "__ABERTO__") return Number(abertoByMonth[comp]?.total) || 0;
    const e = matrix[`${colKey}__${comp}`];
    return e ? Number(e.totalD || e.valor || 0) : 0;
  };
  const sumQuarter = (colKey, qi) => monthKeys.slice(qi * 3, qi * 3 + 3).reduce((s, c) => s + cellNum(colKey, c), 0);
  const sumYear = (colKey) => monthKeys.reduce((s, c) => s + cellNum(colKey, c), 0);

  // Q31: parcelamentos ativos (pra vincular competências) + handlers de vínculo (só marca).
  const parcelamentosAtivos = (parcelamentos?.parcelamentos || []).filter((p) => p.status === "ATIVO");
  async function handleVincular(entry, parcId) {
    if (!parcelamentos?.vincularEntry) return;
    await parcelamentos.vincularEntry(entry.id, parcId);
    await onLoad(year, competencia);
  }
  async function handleDesvincular(entry) {
    if (!parcelamentos?.vincularEntry) return;
    await parcelamentos.vincularEntry(entry.id, null);
    await onLoad(year, competencia);
  }

  // Estilos do quadro transposto — TODAS as colunas com a mesma largura (COL_W).
  const headCellStyle = { width: COL_W, minWidth: COL_W, padding: "8px 6px", textAlign: "center", fontSize: "0.82rem", fontWeight: 700, color: "#F8F8F2", letterSpacing: "0.01em", borderRight: "1px solid #44475A", borderBottom: "2px solid #44475A", lineHeight: 1.2 };
  const headStickyStyle = { ...headCellStyle, textAlign: "center", position: "sticky", left: 0, background: "#282A36", zIndex: 10 };
  const monthStickyStyle = { width: COL_W, minWidth: COL_W, padding: "8px 8px", fontWeight: 700, fontSize: "0.9rem", textAlign: "center", borderRight: "2px solid #44475A", borderBottom: "1px solid #44475A", position: "sticky", left: 0, background: "#21222C", zIndex: 5, whiteSpace: "nowrap", color: "#F8F8F2" };
  const extraCellStyle = { width: COL_W, minWidth: COL_W, padding: "8px 6px", textAlign: "center", borderRight: "1px solid #44475A", fontSize: "0.9rem" };
  const subCellStyle = { width: COL_W, minWidth: COL_W, padding: "8px 6px", textAlign: "center", borderRight: "1px solid #44475A", fontSize: "0.9rem", color: "#F8F8F2" };

  async function handleEditSave(form) {
    if (!editEntry) return;
    setSavingEdit(true);
    try {
      // 1) Lançamento real (DAS/LP): atualiza a entry. INSS sintético não tem lançamento — pula.
      // Propaga exceção para o modal exibir o erro inline (handleUpdateEntry engole via try/catch;
      // por isso validamos o retorno: se vier { ok:false } do backend, lança).
      if (!editEntry.synthetic && onUpdateEntry) {
        const result = await onUpdateEntry(editEntry.id, form);
        if (result && result.ok === false) {
          throw new Error(result.error || result.message || "Falha ao salvar lançamento.");
        }
      }
      // 2) Acréscimo (juros/multa; e o principal, no caso do INSS) → acrescimos da circular.
      if (Array.isArray(form.acrescimoTributos) && onSaveCircular) {
        const comp = editEntry.competencia;
        const merged = { ...(circularData?.acrescimos?.[comp] || {}) };
        for (const t of form.acrescimoTributos) {
          const existing = merged[t.key] || {};
          merged[t.key] = {
            // principal só é editado no modo INSS; nos demais, preserva o existente.
            principal: t.principal !== undefined ? numOrNull(t.principal) : (existing.principal ?? null),
            juros: numOrNull(t.juros),
            multa: numOrNull(t.multa),
          };
        }
        await onSaveCircular({ competencia: comp, acrescimos: merged });
      }
      await onLoad(year, competencia);
      setEditEntry(null);
    } finally {
      setSavingEdit(false);
    }
  }

  // Frente B: acréscimo (juros/multa) agregado por célula subtipo×mês.
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const numOrNull = (s) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? r2(v) : 0; };
  function acrescimoFor(colKey, comp) {
    const keys = SUBTIPO_TO_ACRESCIMO[colKey];
    if (!keys) return null;
    const src = circularData?.acrescimos?.[comp];
    if (!src) return null;
    let principal = 0, juros = 0, multa = 0;
    for (const k of keys) {
      const t = src[k];
      if (t) { principal += Number(t.principal) || 0; juros += Number(t.juros) || 0; multa += Number(t.multa) || 0; }
    }
    // Ignora acréscimo "vazio" (tudo zero) — evita célula-fantasma "R$ 0,00" e badge sem valor.
    if (r2(principal) <= 0 && r2(juros) <= 0 && r2(multa) <= 0) return null;
    return { principal: r2(principal), juros: r2(juros), multa: r2(multa), acrescimo: r2(juros + multa) };
  }
  // Recebe UM id ou a LISTA de ids do lote (principal + juros + multa). Cancelar parcialmente
  // deixaria lançamentos órfãos e a guia reaberta — o pior dos dois mundos.
  // IMPRESSÃO — mesma mecânica da listagem, e de propósito: o clique só liga a flag, e quem chama
  // `window.print()` é o efeito, DEPOIS do render. Chamar no clique imprimiria o DOM anterior.
  // A CSS é a compartilhada (`body.imprimindo` + `data-print-area`, em App.css).
  useEffect(() => {
    if (!imprimindo) return undefined;
    document.body.classList.add("imprimindo");
    const limpar = () => setImprimindo(false);
    window.addEventListener("afterprint", limpar);
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("afterprint", limpar);
      document.body.classList.remove("imprimindo");
    };
  }, [imprimindo]);

  async function handleCancelBaixa(ids) {
    if (!onCancelBaixa) return;
    const lista = Array.isArray(ids) ? ids.filter(Boolean) : [ids].filter(Boolean);
    if (!lista.length) return;
    // ⚠ Isto APAGA lançamentos contábeis (até três: principal, juros, multa) e REABRE a guia. Não
    // tinha confirmação nenhuma, enquanto excluir um lançamento pela aba Lançamentos tinha — o
    // mesmo estrago, por um caminho mais curto. O texto diz quantos vão embora.
    const quantos = lista.length > 1 ? `${lista.length} lançamentos de baixa` : "o lançamento de baixa";
    if (!window.confirm(`Desfazer a baixa?\n\nIsto apaga ${quantos} e reabre a guia como não paga.`)) return;
    setCancellingBaixaId(lista[0]);
    try {
      // Sequencial de propósito: a rota reabre a guia ao apagar, e disparar em paralelo deixaria a
      // ordem das reaberturas ao acaso.
      for (const id of lista) {
        // eslint-disable-next-line no-await-in-loop
        await onCancelBaixa(id);
      }
      await onLoad(year, competencia);
    } finally {
      setCancellingBaixaId(null);
    }
  }

  return (
    /* Margem lateral pela token compartilhada (~5%): a matriz é 12 meses × N tributos e é a tela
       que mais ganha com largura — cada coluna visível é uma rolagem horizontal a menos. */
    <div style={{ padding: "var(--space-3) var(--content-gutter)", width: "100%", background: "#1A1B26", minHeight: "100%", boxSizing: "border-box" }}>
      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700, color: "#F8F8F2" }}>Circular</h2>

        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <button
            onClick={() => onYearChange(year - 1)}
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              width: 28, height: 28, cursor: "pointer", fontSize: "0.875rem",
            }}
          >
            ←
          </button>
          <span style={{ fontWeight: 700, fontSize: "1rem", minWidth: 48, textAlign: "center", color: "#F8F8F2" }}>{year}</span>
          <button
            onClick={() => onYearChange(year + 1)}
            disabled={year >= currentYear + 1}
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              width: 28, height: 28, cursor: year >= currentYear + 1 ? "default" : "pointer",
              fontSize: "0.875rem", opacity: year >= currentYear + 1 ? 0.4 : 1,
            }}
          >
            →
          </button>
          <button
            onClick={() => onLoad(year)}
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              height: 28, padding: "0 10px", cursor: "pointer", fontSize: "0.8125rem",
            }}
          >
            Atualizar
          </button>
          <button
            onClick={() => setImprimindo(true)}
            title="Imprimir o extrato anual (ou salvar em PDF)."
            style={{
              background: "#24253A", border: "1px solid #44475A", borderRadius: 4, color: "#F8F8F2",
              height: 28, padding: "0 10px", cursor: "pointer", fontSize: "0.8125rem",
            }}
          >
            🖨 Imprimir
          </button>
        </div>
      </div>

      {/* Feedback */}
      {(error || message) && (
        <div style={{ marginBottom: 12, display: "grid", gap: 6 }}>
          {error && (
            <div style={{ padding: "10px 14px", borderRadius: 6, background: "#3d1515", border: "1px solid #7f1d1d", color: "#fca5a5", fontSize: "0.8125rem" }}>
              {error}
            </div>
          )}
          {message && (
            <div style={{ padding: "10px 14px", borderRadius: 6, background: "#0d2d1e", border: "1px solid #166534", color: "#86efac", fontSize: "0.8125rem" }}>
              {message}
            </div>
          )}
        </div>
      )}

      {/* Operações Fiscais removidas: ações (Buscar Guias, Verificar Pagtos, Sincronizar INSS)
          ficam nas abas Guias/Configurações; Circular foca só na tabela. */}

      {loading && (
        <p style={{ color: "#6272A4", textAlign: "center", padding: 32 }}>Carregando...</p>
      )}

      {!loading && !circularData && (
        <p style={{ color: "#6272A4", textAlign: "center", padding: 32 }}>
          Nenhum dado disponível. Clique em Atualizar.
        </p>
      )}

      {!loading && circularData && (
        <div data-print-area>
          {/* Cabeçalho que só existe no PAPEL: a folha sai sem o header do app, e uma tabela de
              12 meses sem empresa nem ano é indistinguível da de qualquer outra empresa. */}
          <div data-print-only style={{ display: "none" }}>
            <h2 style={{ margin: "0 0 2px" }}>Extrato anual de guias — {year}</h2>
            <p style={{ margin: "0 0 10px", fontSize: "0.85rem" }}>
              {companyName || ""}{companyName ? " · " : ""}Emitido em {new Date().toLocaleDateString("pt-BR")}
            </p>
          </div>
          <div data-print-tabela style={{ overflowX: "auto", border: "1px solid #44475A", borderRadius: 6, background: "#21222C" }}>
          <table style={{ width: (1 + visibleRows.length + 2 + (temExtratoNoAno ? 1 : 0)) * COL_W, minWidth: "100%", borderCollapse: "collapse", tableLayout: "fixed", color: "#F8F8F2" }}>
            <thead>
              <tr style={{ background: "#282A36" }}>
                <th style={headStickyStyle}>Mês</th>
                {visibleRows.map((col) => (
                  <th key={col.key} style={headCellStyle}>{col.label}</th>
                ))}
                <th style={{ ...headCellStyle, color: "#8BE9FD" }}>Faturamento</th>
                <th style={{ ...headCellStyle, color: "#FF4757" }}>Total em aberto</th>
                {/* Coluna própria para os PDFs do PGDAS-D — antes eram dois links miúdos dentro da
                    célula do mês. Só existe quando ALGUM mês do ano tem documento: coluna vazia o
                    ano inteiro é largura tirada das que têm número. */}
                {temExtratoNoAno && <th style={headCellStyle}>Extrato</th>}
              </tr>
            </thead>
            <tbody>
              {/* `visibleRows` são as COLUNAS de tributo, não as linhas de dados. Usar isso como
                  "está vazio" fazia a Circular dizer "Nenhuma provisão registrada" com a tabela
                  mostrando valor em aberto — a provisão vinha de origem que não gera coluna
                  (INSS/DAS sintéticos). Agora só declara vazio quando NÃO HÁ NADA no ano. */}
              {visibleRows.length === 0 && sumYear("__ABERTO__") === 0 && sumYear("__FAT__") === 0 && (
                <tr>
                  <td colSpan={3 + visibleRows.length + (temExtratoNoAno ? 1 : 0)} style={{ padding: 24, textAlign: "center", color: "#aeb6d3", fontStyle: "italic" }}>
                    Nenhuma provisão registrada para {year}.
                  </td>
                </tr>
              )}
              {monthKeys.flatMap((comp, i) => {
                const fat = circularData.receitas?.[comp];
                const aberto = abertoByMonth[comp];
                const rows = [(
                  <tr key={comp}>
                    <td style={monthStickyStyle}>
                      {MONTH_LABELS[i]}/{yy}
                    </td>
                    {visibleRows.map((col) => (
                      <PagamentoCell
                        key={col.key}
                        entry={matrix[`${col.key}__${comp}`]}
                        onBaixa={(entry) => setBaixaEntry(entry)}
                        onBuscarPagamento={handleBuscarPagamento}
                        onEdit={(onUpdateEntry || onSaveCircular) ? (entry) => setEditEntry(entry) : null}
                        onCancelBaixa={onCancelBaixa ? handleCancelBaixa : null}
                        parcelamentosAtivos={parcelamentosAtivos}
                        onVincular={parcelamentos?.vincularEntry ? handleVincular : null}
                        onDesvincular={handleDesvincular}
                        acrescimo={acrescimoFor(col.key, comp)}
                      />
                    ))}
                    <td style={extraCellStyle}>{fat ? <span style={{ color: "#8BE9FD", fontWeight: 700 }}>R$ {fmtValor(fat)}</span> : <span style={{ color: "#44475A" }}>—</span>}</td>
                    {/* Vencido em VERMELHO, a vencer em ÂMBAR — e cada um com o seu rótulo, porque
                        cor sozinha não é estado (princípio 2). Nada em aberto vira "—", não "R$ 0,00":
                        zero e ausência se leem igual num relance e significam a mesma coisa aqui. */}
                    <td style={extraCellStyle}>
                      {aberto?.total ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "center" }}>
                          {aberto.vencido > 0 && (
                            <span style={{ color: "#FF4757", fontWeight: 700, whiteSpace: "nowrap" }} title="Guias que já passaram do vencimento.">
                              R$ {fmtValor(aberto.vencido)} <span style={{ fontSize: "0.62rem", fontWeight: 600 }}>vencido</span>
                            </span>
                          )}
                          {aberto.aVencer > 0 && (
                            <span style={{ color: "#FFB347", fontWeight: 700, whiteSpace: "nowrap" }} title="Guias em aberto ainda dentro do prazo.">
                              R$ {fmtValor(aberto.aVencer)} <span style={{ fontSize: "0.62rem", fontWeight: 600 }}>a vencer</span>
                            </span>
                          )}
                          {/* Rótulo próprio: chamar isto de "a vencer" seria afirmar um prazo que
                              a célula acima se recusa a afirmar. */}
                          {aberto.semData > 0 && (
                            <span style={{ color: "#FFB347", fontWeight: 700, whiteSpace: "nowrap" }} title="Em aberto — o vencimento destas guias não é conhecido, então não dá para dizer se já venceram.">
                              R$ {fmtValor(aberto.semData)} <span style={{ fontSize: "0.62rem", fontWeight: 600 }}>em aberto</span>
                            </span>
                          )}
                        </div>
                      ) : <span style={{ color: "#44475A" }}>—</span>}
                    </td>
                    {temExtratoNoAno && (
                      <td style={extraCellStyle}>
                        {circularData.extrato?.[comp]
                          ? <ExtratoDoMes comp={comp} info={circularData.extrato[comp]} companyId={companyId} />
                          : <span style={{ color: "#44475A" }}>—</span>}
                      </td>
                    )}
                  </tr>
                )];
                if ((i + 1) % 3 === 0) {
                  const qi = Math.floor(i / 3);
                  const triStyle = { ...subCellStyle, fontWeight: 700, borderTop: "2px solid #44475A", borderBottom: "2px solid #44475A" };
                  rows.push(
                    <tr key={`q${qi}`} style={{ background: "#282A36" }}>
                      <td style={{ ...monthStickyStyle, background: "#282A36", color: "#aeb6d3", fontWeight: 700, borderTop: "2px solid #44475A", borderBottom: "2px solid #44475A" }}>{qi + 1}º Trimestre</td>
                      {visibleRows.map((col) => { const v = sumQuarter(col.key, qi); return <td key={col.key} style={{ ...triStyle, color: "#aeb6d3" }}>{v ? `R$ ${fmtValor(v)}` : "—"}</td>; })}
                      {(() => { const v = sumQuarter("__FAT__", qi); return <td style={{ ...triStyle, color: "#8BE9FD" }}>{v ? `R$ ${fmtValor(v)}` : "—"}</td>; })()}
                      {(() => { const v = sumQuarter("__ABERTO__", qi); return <td style={{ ...triStyle, color: "#FF4757" }}>{v ? `R$ ${fmtValor(v)}` : "—"}</td>; })()}
                      {/* Não há "extrato do trimestre" — a declaração é mensal. Célula vazia para a
                          linha não ficar com uma coluna a menos e desalinhar a grade inteira. */}
                      {temExtratoNoAno && <td style={triStyle} />}
                    </tr>
                  );
                }
                return rows;
              })}
              {/* Anual */}
              <tr style={{ background: "#1f2030", borderTop: "3px solid #44475A" }}>
                <td style={{ ...monthStickyStyle, background: "#1f2030", fontWeight: 800 }}>Anual</td>
                {visibleRows.map((col) => { const v = sumYear(col.key); return <td key={col.key} style={{ ...subCellStyle, fontWeight: 800 }}>{v ? `R$ ${fmtValor(v)}` : "—"}</td>; })}
                {(() => { const v = sumYear("__FAT__"); return <td style={{ ...subCellStyle, fontWeight: 800, color: "#8BE9FD" }}>{v ? `R$ ${fmtValor(v)}` : "—"}</td>; })()}
                {(() => { const v = sumYear("__ABERTO__"); return <td style={{ ...subCellStyle, fontWeight: 800, color: "#FF4757" }}>{v ? `R$ ${fmtValor(v)}` : "—"}</td>; })()}
                {temExtratoNoAno && <td style={subCellStyle} />}
              </tr>
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Parcelamentos foram movidos pra aba própria "Parcelamento" (grupo Contabilidade). */}

      {/* Baixa Modal */}
      {baixaEntry && (
        <BaixaModal
          entry={baixaEntry}
          accounts={accounts}
          saving={savingBaixa}
          onSave={async (input) => {
            await onCreateBaixa(baixaEntry.id, input);
            await onLoad(year, competencia);
            setBaixaEntry(null);
          }}
          onClose={() => setBaixaEntry(null)}
          onLoadBaixaTemplate={onLoadBaixaTemplate}
        />
      )}

      {/* Entry Edit Modal — inclui juros/multa (e valor, p/ INSS sintético) na mesma tela. */}
      {editEntry && (
        <CircularEntryEditModal
          entry={editEntry}
          accounts={accounts || []}
          saving={savingEdit}
          onSave={handleEditSave}
          onClose={() => setEditEntry(null)}
          onSearchHistoricos={onSearchHistoricos}
          acrescimosComp={circularData?.acrescimos?.[editEntry.competencia] || {}}
        />
      )}
    </div>
  );
}

