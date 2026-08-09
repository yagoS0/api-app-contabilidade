// A REGRA DE TELA DA BAIXA POR DECLARAÇÃO — a prestação SEM GUIA (débito automático).
//
// ⚠ AS DUAS FILAS RESPONDEM PERGUNTAS DIFERENTES, e este arquivo existe para que a diferença não
// suma no meio de uma tabela:
//
//   · "Parcelas pagas aguardando lançamento"  → a guia foi PAGA (sinal externo, do SERPRO);
//                                                falta lançar. A tela só repete o documento.
//   · "Prestações vencidas sem guia"          → não há sinal NENHUM. O contador DECLARA que o
//                                                débito saiu da conta, e é essa declaração que
//                                                vira lançamento contábil.
//
// ⚠ JUROS E MULTA SÃO ENTRADA, NÃO DERIVAÇÃO. O servidor recusa (`CONFERENCIA_DIVERGENTE`) todo
// total que não bata com `principal + juros + multa` — ele NÃO deriva o acréscimo por subtração,
// porque foi assim que o encargo já foi reconhecido em dobro no passado. Aqui a conta é feita para
// frente e mostrada antes do clique; o `totalConferido` que sobe é exatamente o número que o
// contador leu.
//
// ⚠ O PRINCIPAL NÃO É CAMPO. Ele vem de `parcelas.valorPrevisto` (o contrato) e viaja read-only:
// aceitar um valor digitado no lugar transformaria a baixa numa segunda fonte para o valor da
// prestação.

import { avaliarValor, MENSAGENS_VALOR } from "../../entries/lib/valorFormula.js";

/** Duas casas — a coluna é `Decimal(18,2)`; a mesma disciplina de `round2` no backend. */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function formatarMoeda(v) {
  return Number.isFinite(Number(v))
    ? Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
}

/**
 * Lê um campo de acréscimo (juros ou multa).
 *
 * ⚠ VAZIO É ZERO, E NÃO É ERRO — parcela paga em dia não tem acréscimo nenhum, e é o caso comum do
 * débito automático. `avaliarValor` (a MESMA leitura da célula de valor da aba Lançamentos, com a
 * gramática estrita de separador decimal que impede `1.500` virar 1,50) já separa "vazio" de
 * "inválido"; aqui só se acrescenta a recusa do NEGATIVO, que é a que o servidor também faz
 * (`acrescimo_negativo`).
 */
export function lerAcrescimo(texto) {
  const r = avaliarValor(texto);
  if (!r.ok) return { ok: false, valor: null, erro: r.erro, mensagem: r.mensagem };
  if (r.vazio) return { ok: true, valor: 0, vazio: true };
  if (r.valor < 0) {
    return {
      ok: false, valor: null, erro: "acrescimo_negativo",
      mensagem: "Juros e multa não podem ser negativos — se o valor foi menor, o principal é que muda, e ele vem do contrato.",
    };
  }
  return { ok: true, valor: round2(r.valor) };
}

/**
 * A decomposição do que vai ser lançado, montada PARA FRENTE.
 *
 * Devolve sempre a mesma forma. `ok:false` desabilita o envio COM O MOTIVO (nunca sem) — e nunca
 * devolve um total "otimista" com um dos campos ilegível, que é como um número errado chegaria a
 * `totalConferido` e o servidor recusaria depois de o contador já ter confirmado.
 */
export function decomporBaixa({ valorPrevisto, textoJuros = "", textoMulta = "" } = {}) {
  const principal = valorPrevisto != null ? round2(valorPrevisto) : null;
  const j = lerAcrescimo(textoJuros);
  const m = lerAcrescimo(textoMulta);

  const base = {
    principal, juros: j.valor, multa: m.valor,
    erroJuros: j.ok ? null : j.mensagem,
    erroMulta: m.ok ? null : m.mensagem,
  };

  if (!Number.isFinite(principal) || principal <= 0) {
    return {
      ...base, total: null, ok: false,
      erro: "sem_valor_previsto",
      mensagem: "Esta prestação não tem valor previsto no contrato, e o principal não se inventa. "
        + "Corrija o contrato (valor da parcela) antes de declarar a baixa.",
    };
  }
  if (!j.ok || !m.ok) {
    return { ...base, total: null, ok: false, erro: "acrescimo_invalido", mensagem: j.mensagem || m.mensagem };
  }
  return { ...base, total: round2(principal + j.valor + m.valor), ok: true, erro: null, mensagem: null };
}

