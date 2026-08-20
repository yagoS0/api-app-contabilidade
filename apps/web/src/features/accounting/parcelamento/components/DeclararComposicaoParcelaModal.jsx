// F2.6 — INFORMAR A COMPOSIÇÃO DE UMA PARCELA QUE **TEM GUIA** E NÃO TRAZ A DECOMPOSIÇÃO.
//
// ⚠ O VÃO QUE ESTA TELA FECHA. A fila "Parcelas pagas aguardando lançamento" tem um botão só —
// ela pressupõe que o documento já traz principal, juros e multa. Guia vinda de UPLOAD não traz:
// medido em produção, o `extracted` de um `ExibirDAS-*.pdf` tem só tipo, valor, vencimento e
// competência, e `TributoParcela` vem ZERO. A baixa recusava com `sem_composicao`, e a outra tela
// (`BaixaManualParcelaModal`, a da prestação SEM guia) recusa toda prestação que TEM guia — o
// servidor a recusa com `parcela_tem_guia`, de propósito, porque as guardas de idempotência das
// duas vias são diferentes e nenhuma enxerga a outra. Não existia caminho. Agora existe: o
// contador DECLARA a decomposição aqui, e ela sobe pela MESMA rota da baixa normal.
//
// ⚠ ESTA TELA NÃO É A `BaixaManualParcelaModal`, E A DIFERENÇA NÃO É COSMÉTICA:
//
//   | | prestação SEM guia (F2.2) | esta (F2.6) |
//   |---|---|---|
//   | o pagamento | é DECLARADO (débito automático, sem documento) | é PROVADO (a guia está paga) |
//   | o principal | vem do CONTRATO (`valorPrevisto`); editá-lo REESCREVE o acordo | é LIDO DO DAS; não toca o contrato |
//   | a âncora | a prestação (`parcelaId`) | a guia (`guideId`) |
//   | o que se declara | juros e multa | a decomposição inteira |
//
// Reusar aquele modal com um `modo` faria um mesmo campo significar "o acordo diz X" numa metade e
// "li X no PDF" na outra, com a rota de correção de contrato pendurada por engano. O que se reusa,
// e é o que importa, é o CÁLCULO: `lerPrincipal`/`lerAcrescimo` (a gramática estrita de separador
// decimal que impede `1.500` virar 1,50), `lancamentosPrevistos` (a prévia do razão) e a mesma
// disciplina de conferência — tudo em `lib/baixaManualParcela.js`, um arquivo só.
//
// ⚠ NADA É DERIVADO POR SUBTRAÇÃO. O total é a SOMA dos três campos, feita para frente e mostrada
// antes do clique; o servidor refaz a soma e RECUSA (409 `CONFERENCIA_DIVERGENTE`) se o
// `totalConferido` não bater. Se a soma não fecha com a guia, quem fecha é o contador olhando o
// DAS — a tela AVISA e não inventa a diferença.

import { useMemo, useState } from "react";
import {
  decomporComposicaoDeclarada, lancamentosPrevistos, formatarMoeda,
  textoDaConfirmacaoDaComposicao, explicarRecusaComposicao, codigoDaRecusa,
} from "../lib/baixaManualParcela";

const PANEL = { text: "#F8F8F2", muted: "#A7B0C0", border: "#44475A", surface: "#21222C", field: "#282A36" };

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * A data que a tela abre pré-preenchida.
 *
 * ⚠ A DO COMPROVANTE VENCE A DE HOJE — é ela que decide a competência do lançamento, e lançar na
 * competência do clique é como parcela paga em 20/03 virava saída de caixa de abril. Quando não há
 * comprovante (o caso da guia de upload marcada como paga à mão), cai em hoje e o contador corrige.
 * ⚠ `dataArrecadacao` é gravada em pt-BR ("dd/mm/aaaa"); o `<input type="date">` exige ISO.
 */
function dataInicial(linha) {
  const br = String(linha?.comprovante?.dataArrecadacao || "").trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : hojeISO();
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6,
  background: PANEL.field, border: `1px solid ${PANEL.border}`, color: PANEL.text,
  fontSize: "0.85rem", fontFamily: "monospace",
};
const labelStyle = { display: "block", fontSize: "0.7rem", color: PANEL.muted, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 };

