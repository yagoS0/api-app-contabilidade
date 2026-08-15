import { dataCivilBR } from "./dataCivil.js";

export function fmtMoney(value) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));
}

/**
 * TIMESTAMP — um instante no tempo, mostrado no fuso de quem lê.
 *
 * ⚠ NÃO É PARA VENCIMENTO. `fmtDate` é global e formata criação, envio, liberação, confirmação de
 * pagamento — casos em que o instante É o dado e converter para o fuso local é o certo. Vencimento
 * é DATA CIVIL, gravada como meia-noite UTC: aqui ela sairia um dia antes (e a guia que vence
 * 01/09 seria impressa como 31/08, mudando de dia E de mês). Use `fmtDataCivil`.
 */
export function fmtDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("pt-BR");
}

/**
 * DATA CIVIL — o DIA de um fato (vencimento), sem conversão de fuso nenhuma.
 *
 * Mesma saída do `fmtDate` (`"DD/MM/YYYY"`, `"-"` na ausência), lida por `lib/dataCivil.js`. Os
 * nomes são diferentes de propósito: a troca de um pelo outro é o defeito, e ela precisa aparecer
 * no diff.
 */
export function fmtDataCivil(value) {
  const br = dataCivilBR(value);
  return br || "-";
}
