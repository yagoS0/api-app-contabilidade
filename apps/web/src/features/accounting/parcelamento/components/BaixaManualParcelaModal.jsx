import { useConfirmacao } from "../../../../components/ui/useConfirmacao";
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

import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "../../../../components/ui/Modal";
import { Button } from "../../../../components/ui/Button";
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

const PANEL = { text: "var(--text)", muted: "var(--text-muted)", border: "var(--border)", surface: "var(--bg-surface)", field: "var(--bg-subtle)" };

function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6,
  background: PANEL.field, border: `1px solid ${PANEL.border}`, color: PANEL.text,
  fontSize: "0.85rem", fontFamily: "monospace",
};
const labelStyle = { display: "block", fontSize: "0.8125rem", color: PANEL.muted, fontWeight: 600, marginBottom: 3 };

export function BaixaManualParcelaModal({ linha, onConfirmar, onCorrigirValorContratado, onClose }) {
  const { pedir, dialogo: confirmacao } = useConfirmacao();
  const principalConfirmado = linha?.pagamentoConfirmado && Number(linha?.comprovante?.principal) > 0 ? Number(linha.comprovante.principal) : null;
  const [textoPrincipal, setTextoPrincipal] = useState(() => principalInicial(principalConfirmado ?? linha?.valorPrevisto));
  const [textoJuros, setTextoJuros] = useState(() => principalInicial(linha?.comprovante?.juros));
  const [textoMulta, setTextoMulta] = useState(() => principalInicial(linha?.comprovante?.multa));
  const [dataPagamento, setDataPagamento] = useState(() => {
    const data = linha?.pagamentoEm || linha?.comprovante?.dataArrecadacao;
    if (typeof data === "string" && /^\d{4}-\d{2}-\d{2}/.test(data)) return data.slice(0, 10);
    return hojeISO();
  });
  const [enviando, setEnviando] = useState(false);
  const [recusa, setRecusa] = useState(null);
  const [valorContratado, setValorContratado] = useState(principalConfirmado ?? linha?.valorPrevisto);
  const [contratoAtualizado, setContratoAtualizado] = useState(false);
  const botaoConfirmarRef = useRef(null);
  const confirmacaoAnterior = useRef(false);
  useEffect(() => {
    const voltouAoFormulario = confirmacaoAnterior.current && !confirmacao;
    confirmacaoAnterior.current = Boolean(confirmacao);
    // Executa depois do commit que remove inert e da limpeza de foco da confirmação irmã.
    if (voltouAoFormulario && !enviando) botaoConfirmarRef.current?.focus();
  }, [confirmacao, enviando]);

  const decomposicao = useMemo(
    () => decomporBaixa({ valorPrevisto: valorContratado, textoPrincipal, textoJuros, textoMulta }),
    [valorContratado, textoPrincipal, textoJuros, textoMulta],
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
    const anterior = Number(linha?.valorPrevisto) || 0;
    const soma = Math.round((Number(c.somaPrestacoes) - anterior + decomposicao.principal) * 100) / 100;
    const provisionado = c.principalProvisionado != null ? Number(c.principalProvisionado) : null;
    return {
      prestacoes: c.prestacoesAmortizaveis ?? null,
      soma,
      provisionado,
      diferenca: provisionado != null ? Math.round((soma - provisionado) * 100) / 100 : null,
    };
  }, [alterandoContrato, linha?.conferenciaPassivo, linha?.valorPrevisto, decomposicao.principal]);

  async function confirmar() {
    if (bloqueio || enviando) return;
    // ⚠ ATO DE CONSEQUÊNCIA CONFIRMA REPETINDO OS DADOS — prestação, contrato, os três valores, o
    // total e a data, mais o aviso de que isto é declaração. Quando o valor CONTRATADO muda, a
    // confirmação diz também o que ele era e o que passa a ser (ver `textoDaConfirmacao`).
    // eslint-disable-next-line no-alert
    if (!await pedir({ titulo: "Confirmar declaração de pagamento", acao: "Confirmar pagamento declarado", texto: textoDaConfirmacao({ linha, decomposicao, dataPagamento, consequencia }) })) {
      return;
    }
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
        // A alteração contratual já foi gravada, mesmo se a baixa seguinte falhar. A próxima
        // tentativa usa esse valor e não repete a correção com a conferência antiga.
        setValorContratado(decomposicao.principal);
        setContratoAtualizado(true);
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
  const fechar = () => onClose?.({ contratoAtualizado });
  const ajuda = { fontSize: "0.8125rem", color: PANEL.muted, lineHeight: 1.45 };

  return <>
    <Modal titulo="Declarar baixa da prestação" tamanho="md" aoFechar={fechar}
      ocupado={enviando} suspenso={Boolean(confirmacao)} fecharAoClicarFundo={false}
      rodape={<>
        {bloqueio && <span style={{ ...ajuda, color: "var(--state-warn)", flex: "1 1 100%" }}>{bloqueio}</span>}
        <Button variant="secondary" onClick={fechar} disabled={enviando}>Cancelar</Button>
        <Button ref={botaoConfirmarRef} variant="primary" onClick={confirmar} disabled={Boolean(bloqueio) || enviando}
          title={bloqueio || "Confirma os dados antes de gravar."}>
          {enviando ? "Lançando…" : alterandoContrato ? "Informar valor e declarar a baixa" : "Declarar e lançar a baixa"}
        </Button>
      </>}
    >
      <div style={{ ...ajuda, marginBottom: 12 }}>
        <strong style={{ color: PANEL.text }}>Prestação {n} de {de} · {linha.parcelamento?.label || "Contrato"}</strong>
        {linha.competencia && <span> · {linha.competencia}</span>}
      </div>
      <p style={{ ...ajuda, margin: "0 0 14px" }}>
        {linha.pagamentoConfirmado ? <><strong>Pagamento confirmado pela Receita.</strong> Confira os valores antes de lançar. Suas alterações ficam registradas como declaração.</> : <><strong>Pagamento declarado por você, sem comprovante fiscal.</strong> Confira o débito no extrato antes de lançar.</>}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="baixa-manual-principal">{principalConfirmado != null ? "Principal confirmado" : "Principal (valor contratado)"}</label>
          <input id="baixa-manual-principal" type="text" inputMode="decimal" value={textoPrincipal}
            onChange={(e) => setTextoPrincipal(e.target.value)} placeholder="0,00"
            disabled={enviando || !podeAlterarContrato || principalConfirmado != null} style={inputStyle}
            title={principalConfirmado != null ? "Principal da evidência fiscal confirmada." : podeAlterarContrato ? "Alterar este valor modifica o contrato." : "O principal vem do contrato."} />
          {decomposicao.erroPrincipal && <div style={{ ...ajuda, color: "var(--state-danger)" }}>{decomposicao.erroPrincipal}</div>}
        </div>
        <div>
          <label style={labelStyle} htmlFor="baixa-manual-data">Data do pagamento</label>
          <input id="baixa-manual-data" type="date" value={dataPagamento} disabled={enviando}
            onChange={(e) => setDataPagamento(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="baixa-manual-juros">Juros (você declara)</label>
          <input id="baixa-manual-juros" type="text" inputMode="decimal" value={textoJuros} disabled={enviando}
            onChange={(e) => setTextoJuros(e.target.value)} placeholder="0,00" style={inputStyle} />
          {decomposicao.erroJuros && <div style={{ ...ajuda, color: "var(--state-danger)" }}>{decomposicao.erroJuros}</div>}
        </div>
        <div>
          <label style={labelStyle} htmlFor="baixa-manual-multa">Multa (você declara)</label>
          <input id="baixa-manual-multa" type="text" inputMode="decimal" value={textoMulta} disabled={enviando}
            onChange={(e) => setTextoMulta(e.target.value)} placeholder="0,00" style={inputStyle} />
          {decomposicao.erroMulta && <div style={{ ...ajuda, color: "var(--state-danger)" }}>{decomposicao.erroMulta}</div>}
        </div>
      </div>
      {alterandoContrato && <div role="status" style={{ ...ajuda, marginTop: 12, padding: 10, background: "var(--state-warn-surface)", borderRadius: 6 }}>
        <strong style={{ color: "var(--state-warn)" }}>Isto altera o CONTRATO, não só esta baixa.</strong>
        <div>Principal: {decomposicao.principalContratado == null ? "sem valor" : formatarMoeda(decomposicao.principalContratado)} → {formatarMoeda(decomposicao.principal)}. As demais prestações não são alteradas.</div>
        {consequencia && <div>Prestações: {formatarMoeda(consequencia.soma)} · Provisão: {consequencia.provisionado == null ? "não informada" : formatarMoeda(consequencia.provisionado)}{consequencia.diferenca != null && <> · Diferença: {formatarMoeda(consequencia.diferenca)}</>}</div>}
      </div>}
      <div style={{ marginTop: 14, padding: 12, background: PANEL.field, border: "1px solid var(--border)", borderRadius: 8 }}>
        <strong style={{ fontSize: "0.875rem" }}>O que vai ser lançado</strong>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          {linhasPrevistas.length ? <table style={{ width: "100%", minWidth: 0, tableLayout: "fixed", borderCollapse: "collapse" }}>
            <colgroup><col style={{ width: 30 }} /><col /><col style={{ width: "30%" }} /></colgroup>
            <tbody>{linhasPrevistas.map((l) => <tr key={l.papel}>
              <td style={{ padding: "6px 4px", fontSize: "0.8125rem", whiteSpace: "normal" }}>{l.lado}</td>
              <td style={{ padding: "6px 4px", whiteSpace: "normal", overflowWrap: "anywhere", fontSize: "0.8125rem" }}>{l.o_que}<div style={ajuda}>{l.efeito}</div></td>
              <td style={{ padding: "6px 4px", textAlign: "right", fontSize: "0.8125rem", whiteSpace: "normal", overflowWrap: "anywhere", fontVariantNumeric: "tabular-nums" }}>{formatarMoeda(l.valor)}</td>
            </tr>)}</tbody>
          </table> : <p style={ajuda}>{decomposicao.mensagem || "Preencha os valores para ver os lançamentos."}</p>}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 6 }}>
          <span style={ajuda}>Total pago · principal + juros + multa</span>
          <strong>{formatarMoeda(decomposicao.total)}</strong>
        </div>
        {decomposicao.ok && (decomposicao.juros > 0 || decomposicao.multa > 0) && <p style={{ ...ajuda, margin: "8px 0 0" }}>Juros e multa são despesas do pagamento. O acréscimo NÃO amortiza o passivo.</p>}
      </div>
      <details style={{ ...ajuda, marginTop: 12 }}>
        <summary style={{ cursor: "pointer" }}>Como a baixa é registrada</summary>
        <p>O principal é o valor contratado; alterá-lo modifica apenas esta prestação. Juros e multa compõem o total pago. A data do pagamento define a competência do lançamento, que precisa estar aberta.</p>
        <p>A baixa fica registrada como MANUAL, com histórico “(declarado)”. As contas vêm da configuração do parcelamento e podem ser revisadas em Lançamentos.</p>
      </details>
      {contratoAtualizado && !enviando && <div role="status" style={{ ...ajuda, marginTop: 12, color: "var(--state-warn)" }}>O valor contratado foi salvo. A baixa ainda precisa ser concluída; tentar novamente mantém o valor salvo.</div>}
      {recusa && <div role="status" style={{ ...ajuda, marginTop: 12, padding: 10, background: "var(--state-danger-surface)", borderRadius: 6 }}><strong style={{ color: "var(--state-danger)" }}>A baixa não foi concluída.</strong><div>{recusa}</div></div>}
    </Modal>
    {confirmacao}
  </>;
}
