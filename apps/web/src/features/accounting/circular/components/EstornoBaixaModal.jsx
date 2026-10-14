// ESTORNO DA BAIXA — a confirmação que REPETE OS DADOS.
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// POR QUE ESTE MODAL EXISTE (e por que um `window.confirm` não serve)
// ══════════════════════════════════════════════════════════════════════════════════════════════
//
// Até aqui, desfazer uma baixa pela Circular era um `window.confirm("Desfazer a baixa?")` seguido
// de N `DELETE /entries/:id`. O backend fechou essa porta (`409 USE_ESTORNO`) porque desfazer uma
// baixa não é excluir um lançamento: some um pagamento do razão, um passivo volta a existir, uma
// parcela volta para a fila e — em mês fechado — nasce um lançamento novo numa competência que
// ainda vai ser fechada.
//
// Ato de consequência confirma REPETINDO OS DADOS. Quem clica precisa ver o lote inteiro com
// valores (uma baixa são até três ou quatro lançamentos, em contas diferentes), o modo, a
// competência do contra-lançamento e o que acontece com a guia. É por isso que a tela busca a
// PRÉVIA do servidor antes de oferecer o botão: ela é a única fonte que sabe o que existe AGORA.
//
// ⚠ E é o `totalEstornado` da prévia que volta no POST como `totalConferido`. Se a baixa mudou
// entre a tela e o clique — outra sessão, ou o worker de confirmação de pagamento acrescentando o
// juros ao lote —, o servidor recusa com `409 CONFERENCIA_DIVERGENTE` em vez de desfazer algo
// diferente do que foi confirmado. Sem mandar o total, essa guarda não existe.
//
// ⚠ AUSÊNCIA NUNCA É RESPOSTA. Toda recusa (motivo curto, total divergente, mês corrente fechado,
// lote já exportado) chega à tela COM O MOTIVO, no lugar onde o contador está olhando e pode agir.
// Recusa silenciosa aqui é o pior resultado possível: o contador clica, nada acontece, e ele não
// tem como saber se desfez ou não.

import "./estornoBaixa.css";
import { useEffect, useState } from "react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
import { recusaDeAcesso } from "../../parcelamento/lib/recusaDeAcesso";
import { ACCOUNTING_PANEL } from "../../entries/lib/accountingEntriesShared";

// ⚠ Mínimo do motivo. O servidor checa (`MOTIVO_OBRIGATORIO`) e o banco também (CHECK
// `length(btrim(motivo)) >= 5`) — este número aqui é só para o botão poder dizer NÃO antes de
// gastar uma ida ao servidor. Quem recusa continua sendo o backend.
export const MOTIVO_MIN = 5;

