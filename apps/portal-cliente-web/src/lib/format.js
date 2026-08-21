// Formatação para o cliente final. Espelha `src/format.ts` do app mobile
// (portal-cliente-mobile) — os dois lados precisam formatar igual.
//
// ⚠ DIFERENÇA DELIBERADA em relação ao mobile: lá `brl(null)` devolve "R$ 0,00".
// Aqui não. Ausência é traço; zero é afirmação. Um "R$ 0,00" no lugar de um
// dado que a API não mandou é o front inventando um fato fiscal.

export const TRACO = "—"; // em dash

/** Valor monetário. `null`/`undefined`/NaN viram traço; 0 vira "R$ 0,00". */
export function brl(value) {
  if (value === null || value === undefined || value === "") return TRACO;
  const v = Number(value);
  if (!Number.isFinite(v)) return TRACO;
  const neg = v < 0;
  const [intPart, decPart] = Math.abs(v).toFixed(2).split(".");
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}R$ ${withThousands},${decPart}`;
}

/**
 * Valor que vem de uma SOMA/AGREGAÇÃO do backend, onde `0` é indistinguível de
 * "não há nada somado" (ex.: `impostosPagos` = soma de guias PAID; `dasExtrato`
 * = extrato do PGDAS-D que pode nunca ter sido capturado). Nesses campos o zero
 * não afirma "foi zero", afirma "não achei linha" — e por isso sai como traço.
 */
export function somaOuTraco(value) {
  if (value === null || value === undefined) return TRACO;
  const v = Number(value);
  if (!Number.isFinite(v) || v === 0) return TRACO;
  return brl(v);
}

/** Percentual com 2 casas. `null`/NaN viram traço. */
export function pct(value) {
  if (value === null || value === undefined) return TRACO;
  const v = Number(value);
  if (!Number.isFinite(v)) return TRACO;
  return `${v.toFixed(2).replace(".", ",")}%`;
}

/** Inteiro simples; `null` vira traço (0 continua sendo 0 — é contagem, e contagem zero é fato). */
export function inteiro(value) {
  if (value === null || value === undefined) return TRACO;
  const v = Number(value);
  if (!Number.isFinite(v)) return TRACO;
  return String(Math.trunc(v));
}

/** Texto: string vazia/nula vira traço. */
export function texto(value) {
  const s = value === null || value === undefined ? "" : String(value).trim();
  return s === "" ? TRACO : s;
}

/** 'YYYY-MM' -> 'MM/AAAA' */
export function fmtCompetencia(competencia) {
  if (!competencia) return TRACO;
  const m = /^(\d{4})-(\d{2})/.exec(String(competencia));
  if (!m) return String(competencia);
  return `${m[2]}/${m[1]}`;
}

/** ISO ou 'YYYY-MM-DD' -> 'DD/MM/AAAA'. Sem `new Date` para não deslocar fuso. */
export function fmtDateBr(date) {
  if (!date) return TRACO;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
  if (!m) return String(date);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * ⚠⚠ INSTANTE (data E hora), no relógio de quem lê — `2026-08-21T14:41:00Z` → `21/08/2026 11:41`.
 *
 * ⚠ **ESTA É A EXCEÇÃO DELIBERADA À REGRA DE `fmtDateBr`**, que evita `new Date` de propósito para
 * não deslocar fuso. Ali o dado é uma DATA CIVIL (competência, vencimento): ela não tem hora, e
 * convertê-la mostraria outro dia. Aqui o dado é um INSTANTE gravado em UTC, e o que a pessoa
 * precisa ler é a hora do relógio dela — sem a conversão, um desfecho das 11:41 apareceria como
 * 14:41. Foi por confundir 11:41 com 12:41 que um relatório de lote foi lido como se fosse de
 * outra tentativa.
 *
 * ⚠ Ausência é TRAÇO, nunca "agora": data inventada num relatório de ato fiscal é pior que
 * nenhuma. Instante ilegível volta como veio, para a ausência não ser confundida com erro nosso.
 */
export function fmtDataHora(valor) {
  if (!valor) return TRACO;
  const d = valor instanceof Date ? valor : new Date(String(valor));
  if (Number.isNaN(d.getTime())) return String(valor);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/** 00.000.000/0000-00 — só formata se tiver os 14 dígitos; senão devolve o que veio. */
export function fmtCnpj(cnpj) {
  const d = String(cnpj || "").replace(/\D+/g, "");
  if (d.length !== 14) return texto(cnpj);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** CNPJ (14) ou CPF (11); qualquer outro tamanho sai como veio. */
export function fmtDoc(doc) {
  const d = String(doc || "").replace(/\D+/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return fmtCnpj(d);
  return texto(doc);
}

/** Últimas N competências 'YYYY-MM', do mês atual para trás. */
export function competenciasRecentes(n = 12) {
  const out = [];
  const now = new Date();
  let y = now.getFullYear();
  let mo = now.getMonth();
  for (let i = 0; i < n; i += 1) {
    out.push(`${y}-${String(mo + 1).padStart(2, "0")}`);
    mo -= 1;
    if (mo < 0) {
      mo = 11;
      y -= 1;
    }
  }
  return out;
}

/** Competência do mês antecedente (mês fechado anterior), 'YYYY-MM'. */
export function mesAntecedente() {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Competência do mês corrente, 'YYYY-MM'. */
export function mesCorrente() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * A COMPETÊNCIA COM QUE AS TELAS DO CLIENTE ABREM: o **mês CORRENTE**.
 *
 * ⚠⚠ ISTO INVERTE UMA DECISÃO DOCUMENTADA, E A INVERSÃO É DO DONO — 18/08/2026.
 * O padrão do projeto é o mês ANTERIOR, e ele é deliberado: `apps/web/src/lib/competencia.js`
 * (`competenciaPadrao`) diz *"o contador trabalha com o mês fechado"*, e o dashboard do escritório
 * filtra assim. O portal do CLIENTE passa a abrir no mês corrente porque foi o que o dono pediu,
 * com a tela na frente dele.
 *
 * ⚠ **NÃO "CONSERTE" ISTO DE VOLTA PARA `mesAntecedente`.** Quem vier daqui a três meses vai
 * encontrar duas telas do mesmo sistema abrindo em meses diferentes e vai querer alinhá-las; o
 * alinhamento certo é perguntar ao dono, não escolher o lado do contador. O motivo da diferença é
 * o USO: o contador olha o mês que fechou, o cliente olha o mês que está vivendo — ele acabou de
 * emitir a nota que quer ver.
 *
 * ⚠ O que NÃO mudou junto: o mês anterior continua na lista de opções (é a segunda linha de
 * `competenciasRecentes`), e nas abas Notas e Guias "Todas" continua existindo. A decisão é sobre
 * onde a tela ABRE, não sobre o que ela deixa ver.
 */
export function competenciaPadrao() {
  return mesCorrente();
}
