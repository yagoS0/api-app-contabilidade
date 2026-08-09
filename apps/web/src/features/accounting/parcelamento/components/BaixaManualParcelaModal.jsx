// DECLARAR A BAIXA DE UMA PRESTAÇÃO SEM GUIA (débito automático).
//
// ⚠ ESTA TELA NÃO É A OUTRA. A fila "Parcelas pagas aguardando lançamento" tem um botão só: o
// documento já traz data, principal, juros e multa, e o contador apenas manda lançar. Aqui não
// existe documento nenhum — juros e multa são DECLARADOS, e o servidor recusa (409
// `CONFERENCIA_DIVERGENTE`) todo total que não bata com `principal + juros + multa`, porque ele
// **não** deriva o acréscimo por subtração. Então a conta tem de fechar na tela, à vista, ANTES.
//
// ⚠ E ELA DIZ QUE É DECLARAÇÃO, NÃO PROVA. O dado gravado é `origemBaixa: "MANUAL"`, `origem:
// "MANUAL"` no lançamento e "(declarado)" no histórico do razão. Quando a via SERPRO existir
// (`DETPAGTOPARC165`), ela gravará outra coisa — e quem auditar depois precisa conseguir
// distinguir "o contador afirmou" de "a Receita provou". Se a tela não disser qual das duas está
// acontecendo, a distinção só existe no banco.

import { useMemo, useState } from "react";
import {
  decomporBaixa, lancamentosPrevistos, formatarMoeda, textoDaConfirmacao, explicarRecusa,
  codigoDaRecusa,
} from "../lib/baixaManualParcela";

