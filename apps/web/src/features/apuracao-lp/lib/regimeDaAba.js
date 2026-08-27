// QUAL ABA DE APURAÇÃO ESTA EMPRESA TEM — regra pura, três respostas.
//
// ⚠⚠ ESTE É O ESPELHO de `apps/api/src/application/fiscal/lp/lib/regimeDoPresumido.js`, e a cópia
// está AMARRADA POR TESTE (`__tests__/regimeDaAba.test.js` lê o arquivo do backend). Cruzar os dois
// apps não é possível — eles não compartilham código —, e sem a amarração a tela ofereceria uma aba
// que a rota recusa, ou esconderia uma que ela aceita.
//
// ⚠⚠ O QUE MUDOU DE PESO EM 27/08/2026. Até aqui o regime só ESCONDIA a aba `cadastroFiscal`
// (`isSimplesCompany`, em `renderCompanyDetailHeader.jsx`): errar custava uma aba a menos. Agora ele
// escolhe QUAL DAS DUAS telas renderiza — e errar passa a mostrar a apuração de OUTRO REGIME, com
// números que não descrevem a empresa que está na frente do contador.

/** As três respostas. Lista FECHADA — é o mesmo vocabulário do backend. */
export const APURACAO = Object.freeze({
  PRESUMIDO: "PRESUMIDO",
  SIMPLES: "SIMPLES",
  DESCONHECIDO: "DESCONHECIDO",
});

/**
 * De onde sai o regime, na ordem em que a tela já o lia.
 *
 * ⚠ São QUATRO campos porque a empresa chega ao componente de duas formas (o `PortalClient` e a
 * `Company` legada aninhada). Essa cadeia é a que `isSimplesCompany` já usava — ela não foi
 * inventada aqui, foi preservada.
 */
export function regimeDaEmpresa(company) {
  return company?.regimeTributario
    || company?.tipoTributario
    || company?.legacyCompany?.regimeTributario
    || company?.legacyCompany?.tipoTributario
    || null;
}

/**
 * ⚠ A leitura é por PADRÃO, nunca por igualdade: a `Company` grava `SIMPLES` / `LUCRO_PRESUMIDO` e
 * o `CadastroFiscal` grava `SIMPLES_NACIONAL`. Comparar `=== "SIMPLES"` — que é o que a tela fazia
 * — faz a MESMA empresa ter dois regimes conforme a fonte lida.
 *
 * ⚠ MEI vem antes de SIMPLES: o MEI É optante, e um texto com as duas palavras é MEI.
 */
export function apuracaoDoRegime(regime) {
  const t = String(regime ?? "").trim().toUpperCase();
  if (!t) return APURACAO.DESCONHECIDO;
  if (/MEI\b/.test(t)) return APURACAO.SIMPLES;
  if (/PRESUMID/.test(t)) return APURACAO.PRESUMIDO;
  if (/REAL/.test(t)) return APURACAO.PRESUMIDO;
  if (/SIMPLES/.test(t)) return APURACAO.SIMPLES;
  // ⚠ Texto que existe e não se reconhece NÃO vira Simples por descarte — vira "não sei".
  return APURACAO.DESCONHECIDO;
}

export function apuracaoDaEmpresa(company) {
  return apuracaoDoRegime(regimeDaEmpresa(company));
}

/**
 * ⚠⚠ QUAL TELA RENDERIZAR — e a resposta para `DESCONHECIDO` é o Simples, DE PROPÓSITO.
 *
 * Isto é uma ASSIMETRIA deliberada com o backend, e ela precisa estar escrita para não se ler como
 * incoerência: a ROTA do Presumido **aceita** regime desconhecido (bloquear trabalho por falta de
 * dado é o erro caro lá), e a TELA **continua mostrando o Simples** (mudar o que já funciona é o
 * erro caro aqui). As duas escolhas são a mesma disciplina — não quebrar o que existe.
 *
 * O comportamento antigo era `if (!regime) return true` em `isSimplesCompany`, e ele fica INTACTO.
 */
export function telaDeApuracao(company) {
  const apuracao = apuracaoDaEmpresa(company);
  return apuracao === APURACAO.PRESUMIDO ? APURACAO.PRESUMIDO : APURACAO.SIMPLES;
}

/** A aba `cadastroFiscal` (a do PGDAS-D) aparece? — o que `soApuraSimples` pergunta hoje. */
export const mostraApuracaoDoSimples = (company) => telaDeApuracao(company) === APURACAO.SIMPLES;

/** A aba do Presumido aparece? É o complemento exato — nunca as duas, nunca nenhuma. */
export const mostraApuracaoDoPresumido = (company) => telaDeApuracao(company) === APURACAO.PRESUMIDO;
