// DATA CIVIL — o DIA de um fato, não um instante no tempo.
//
// ⚠ POR QUE ISTO EXISTE, e por que não é abstração prematura.
//
// Vários campos deste sistema guardam um DIA, não um momento: `AccountingEntry.data` (o dia do
// lançamento), `Guide.vencimento` (o dia em que a guia vence), `Parcela.vencimento`. Todos são
// gravados como **meia-noite UTC** — `2026-05-12T00:00:00.000Z` quer dizer "12 de maio", ponto.
//
// `toLocaleDateString("pt-BR")` **sem `timeZone`** usa o fuso do PROCESSO. Em produção
// `TZ=America/Sao_Paulo`, então meia-noite UTC vira 21h do dia ANTERIOR — e a data sai um dia
// antes. Não há erro, não há aviso: o número simplesmente muda.
//
// Isso já saiu para fora DUAS vezes, medido em 13/08/2026:
//
//   1. **Export CSV de lançamentos** (`routes/firm/accountingEntries.js`) — os 621 lançamentos da
//      base saíam com a data um dia antes, e **15 deles mudavam de MÊS** (os gravados no dia 1º
//      viravam o último dia do mês anterior). Esse CSV é consumido por sistema contábil externo:
//      lançamento entrando na competência errada, não detalhe cosmético. Relatado pelo dono como
//      "na minha tabela não tem 26/5 nem 11/5, mas o export tem".
//   2. **E-mail de guia ao cliente** (`workers/guideEmailWorker.js`) — `Guide.vencimento` também é
//      meia-noite UTC (6 de 6 conferidos em produção), então a guia que vence 25/08 era anunciada
//      ao cliente como vencendo **24/08**. Data de pagamento, na mensagem que sai do escritório.
//
// ⚠ A TELA SEMPRE ESTEVE CERTA e é o modelo a seguir: ela usa `String(entry.data).slice(0, 10)`,
// que fatia a ISO sem converter fuso nenhum. Fatiar a ISO é o que faz backend e front lerem a
// MESMA data por construção — `toLocaleDateString(..., { timeZone: "UTC" })` daria o mesmo
// resultado, mas continuaria dependendo de alguém lembrar de passar a opção na próxima vez.
//
// ⚠ NÃO use isto para TIMESTAMP de verdade (`createdAt`, `transmitidoEm`, `certExpiresAt`). Ali o
// instante é o dado, e converter para o fuso de quem lê é justamente o certo.

/** `2026-05-12T00:00:00.000Z` → `"2026-05-12"`. Nulo/inválido → `""`. */
export function dataCivilISO(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

/** `2026-05-12T00:00:00.000Z` → `"12/05/2026"`. Nulo/inválido → `""`. */
export function dataCivilBR(d) {
  const iso = dataCivilISO(d);
  if (!iso) return "";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}
