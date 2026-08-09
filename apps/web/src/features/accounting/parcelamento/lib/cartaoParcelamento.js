// R3 — AS DERIVAÇÕES DO CARD DO PARCELAMENTO, fora do JSX.
//
// Tudo aqui sai do MESMO payload que `listParcelamentos` já devolve (`decorateParcelamento` +
// `parcelasContratadas`). Nenhum número é recalculado a partir de outra fonte: `parcelasPagas`,
// `parcelasTotal`, `parcelasSemEvidencia` e `risco` vêm prontos do backend, e o que este arquivo
// acrescenta são leituras que o backend não tinha por que fazer — quantas das quitadas são
// HISTÓRICAS (quitadas antes de o contrato entrar no sistema) e qual é a próxima prestação.

/**
 * ⚠ `HISTORICO` É VOCABULÁRIO DE `origemBaixa`, NÃO COLUNA PRÓPRIA (F2.3). O backend marca as N
 * primeiras prestações de um contrato migrado com `origemBaixa: "HISTORICO"` e todas as derivações
 * — contadores, risco, `parcelasSemEvidencia` — já a enxergam como quitação. Aqui a contagem serve
 * só para o card poder dizer "22 pagas (22 históricas)": sem isso, um contrato migrado exibe 22
 * pagamentos que este escritório nunca lançou, e alguém vai procurar os lançamentos.
 */
export function contarHistoricas(parcelamento) {
  const linhas = Array.isArray(parcelamento?.parcelasContratadas) ? parcelamento.parcelasContratadas : [];
  return linhas.filter((p) => String(p?.origemBaixa || "").toUpperCase() === "HISTORICO").length;
}

function quitada(parcela) {
  if (parcela?.origemBaixa) return true;
  const g = parcela?.guia;
  if (!g) return false;
  return Boolean(g.baixada) || String(g.paymentStatus || "").toUpperCase() === "PAID";
}

/**
 * A próxima prestação em aberto: a de menor número entre as não quitadas.
 * `null` quando não há nenhuma (contrato quitado) ou quando não há cronograma materializado.
 */
export function proximaPrestacao(parcelamento) {
  const linhas = Array.isArray(parcelamento?.parcelasContratadas) ? parcelamento.parcelasContratadas : [];
  const abertas = linhas
    .filter((p) => !quitada(p))
    .sort((a, b) => (Number(a?.numeroParcela) || Infinity) - (Number(b?.numeroParcela) || Infinity));
  const p = abertas[0];
  if (!p) return null;
  return {
    numeroParcela: p.numeroParcela ?? null,
    // O vencimento REAL é o da guia quando ela existe (veio do SERPRO/PDF); o da parcela é o
    // cronograma CONTRATADO. Mesma resolução de `quadroDasParcelas` no backend — não é cópia da
    // regra de atraso, é a mesma leitura de qual data vale.
    vencimento: p.guia?.vencimento ?? p.vencimento ?? null,
    temGuia: Boolean(p.guia),
  };
}

/** Prestações do contrato que ainda não estão quitadas. */
export function restantes(parcelamento) {
  const total = Number(parcelamento?.parcelasTotal);
  const pagas = Number(parcelamento?.parcelasPagas);
  if (!Number.isFinite(total) || !Number.isFinite(pagas)) return null;
  return Math.max(0, total - pagas);
}

/** `{pagas} de {total} (N históricas)` — o texto do progresso, com a fração para a barra. */
export function textoDoProgresso(parcelamento) {
  const pagas = Number(parcelamento?.parcelasPagas) || 0;
  const total = Number(parcelamento?.parcelasTotal) || 0;
  const historicas = contarHistoricas(parcelamento);
  const sufixo = historicas > 0 ? ` (${historicas} histórica${historicas === 1 ? "" : "s"})` : "";
  return {
    texto: `${pagas} de ${total}${sufixo}`,
    fracao: total > 0 ? Math.min(1, pagas / total) : 0,
    pagas,
    total,
    historicas,
  };
}

/**
 * O ALERTA DE ATRASO COM A REGRA CONTEXTUALIZADA.
 *
 * ⚠ SEM ATRASO NÃO HÁ ALERTA. Uma tarja verde de "em dia" em todo card treina o olho a ignorar a
 * faixa inteira, e aí a vermelha também passa batido — a mesma decisão que `RiscoRescisao` já tomava.
 *
 * ⚠ A CITAÇÃO LEGAL SÓ SAI QUANDO CONFERIDA (`regra.citacaoConferida`). A regra em texto orienta; o
 * NÚMERO do artigo o contador confia e age.
 */
export function alertaDeAtraso(parcelamento) {
  const risco = parcelamento?.risco;
  if (!risco?.avaliavel || !risco.nivel || risco.nivel === "ok") return null;
  const emAtraso = Number(risco.emAtraso) || 0;
  const critico = risco.nivel === "rescindivel" || risco.nivel === "critico";
  const limite = risco.regra?.limiteAbsoluto;

  const prestacoes = `${emAtraso} ${emAtraso === 1 ? "prestação" : "prestações"} em atraso`;
  const titulo = critico ? `Em risco de rescisão — ${prestacoes}` : prestacoes;

  // "Rescinde com 3 em atraso — está com {x}" é a frase que o dono pediu: a regra deixa de ser um
  // texto genérico e passa a dizer onde ESTE contrato está dentro dela.
  const contextualizada = Number.isFinite(Number(limite))
    ? `Rescinde com ${limite} em atraso — está com ${emAtraso}.`
    : `Rescinde com ${risco.regra?.descricao || "o limite da modalidade"} — está com ${emAtraso}.`;

  return {
    critico,
    titulo,
    contextualizada,
    regraCompleta: risco.regra?.descricao || null,
    citacao: risco.regra?.citacaoConferida ? risco.regra?.id || null : null,
    numeros: (risco.parcelasEmAtraso || []).map((x) => x.numeroParcela ?? "?"),
  };
}

/** A leitura declarada de COMO se paga. `null` = não declarado, e isso não é o mesmo que nenhuma. */
export function rotuloFormaPagamento(forma) {
  const v = String(forma || "").toUpperCase();
  if (v === "DEBITO_AUTOMATICO") return { texto: "Débito automático", detalhe: "As prestações não geram guia." };
  if (v === "GUIA_MENSAL") return { texto: "Guia mensal", detalhe: "Cada prestação tem uma guia." };
  return { texto: "Forma de pagamento não declarada", detalhe: "Ninguém declarou como este contrato é pago." };
}

/**
 * ⚠ AS CORES ESTAVAM INVERTIDAS. `statusColors` pintava **ATIVO de verde** e QUITADO de ciano — e
 * verde, no vocabulário deste app, é CONCLUÍDO (o rodapé `D = C ✓ ok`, a guia paga). Um contrato
 * ATIVO é trabalho em curso, não conclusão. Agora: ATIVO = neutro, QUITADO = ok (verde),
 * RESCINDIDO = danger. Cada tom vem com o par `-surface` — nunca concatenar hex.
 */
export const TONS_STATUS = Object.freeze({
  ATIVO: { cor: "var(--state-neutral)", fundo: "var(--state-neutral-surface)" },
  QUITADO: { cor: "var(--state-ok)", fundo: "var(--state-ok-surface)" },
  RESCINDIDO: { cor: "var(--state-danger)", fundo: "var(--state-danger-surface)" },
});

export function tomDoStatus(status) {
  return TONS_STATUS[String(status || "").toUpperCase()] || TONS_STATUS.ATIVO;
}
