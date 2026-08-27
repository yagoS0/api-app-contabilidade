// QUEM APURA PELO LUCRO PRESUMIDO — regra PURA, três respostas.
//
// ⚠⚠ POR QUE ELA EXISTE. Até 27/08/2026 o regime só servia para ESCONDER a aba Apuração
// (`isSimplesCompany`, no app do contador). Esconder erra barato: some uma aba. A partir do momento
// em que o regime passa a decidir **QUAL DAS DUAS TELAS** renderiza — e qual rota calcula —, errar
// deixa de esconder e passa a mostrar a apuração ERRADA, com números que não descrevem a empresa.
//
// ── O QUE FOI MEDIDO EM PRODUÇÃO (27/08/2026, `scripts/diag-regime-para-aba-lp.mjs`) ──────────
//
//   `Company.regimeTributario` .... SIMPLES 23 · LUCRO_PRESUMIDO 11 · **zero NULO**
//   `cadastros_fiscais.regime` ..... SIMPLES_NACIONAL 6 (e só)
//   as duas fontes ................. **nunca discordam** hoje
//
// ⚠⚠ E O ACHADO QUE DECIDE A FONTE: **as 11 empresas do Presumido NÃO TÊM linha em
// `cadastros_fiscais`**. Tratar o `CadastroFiscal` como autoridade aqui — que é a regra do módulo
// do Simples — não encontraria nada em exatamente as 11 empresas para as quais esta tela existe.
// A fonte é a `Company`, que é também a que a tela já lê.
//
// ⚠ OS DOIS VOCABULÁRIOS SÃO DIFERENTES e não podem ser comparados por igualdade: a `Company` grava
// `SIMPLES` / `LUCRO_PRESUMIDO`; o `CadastroFiscal` grava `SIMPLES_NACIONAL`. A leitura é por
// PADRÃO, no mesmo critério do `mapRegime` da rota v2 — mas SEM o default dele.

export const APURACAO = Object.freeze({
  /** Presumido e Real apuram por presunção/trimestre — esta é a tela deles. */
  PRESUMIDO: "PRESUMIDO",
  /** Simples e MEI têm a própria apuração (PGDAS-D). */
  SIMPLES: "SIMPLES",
  /** ⚠ Terceiro estado: não se sabe. Nunca colapsar num dos outros dois. */
  DESCONHECIDO: "DESCONHECIDO",
});

/**
 * Que apuração esta empresa tem?
 *
 * ⚠⚠ **NÃO COPIE O DEFAULT DO `mapRegime`.** Ele termina em `return "SIMPLES_NACIONAL"` porque lá o
 * default é inofensivo (o app é quase todo do Simples). Aqui ele seria caro nos dois sentidos: numa
 * empresa sem regime, "Simples" recusaria a tela do Presumido a quem talvez precise dela, e
 * "Presumido" calcularia presunção para quem talvez seja do Simples. A resposta honesta é
 * `DESCONHECIDO`, e quem consome decide o que fazer com ela.
 *
 * @param {string|null|undefined} regime  o texto cru de `Company.regimeTributario`
 */
export function apuracaoDoRegime(regime) {
  const t = String(regime ?? "").trim().toUpperCase();
  if (!t) return APURACAO.DESCONHECIDO;
  // ⚠ MEI antes de SIMPLES: o MEI É optante do Simples, e um texto que diga as duas coisas
  // ("SIMPLES NACIONAL - MEI") é MEI. A ordem é a mesma do `mapRegime`.
  if (/MEI\b/.test(t)) return APURACAO.SIMPLES;
  if (/PRESUMID/.test(t)) return APURACAO.PRESUMIDO;
  if (/REAL/.test(t)) return APURACAO.PRESUMIDO;
  if (/SIMPLES/.test(t)) return APURACAO.SIMPLES;
  // ⚠ Texto que existe e não se reconhece NÃO vira Simples por descarte — vira "não sei".
  return APURACAO.DESCONHECIDO;
}

/**
 * A rota do Presumido aceita esta empresa?
 *
 * ⚠ `DESCONHECIDO` **PASSA**, e é decisão registrada: nesta direção, bloquear por falta de dado é o
 * erro caro — é o mesmo critério que `routes/firm/obrigacoes.js` já aplica à guarda da EFD
 * ("regime ausente ou desconhecido PASSA"). O que não passa é a certeza contrária.
 *
 * ⚠ A recusa é NOMEADA e diz para onde ir. "Não permitido" mandaria o contador procurar defeito.
 */
export function podeApurarPresumido(regime) {
  const apuracao = apuracaoDoRegime(regime);
  if (apuracao === APURACAO.SIMPLES) {
    return {
      pode: false,
      apuracao,
      motivo: "Esta empresa é optante pelo Simples Nacional: a apuração dela é o PGDAS-D, na aba "
        + "Apuração do Simples. Uma apuração do Lucro Presumido aqui produziria números que não "
        + "descrevem esta empresa.",
    };
  }
  return {
    pode: true,
    apuracao,
    // ⚠ Passar não é afirmar que ela é do Presumido — e a tela precisa dizer isso.
    aviso: apuracao === APURACAO.DESCONHECIDO
      ? "O regime desta empresa não está cadastrado. O cálculo abaixo assume o Lucro Presumido; "
        + "confirme o regime no cadastro antes de usá-lo."
      : null,
  };
}
