// COMO A SITUAÇÃO FISCAL SE LÊ NA TELA DO CLIENTE.
//
// ⚠⚠ A REGRA QUE MANDA: **NUNCA CONSULTADA NÃO É "EM DIA".** Afirmar regularidade perante o fisco
// sem ter consultado é o erro caro — o cliente deixa de correr atrás de uma pendência que existe.
// Dizer que não se sabe é o barato. Por isso `null`, ausência e **valor desconhecido** caem todos em
// `nao_consultada`, e não há ramo nenhum que produza "regular" por omissão.
//
// ⚠ O MAPA É FECHADO, e a falha é FECHAR, não abrir. Um estado novo no backend que ninguém tenha
// mapeado aqui aparece como "não consultada" — que é menos informação, nunca informação errada. É a
// mesma disciplina de `chipDaGuia` ("valor fora da lista renderiza sem cor nenhuma, em silêncio",
// que lá é o defeito e aqui é impedido).
//
// ⚠⚠ E O `data-status` DAS NOTAS/GUIAS **NÃO** FOI REUSADO. Aquele vocabulário é espelhado pelo app
// mobile, e "paga"/"vencida"/"emitida" não descrevem situação perante o fisco. Este atributo é
// `data-situacao-fiscal`, próprio — pelo mesmo motivo que "GUIA NÃO É NOTA" já registra: cor certa
// por acidente, significado errado, e o significado é o que fica no DOM.
//
// ⚠ Quem CONSULTA é o escritório, e isso não muda: a consulta ao SERPRO é paga e o limite é por
// contratante. Aqui só se lê o que foi gravado — e a data da leitura viaja junto, porque
// "sem pendências" sem dizer DE QUANDO é uma afirmação sobre hoje que ninguém apurou hoje.

/** Estados que a tela sabe desenhar. Lista FECHADA. */
export const SITUACAO = Object.freeze({
  REGULAR: "regular",
  COM_PENDENCIA: "com_pendencia",
  EM_PARCELAMENTO: "em_parcelamento",
  PROCESSANDO: "processando",
  NAO_CONSULTADA: "nao_consultada",
});

const DO_BACKEND = Object.freeze({
  REGULAR: SITUACAO.REGULAR,
  COM_PENDENCIA: SITUACAO.COM_PENDENCIA,
  EM_PARCELAMENTO: SITUACAO.EM_PARCELAMENTO,
  PROCESSANDO: SITUACAO.PROCESSANDO,
});

const ROTULO = Object.freeze({
  [SITUACAO.REGULAR]: "Sem pendências",
  [SITUACAO.COM_PENDENCIA]: "Com pendência",
  [SITUACAO.EM_PARCELAMENTO]: "Em parcelamento",
  [SITUACAO.PROCESSANDO]: "Consulta em andamento",
  [SITUACAO.NAO_CONSULTADA]: "Não consultada",
});

/**
 * O que a tela mostra a partir do `situacao` do servidor.
 *
 * ⚠ `apoio` só existe onde a ausência precisa deixar de virar afirmação, ou onde há uma AÇÃO:
 * "sem pendências" ganha a data (senão fala do presente sobre um passado), e "com pendência" diz o
 * que fazer — que é falar com o contador, a única saída que o cliente tem daqui. Os outros três não
 * ganham frase: descreveriam o que o próprio rótulo já diz.
 */
export function situacaoNaTela(bruto) {
  const chave = String(bruto || "").trim().toUpperCase();
  const status = Object.prototype.hasOwnProperty.call(DO_BACKEND, chave)
    ? DO_BACKEND[chave]
    : SITUACAO.NAO_CONSULTADA;
  return { status, rotulo: ROTULO[status] };
}

/** `true` só quando o servidor AFIRMOU regularidade. Ausência não passa por aqui. */
export function ehRegular(bruto) {
  return situacaoNaTela(bruto).status === SITUACAO.REGULAR;
}

// ── A TABELA DO RELATÓRIO ────────────────────────────────────────────────────────────────────
//
// ⚠ Espelho de `apps/web/.../SitfisRelatorioTabela.jsx` (paleta escura, hardcoded, e os dois apps
// não compartilham código). As regras vêm INTEIRAS de lá, e são estas:
//   • cada bloco declara as PRÓPRIAS colunas — não há cabeçalho fixo;
//   • a tela mostra as colunas que o PDF mostra, TODAS, sempre;
//   • `Sdo. Dev. Cons.` é a coluna que responde "quanto devo hoje";
//   • **uma linha ilegível invalida o total do bloco** — total parcial mostraria dívida MENOR que a
//     real, lida como conferida;
//   • **nada some**: bloco que não virou tabela aparece cru.

/** Colunas de dinheiro: alinham à direita, em fonte tabular. */
export const COLUNAS_VALOR = new Set([
  "Vl. Original", "Sdo. Devedor", "Vl.Original", "Sdo.Devedor",
  "Multa", "Juros", "Sdo. Dev. Cons.", "Valor",
  "Valor em Atraso", "Valor Suspenso",
]);

/** A coluna que responde à pergunta: quanto a empresa deve HOJE, já com multa e juros. */
export const COLUNA_TOTAL = "Sdo. Dev. Cons.";

/** "15.510,72" → 15510.72. `null` quando não é um número reconhecível — nunca 0. */
export function parseValorBR(v) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  if (!/^-?[\d.]+,\d{2}$/.test(t)) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * A soma do saldo consolidado do bloco — ou `null`.
 *
 * ⚠⚠ UMA LINHA ILEGÍVEL INVALIDA O TOTAL INTEIRO. Os valores são STRINGS lidas de um PDF; um total
 * parcial mostraria uma dívida MENOR que a real, e quem lê acharia que está conferido.
 * ⚠ Com uma linha só não há total — a soma seria o próprio valor, repetido logo abaixo dele.
 */
export function totalDoBloco(colunas, registros, coluna = COLUNA_TOTAL) {
  if (!colunas?.includes(coluna) || !registros || registros.length < 2) return null;
  let soma = 0;
  for (const r of registros) {
    const v = parseValorBR(r[coluna]);
    if (v === null) return null;
    soma += v;
  }
  // Centavos: somar float acumula erro (0,1+0,2). O arredondamento é de APRESENTAÇÃO.
  return Math.round(soma * 100) / 100;
}

/**
 * ⚠ O QUARTO ESTADO — o bloco que não virou tabela e também não caiu em `naoInterpretado`.
 * Quando NENHUMA linha do começo do bloco é um cabeçalho conhecido, o bloco INTEIRO sai em
 * `descricao` e `naoInterpretado` fica vazio. Sem este ramo, isso aparece como linhas soltas, sem
 * uma palavra dizendo que não foram interpretadas: ausência de leitura com cara de conteúdo.
 */
export function naoVirouTabela(bloco) {
  const { colunas = [], registros = [], descricao = [] } = bloco || {};
  return colunas.length === 0 && registros.length === 0 && descricao.length > 0;
}