const PANEL = { text: "#F8F8F2", muted: "#A7B0C0", border: "#44475A", surface: "#21222C", field: "#282A36" };

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6,
  background: PANEL.field, border: `1px solid ${PANEL.border}`, color: PANEL.text,
  fontSize: "0.85rem", fontFamily: "monospace",
};
const labelStyle = { display: "block", fontSize: "0.7rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 };

export function BaixaManualParcelaModal({ linha, onConfirmar, onClose }) {
  const [textoJuros, setTextoJuros] = useState("");
  const [textoMulta, setTextoMulta] = useState("");
  const [dataPagamento, setDataPagamento] = useState(hojeISO());
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState(null);

  const decomposicao = useMemo(
    () => decomporBaixa({ valorPrevisto: linha?.valorPrevisto, textoJuros, textoMulta }),
    [linha?.valorPrevisto, textoJuros, textoMulta],
  );
  const linhasPrevistas = useMemo(() => lancamentosPrevistos(decomposicao), [decomposicao]);

  // ⚠ DESABILITADO SEMPRE COM O MOTIVO — o projeto proíbe o contrário, e aqui há quatro motivos
  // possíveis. `motivoBloqueio` vem do servidor (provisão de abertura ausente, valor previsto
  // ausente); os outros dois nascem do que está digitado.
  const bloqueio = linha?.motivoBloqueio
    ? explicarRecusa(linha.motivoBloqueio)
    : (!decomposicao.ok ? decomposicao.mensagem : (!dataPagamento ? "Informe a data em que o débito saiu da conta." : null));

  async function confirmar() {
    if (bloqueio || enviando) return;
    // ⚠ ATO DE CONSEQUÊNCIA CONFIRMA REPETINDO OS DADOS — prestação, contrato, os três valores, o
    // total e a data, mais o aviso de que isto é declaração.
    // eslint-disable-next-line no-alert
    if (!window.confirm(textoDaConfirmacao({ linha, decomposicao, dataPagamento }))) return;
    setRecusa(null);
    setEnviando(true);
    try {
      await onConfirmar({
        parcelaId: linha.parcelaId,
        dataPagamento,
        valorJuros: decomposicao.juros,
        valorMulta: decomposicao.multa,
        // O número que o contador ACABOU de ler na tela — é ele que o servidor confere.
        totalConferido: decomposicao.total,
      });
    } catch (err) {
      // ⚠ A RECUSA FICA NO MODAL, com o motivo. Fechar a tela num erro apagaria o que foi digitado
      // e o contador não saberia se lançou ou não.
      setRecusa(explicarRecusa(codigoDaRecusa(err), err?.message));
      setEnviando(false);
    }
  }

  if (!linha) return null;
  const n = linha.numeroParcela ?? "?";
  const de = linha.parcelamento?.numParcelas ?? "?";

  return (
    <div
      role="dialog"
      aria-label="Declarar baixa da prestação"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", zIndex: 60, overflowY: "auto",
      }}
    >
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, width: "min(620px, 100%)", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <strong style={{ color: PANEL.text, fontSize: "1rem" }}>
              Declarar o pagamento da prestação {n} de {de}
            </strong>
            <div style={{ color: PANEL.muted, fontSize: "0.78rem", marginTop: 2 }}>
              {linha.parcelamento?.label || "contrato"}
              {linha.competencia ? ` · competência ${linha.competencia}` : ""}
            </div>
          </div>
          <button
            type="button" onClick={onClose} title="Fechar sem lançar nada"
            style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.1rem" }}
          >
            ✕
          </button>
        </div>

        {/* ⚠ DECLARAÇÃO × PROVA — a frase que o dono exige, no topo, não num rodapé. */}
        <div style={{
          marginTop: 12, padding: "9px 11px", borderRadius: 6, lineHeight: 1.45, fontSize: "0.76rem",
          color: PANEL.muted, background: "var(--accent-purple-surface)", border: "1px solid var(--accent-purple-border)",
        }}>
          <div style={{ color: "var(--accent-purple)", fontWeight: 700, marginBottom: 2 }}>
            Isto é uma DECLARAÇÃO sua, não um comprovante
          </div>
          Não existe guia nem documento desta prestação — no débito automático o dinheiro sai da conta
          e pronto. Você está afirmando que ele saiu. A baixa fica registrada como <strong>MANUAL</strong>{" "}
          e o histórico no razão sai com <strong>“(declarado)”</strong>, para que depois se distinga do
          que a Receita provar.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 14 }}>
          <div>
            <span style={labelStyle}>Principal (do contrato)</span>
            <div style={{ ...inputStyle, background: "transparent", borderStyle: "dashed" }}>
              {formatarMoeda(linha.valorPrevisto)}
            </div>
            {/* Por que não é campo: o valor da prestação tem uma fonte só. */}
            <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 3, lineHeight: 1.35 }}>
              Vem de <code>valorPrevisto</code> do contrato — não se digita aqui, senão a baixa viraria
              uma segunda fonte para o valor da parcela.
            </div>
          </div>
          <div>
            <label style={labelStyle} htmlFor="baixa-manual-juros">Juros (você declara)</label>
            <input
              id="baixa-manual-juros" type="text" inputMode="decimal" value={textoJuros}
              onChange={(e) => setTextoJuros(e.target.value)} placeholder="0,00" style={inputStyle}
            />
            {decomposicao.erroJuros && (
              <div style={{ fontSize: "0.68rem", color: "var(--state-danger)", marginTop: 3 }}>{decomposicao.erroJuros}</div>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="baixa-manual-multa">Multa (você declara)</label>
            <input
              id="baixa-manual-multa" type="text" inputMode="decimal" value={textoMulta}
              onChange={(e) => setTextoMulta(e.target.value)} placeholder="0,00" style={inputStyle}
            />
            {decomposicao.erroMulta && (
              <div style={{ fontSize: "0.68rem", color: "var(--state-danger)", marginTop: 3 }}>{decomposicao.erroMulta}</div>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="baixa-manual-data">Data do pagamento</label>
            <input
              id="baixa-manual-data" type="date" value={dataPagamento}
              onChange={(e) => setDataPagamento(e.target.value)} style={inputStyle}
            />
            <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 3, lineHeight: 1.35 }}>
              É ela que decide a competência do lançamento — e mês fechado recusa.
            </div>
          </div>
        </div>

        {/* ⚠ A CONTA TEM DE FECHAR, E ELA É FEITA PARA FRENTE. O servidor recalcula
            `principal + juros + multa` e recusa se o total conferido não bater. */}
        <div style={{
          marginTop: 14, padding: "10px 12px", borderRadius: 8,
          background: PANEL.field, border: `1px solid ${PANEL.border}`,
        }}>
          <div style={{ fontSize: "0.7rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>
            O que vai ser lançado
          </div>
          {linhasPrevistas.length ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {linhasPrevistas.map((l) => (
                  <tr key={l.papel} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                    <td style={{ padding: "4px 6px", fontFamily: "monospace", color: PANEL.muted, fontSize: "0.75rem", width: 28 }}>{l.lado}</td>
                    <td style={{ padding: "4px 6px", color: PANEL.text, fontSize: "0.8rem" }}>{l.o_que}</td>
                    <td style={{ padding: "4px 6px", color: PANEL.muted, fontSize: "0.7rem" }}>{l.efeito}</td>
                    <td style={{ padding: "4px 6px", textAlign: "right", fontFamily: "monospace", color: PANEL.text, fontSize: "0.8rem" }}>
                      {formatarMoeda(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            /* ⚠ AUSÊNCIA NUNCA É RESPOSTA: a prévia vazia DIZ por que está vazia. */
            <div style={{ fontSize: "0.75rem", color: PANEL.muted, lineHeight: 1.4 }}>
              {decomposicao.mensagem || "Preencha os valores para ver o que será gravado."}
            </div>
          )}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "baseline",
            marginTop: 8, paddingTop: 8, borderTop: `1px solid ${PANEL.border}`,
          }}>
            <span style={{ color: PANEL.muted, fontSize: "0.74rem" }}>
              Total conferido = principal + juros + multa
            </span>
            <strong style={{ color: PANEL.text, fontFamily: "monospace", fontSize: "0.95rem" }}>
              {formatarMoeda(decomposicao.total)}
            </strong>
          </div>
          <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 4, lineHeight: 1.4 }}>
            O servidor refaz esta soma e <strong>recusa</strong> se ela não bater com o que está aqui —
            ele não deduz juros e multa por subtração.
          </div>
        </div>

        {recusa && (
          <div role="status" style={{
            marginTop: 12, padding: "8px 10px", borderRadius: 6, lineHeight: 1.4, fontSize: "0.74rem",
            color: PANEL.muted, background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
          }}>
            <div style={{ color: "var(--state-danger)", fontWeight: 700, marginBottom: 2 }}>Nada foi lançado</div>
            {recusa}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          {bloqueio && (
            <span style={{ color: "var(--state-warn)", fontSize: "0.72rem", flex: "1 1 240px", lineHeight: 1.4 }}>
              {bloqueio}
            </span>
          )}
          <button
            type="button" onClick={onClose}
            style={{ padding: "5px 12px", borderRadius: 6, background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.muted, cursor: "pointer", fontSize: "0.8rem" }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={Boolean(bloqueio) || enviando}
            // ⚠ Desabilitado SEM explicação é proibido: o motivo já está ao lado, e repete no title.
            title={bloqueio || (enviando ? "Lançando…" : "Confirma repetindo os dados antes de gravar.")}
            style={{
              padding: "5px 14px", borderRadius: 6, cursor: bloqueio || enviando ? "not-allowed" : "pointer",
              background: "transparent",
              // ⚠ Ação primária é o ACCENT. Verde é "concluído" neste projeto — nunca "faça isto".
              border: `1px solid ${bloqueio || enviando ? PANEL.border : "var(--accent-purple)"}`,
              color: bloqueio || enviando ? PANEL.muted : "var(--accent-purple)",
              fontSize: "0.8rem", fontWeight: 700,
            }}
          >
            {enviando ? "Lançando…" : "Declarar e lançar a baixa"}
          </button>
        </div>
      </div>
    </div>
  );
}