/**
 * O que será GRAVADO no razão, linha a linha — o espelho de `linhasPagamento` no backend.
 *
 * ⚠ ESTA É A PARTE QUE FAZ O ATO DE CONSEQUÊNCIA SER CONFERÍVEL. A baixa grava até quatro
 * lançamentos e amortiza passivo; um botão que só diz "Dar baixa" esconde qual conta vai ser
 * debitada por quanto. Componente zerado NÃO gera lançamento — igual ao backend, que pula
 * `valor <= 0` — e por isso ele também não aparece aqui: a prévia mostraria uma linha que não vai
 * existir.
 */
export function lancamentosPrevistos(decomposicao) {
  if (!decomposicao?.ok) return [];
  const { principal, juros, multa, total } = decomposicao;
  const linhas = [
    { papel: "PARC", lado: "D", valor: principal, o_que: "Parcelamento a pagar", efeito: "amortiza o passivo" },
  ];
  if (juros > 0) linhas.push({ papel: "JUROS", lado: "D", valor: juros, o_que: "Juros", efeito: "despesa do mês do pagamento" });
  if (multa > 0) linhas.push({ papel: "MULTA", lado: "D", valor: multa, o_que: "Multa", efeito: "despesa do mês do pagamento" });
  linhas.push({ papel: "CAIXA", lado: "C", valor: total, o_que: "Caixa/banco", efeito: "o dinheiro que saiu da conta" });
  return linhas;
}

/**
 * As recusas do servidor, cada uma com a SAÍDA que o contador precisa.
 *
 * ⚠ Toda guarda de `gerarPagamentoParcelaManual` está aqui. Recusa que chega à tela como código
 * cru (`provisao_inexistente`) é recusa que o contador não sabe resolver — e as duas primeiras têm
 * outro caminho aberto, que precisa ser DITO, não deduzido.
 */
export const MOTIVOS_BAIXA_MANUAL = Object.freeze({
  parcela_tem_guia: "Esta prestação ganhou uma guia (a captura do SERPRO pode tê-la trazido agora). "
    + "A baixa dela é pela guia, na fila “Parcelas pagas aguardando lançamento” — lá a composição vem "
    + "do documento, em vez de ser declarada.",
  parcela_ja_baixada: "Esta prestação já foi baixada. Se a baixa estiver errada, desfaça-a pelo estorno "
    + "(no lançamento) — ela volta para esta fila.",
  provisao_inexistente: "O parcelamento não tem a provisão de abertura, então não há passivo a amortizar. "
    + "Lance a adesão antes.",
  sem_valor_previsto: "A prestação não tem valor previsto no contrato, e o principal não se inventa. "
    + "Corrija o valor da parcela no contrato.",
  acrescimo_negativo: "Juros e multa não podem ser negativos.",
  data_invalida: "A data do pagamento não foi entendida.",
  parcela_not_found: "Prestação não encontrada — a lista pode estar desatualizada. Recarregue a fila.",
  parcelamento_not_found: "Parcelamento não encontrado.",
  MES_FECHADO: "A competência da data do pagamento está FECHADA. Reabra o mês, ou lance a baixa na "
    + "competência correta — o mês fechado já foi reportado, e mudá-lo sem reabrir não deixa rastro.",
  CONFERENCIA_OBRIGATORIA: "O servidor exige o total conferido. Confira os valores e tente de novo.",
  CONFERENCIA_DIVERGENTE: "O total que o servidor calcula não é o que foi conferido nesta tela — "
    + "alguém pode ter mudado o valor da prestação no contrato. Recarregue a fila e confira de novo.",
});

