// EXCLUIR O CONTRATO · DESFAZER A RESCISÃO — a confirmação que REPETE OS DADOS.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// POR QUE NÃO É UM `window.confirm`
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Pedido do dono: *"Devo poder excluir um parcelamento"*, com a régua *"deve dar autonomia ao
// contador"*. Autonomia não é o botão existir — é o botão existir COM A INFORMAÇÃO. Um
// "Tem certeza?" genérico pede a decisão e sonega tudo que a sustenta: quantas prestações somem,
// quantas delas constam pagas, quantos lançamentos saem do razão, quanto isso soma, o que acontece
// com a guia que o cliente já recebeu por e-mail, e se alguma competência está fechada.
//
// Por isso a tela BUSCA A PRÉVIA no servidor antes de oferecer o botão: só ele sabe o que existe
// AGORA. E é o `totalDesfeito` da prévia que volta no POST como `totalConferido` — se o contrato
// mudou entre a tela e o clique (o worker trouxe a guia de mais uma parcela, outra sessão lançou uma
// baixa), o servidor recusa com `CONFERENCIA_DIVERGENTE` em vez de excluir algo diferente do que foi
// confirmado. Sem mandar o total, essa guarda não existe.
//
// ⚠ AUSÊNCIA NUNCA É RESPOSTA: toda recusa (motivo curto, mês corrente fechado, lote exportado,
// total divergente) chega COM O MOTIVO, ao lado do campo que a resolve. Recusa silenciosa aqui é o
// pior desfecho — o contador clica, nada acontece, e ele não sabe se excluiu ou não.
//
// ⚠ E O QUE ESTA TELA **NÃO** FAZ: ela não bloqueia. Contrato com prestação quitada é excluível; o
// peso aparece em vermelho, com o número, e a decisão continua sendo dele. Ele sabe se aquele
// dinheiro saiu de verdade; o sistema não.

import { useEffect, useState } from "react";
import {
  MOTIVO_MIN, motivoCurto, linhasDoQueVaiAcontecer, linhasDoDesfazerRescisao,
  explicarRecusaAto, formatarMoeda, formatarCompetencia,
} from "../lib/exclusaoParcelamento";

const PANEL = { surface: "#21222C", field: "#282A36", border: "#44475A", text: "#F8F8F2", muted: "#aeb6d3" };
const CAIXA = { padding: "9px 11px", borderRadius: 6, fontSize: "0.78rem", lineHeight: 1.45 };

/**
 * O modal dos dois atos. Um componente só, porque a FORMA é a mesma — prévia → consequências com
 * números → motivo obrigatório → confirmação — e duas cópias divergiriam na primeira mudança de
 * regra (foi assim que quatro cópias da mesma frase de envio nasceram neste projeto). O que varia
 * viaja como dado: título, verbo, cor do botão e a função que monta as linhas.
 */
