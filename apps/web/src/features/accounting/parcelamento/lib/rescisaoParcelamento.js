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

import { avaliarValor } from "../../entries/lib/valorFormula.js";

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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// A LEITURA DO QUE FOI DIGITADO — e por que ela NÃO podia continuar sendo escrita aqui à mão.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// O modal lia os campos com `Number(String(v).replace(",", "."))`. Num teclado numérico brasileiro
// isso é uma leitura 1000× errada, e o pior é que ela erra COERENTEMENTE:
//
//   digitado     `replace(",", ".")`   a gramática estrita
//   `12.000`     12          ← R$ 12,00        12000
//   `6.900,00`   NaN → 0     ← R$ 0,00          6900
//   `1.234,56`   NaN → 0                        1234,56
//
// ⚠ AS DUAS GUARDAS DO MODAL NÃO PEGAM ISSO, e é por isso que passava até o razão: Σ D e Σ C erram
// na MESMA proporção (`12.000/10.000/2.000` vira 12 = 10 + 2, e o rodapé carimba "✓"), e o piso
// `Σ D < 0,01` é satisfeito por R$ 12,00. O servidor não re-deriva nada — `ParcelamentoService`
// grava o que recebe —, e a rescisão é o ato mais caro do módulo: manda o saldo remanescente para a
// Dívida Ativa da União e o app não a desfaz.
//
// ⚠ NADA DE UM QUARTO PARSER. `entries/lib/valorFormula.js` (48 testes próprios) já é a gramática
// deste projeto, e a baixa manual (`baixaManualParcela.lerAcrescimo`/`lerPrincipal`) e o wizard
// (`wizardParcelamento.numero`) já a reusam. Este arquivo era o único lugar do módulo em que um
// valor digitado virava lançamento por outro caminho.

/**
 * Lê um campo de valor da rescisão.
 *
 * ⚠ VAZIO É 0 E NÃO É ERRO — é o estado inicial de TODA linha quando `podePrePreencher` é falso
 * (o contrato sem `principalTotal` abre com os campos em branco, de propósito). Quem recusa a
 * rescisão zerada é o gate `Σ D < 0,01`, que continua exatamente como estava.
 *
 * ⚠ ILEGÍVEL, PORÉM, DEIXOU DE VIRAR 0. O `num` antigo devolvia 0 para tudo que não entendia, e um
 * zero silencioso numa linha da rescisão é o mesmo defeito de ordem de grandeza pelo outro lado.
 * Isto APERTA a guarda: o que antes passava mudo agora bloqueia com o motivo na tela.
 */
export function lerValorDaRescisao(texto) {
  const r = avaliarValor(texto);
  if (!r.ok) return { ok: false, valor: null, vazio: false, erro: r.erro, mensagem: r.mensagem };
  if (r.vazio) return { ok: true, valor: 0, vazio: true, erro: null, mensagem: null };
  return { ok: true, valor: r.valor, vazio: false, erro: null, mensagem: null };
}

/**
 * As somas do rodapé e os dois gates, a partir das linhas COMO ESTÃO NA TELA.
 *
 * Devolve as leituras na mesma ordem das linhas — é o que permite o modal mostrar a prévia
 * (`= 12.000,00`) embaixo de cada campo sem ler o texto uma segunda vez.
 *
 * ⚠ A PRÉVIA É PARTE DA CORREÇÃO, não enfeite. `12.000` pode ser doze mil ou doze reais, e o texto
 * não distingue — é a mesma ambiguidade que `valorFormula` documenta para `2.500`. Mostrar como o
 * app leu, antes do clique, é o que teria denunciado este defeito na primeira digitação.
 */
export function somasDaRescisao(lines) {
  const linhas = Array.isArray(lines) ? lines : [];
  const leituras = linhas.map((l) => lerValorDaRescisao(l?.valor));
  const somaD = linhas.reduce((s, l, i) => (l?.tipo === "D" && leituras[i].ok ? s + leituras[i].valor : s), 0);
  const somaC = linhas.reduce((s, l, i) => (l?.tipo === "C" && leituras[i].ok ? s + leituras[i].valor : s), 0);
  const ilegiveis = leituras.filter((r) => !r.ok).length;
  return {
    leituras,
    somaD: r2(somaD),
    somaC: r2(somaC),
    // Tolerância de 1 centavo — a MESMA do gate de fechamento (`computeFechamentoBlockers`).
    desbalanceado: Math.abs(somaD - somaC) >= 0.01,
    semValor: somaD < 0.01,
    ilegiveis,
    // ⚠ Enquanto houver campo ilegível, as somas NÃO são a resposta: elas descrevem só as linhas
    // que deram para ler. Carimbar "✓ D = C" por cima disso seria o mesmo "número certo ao lado de
    // soma errada" do rodapé da aba Lançamentos.
    somasConfiaveis: ilegiveis === 0,
  };
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