/**
 * O código da recusa, venha ele por onde vier.
 *
 * ⚠ A ROTA RESPONDE DE DUAS FORMAS, e ignorar uma delas apagaria metade dos motivos:
 *   · guardas de negócio → `{ ok:false, skipped:true, motivo:"parcela_tem_guia" }` (404/409/422/400)
 *   · exceções nomeadas  → `{ ok:false, error:"CONFERENCIA_DIVERGENTE", message }` (400/409)
 * O `request` do `realApi` só promove `payload.error` a `err.code`; o `motivo` fica no `payload`.
 */
export function codigoDaRecusa(err) {
  return err?.code || err?.payload?.motivo || err?.payload?.error || err?.motivo || err?.error || null;
}

export function explicarRecusa(codigo, mensagemDoServidor) {
  const conhecido = MOTIVOS_BAIXA_MANUAL[codigo];
  if (conhecido) return conhecido;
  // ⚠ Mensagem do servidor só quando ela é FRASE. Vários códigos do projeto chegam com a mensagem
  // igual ao código (`serpro_pagtoweb_disabled`) — exibi-la crua poria um identificador no lugar do
  // motivo. Sem espaço em branco = não é frase.
  const texto = String(mensagemDoServidor || "").trim();
  if (texto && /\s/.test(texto)) return texto;
  return "O servidor recusou a baixa e não disse por quê.";
}

/**
 * A confirmação REPETE OS DADOS — quem, quanto, em qual competência, e o que será gravado.
 *
 * ⚠ E diz que é DECLARAÇÃO. O dado gravado é `origemBaixa: "MANUAL"` e o histórico sai com
 * "(declarado)": quando a via SERPRO existir, ela gravará outra coisa. O contador precisa saber
 * qual das duas ele está fazendo — é a única diferença entre "a Receita provou" e "eu afirmei".
 */
export function textoDaConfirmacao({ linha, decomposicao, dataPagamento }) {
  const n = linha?.numeroParcela ?? "?";
  const de = linha?.parcelamento?.numParcelas ?? "?";
  const contrato = linha?.parcelamento?.label || "este contrato";
  const comp = linha?.competencia ? ` (competência ${linha.competencia})` : "";
  const quando = dataPagamento
    ? new Date(`${dataPagamento}T12:00:00`).toLocaleDateString("pt-BR")
    : "hoje";
  const partes = [
    `Declarar o pagamento da prestação ${n} de ${de} — ${contrato}${comp}.`,
    "",
    `Principal (do contrato): ${formatarMoeda(decomposicao?.principal)}`,
    `Juros (declarado por você): ${formatarMoeda(decomposicao?.juros)}`,
    `Multa (declarada por você): ${formatarMoeda(decomposicao?.multa)}`,
    `TOTAL: ${formatarMoeda(decomposicao?.total)}`,
    `Data do pagamento: ${quando}`,
    "",
    "Isto GRAVA lançamentos contábeis (principal, juros e multa separados) e amortiza o passivo do",
    "parcelamento. É uma DECLARAÇÃO sua, não um comprovante: fica registrada como baixa MANUAL e o",
    "histórico sai com \"(declarado)\".",
    "",
    "Confirmar?",
  ];
  return partes.join("\n");
}

/** Rótulo da situação da linha. `VENCIDA` e `VENCE_HOJE` vêm do servidor — a tela não recalcula. */
export function rotuloDaSituacao(situacao) {
  return situacao === "VENCE_HOJE"
    ? { texto: "Vence hoje", cor: "var(--state-neutral)", titulo: "O vencimento contratado é hoje — ainda dá tempo." }
    : { texto: "Vencida", cor: "var(--state-warn)", titulo: "O vencimento contratado já passou." };
}

export { MENSAGENS_VALOR };
