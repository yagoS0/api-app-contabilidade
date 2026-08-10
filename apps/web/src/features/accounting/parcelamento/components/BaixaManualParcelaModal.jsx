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
  explicarRecusaCorrecao, codigoDaRecusa,
} from "../lib/baixaManualParcela";

/** O valor do contrato como texto EDITÁVEL em pt-BR. Ausente ou zero abre vazio — e vazio é erro. */
function principalInicial(valorPrevisto) {
  const n = Number(valorPrevisto);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n.toFixed(2).replace(".", ",");
}

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

export function BaixaManualParcelaModal({ linha, onConfirmar, onCorrigirValorContratado, onClose }) {
  const [textoPrincipal, setTextoPrincipal] = useState(() => principalInicial(linha?.valorPrevisto));
  const [textoJuros, setTextoJuros] = useState("");
  const [textoMulta, setTextoMulta] = useState("");
  const [dataPagamento, setDataPagamento] = useState(hojeISO());
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState(null);

  const decomposicao = useMemo(
    () => decomporBaixa({ valorPrevisto: linha?.valorPrevisto, textoPrincipal, textoJuros, textoMulta }),
    [linha?.valorPrevisto, textoPrincipal, textoJuros, textoMulta],
  );
  const linhasPrevistas = useMemo(() => lancamentosPrevistos(decomposicao), [decomposicao]);

  // ⚠ `sem_valor_previsto` DEIXOU DE BLOQUEAR AQUI, e é a mudança da fase. Ele era a recusa que
  // mandava "corrigir o valor da parcela no contrato" — um caminho nomeado e inexistente. Hoje a
  // correção É este modal, e tratá-lo como bloqueio fecharia a única porta que resolve o problema.
  // `provisao_inexistente` continua bloqueando: a adesão não se lança daqui.
  const bloqueioDoServidor = linha?.motivoBloqueio && linha.motivoBloqueio !== "sem_valor_previsto"
    ? explicarRecusa(linha.motivoBloqueio)
    : null;

  // ⚠ DESABILITADO SEMPRE COM O MOTIVO — o projeto proíbe o contrário. Os motivos nascem do
  // servidor (provisão de abertura ausente) ou do que está digitado (principal/juros/multa
  // ilegíveis, data em branco).
  const bloqueio = bloqueioDoServidor
    || (!decomposicao.ok ? decomposicao.mensagem : (!dataPagamento ? "Informe a data em que o débito saiu da conta." : null));

  // A alteração do CONTRATO é um ato próprio, com rota própria — ela não viaja no body da baixa.
  const alterandoContrato = Boolean(decomposicao.principalAlterado) && decomposicao.ok;
  const podeAlterarContrato = typeof onCorrigirValorContratado === "function";

  /**
   * A CONSEQUÊNCIA DA CORREÇÃO, EM NÚMERO — calculada aqui porque o servidor já mandou o total.
   *
   * ⚠ A aritmética é `soma_atual − valor_desta_prestação + valor_novo`: a conferência que veio na
   * fila conta TODAS as prestações que ainda amortizam, e a correção troca UMA delas. Refazer a
   * soma inteira exigiria as 60 linhas na tela. ⚠ `null` quando a fila não mandou a conferência —
   * ausência de dado não vira zero, e um "fecham" afirmado sobre número inventado seria pior que
   * não dizer nada.
   */
  const consequencia = useMemo(() => {
    const c = linha?.conferenciaPassivo;
    if (!alterandoContrato || !c || !Number.isFinite(Number(c.somaPrestacoes))) return null;
    const anterior = decomposicao.principalContratado ?? 0;
    const soma = Math.round((Number(c.somaPrestacoes) - anterior + decomposicao.principal) * 100) / 100;
    const provisionado = c.principalProvisionado != null ? Number(c.principalProvisionado) : null;
    return {
      prestacoes: c.prestacoesAmortizaveis ?? null,
      soma,
      provisionado,
      diferenca: provisionado != null ? Math.round((soma - provisionado) * 100) / 100 : null,
    };
  }, [alterandoContrato, linha?.conferenciaPassivo, decomposicao.principal, decomposicao.principalContratado]);

  async function confirmar() {
    if (bloqueio || enviando) return;
    // ⚠ ATO DE CONSEQUÊNCIA CONFIRMA REPETINDO OS DADOS — prestação, contrato, os três valores, o
    // total e a data, mais o aviso de que isto é declaração. Quando o valor CONTRATADO muda, a
    // confirmação diz também o que ele era e o que passa a ser (ver `textoDaConfirmacao`).
    // eslint-disable-next-line no-alert
    if (!window.confirm(textoDaConfirmacao({ linha, decomposicao, dataPagamento, consequencia }))) return;
    setRecusa(null);
    setEnviando(true);

    // ⚠ O CONTRATO É GRAVADO ANTES DA BAIXA, E EM DUAS CHAMADAS — de propósito. São dois fatos:
    // "o acordo diz que esta prestação vale X" e "o débito de X + acréscimos saiu da conta". Se a
    // primeira falhar, a segunda NÃO sai: a baixa amortizaria um valor que o contrato não
    // reconhece, e o contador veria o número antigo voltar na próxima tela — que é exatamente a
    // edição-que-se-perde que esta fase existe para evitar.
    if (alterandoContrato) {
      try {
        await onCorrigirValorContratado({
          parcelaId: linha.parcelaId,
          valorPrevisto: decomposicao.principal,
          // O "era" que ESTA tela mostrou. O servidor recusa se o contrato tiver mudado no meio.
          valorAnteriorConferido: decomposicao.principalContratado,
        });
      } catch (err) {
        setRecusa(explicarRecusaCorrecao(codigoDaRecusa(err), err?.message));
        setEnviando(false);
        return;
      }
    }

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

        {/* ⚠ DOIS BLOCOS, DOIS FATOS — e é essa separação que dá autonomia sem escolher no escuro.
            Um campo só que ora significa "o acordo diz X" e ora "eu paguei X" faria o contador
            decidir sem saber qual dos dois está mexendo. Aqui os dois são editáveis, cada um
            nomeado, cada um com o efeito escrito ao lado. */}
        <div style={{ marginTop: 14, fontSize: "0.7rem", color: "var(--accent-purple)", fontWeight: 700, textTransform: "uppercase" }}>
          1 · O contrato — quanto o acordo diz que esta prestação vale
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 6 }}>
          <div>
            <label style={labelStyle} htmlFor="baixa-manual-principal">Principal (valor contratado)</label>
            <input
              id="baixa-manual-principal" type="text" inputMode="decimal" value={textoPrincipal}
              onChange={(e) => setTextoPrincipal(e.target.value)} placeholder="0,00"
              disabled={!podeAlterarContrato}
              title={podeAlterarContrato
                ? "É o que o ACORDO diz que esta prestação vale. Alterar aqui altera o contrato."
                : "A alteração do valor contratado não está disponível neste modo de API."}
              style={{
                ...inputStyle,
                ...(decomposicao.principalAlterado
                  ? { borderColor: "var(--state-warn)", background: "var(--state-warn-surface)" }
                  : null),
              }}
            />
            {decomposicao.erroPrincipal && (
              <div style={{ fontSize: "0.68rem", color: "var(--state-danger)", marginTop: 3 }}>{decomposicao.erroPrincipal}</div>
            )}
            {/* ⚠ O QUE ESTE CAMPO É — e o que ele NÃO é. Digitar aqui não declara "quanto eu paguei":
                declara quanto o ACORDO diz que a prestação vale. O que foi pago a mais entra em
                juros/multa, e a diferença entre os dois números é informação, não erro. */}
            <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 3, lineHeight: 1.35 }}>
              É o <strong>valor do contrato</strong> (<code>valorPrevisto</code>), não o valor pago:
              é ele que a baixa amortiza do passivo. Pagou mais? O acréscimo vai em juros/multa,
              abaixo. <strong>Alterar aqui altera o contrato</strong> e persiste.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, fontSize: "0.7rem", color: "var(--accent-purple)", fontWeight: 700, textTransform: "uppercase" }}>
          2 · O pagamento — quanto saiu da conta
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 6 }}>
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

        {/* ⚠ ALTERAR O CONTRATO É UM SEGUNDO ATO, E ELE APARECE NOMEADO — com o que ERA e o que
            PASSA A SER. Sem este bloco, a única pista de que o acordo foi reescrito seria a borda
            do campo, e a confirmação chegaria como surpresa. */}
        {alterandoContrato && (
          <div role="status" style={{
            marginTop: 12, padding: "9px 11px", borderRadius: 6, lineHeight: 1.45, fontSize: "0.75rem",
            color: PANEL.muted, background: "var(--state-warn-surface)", border: "1px solid var(--state-warn)",
          }}>
            <div style={{ color: "var(--state-warn)", fontWeight: 700, marginBottom: 2 }}>
              Isto altera o CONTRATO, não só esta baixa
            </div>
            O valor contratado da prestação {n} passa de{" "}
            <strong style={{ fontFamily: "monospace" }}>
              {decomposicao.principalContratado == null
                ? "sem valor"
                : formatarMoeda(decomposicao.principalContratado)}
            </strong>{" "}
            para{" "}
            <strong style={{ fontFamily: "monospace", color: PANEL.text }}>
              {formatarMoeda(decomposicao.principal)}
            </strong>
            . É o número que todas as telas vão mostrar desta prestação daqui em diante, e é ele que
            a baixa amortiza do passivo. <strong>As demais prestações não são tocadas.</strong>
            {/* ⚠ A CONSEQUÊNCIA, EM NÚMERO, ANTES DO CLIQUE. O passivo `PARC` nasce valendo o
                principal que a adesão provisionou (`linhasProvisao` reconhece SÓ o principal —
                decisão do dono), e a soma das amortizações é o que o zera. Mostrar o resultado da
                correção contra esse total é o que transforma "alterei um campo" em decisão
                informada. ⚠ NÃO BLOQUEIA: o número certo sai do contrato, e quem decide é o
                contador. */}
            {consequencia && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--state-warn)" }}>
                Depois desta correção, as <strong>{consequencia.prestacoes}</strong> prestações que
                ainda amortizam somam{" "}
                <strong style={{ fontFamily: "monospace" }}>{formatarMoeda(consequencia.soma)}</strong>
                {consequencia.provisionado == null ? (
                  <> — e não há provisão de abertura registrada para comparar.</>
                ) : (
                  <>
                    {" contra o principal provisionado na adesão de "}
                    <strong style={{ fontFamily: "monospace" }}>{formatarMoeda(consequencia.provisionado)}</strong>
                    {Math.abs(consequencia.diferenca) <= 0.01
                      ? <> — <strong style={{ color: "var(--state-ok)" }}>fecham</strong>: o passivo zera ao fim do contrato.</>
                      : (
                        <>
                          {" — sobra "}
                          <strong style={{ fontFamily: "monospace" }}>{formatarMoeda(consequencia.diferenca)}</strong>
                          {" de diferença. É informação, não impedimento: juros embutidos nas prestações "}
                          {"explicam a diferença, e o número certo é o do contrato."}
                        </>
                      )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

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
              Total PAGO conferido = principal + juros + multa
            </span>
            <strong style={{ color: PANEL.text, fontFamily: "monospace", fontSize: "0.95rem" }}>
              {formatarMoeda(decomposicao.total)}
            </strong>
          </div>
          {/* ⚠ OS DOIS NÚMEROS, LADO A LADO E NOMEADOS. Contratado 1.000 com pago 1.037,42 é
              informação (juros, TJLP, atraso), não erro de digitação — e é por isso que eles nunca
              colapsam num campo só. Sem esta linha, o "total" seria lido como se fosse o contrato. */}
          {decomposicao.ok && (decomposicao.juros > 0 || decomposicao.multa > 0) && (
            <div style={{ fontSize: "0.7rem", color: PANEL.muted, marginTop: 6, lineHeight: 1.4 }}>
              Contratado <strong style={{ fontFamily: "monospace" }}>{formatarMoeda(decomposicao.principal)}</strong>
              {" · "}pago <strong style={{ fontFamily: "monospace" }}>{formatarMoeda(decomposicao.total)}</strong>
              {" — a diferença de "}
              <strong style={{ fontFamily: "monospace" }}>
                {formatarMoeda(Math.round((decomposicao.juros + decomposicao.multa) * 100) / 100)}
              </strong>
              {" é acréscimo (juros/multa), despesa do mês do pagamento. Ela NÃO amortiza o passivo."}
            </div>
          )}
          <div style={{ fontSize: "0.66rem", color: PANEL.muted, marginTop: 4, lineHeight: 1.4 }}>
            O total é <strong>derivado</strong> dos três campos acima — por isso ele não se digita:
            o servidor refaz esta soma e <strong>recusa</strong> se ela não bater, e ele não deduz
            juros e multa por subtração. Para mudar o total, mude a origem dele (principal, juros
            ou multa).
          </div>
          {/* ⚠ A ÚNICA COISA QUE ESTA TELA NÃO DEIXA ESCOLHER — e ela diz ONDE se escolhe, em vez
              de simplesmente não oferecer. As contas vêm da config do parcelamento e da memória
              (`MapaContaTributo`); editá-las aqui daria duas fontes para o mesmo mapeamento, e o
              lugar onde a memória APRENDE é o lançamento. */}
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
            {enviando ? "Lançando…" : "Declarar e lançar a baixa"}
          </button>
        </div>
      </div>
    </div>
  );
}
