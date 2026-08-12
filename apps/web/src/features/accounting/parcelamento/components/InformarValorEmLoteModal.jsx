// INFORMAR O VALOR CONTRATADO DE VÁRIAS PRESTAÇÕES DO MESMO CONTRATO — a ação em lote do banner.
//
// ⚠ ESTE MODAL NÃO LANÇA BAIXA. Ele grava UM fato: "o acordo diz que estas prestações valem X".
// A baixa continua sendo ato deliberado, prestação a prestação, na fila — e é por isso que o verbo
// aqui é *informar*, nunca *baixar*. Colar as duas coisas num clique só faria N declarações de
// pagamento saírem de um formulário que não perguntou nem a data nem os acréscimos de nenhuma delas.
//
// ⚠ ELE EXISTE PORQUE A REPETIÇÃO ERA A PENDÊNCIA. Todo contrato criado pelo wizard nasce com
// TODAS as prestações valendo R$ 0,00 (`buildDTOsFromManual` deriva o valor da soma dos tributos, e
// sem guia essa soma é zero). Corrigir uma por uma é abrir o mesmo modal N vezes para digitar o
// mesmo número — e era isso, não a falta de capacidade, que fazia a fila parecer intransponível.
//
// ⚠ E CADA LINHA CONTINUA EDITÁVEL. O valor de cima é o padrão, não a decisão: parcelamento com
// entrada maior, ou com a última prestação quebrada, é o caso normal. Um lote que só aceitasse um
// número obrigaria a desfazer no detalhe o que ele acabou de fazer no atacado.
//
// ⚠ UMA CHAMADA POR PRESTAÇÃO, e é de propósito: a rota é
// `PATCH .../parcelas/:parcelaId/valor-previsto`, com a conferência do "era" (`valorAnteriorConferido`)
// que recusa se o contrato tiver mudado no meio. Não há rota de lote, e inventar uma no front —
// engolindo a recusa de uma linha para seguir nas outras — apagaria exatamente a guarda que protege
// o contador de reescrever um contrato a partir de um "antes" que ele nunca viu. Aqui cada linha
// tem o seu desfecho, e a que recusar diz por quê.

import { useEffect, useMemo, useState } from "react";
import {
  planoDoLoteDeValor, textoDaConfirmacaoDoLote, formatarMoeda,
  explicarRecusaCorrecao, codigoDaRecusa,
} from "../lib/baixaManualParcela";

const PANEL = { text: "#F8F8F2", muted: "#A7B0C0", border: "#44475A", surface: "#21222C", field: "#282A36" };

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6,
  background: PANEL.field, border: `1px solid ${PANEL.border}`, color: PANEL.text,
  fontSize: "0.85rem", fontFamily: "monospace",
};

