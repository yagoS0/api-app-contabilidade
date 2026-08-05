// A COMPETÊNCIA como valor — formato canônico `"YYYY-MM"`.
//
// ⚠ POR QUE ISTO EXISTE FORA DE `features/accounting`
// A competência deixou de ser estado de uma aba e virou estado da EMPRESA: o seletor mora no header
// e as abas de Contabilidade acompanham. Um helper que vivesse dentro de `accounting/` obrigaria o
// header (feature `companies`) a importar de outra feature só para saber escrever "Julho 2026" —
// e o caminho fácil, então, seria escrever a segunda cópia. Já houve duas competências nesta tela;
// não vale a pena arriscar duas formatações.
//
// `formatCompetenciaTitulo` (MAIÚSCULA, "MAIO/2026") continua em `accountingEntriesShared` — é o
// título da tabela, outra tipografia e outro uso.

const MESES_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** `"2026-07"` → `{ ano: 2026, mes: 7 }`; entrada inválida → `null`. */
export function parseCompetencia(comp) {
  const [yyyy, mm] = String(comp || "").split("-");
  const ano = Number(yyyy);
  const mes = Number(mm);
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return { ano, mes };
}

/** `"2026-07"` → `"Julho 2026"`. Entrada inválida volta como veio — nunca inventa um mês. */
export function formatCompetencia(comp) {
  const p = parseCompetencia(comp);
  if (!p) return String(comp || "");
  return `${MESES_PT[p.mes - 1]} ${p.ano}`;
}

/**
 * Anda `delta` meses.
 *
 * ⚠ Passa por `Date` com **dia 1**. Com o dia de hoje, 31/03 recuando um mês cairia em 31/02, que o
 * JS "corrige" para 02/03 — o mês não mudaria. É a mesma armadilha que o default dos lançamentos já
 * documentava; centralizada aqui para não depender de cada chamador lembrar dela.
 */
export function deslocarCompetencia(comp, delta) {
  const p = parseCompetencia(comp);
  if (!p) return comp;
  const ref = new Date(p.ano, p.mes - 1 + delta, 1);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
}

/** A competência de trabalho padrão: o mês ANTERIOR — o contador trabalha com o mês fechado. */
export function competenciaPadrao() {
  const now = new Date();
  const ref = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
}

/** A competência do mês corrente — o teto do seletor (não se apura mês que não terminou). */
export function competenciaAtual() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