function ModalDeAto({
  titulo, subtitulo, verbo, verboEmVoo, destrutivo,
  parcelamento, montarLinhas, mandarTotalConferido = false,
  onLoadPreview, onConfirm, onClose,
}) {
  const [preview, setPreview] = useState(null);
  const [carregando, setCarregando] = useState(true);
  // ⚠ DUAS RECUSAS SEPARADAS. A da PRÉVIA impede a confirmação de existir; a da EXECUÇÃO acontece
  // depois de o contador ter escrito o motivo. Uma não pode apagar a outra da tela.
  const [erroPrevia, setErroPrevia] = useState(null);
  const [erroExecucao, setErroExecucao] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErroPrevia(null);
    Promise.resolve()
      .then(() => onLoadPreview())
      .then((p) => { if (vivo) setPreview(p); })
      .catch((err) => {
        if (!vivo) return;
        setErroPrevia(explicarRecusaAto(err?.code || err?.error, err?.message));
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelamento?.id]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose?.(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ⚠ O gate é sobre o texto APARADO: campo obrigatório que aceita cinco espaços não é obrigatório,
  // e o banco recusaria depois, com o contador já achando que tinha excluído.
  const curto = motivoCurto(motivo);
  const bloqueios = preview?.bloqueios || [];
  const podeConfirmar = Boolean(preview) && !bloqueios.length && !curto && !salvando;

  async function confirmar() {
    if (!podeConfirmar) return;
    setErroExecucao(null);
    setSalvando(true);
    try {
      await onConfirm({
        motivo: motivo.trim(),
        // O número que ESTÁ NA TELA, não um recalculado: é a conferência que o servidor exige.
        ...(mandarTotalConferido ? { totalConferido: preview.totalDesfeito } : {}),
      });
      onClose?.();
    } catch (err) {
      setErroExecucao(explicarRecusaAto(err?.code || err?.error, err?.message));
    } finally {
      setSalvando(false);
    }
  }

  const corDoTom = (tom) => (tom === "atencao" ? "var(--state-warn)" : PANEL.muted);
  const linhas = preview ? montarLinhas(preview) : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 1800,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div style={{
        background: PANEL.surface, border: `1px solid ${destrutivo ? "var(--state-danger)" : PANEL.border}`,
        borderRadius: 10, padding: 20, width: "min(96vw, 640px)", maxHeight: "92vh",
        overflowY: "auto", color: PANEL.text,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>{titulo}</h3>
          <button
            type="button" onClick={onClose} aria-label="Fechar"
            style={{ background: "none", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.3rem", lineHeight: 1 }}
          >
            ×
          </button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: "0.78rem", color: PANEL.muted, lineHeight: 1.45 }}>
          {parcelamento?.label ? <strong style={{ color: PANEL.text }}>{parcelamento.label}</strong> : null}
          {parcelamento?.numeroParcelamento ? ` · nº ${parcelamento.numeroParcelamento}` : ""}
          <br />
          {subtitulo}
        </p>

        {carregando && (
          <div style={{ padding: "16px 0", fontSize: "0.85rem", color: PANEL.muted }}>
            Carregando o que vai acontecer…
          </div>
        )}

        {/* Recusa da PRÉVIA: não há o que confirmar, então nem o campo de motivo aparece. Mas a
            razão aparece — some o fluxo, nunca a explicação. */}
        {!carregando && erroPrevia && (
          <div role="status" style={{ ...CAIXA, color: "var(--state-danger)", background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)" }}>
            {erroPrevia}
          </div>
        )}

        {!carregando && preview && (
          <>
            <div style={{ fontSize: "0.7rem", color: PANEL.muted, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              O que vai acontecer
            </div>
            <ul style={{ listStyle: "none", margin: "0 0 12px", padding: 0, display: "grid", gap: 6 }}>
              {linhas.map((l) => (
                <li
                  key={l.chave}
                  style={{
                    ...CAIXA,
                    color: corDoTom(l.tom),
                    background: l.tom === "atencao" ? "var(--state-warn-surface)" : "var(--state-neutral-surface)",
                    border: `1px solid ${l.tom === "atencao" ? "var(--state-warn)" : PANEL.border}`,
                  }}
                >
                  {l.texto}
                </li>
              ))}
            </ul>

            {/* O detalhe lançamento a lançamento — dobrável, porque um contrato de 60 meses tem
                muitos, e o resumo acima já basta para decidir. Quem quer conferir, confere. */}
            {Boolean(preview.lancamentos?.lista?.length) && (
              <details style={{ marginBottom: 12, background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6, padding: "8px 10px" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.76rem", color: PANEL.text, fontWeight: 700 }}>
                  Ver os {preview.lancamentos.lista.length} lançamentos ({formatarMoeda(preview.totalDesfeito)})
                </summary>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6, fontSize: "0.74rem" }}>
                  <tbody>
                    {preview.lancamentos.lista.map((e) => (
                      <tr key={e.id} style={{ borderTop: `1px solid ${PANEL.border}` }}>
                        <td style={{ padding: "4px 2px", color: PANEL.text }}>
                          {e.historico}
                          <div style={{ color: PANEL.muted, fontSize: "0.68rem" }}>
                            {formatarCompetencia(e.competencia)}
                            {e.tipoLinha ? ` · ${e.tipoLinha}` : ""}
                            {e.mesFechado ? " · mês fechado (vira contra-lançamento)" : ""}
                          </div>
                        </td>
                        <td style={{ padding: "4px 2px", textAlign: "right", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                          {formatarMoeda(e.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            {/* BLOQUEIOS — o que o servidor recusaria. Aqui o botão fica desabilitado COM o motivo. */}
            {bloqueios.map((b) => (
              <div
                key={b.code}
                role="status"
                style={{ ...CAIXA, marginBottom: 10, color: "var(--state-danger)", background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)" }}
              >
                {b.message}
              </div>
            ))}

            <label style={{ display: "grid", gap: 4, fontSize: "0.76rem", color: PANEL.muted, marginBottom: 4 }}>
              Motivo (obrigatório)
              <textarea
                rows={3}
                autoFocus
                value={motivo}
                disabled={Boolean(bloqueios.length)}
                onChange={(e) => { setMotivo(e.target.value); setErroExecucao(null); }}
                placeholder="Ex.: parcelamento lançado errado — a dívida certa é o nº 0211.00012…"
                style={{
                  background: PANEL.field, border: `1px solid ${PANEL.border}`, borderRadius: 6,
                  color: PANEL.text, padding: "8px 10px", font: "inherit", fontSize: "0.85rem", resize: "vertical",
                }}
              />
            </label>
            <div style={{ fontSize: "0.7rem", color: curto ? "var(--state-warn)" : PANEL.muted, marginBottom: 12 }}>
              {curto
                ? `Mínimo de ${MOTIVO_MIN} caracteres — faltam ${Math.max(0, MOTIVO_MIN - motivo.trim().length)}.`
                : "Fica gravado com o seu nome e a data, e sobrevive à exclusão."}
            </div>
          </>
        )}

        {/* Recusa da EXECUÇÃO — o 409 chega aqui, com o motivo, ao lado do campo que o resolve. */}
        {erroExecucao && (
          <div role="status" style={{ ...CAIXA, marginBottom: 10, color: "var(--state-danger)", background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)" }}>
            {erroExecucao}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button" onClick={onClose} disabled={salvando}
            style={{
              padding: "8px 16px", borderRadius: 6, border: `1px solid ${PANEL.border}`,
              background: "transparent", color: PANEL.text, cursor: salvando ? "default" : "pointer", fontSize: "0.85rem",
            }}
          >
            Cancelar
          </button>
          {/* ⚠ NUNCA VERDE. Verde significa CONCLUÍDO no vocabulário deste app; ação primária é o
              accent, e ação destrutiva é o vermelho de estado. Desabilitado NOMEIA o motivo. */}
          <button
            type="button"
            onClick={confirmar}
            disabled={!podeConfirmar}
            title={!preview
              ? "Carregando o que vai acontecer…"
              : (bloqueios.length
                ? bloqueios[0].message
                : (curto ? `Escreva o motivo (mínimo ${MOTIVO_MIN} caracteres).` : "Grava o ato com motivo, autor e data."))}
            style={{
              padding: "8px 16px", borderRadius: 6, border: "none", fontWeight: 700, fontSize: "0.85rem",
              background: podeConfirmar
                ? (destrutivo ? "var(--state-danger)" : "var(--accent-purple)")
                : PANEL.border,
              color: podeConfirmar ? "#12131A" : PANEL.muted,
              cursor: podeConfirmar ? "pointer" : "not-allowed",
            }}
          >
            {salvando ? verboEmVoo : verbo}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExclusaoParcelamentoModal({ parcelamento, onLoadPreview, onConfirm, onClose }) {
  return (
    <ModalDeAto
      titulo="Excluir parcelamento"
      subtitulo="O contrato, as prestações e os lançamentos dele saem do sistema. As guias NÃO são apagadas."
      verbo="Excluir parcelamento"
      verboEmVoo="Excluindo…"
      destrutivo
      mandarTotalConferido
      parcelamento={parcelamento}
      montarLinhas={linhasDoQueVaiAcontecer}
      onLoadPreview={onLoadPreview}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}

export function DesfazerRescisaoModal({ parcelamento, onLoadPreview, onConfirm, onClose }) {
  return (
    <ModalDeAto
      titulo="Desfazer a rescisão"
      subtitulo="O contrato volta a ATIVO e as prestações dele voltam às filas de baixa."
      verbo="Desfazer a rescisão"
      verboEmVoo="Desfazendo…"
      destrutivo={false}
      parcelamento={parcelamento}
      montarLinhas={linhasDoDesfazerRescisao}
      onLoadPreview={onLoadPreview}
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