export function DeclararComposicaoParcelaModal({ linha, onConfirmar, onClose }) {
  const [textoPrincipal, setTextoPrincipal] = useState("");
  const [textoJuros, setTextoJuros] = useState("");
  const [textoMulta, setTextoMulta] = useState("");
  const [dataPagamento, setDataPagamento] = useState(() => dataInicial(linha));
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState(null);

  const decomposicao = useMemo(
    () => decomporComposicaoDeclarada({ valorGuia: linha?.valor, textoPrincipal, textoJuros, textoMulta }),
    [linha?.valor, textoPrincipal, textoJuros, textoMulta],
  );
  const linhasPrevistas = useMemo(() => lancamentosPrevistos(decomposicao), [decomposicao]);

  // ⚠ DESABILITADO SEMPRE COM O MOTIVO — o projeto proíbe o contrário. E a DIVERGÊNCIA contra a
  // guia NÃO entra aqui: ela avisa, não bloqueia. Bloquear devolveria o contador ao vão que esta
  // tela existe para fechar, e a diferença pode ser legítima (o que foi pago difere da guia).
  const bloqueio = !decomposicao.ok
    ? decomposicao.mensagem
    : (!dataPagamento ? "Informe a data em que a parcela foi paga." : null);

  async function confirmar() {
    if (bloqueio || enviando) return;
    // ⚠ ATO DE CONSEQUÊNCIA CONFIRMA REPETINDO OS DADOS — os três valores, o total, o valor da guia,
    // a data, e o aviso de que a composição é declaração (ver `textoDaConfirmacaoDaComposicao`).
    // eslint-disable-next-line no-alert
    if (!window.confirm(textoDaConfirmacaoDaComposicao({ linha, decomposicao, dataPagamento }))) return;
    setRecusa(null);
    setEnviando(true);
    try {
      await onConfirmar({
        guideId: linha.guideId,
        dataPagamento,
        composicaoDeclarada: {
          principal: decomposicao.principal,
          juros: decomposicao.juros,
          multa: decomposicao.multa,
          // O número que o contador ACABOU de ler na tela — é ele que o servidor confere.
          totalConferido: decomposicao.total,
        },
      });
    } catch (err) {
      // ⚠ A RECUSA FICA NO MODAL, com o motivo. Fechar a tela num erro apagaria o que foi digitado
      // e o contador não saberia se lançou ou não.
      setRecusa(explicarRecusaComposicao(codigoDaRecusa(err), err?.message));
      setEnviando(false);
    }
  }

  if (!linha) return null;
  const n = linha.numeroParcela ?? "?";

  return (
    <div
      role="dialog"
      aria-label="Informar a composição da parcela"
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", zIndex: 60, overflowY: "auto",
      }}
    >
      <div style={{ background: PANEL.surface, border: `1px solid ${PANEL.border}`, borderRadius: 10, width: "min(620px, 100%)", padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <strong style={{ color: PANEL.text, fontSize: "1rem" }}>
              Informar a composição da parcela {n}
            </strong>
            <div style={{ color: PANEL.muted, fontSize: "0.78rem", marginTop: 2 }}>
              {linha.competencia ? `competência ${linha.competencia} · ` : ""}
              guia de {formatarMoeda(linha.valor)}
            </div>
          </div>
          <button
            type="button" onClick={onClose} title="Fechar sem lançar nada"
            style={{ background: "transparent", border: "none", color: PANEL.muted, cursor: "pointer", fontSize: "1.1rem" }}
          >
            ✕
          </button>
        </div>

        {/* ⚠ O QUE É PROVA E O QUE É DECLARAÇÃO — dito no topo, não num rodapé, e SEPARADO. Chamar o
            conjunto de "declaração" afirmaria menos evidência do que existe (o pagamento está
            comprovado pela guia); calar sobre a decomposição apagaria a única parte que o contador
            está afirmando. É essa fronteira que precisa sobreviver para quem auditar depois. */}
        <div style={{
          marginTop: 12, padding: "9px 11px", borderRadius: 6, lineHeight: 1.45, fontSize: "0.76rem",
          color: PANEL.muted, background: "var(--accent-purple-surface)", border: "1px solid var(--accent-purple-border)",
        }}>
          <div style={{ color: "var(--accent-purple)", fontWeight: 700, marginBottom: 2 }}>
            O pagamento está comprovado; a COMPOSIÇÃO é sua declaração
          </div>
          A guia desta parcela está paga — isso é documento. O que ela <strong>não</strong> traz é a
          separação entre principal, juros e multa, e sem ela não há como amortizar o passivo e
          lançar o encargo em contas diferentes. Informe abaixo os três valores{" "}
          <strong>lendo o DAS</strong>. O histórico no razão sai com{" "}
          <strong>“(composição declarada)”</strong>, para que depois se distinga do que a Receita
          provar.
        </div>

        <div style={{ marginTop: 14, fontSize: "0.7rem", color: "var(--accent-purple)", fontWeight: 700, textTransform: "uppercase" }}>
          A composição, como está no DAS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 6 }}>
          <div>
            <label style={labelStyle} htmlFor="composicao-principal">Principal</label>
            <input
              id="composicao-principal" type="text" inputMode="decimal" value={textoPrincipal}
              onChange={(e) => setTextoPrincipal(e.target.value)} placeholder="0,00" style={inputStyle}
              title="O principal do DAS. É ele que amortiza o passivo do parcelamento."
            />
            {decomposicao.erroPrincipal && (
              <div style={{ fontSize: "0.68rem", color: "var(--state-danger)", marginTop: 3 }}>{decomposicao.erroPrincipal}</div>
            )}
            {/* ⚠ O QUE ESTE CAMPO É — e o que ele NÃO é. Aqui digitar NÃO altera o contrato: o
                número vai só para este lançamento. Quem altera o valor contratado da prestação é a
                outra tela, a da prestação sem guia. */}
            <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 3, lineHeight: 1.35 }}>
              É o que <strong>amortiza o passivo</strong> do parcelamento. Este valor vale para{" "}
              <strong>este lançamento</strong> — ele não altera o contrato.
            </div>
          </div>
          <div>
            <label style={labelStyle} htmlFor="composicao-juros">Juros</label>
            <input
              id="composicao-juros" type="text" inputMode="decimal" value={textoJuros}
              onChange={(e) => setTextoJuros(e.target.value)} placeholder="0,00" style={inputStyle}
            />
            {decomposicao.erroJuros && (
              <div style={{ fontSize: "0.68rem", color: "var(--state-danger)", marginTop: 3 }}>{decomposicao.erroJuros}</div>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="composicao-multa">Multa</label>
            <input
              id="composicao-multa" type="text" inputMode="decimal" value={textoMulta}
              onChange={(e) => setTextoMulta(e.target.value)} placeholder="0,00" style={inputStyle}
            />
            {decomposicao.erroMulta && (
              <div style={{ fontSize: "0.68rem", color: "var(--state-danger)", marginTop: 3 }}>{decomposicao.erroMulta}</div>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="composicao-data">Data do pagamento</label>
            <input
              id="composicao-data" type="date" value={dataPagamento}
              onChange={(e) => setDataPagamento(e.target.value)} style={inputStyle}
            />
            {/* ⚠ MÊS FECHADO RECUSA — e a tela diz o que fazer ANTES do clique, não só depois da
                recusa. É a trava que fica (`isMonthClosed`/`MES_FECHADO`). */}
            <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 3, lineHeight: 1.35 }}>
              É ela que decide a competência do lançamento. <strong>Mês fechado recusa</strong> — se
              acontecer, reabra a competência na aba Fechamento contábil e lance de novo.
            </div>
          </div>
        </div>

        {/* ⚠ A CONFERÊNCIA CONTRA O DOCUMENTO — VISÍVEL, E SEM DERIVAR NADA. A guia diz um total; a
            soma dos três campos diz outro. A tela mostra os dois e a diferença, e NÃO preenche
            nenhum campo a partir dos outros: derivar o acréscimo por subtração é como o encargo já
            foi reconhecido em dobro neste projeto. Quem decide qual dos números está errado é o
            contador, com o DAS na mão. */}
        {decomposicao.ok && decomposicao.divergeDoDocumento && (
          <div role="status" style={{
            marginTop: 12, padding: "9px 11px", borderRadius: 6, lineHeight: 1.45, fontSize: "0.75rem",
            color: PANEL.muted, background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
          }}>
            <div style={{ color: "var(--state-warn)", fontWeight: 700, marginBottom: 2 }}>
              A soma não bate com o valor da guia
            </div>
            A guia diz{" "}
            <strong style={{ fontFamily: "monospace" }}>{formatarMoeda(decomposicao.valorDocumento)}</strong>
            {" e os três campos somam "}
            <strong style={{ fontFamily: "monospace", color: PANEL.text }}>{formatarMoeda(decomposicao.total)}</strong>
            {" — diferença de "}
            <strong style={{ fontFamily: "monospace" }}>{formatarMoeda(decomposicao.diferencaDocumento)}</strong>.
            {" Nada é deduzido por subtração aqui: nenhum dos três campos é calculado a partir dos "}
            {"outros. Confira no DAS. Se o valor pago realmente diferiu da guia, pode confirmar — o "}
            {"lançamento sai com o que você informou."}
          </div>
        )}

        {/* ⚠ O QUE VAI SER GRAVADO, LINHA A LINHA — a MESMA prévia da baixa por declaração, do mesmo
            `lancamentosPrevistos`, espelho de `linhasPagamento` no backend. Um botão que só diz
            "Dar baixa" esconde qual conta vai ser debitada por quanto. */}
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
              {decomposicao.mensagem || "Informe principal, juros e multa para ver o que será gravado."}
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
            O total é <strong>derivado</strong> dos três campos acima — por isso ele não se digita:
            o servidor refaz esta soma e <strong>recusa</strong> se ela não bater, e ele não deduz
            juros e multa por subtração. Para mudar o total, mude a origem dele.
          </div>
          <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 4, lineHeight: 1.4 }}>
            As <strong>contas</strong> de cada linha não se escolhem aqui: vêm da configuração deste
            parcelamento e da memória do escritório. Elas são editáveis na aba{" "}
            <strong>Lançamentos</strong>, depois de lançada a baixa — e o sistema aprende o que você
            preencher lá.
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
            {enviando ? "Lançando…" : "Informar a composição e dar baixa"}
          </button>
        </div>
      </div>
    </div>
  );
}