function fmtBRL(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtComp(comp) {
  const [yyyy, mm] = String(comp || "").split("-");
  return yyyy && mm ? `${mm}/${yyyy}` : String(comp || "—");
}

const CAIXA_AVISO = {
  padding: "10px 12px", borderRadius: 6, fontSize: "0.8rem", lineHeight: 1.4,
};

export function EstornoBaixaModal({
  entryId,
  quantosLancamentos = 0,
  onLoadPreview,
  onConfirm,
  onClose,
}) {
  const [preview, setPreview] = useState(null);
  const [carregando, setCarregando] = useState(true);
  // Recusa da PRÉVIA (não é baixa, lote já exportado, lançamento sumiu) é diferente da recusa da
  // EXECUÇÃO: a primeira impede a confirmação de existir, a segunda acontece depois de o contador
  // ter preenchido o motivo. Separadas para que uma não apague a outra na tela.
  const [erroPrevia, setErroPrevia] = useState(null);
  const [erroExecucao, setErroExecucao] = useState(null);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErroPrevia(null);
    Promise.resolve()
      .then(() => onLoadPreview(entryId))
      .then((p) => { if (vivo) setPreview(p); })
      .catch((err) => {
        if (!vivo) return;
        setErroPrevia({
          code: err?.code || null,
          message: recusaDeAcesso(err?.message) || err?.message || recusaDeAcesso(err?.code) || "Não foi possível carregar o que será desfeito.",
        });
      })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [entryId, onLoadPreview]);

  // ⚠ O gate é sobre o texto APARADO. Campo obrigatório que aceita espaço em branco não é
  // obrigatório — cinco espaços passariam no `length` e o banco recusaria depois, com o contador
  // já achando que tinha desfeito.
  const motivoLimpo = motivo.trim();
  const motivoCurto = motivoLimpo.length < MOTIVO_MIN;
  const bloqueios = preview?.bloqueios || [];
  const podeConfirmar = Boolean(preview) && !bloqueios.length && !motivoCurto && !salvando;

  async function handleConfirmar() {
    if (!podeConfirmar) return;
    setErroExecucao(null);
    setSalvando(true);
    try {
      await onConfirm({
        entryId,
        motivo: motivoLimpo,
        // O número que ESTÁ NA TELA, não um recalculado: é a conferência que o servidor exige.
        totalConferido: preview.totalEstornado,
      });
      onClose?.();
    } catch (err) {
      setErroExecucao({
        code: err?.code || null,
        message: recusaDeAcesso(err?.message) || err?.message || recusaDeAcesso(err?.code) || "Falha ao estornar a baixa.",
      });
    } finally {
      setSalvando(false);
    }
  }

  const contraLancamento = preview?.modo === "CONTRA_LANCAMENTO";

  return (
    <Modal className="estorno-baixa-modal" titulo="Desfazer baixa" tamanho="md" ocupado={salvando} aoFechar={onClose} fecharAoClicarFundo={false} rodape={<>
      <Button variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
      <Button onClick={handleConfirmar} disabled={!podeConfirmar}>{salvando ? "Desfazendo…" : (quantosLancamentos > 1 ? `Desfazer ${quantosLancamentos} lançamentos` : "Desfazer baixa")}</Button>
    </>}>
      <div style={{ color: ACCOUNTING_PANEL.text, overflowWrap: "anywhere" }}>
        <p style={{ margin: "0 0 14px", fontSize: "0.875rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
          O estorno fica registrado com o motivo, com quem desfez e com o que foi desfeito. Confira
          abaixo o que sai do razão antes de confirmar.
        </p>

        {carregando && (
          <div role="status" style={{ padding: "18px 0", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Carregando o que será desfeito…
          </div>
        )}

        {/* Recusa da prévia: não há o que confirmar, então nem o campo de motivo aparece. Mas a
            razão aparece — some o fluxo, nunca a explicação. */}
        {!carregando && erroPrevia && (
          <div role="alert" style={{
            ...CAIXA_AVISO, color: "var(--state-danger)",
            background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
          }}>
            {erroPrevia.message}
          </div>
        )}

        {!carregando && preview && (
          <>
            {/* ── O LOTE, COM VALORES ────────────────────────────────────────────────────── */}
            <div style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: 6 }}>
              {preview.lancamentos.length > 1
                ? `${preview.lancamentos.length} lançamentos serão desfeitos`
                : "1 lançamento será desfeito"}
            </div>
            <table style={{ width: "100%", minWidth: 0, tableLayout: "fixed", borderCollapse: "collapse", marginBottom: 4, fontSize: "0.8rem" }}>
              <tbody>
                {preview.lancamentos.map((l) => (
                  <tr key={l.id} style={{ borderBottom: `1px solid ${ACCOUNTING_PANEL.border}` }}>
                    <td style={{ padding: "6px 4px", verticalAlign: "top" }}>
                      <div>{l.historico || "Lançamento sem histórico"}</div>
                      <div style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
                        {fmtComp(l.competencia)}
                        {l.tipoLinha ? ` · ${l.tipoLinha}` : ""}
                      </div>
                    </td>
                    <td style={{ padding: "6px 4px", width: "34%", textAlign: "right", whiteSpace: "nowrap", fontWeight: 600, verticalAlign: "top" }}>
                      R$ {fmtBRL(l.valor)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ padding: "8px 4px", fontWeight: 600 }}>Total a estornar</td>
                  {/* ⚠ Este número não é decoração: é ele que viaja de volta como `totalConferido`.
                      É o que o contador declara ter visto. */}
                  <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>
                    R$ {fmtBRL(preview.totalEstornado)}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* ── O QUE ACONTECE DEPOIS ──────────────────────────────────────────────────── */}
            <div style={{
              ...CAIXA_AVISO, marginBottom: 12,
              color: contraLancamento ? "var(--state-warn)" : ACCOUNTING_PANEL.text,
              background: contraLancamento ? "var(--state-warn-surface)" : "var(--state-neutral-surface)",
              border: `1px solid ${contraLancamento ? "var(--state-warn)" : ACCOUNTING_PANEL.border}`,
            }}>
              {contraLancamento ? (
                <>
                  <strong>A competência {fmtComp(preview.competenciaOriginal)} está fechada.</strong>{" "}
                  Os lançamentos <strong>não serão apagados</strong>: nasce um contra-lançamento
                  espelhado em <strong>{fmtComp(preview.competenciaContraLancamento)}</strong>. O saldo
                  de um mês já reportado não muda para trás — ele é corrigido no mês corrente.
                </>
              ) : (
                <>
                  A competência {fmtComp(preview.competenciaOriginal)} está aberta: os lançamentos
                  serão <strong>apagados</strong> e a provisão volta a ter saldo.
                </>
              )}
            </div>

            {/* ── A GUIA / PARCELA ───────────────────────────────────────────────────────── */}
            {preview.guia && (
              <div style={{ ...CAIXA_AVISO, marginBottom: 12, background: "var(--state-neutral-surface)", border: `1px solid ${ACCOUNTING_PANEL.border}` }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>A guia volta para a fila</div>
                <div style={{ color: "var(--text-muted)" }}>
                  {preview.guia.tipo || "Guia"}
                  {preview.guia.numeroParcela ? ` · parcela ${preview.guia.numeroParcela}` : ""}
                  {preview.guia.valor != null ? ` · R$ ${fmtBRL(preview.guia.valor)}` : ""}
                  {preview.guia.parcelaEstadoAposEstorno
                    ? ` · ${preview.guia.parcelaEstado || "—"} → ${preview.guia.parcelaEstadoAposEstorno}`
                    : ""}
                </div>
                {/* Confirmação vinda do SERPRO NÃO se desfaz: o dinheiro saiu e o comprovante
                    existe. O que se desfaz é o lançamento, não o fato — e a tela diz qual dos dois
                    casos é este, em vez de deixar o contador descobrir depois. */}
                <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
                  {preview.guia.pagamentoSeraDesfeito
                    ? "O pagamento manual também será desfeito (a guia volta a ficar em aberto)."
                    : "A confirmação de pagamento permanece — só o lançamento é desfeito."}
                </div>
              </div>
            )}

            {/* ── BLOQUEIOS ──────────────────────────────────────────────────────────────── */}
            {bloqueios.map((b) => (
              <div
                key={b.code}
                style={{
                  ...CAIXA_AVISO, marginBottom: 12, color: "var(--state-danger)",
                  background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
                }}
              >
                {b.message}
              </div>
            ))}

            {/* ── O MOTIVO ───────────────────────────────────────────────────────────────── */}
            <label style={{ display: "grid", gap: 4, fontSize: "0.875rem", color: "var(--text-muted)", marginBottom: 4 }}>
              Motivo do estorno (obrigatório)
              <textarea
                rows={3}
                autoFocus
                value={motivo}
                disabled={salvando || Boolean(bloqueios.length)}
                onChange={(e) => { setMotivo(e.target.value); setErroExecucao(null); }}
                placeholder="Ex.: baixa lançada na guia errada — o pagamento era da parcela 04"
                style={{
                  background: ACCOUNTING_PANEL.field, border: `1px solid ${ACCOUNTING_PANEL.border}`,
                  borderRadius: 6, color: ACCOUNTING_PANEL.text, padding: "8px 10px",
                  font: "inherit", fontSize: "0.85rem", resize: "vertical",
                }}
              />
            </label>
            {/* O motivo curto é dito ANTES do clique — descobrir a exigência por um erro do
                servidor é a versão cara da mesma informação. */}
            <div style={{ fontSize: "0.875rem", color: motivoCurto ? "var(--state-warn)" : "var(--text-muted)", marginBottom: 12 }}>
              {motivoCurto
                ? `Mínimo de ${MOTIVO_MIN} caracteres — faltam ${MOTIVO_MIN - motivoLimpo.length}.`
                : "Fica registrado na auditoria do estorno."}
            </div>
          </>
        )}

        {/* Recusa da EXECUÇÃO — o 409 chega aqui, com o motivo, ao lado do campo que o resolve. */}
        {erroExecucao && (
          <div role="alert" style={{
            ...CAIXA_AVISO, marginBottom: 12, color: "var(--state-danger)",
            background: "var(--state-danger-surface)", border: "1px solid var(--state-danger)",
          }}>
            {erroExecucao.message}
          </div>
        )}

      </div>
    </Modal>
  );
}