function fmtVenc(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

/**
 * @param {object}   grupo        `{ label, parcelas, quantidade }` de `agruparBloqueiosDaFila`
 * @param {function} onInformar   `({parcelaId, valorPrevisto, valorAnteriorConferido}) => Promise`
 * @param {function} onConcluido  recarrega a fila — chamado ao fechar depois de gravar algo
 * @param {function} onClose
 */
export function InformarValorEmLoteModal({ grupo, onInformar, onConcluido, onClose }) {
  const [textoPadrao, setTextoPadrao] = useState("");
  const [overrides, setOverrides] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [desfechos, setDesfechos] = useState({}); // parcelaId → { tom, texto }
  const [gravadas, setGravadas] = useState(0);

  // ESC fecha; clicar fora NÃO — este é um formulário, e o backdrop apagaria o preenchimento sem
  // confirmação. Mesma regra dos modais irmãos (`useEscapeToClose` em `ParcelamentoModals`).
  useEffect(() => {
    function onKeyDown(e) { if (e.key === "Escape" && !enviando) fechar(); }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // ⚠ AS JÁ GRAVADAS SAEM DO PLANO. Sem isso, um lote parcialmente aplicado (três gravadas, uma
  // recusada) reenviaria as três na segunda tentativa — e a rota recusaria TODAS por conferência
  // divergente, porque o "era" delas mudou. O que sobra na tela é o que falta fazer.
  const pendentes = useMemo(
    () => (grupo?.parcelas || []).filter((p) => desfechos[p.parcelaId]?.tom !== "ok"),
    [grupo, desfechos],
  );
  const plano = useMemo(
    () => planoDoLoteDeValor({ parcelas: pendentes, textoPadrao, overrides }),
    [pendentes, textoPadrao, overrides],
  );

  function fechar() {
    if (gravadas > 0) onConcluido?.();
    onClose?.();
  }

  async function confirmar() {
    if (!plano.ok || enviando) return;
    // eslint-disable-next-line no-alert
    if (!window.confirm(textoDaConfirmacaoDoLote(plano, grupo?.label))) return;
    setEnviando(true);
    let ok = 0;
    for (const linha of plano.validas) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await onInformar({
          parcelaId: linha.parcelaId,
          valorPrevisto: linha.valor,
          valorAnteriorConferido: linha.valorAnterior,
        });
        ok += 1;
        setDesfechos((d) => ({
          ...d,
          [linha.parcelaId]: { tom: "ok", texto: `Valor informado: ${formatarMoeda(linha.valor)}` },
        }));
      } catch (err) {
        // ⚠ A RECUSA FICA NA LINHA, com o motivo — e o lote SEGUE. Parar tudo na primeira recusa
        // deixaria as demais sem resposta nenhuma, e o contador sem saber o que foi gravado.
        setDesfechos((d) => ({
          ...d,
          [linha.parcelaId]: { tom: "erro", texto: explicarRecusaCorrecao(codigoDaRecusa(err), err?.message) },
        }));
      }
    }
    setGravadas((g) => g + ok);
    setEnviando(false);
  }

  if (!grupo) return null;
  const th = { padding: "5px 8px", textAlign: "left", fontSize: "0.62rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" };
  const td = { padding: "5px 8px", fontSize: "0.78rem", color: PANEL.text, verticalAlign: "top" };
  const nRestantes = plano.validas.length;
  // Tudo gravado: não há mais lista sobre a qual pedir valor nenhum.
  const nadaAFazer = pendentes.length === 0;

  return (
    <div
      role="dialog"
      aria-label="Informar o valor contratado das prestações"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", zIndex: 60, overflowY: "auto",
      }}
    >
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, width: "min(660px, 100%)", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <strong style={{ color: PANEL.text, fontSize: "1rem" }}>
              Informar o valor contratado de {grupo.quantidade}{" "}
              {grupo.quantidade === 1 ? "prestação" : "prestações"}
            </strong>
            <div style={{ color: PANEL.muted, fontSize: "0.78rem", marginTop: 2 }}>{grupo.label || "contrato"}</div>
          </div>
          <button
            type="button" onClick={fechar} title="Fechar"
            style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.1rem", minHeight: 40, minWidth: 40 }}
          >
            ✕
          </button>
        </div>

        {/* ⚠ O TEXTO DE APOIO FICA NO TOPO DO GRUPO, UMA VEZ — não repetido por linha. Ele responde
            as duas perguntas que o lote levanta: o que este número é (o contrato, não o pagamento) e
            o que este botão NÃO faz (baixa). */}
        <div style={{
          marginTop: 12, padding: "9px 11px", borderRadius: 6, lineHeight: 1.45, fontSize: "0.76rem",
          color: PANEL.muted, background: "var(--accent-purple-surface)", border: "1px solid var(--accent-purple-border)",
        }}>
          Este é o valor que o <strong>acordo</strong> diz que cada prestação vale — é ele que a baixa
          amortiza do passivo, e ele passa a valer em todas as telas. <strong>Nenhuma baixa é lançada
          aqui:</strong> depois disto as prestações ficam prontas para você declarar o pagamento, uma
          a uma, na fila.
        </div>

        <div style={{ marginTop: 14, maxWidth: 260 }}>
          <label
            htmlFor="lote-valor-padrao"
            style={{ display: "block", fontSize: "0.7rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}
          >
            Valor de todas
          </label>
          <input
            id="lote-valor-padrao" type="text" inputMode="decimal" value={textoPadrao}
            onChange={(e) => setTextoPadrao(e.target.value)} placeholder="0,00" style={inputStyle}
            disabled={enviando}
          />
          <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 3, lineHeight: 1.35 }}>
            Vale para as prestações abaixo. Qualquer uma pode receber outro valor na própria linha.
          </div>
        </div>

        <div style={{ marginTop: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: PANEL.field }}>
                <th style={th}>Parc.</th>
                <th style={th}>Competência</th>
                <th style={th}>Vencimento</th>
                <th style={{ ...th, textAlign: "right" }}>Hoje vale</th>
                <th style={{ ...th, textAlign: "right", width: 150 }}>Passa a valer</th>
              </tr>
            </thead>
            <tbody>
              {(grupo.parcelas || []).map((p) => {
                const linha = plano.linhas.find((l) => l.parcelaId === p.parcelaId) || null;
                const desfecho = desfechos[p.parcelaId];
                const anterior = p.valorPrevisto == null || Number(p.valorPrevisto) === 0
                  ? "sem valor"
                  : formatarMoeda(p.valorPrevisto);
                return (
                  <tr key={p.parcelaId} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                    <td style={{ ...td, fontFamily: "monospace" }}>{p.numeroParcela ?? "?"}</td>
                    <td style={td}>{p.competencia || "—"}</td>
                    <td style={{ ...td, color: PANEL.muted }}>{fmtVenc(p.vencimento)}</td>
                    <td style={{ ...td, textAlign: "right", color: PANEL.muted, fontFamily: "monospace" }}>{anterior}</td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {desfecho?.tom === "ok" ? (
                        <span style={{ color: "var(--state-ok)", fontSize: "0.74rem", fontWeight: 700 }}>
                          {desfecho.texto}
                        </span>
                      ) : (
                        <>
                          <input
                            type="text" inputMode="decimal" disabled={enviando}
                            aria-label={`Valor da prestação ${p.numeroParcela ?? "?"}`}
                            value={overrides[p.parcelaId] ?? ""}
                            onChange={(e) => setOverrides((o) => ({ ...o, [p.parcelaId]: e.target.value }))}
                            placeholder={plano.linhas.length && linha?.origem === "padrao" && linha?.valor != null
                              ? formatarMoeda(linha.valor)
                              : "usa o valor de todas"}
                            style={{ ...inputStyle, textAlign: "right" }}
                          />
                          {/* ⚠ O ERRO DA LINHA SÓ APARECE NA LINHA QUE O CAUSOU. Com o "valor de
                              todas" ainda vazio, TODAS as linhas herdam o mesmo erro — e imprimi-lo
                              em cada uma recria, dentro do modal que existe para acabar com a
                              repetição, a parede de parágrafos idênticos. O motivo do campo vazio
                              é do GRUPO, e sai uma vez, ao lado do botão desabilitado. */}
                          {linha?.erro && linha.origem === "individual" && (
                            <div style={{ fontSize: "0.66rem", color: "var(--state-warn)", marginTop: 3, lineHeight: 1.35, textAlign: "left" }}>
                              {linha.erro}
                            </div>
                          )}
                          {desfecho?.tom === "erro" && (
                            <div role="status" style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 4, lineHeight: 1.35, textAlign: "left" }}>
                              <strong style={{ color: "var(--state-warn)" }}>Nada foi gravado nesta: </strong>
                              {desfecho.texto}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {gravadas > 0 && (
          <div role="status" style={{
            marginTop: 12, padding: "8px 10px", borderRadius: 6, fontSize: "0.75rem", lineHeight: 1.4,
            color: PANEL.muted, background: "var(--state-ok-surface)", border: "1px solid var(--state-ok)",
          }}>
            <strong style={{ color: "var(--state-ok)" }}>
              Valor informado em {gravadas} {gravadas === 1 ? "prestação" : "prestações"}.
            </strong>{" "}
            {nRestantes > 0
              ? "As demais continuam sem valor — corrija o que ficou e informe de novo."
              : "Elas já podem receber a baixa declarada, na fila."}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
          {/* ⚠ NÃO SOBRA NADA A FAZER ⇒ NÃO SOBRA BOTÃO. Com as N prestações gravadas, o rodapé
              insistia "informe o valor contratado" ao lado de um "Informar valor" desabilitado —
              um pedido sobre uma lista que não existe mais, e a leitura óbvia é "deu errado". */}
          {!nadaAFazer && !plano.ok && (
            <span style={{ color: "var(--state-warn)", fontSize: "0.72rem", flex: "1 1 240px", lineHeight: 1.4 }}>
              {plano.mensagem}
            </span>
          )}
          <button
            type="button" onClick={fechar} disabled={enviando}
            style={{ minHeight: 40, padding: "5px 12px", borderRadius: 6, background: "transparent", border: `1px solid ${PANEL.border}`, color: PANEL.muted, cursor: enviando ? "not-allowed" : "pointer", fontSize: "0.8rem" }}
          >
            {gravadas > 0 ? "Fechar" : "Cancelar"}
          </button>
          {!nadaAFazer && (
          <button
            type="button"
            onClick={confirmar}
            disabled={!plano.ok || enviando}
            // ⚠ Desabilitado SEM explicação é proibido: o motivo está ao lado e repete no `title`.
            title={!plano.ok ? plano.mensagem : (enviando ? "Gravando…" : "Confirma repetindo prestação por prestação antes de gravar.")}
            style={{
              minHeight: 40, padding: "5px 14px", borderRadius: 6,
              cursor: !plano.ok || enviando ? "not-allowed" : "pointer",
              background: "transparent",
              // ⚠ Ação primária é o ACCENT. Verde é "concluído" neste projeto — nunca "faça isto".
              border: `1px solid ${!plano.ok || enviando ? PANEL.border : "var(--accent-purple)"}`,
              color: !plano.ok || enviando ? PANEL.muted : "var(--accent-purple)",
              fontSize: "0.8rem", fontWeight: 700,
            }}
          >
            {/* ⚠ O RÓTULO NÃO PROMETE ZERO. "Informar valor em 0 prestações" é a tela dizendo que
                vai fazer nada; com o campo ainda vazio o botão volta a ser só o nome da ação, e o
                motivo de estar desabilitado fica ao lado. */}
            {enviando
              ? "Gravando…"
              : (nRestantes
                ? `Informar valor em ${nRestantes} ${nRestantes === 1 ? "prestação" : "prestações"}`
                : "Informar valor")}
          </button>
          )}
        </div>
      </div>
    </div>
  );
}
