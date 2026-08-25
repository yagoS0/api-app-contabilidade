import { memo, useState } from "react";
import { Button } from "../../../../components/ui/Button";
import { fmtValor } from "../../entries/lib/accountingEntriesShared";
import { historicoSugeridoDaLinha } from "../lib/historicoSugerido";
import { contasSugeriveis, sinteticasNasLinhas } from "../../entries/lib/contaSintetica";

const PANEL = {
  surface: "#24253A",
  field: "#1A1B26",
  border: "#44475A",
  text: "#F8F8F2",
  muted: "#6272A4",
  accent: "#BD93F9",
};

const overlay = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1100,
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const modalBox = {
  background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10,
  padding: 22, width: 1100, maxWidth: "100%", maxHeight: "92vh", overflowY: "auto",
  color: PANEL.text, boxSizing: "border-box",
};
const inputStyle = {
  background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6,
  color: PANEL.text, padding: "6px 8px", fontSize: "0.85rem", width: "100%", boxSizing: "border-box",
};
const headStyle = {
  padding: "8px 6px", textAlign: "left", color: "#aeb6d3", fontSize: "0.75rem",
  fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em",
  borderBottom: `1px solid ${PANEL.border}`, background: PANEL.field,
};

function fmtDateBR(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ⚠ Referência ESTÁVEL para "sem contas" — `accounts = []` no parâmetro cria um array NOVO a cada
// render, e array novo derrota a memoização abaixo em silêncio.
const SEM_CONTAS = [];

// O `<datalist>` do plano de contas era montado UMA VEZ POR LINHA (e mais duas no preenchimento em
// lote), cada um com uma `<option>` por conta — e todos os `id` eram diferentes só por cópia-e-cola:
// o conteúdo era idêntico. Com o plano real desta base (593 a 1.199 contas), 10 linhas custavam
// ~197 ms POR TECLA no Chrome; 50 linhas, ~747 ms. Agora é UM `<datalist>` para o modal inteiro,
// e ele é memoizado — `accounts` não muda enquanto se digita, então o React pula a subárvore.
// ⚠ Sem `areEqual` customizado: a comparação rasa padrão está correta, e comparador à mão é o
// caminho conhecido para o campo parar de atualizar.
const ID_LISTA_CONTAS = "excel-acc";
const ListaDeContas = memo(function ListaDeContas({ id, accounts }) {
  // ⚠ A SINTÉTICA SAI DA OFERTA, igual aos dropdowns da tela de lançar: oferecer é o sistema
  // dizendo "use esta", e o servidor recusa a linha que a usa. Ela continua DIGITÁVEL — o campo é
  // livre —, e é aí que a linha aparece bloqueada com o motivo.
  const oferecidas = contasSugeriveis(accounts);
  return (
    <datalist id={id}>
      {oferecidas.map((a) => <option key={a.codigo} value={a.codigo}>{a.codigo} — {a.nome}</option>)}
    </datalist>
  );
});

export function ImportExcelModal({ accounts = SEM_CONTAS, onPreview, onCommit, onClose }) {
  const [step, setStep] = useState("upload"); // "upload" | "review"
  const [file, setFile] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [bulkD, setBulkD] = useState("");
  const [bulkC, setBulkC] = useState("");

  async function handlePreview() {
    if (!file) { setError("Selecione um arquivo Excel."); return; }
    setError("");
    setLoading(true);
    try {
      const res = await onPreview(file);
      const list = Array.isArray(res?.transactions) ? res.transactions : [];
      if (list.length === 0) {
        setError("Nenhuma transação encontrada no arquivo.");
        return;
      }
      // Hidrata cada linha com contas a partir do match (se houver) e com o histórico SUGERIDO.
      // ⚠ A sugestão nasce preenchida e é EDITÁVEL — o contador escreve por cima antes de importar.
      const hydrated = list.map((t) => ({
        ...t,
        contaDebito: t.match?.contaDebito || "",
        contaCredito: t.match?.contaCredito || "",
        historico: historicoSugeridoDaLinha(t),
        skip: false,
      }));
      setTransactions(hydrated);
      setStep("review");
    } catch (err) {
      setError(err?.message || "Falha ao processar Excel.");
    } finally {
      setLoading(false);
    }
  }

  function updateRow(idx, patch) {
    setTransactions((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function applyBulkFill() {
    if (!bulkD && !bulkC) return;
    setTransactions((prev) => prev.map((r) => {
      if (r.contaDebito && r.contaCredito) return r; // já preenchidas — não mexe
      return {
        ...r,
        contaDebito: r.contaDebito || bulkD,
        contaCredito: r.contaCredito || bulkC,
      };
    }));
  }

  const totalRows = transactions.length;
  const matchedRows = transactions.filter((t) => t.match).length;
  const pendingRows = transactions.filter((t) => !t.match).length;
  /**
   * ⚠ LINHA EM CONTA SINTÉTICA NÃO É ENVIADA — e o motivo aparece ANTES do clique.
   *
   * O servidor recusa a linha (`reason: "conta_sintetica"` no `failed[]`), e a tela só mostrava uma
   * CONTAGEM de falhas: o contador via "(1 falha)" sem saber qual linha nem por quê. Mandar para
   * ser recusado é o mesmo que recusar mudo. Aqui a linha simplesmente não conta como pronta, com o
   * nome da conta à vista — e continua editável, que é a saída.
   *
   * (Dos 6 lançamentos hoje em conta de agregação na base real, 4 vieram deste import.)
   */
  const sinteticasDaLinha = (t) => sinteticasNasLinhas(
    [{ conta: t.contaDebito }, { conta: t.contaCredito }], accounts,
  );
  const bloqueadasPorSintetica = transactions.filter((t) => !t.skip && sinteticasDaLinha(t).length > 0);
  const completeRows = transactions.filter(
    (t) => (t.contaDebito || t.contaCredito) && !t.skip && sinteticasDaLinha(t).length === 0,
  ).length;
  const skipRows = transactions.filter((t) => t.skip).length;
  const canCommit = completeRows > 0 && !saving;

  async function handleCommit() {
    setError("");
    const toSend = transactions
      .filter((t) => !t.skip && (t.contaDebito || t.contaCredito) && sinteticasDaLinha(t).length === 0)
      .map((t) => ({
        rowIndex: t.rowIndex,
        data: t.data,
        // `descricao` continua sendo o texto CRU da planilha (a chave de match e, agora, a coluna
        // `descricaoImportacao` do lançamento). `historico` é o que o contador confirmou aqui.
        descricao: t.descricao,
        historico: String(t.historico || "").trim() || t.descricao,
        valor: Number(t.valor),
        contaDebito: t.contaDebito,
        contaCredito: t.contaCredito,
        tipo: "DESPESA",
      }));
    if (toSend.length === 0) {
      setError("Nenhum lançamento pronto para importar.");
      return;
    }
    setSaving(true);
    try {
      const res = await onCommit(toSend);
      if (res?.ok) {
        onClose();
      } else {
        setError(res?.message || "Falha ao importar.");
      }
    } catch (err) {
      setError(err?.message || "Falha ao importar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={modalBox}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>Importar Excel</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: PANEL.muted, fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>

        {step === "upload" && (
          <div>
            <p style={{ fontSize: "0.85rem", color: PANEL.muted, margin: "0 0 12px" }}>
              Formato esperado: planilha com colunas <strong>Data | Descrição | Valor</strong> (cabeçalho opcional).
              O sistema casa as descrições com históricos já cadastrados para preencher automaticamente as contas. Descrições novas ficam pendentes para você declarar — e a partir dali ficam memorizadas para próximos imports.
              O <strong>histórico do lançamento</strong> vem sugerido (<em>PAGO</em> + descrição, ou o que você já escreveu antes para aquela descrição) e é <strong>editável</strong> linha a linha: nada é gravado sem você ver.
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                style={{ ...inputStyle, padding: "8px 10px", flex: "1 1 320px" }}
              />
              <Button variant="primary" onClick={handlePreview} disabled={!file || loading}>
                {loading ? "Lendo..." : "Pré-visualizar"}
              </Button>
            </div>
            {error && (
              <div style={{ marginTop: 12, padding: 8, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", borderRadius: 6, color: "#FF5757", fontSize: "0.8125rem" }}>
                {error}
              </div>
            )}
          </div>
        )}

        {step === "review" && (
          <div>
            <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: "0.85rem", flexWrap: "wrap" }}>
              <span><strong style={{ color: "var(--success)" }}>{matchedRows}</strong> casadas</span>
              <span><strong style={{ color: "#FFB347" }}>{pendingRows}</strong> pendentes</span>
              <span><strong style={{ color: PANEL.accent }}>{completeRows}</strong> prontas para importar</span>
              {skipRows > 0 && <span><strong style={{ color: PANEL.muted }}>{skipRows}</strong> ignoradas</span>}
              <span style={{ color: PANEL.muted }}>{totalRows} no total</span>
            </div>

            {/* ⚠ O bloqueio se explica ANTES do clique, e NOMEIA a linha e a conta — o servidor
                recusaria estas linhas de qualquer forma, e devolver só uma contagem de falhas no
                fim é a recusa muda que este aviso existe para evitar. */}
            {bloqueadasPorSintetica.length > 0 && (
              <div style={{ marginBottom: 12, fontSize: "0.8125rem", color: "#FF5757", fontWeight: 600 }}>
                {bloqueadasPorSintetica.length === 1 ? "1 linha não será importada" : `${bloqueadasPorSintetica.length} linhas não serão importadas`}
                {" — conta sintética (de agregação) não recebe lançamento: "}
                {[...new Set(bloqueadasPorSintetica.flatMap((t) => sinteticasDaLinha(t).map((s) => `${s.codigo} ${s.nome}`)))].join(", ")}
                <span style={{ fontWeight: 400, color: PANEL.muted }}> — troque por uma analítica abaixo dela, ou ignore a linha.</span>
              </div>
            )}

            <div style={{ overflowX: "auto", borderRadius: 8, border: `1px solid ${PANEL.border}`, marginBottom: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th style={{ ...headStyle, width: 100 }}>Data</th>
                    <th style={{ ...headStyle, width: 220 }}>Descrição (planilha)</th>
                    <th style={{ ...headStyle, minWidth: 220 }}>Histórico (lançamento)</th>
                    <th style={{ ...headStyle, width: 110, textAlign: "right" }}>Valor (R$)</th>
                    <th style={{ ...headStyle, width: 110, textAlign: "center" }}>Débito</th>
                    <th style={{ ...headStyle, width: 110, textAlign: "center" }}>Crédito</th>
                    <th style={{ ...headStyle, width: 130 }}>Status</th>
                    <th style={{ ...headStyle, width: 60, textAlign: "center" }}>Pular</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((t, idx) => {
                    const ready = t.contaDebito && t.contaCredito;
                    const matched = Boolean(t.match);
                    const bg = t.skip
                      ? "transparent"
                      : matched && ready
                      ? "rgba(105,255,71,0.05)"
                      : !matched
                      ? "rgba(255,179,71,0.05)"
                      : "transparent";
                    return (
                      <tr key={idx} style={{ background: bg, borderBottom: `1px solid ${PANEL.border}`, opacity: t.skip ? 0.4 : 1 }}>
                        <td style={{ padding: "5px 8px", whiteSpace: "nowrap" }}>{fmtDateBR(t.data)}</td>
                        <td style={{ padding: "5px 8px", color: PANEL.muted }}>{t.descricao}</td>
                        <td style={{ padding: "5px 8px" }}>
                          {/* SUGESTÃO editável: nasce com "PAGO " + descrição (ou com o histórico
                              que a memória já guardava) e o contador escreve por cima. */}
                          <input
                            type="text"
                            value={t.historico || ""}
                            onChange={(e) => updateRow(idx, { historico: e.target.value })}
                            placeholder="Histórico do lançamento"
                            disabled={t.skip}
                            aria-label={`Histórico da linha ${t.rowIndex}`}
                            style={inputStyle}
                          />
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "right", whiteSpace: "nowrap" }}>{fmtValor(t.valor)}</td>
                        <td style={{ padding: "5px 8px" }}>
                          <input
                            type="text"
                            list={ID_LISTA_CONTAS}
                            value={t.contaDebito || ""}
                            onChange={(e) => updateRow(idx, { contaDebito: e.target.value })}
                            placeholder="—"
                            disabled={t.skip}
                            style={{ ...inputStyle, fontWeight: 700, color: t.contaDebito ? "#8BE9FD" : PANEL.muted, textAlign: "center" }}
                          />
                        </td>
                        <td style={{ padding: "5px 8px" }}>
                          <input
                            type="text"
                            list={ID_LISTA_CONTAS}
                            value={t.contaCredito || ""}
                            onChange={(e) => updateRow(idx, { contaCredito: e.target.value })}
                            placeholder="—"
                            disabled={t.skip}
                            style={{ ...inputStyle, fontWeight: 700, color: t.contaCredito ? "var(--success)" : PANEL.muted, textAlign: "center" }}
                          />
                        </td>
                        <td style={{ padding: "5px 8px", fontSize: "0.78rem" }}>
                          {t.skip ? <span style={{ color: PANEL.muted }}>—</span>
                            : matched ? (
                              <span style={{ color: "var(--success)" }}>
                                ✓ {t.match.matchType === "exact" ? "Casou" : "Parcial"}
                              </span>
                            ) : ready ? (
                              <span style={{ color: PANEL.accent }}>✓ Pronto</span>
                            ) : (
                              <span style={{ color: "#FFB347" }}>⚠ Pendente</span>
                            )}
                        </td>
                        <td style={{ padding: "5px 8px", textAlign: "center" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(t.skip)}
                            onChange={(e) => updateRow(idx, { skip: e.target.checked })}
                            style={{ width: 16, height: 16, cursor: "pointer", accentColor: PANEL.accent }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* UMA lista para o modal inteiro — a tabela e o preenchimento em lote apontam para ela. */}
            <ListaDeContas id={ID_LISTA_CONTAS} accounts={accounts} />

            {pendingRows > 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: 10, background: PANEL.field, borderRadius: 6, marginBottom: 12 }}>
                <span style={{ fontSize: "0.78rem", color: PANEL.muted }}>Aplicar a todas pendentes:</span>
                <input
                  type="text"
                  list={ID_LISTA_CONTAS}
                  value={bulkD}
                  onChange={(e) => setBulkD(e.target.value)}
                  placeholder="Débito"
                  style={{ ...inputStyle, width: 110, fontWeight: 700, color: bulkD ? "#8BE9FD" : PANEL.muted, textAlign: "center" }}
                />
                <input
                  type="text"
                  list={ID_LISTA_CONTAS}
                  value={bulkC}
                  onChange={(e) => setBulkC(e.target.value)}
                  placeholder="Crédito"
                  style={{ ...inputStyle, width: 110, fontWeight: 700, color: bulkC ? "var(--success)" : PANEL.muted, textAlign: "center" }}
                />
                <Button variant="secondary" size="sm" onClick={applyBulkFill} disabled={!bulkD && !bulkC}>
                  Aplicar
                </Button>
              </div>
            )}

            {error && (
              <div style={{ marginBottom: 10, padding: 8, background: "rgba(255,87,87,0.15)", border: "1px solid #FF5757", borderRadius: 6, color: "#FF5757", fontSize: "0.8125rem" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => { setStep("upload"); setTransactions([]); setError(""); }}>Voltar</Button>
              <Button variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button variant="primary" onClick={handleCommit} disabled={!canCommit}>
                {saving ? "Importando..." : `Importar ${completeRows} ${completeRows === 1 ? "linha" : "linhas"}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
