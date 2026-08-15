// DATA CIVIL NO FRONT — o DIA de um fato, não um instante no tempo.
//
// ⚠ POR QUE ISTO EXISTE, e por que é o espelho de `apps/api/src/utils/dataCivil.js`.
//
// `Guide.vencimento`, `Parcela.vencimento` e `ObrigacaoOcorrencia.dataVencimento` guardam um DIA,
// não um momento: o backend os grava como **meia-noite UTC** e os manda pelo JSON como
// `"2026-08-20T00:00:00.000Z"`. Isso quer dizer "20 de agosto", ponto.
//
// Ler esse valor com `new Date(v)` + `setHours(0,0,0,0)` converte para o fuso do NAVEGADOR. Em São
// Paulo (UTC−3) a meia-noite UTC é 21h do dia ANTERIOR, e o `setHours` então ancora no dia 19.
// Não há erro, não há aviso: o dia simplesmente anda para trás — a mesma classe de defeito que já
// saiu para fora duas vezes pelo backend (621 lançamentos no export CSV e a data de pagamento no
// e-mail ao cliente, medidos em 13/08/2026).
//
// ⚠ SÃO DUAS PERGUNTAS DIFERENTES, e é por isso que são duas funções:
//
//   • `diaCivil(valor)`     — "que DIA é este dado?"    → fatia a ISO / lê em **UTC**, que é a
//                                                          forma em que o backend o gravou.
//   • `diaCivilDeHoje(now)` — "que dia é hoje AQUI?"    → lê em **local**, porque `new Date()` é um
//                                                          instante de verdade e o dia de hoje é o
//                                                          dia de quem está olhando a tela.
//
// Trocar uma pela outra recria o defeito com o sinal invertido. A comparação é sempre dia civil
// contra dia civil — string `"YYYY-MM-DD"` contra string `"YYYY-MM-DD"`, que ordena por si só —,
// nunca instante contra instante.
//
// ⚠ NÃO use isto para TIMESTAMP de verdade (`createdAt`, `liberadaEm`, `recalculatedAt`,
// `paymentConfirmedAt`, `expiresAt`). Ali o instante É o dado, e convertê-lo para o fuso de quem lê
// é justamente o certo — é o que o `fmtDate` de `lib/format.js` faz, e por isso ele não mudou.

const pad2 = (n) => String(n).padStart(2, "0");

/**
 * O dia civil de um valor gravado como data civil.
 * `"2026-08-20T00:00:00.000Z"` → `"2026-08-20"`. Nulo/ilegível → `""`.
 *
 * String ISO é FATIADA (nenhuma conversão de fuso acontece); `Date` é lido pelos componentes
 * **UTC**, que é a forma em que o backend grava.
 */
export function diaCivil(v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "string") {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
    if (m) return m[1];
  }
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * O dia civil de HOJE, no fuso de quem está olhando a tela.
 *
 * ⚠ Aqui a leitura é LOCAL de propósito: `new Date()` é um instante, e "hoje" é o dia de quem lê.
 * Ler este valor em UTC faria o dia virar às 21h em São Paulo.
 */
export function diaCivilDeHoje(agora = new Date()) {
  if (typeof agora === "string") return diaCivil(agora);
  const d = agora instanceof Date ? agora : new Date(agora);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Dias inteiros de `de` até `ate` (ambos `"YYYY-MM-DD"`). Negativo = `ate` já passou. */
export function diasEntreDiasCivis(de, ate) {
  if (!de || !ate) return null;
  const a = Date.parse(`${de}T00:00:00.000Z`);
  const b = Date.parse(`${ate}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** `"2026-09-01T00:00:00.000Z"` → `"01/09"`. Nulo/ilegível → `""`. */
export function diaMesCivil(v) {
  const iso = diaCivil(v);
  if (!iso) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** `"2026-09-01T00:00:00.000Z"` → `"01/09/2026"`. Nulo/ilegível → `""`. */
export function dataCivilBR(v) {
  const iso = diaCivil(v);
  if (!iso) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}
