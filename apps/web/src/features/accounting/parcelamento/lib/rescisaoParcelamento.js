// A REGRA DO PRÉ-PREENCHIMENTO DA RESCISÃO — e, principalmente, a RECUSA.
//
// ⚠ POR QUE ISTO VIROU UMA LIB. O modal lia `parc.saldoRestante` com `|| 0`, e `saldoRestante` era
// `max(0, totalValue − parcelasPagas × principalPerParcela)`: um consolidado menos um "principal"
// que, nos contratos do V2, é o valor CHEIO da prestação. Três consequências, em ordem de gravidade:
//
//   1. contrato sem `principalTotal` confiável (o que o wizard produz hoje) pré-preenchia a rescisão
//      com **R$ 0,00** — e ninguém pré-preenche zero por engano num formulário; o zero PARECE uma
//      resposta, e a rescisão manda o saldo para a Dívida Ativa da União;
//   2. contrato do V2 pré-preenchia com um número grande demais (o consolidado inteiro, porque o
//      "principal pago" descontado estava inflado pelo valor cheio);
//   3. o `|| 0` apagava a diferença entre "não sei" e "é zero" — que é justamente a distinção que
//      este projeto trata como inegociável (`analitica` tri-estado, `semFaturamento` tri-estado,
//      `conferenciaDoPassivoPorContrato.principalProvisionado: null`).
//
// ⚠ PRÉ-PREENCHER ZERO NUM LANÇAMENTO DE RESCISÃO É PIOR QUE RECUSAR. Por isso o desfecho quando o
// número não se sabe não é "abre com o campo vazio": é abrir DIZENDO o que falta e por quê, com o
// botão bloqueado até o contador digitar os valores por conta própria.
//
// ⚠ A FORMA DO LANÇAMENTO NÃO MUDA. As três linhas (D PARC · C PRINCIPAL · C JUROS), os papéis, os
// lados e a identidade `PARC = PRINCIPAL + JUROS` são exatamente os de antes — o que muda é DE ONDE
// sai o número do principal remanescente, e o que acontece quando ele não existe.

/** `null` para qualquer coisa que não seja um número finito — inclusive `undefined` e `""`. */
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * O que a rescisão pode pré-preencher, e o que ela precisa recusar.
 *
 * @param {object} parc o contrato como `listParcelamentos` o devolve
 * @returns {{
 *   podePrePreencher: boolean,
 *   motivo: string|null,
 *   principalRemanescente: number|null,
 *   jurosRemanescente: number|null,
 *   totalRemanescente: number|null,
 *   saldoPassivo: number|null,
 *   avisoDivergencia: string|null,
 * }}
 */
export function baseDaRescisao(parc) {
  // ⚠ `saldoContratual` É O CAMPO NOVO, e ele pode ser `null` de propósito: sem `principalTotal`
  // confiável no cabeçalho não se sabe quanto do acordo é principal. `saldoRestante` NÃO existe mais
  // — ler o nome antigo aqui devolveria `undefined`, que com `|| 0` volta a ser o zero fabricado.
  const principalRemanescente = num(parc?.saldoContratual);
  const saldoPassivo = num(parc?.saldoPassivo);

  if (principalRemanescente == null) {
    return {
      podePrePreencher: false,
      motivo:
        "Este contrato não tem o principal declarado no cabeçalho, então o sistema não sabe quanto "
        + "ainda falta amortizar — e um lançamento de rescisão pré-preenchido com R$ 0,00 afirmaria "
        + "que não falta nada. Informe os valores de cada linha à mão, conferindo o contrato, ou "
        + "corrija o parcelamento antes de rescindir.",
      principalRemanescente: null,
      jurosRemanescente: null,
      totalRemanescente: null,
      saldoPassivo,
      avisoDivergencia: null,
    };
  }

  // ⚠ O JUROS REMANESCENTE CONTINUA PROPORCIONAL ÀS PRESTAÇÕES EM ABERTO — a derivação de antes,
  // intocada. `jurosTotal` ausente vira 0, e aqui zero É a resposta: o cabeçalho declarou que não há
  // juros, o que não é o mesmo que não saber quanto é o principal.
  const n = Number(parc?.numParcelas) || 0;
  const pagas = Number(parc?.parcelasPagas) || 0;
  const abertas = Math.max(0, n - pagas);
  const jurosTotal = num(parc?.jurosTotal) || 0;
  const jurosRemanescente = n ? r2(jurosTotal * (abertas / n)) : 0;
  const totalRemanescente = r2(principalRemanescente + jurosRemanescente);

  // ⚠ O PASSIVO DO RAZÃO É CONFERÊNCIA, NUNCA BLOQUEIO — mesma disciplina de
  // `conferenciaDoPassivoPorContrato`. Quando os dois divergem, o número certo é decisão de quem lê
  // o contrato; o que a tela deve é mostrar que eles divergem, antes do clique, em vez de deixar a
  // diferença aparecer como resíduo permanente em "Parcelamento a Pagar" meses depois.
  const avisoDivergencia = saldoPassivo != null && Math.abs(saldoPassivo - totalRemanescente) > 0.01
    ? `O razão mostra R$ ${formatar(saldoPassivo)} em "Parcelamento a Pagar" e o contrato aponta `
      + `R$ ${formatar(totalRemanescente)} a rescindir (diferença de R$ ${formatar(Math.abs(saldoPassivo - totalRemanescente))}). `
      + "Confira os valores antes de gravar — a rescisão não corrige o passivo sozinha."
    : null;

  return {
    podePrePreencher: true,
    motivo: null,
    principalRemanescente,
    jurosRemanescente,
    totalRemanescente,
    saldoPassivo,
    avisoDivergencia,
  };
}

function formatar(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * O valor sugerido de cada papel. `null` (campo VAZIO) quando não se pode pré-preencher —
 * nunca `0`, e nunca `""` disfarçado de número.
 */
export function valorPorPapelDaRescisao(base) {
  if (!base?.podePrePreencher) return { PARC: null, PRINCIPAL: null, JUROS: null, MULTA: null };
  return {
    PARC: base.totalRemanescente,
    PRINCIPAL: base.principalRemanescente,
    JUROS: base.jurosRemanescente,
    // ⚠ MULTA fica em zero de propósito: `jurosTotal` é declarado no cabeçalho e a multa
    // remanescente não tem fonte nenhuma. Zero aqui é o que o modal já fazia, e a linha é editável.
    MULTA: 0,
  };
}
