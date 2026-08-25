// GERA A NOMENCLATURA BRASILEIRA DE SERVIÇOS (NBS) a partir do XLSX oficial já versionado.
//
// A fonte é a MESMA de `gerar-lista-servico-nacional.mjs` — `docs/lista-servico-nacional/`, aba
// `LISTA.NBS_v2.0`. Nenhum arquivo novo entra em `docs/`: o Anexo B traz as duas listas, e baixar
// de novo criaria uma segunda cópia que envelheceria em separado.
//
// ⚠⚠ ELA NASCE SEM CONSUMIDOR, E ISSO É DECISÃO DO DONO (25/08/2026). O `cNBS` é campo OPCIONAL da
// DPS e este projeto não o preenche; eu recomendei deixar a tabela para quando houvesse leitor —
// dado que ninguém lê é o defeito que o próprio Perfil Fiscal tem hoje — e ele decidiu gerar agora,
// para estar pronta. Fica registrado assim: a tabela é INERTE por escolha, não por esquecimento.
//
// ⚠ SÓ LEITURA E ZERO REDE.
//
// Uso:
//   node apps/api/scripts/gerar-lista-nbs.mjs             # confere e reescreve
//   node apps/api/scripts/gerar-lista-nbs.mjs --conferir  # só confere
//
// (Rodar da raiz do monorepo — o `xlsx` está hoisted em `node_modules/`.)

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const FONTE = path.join(RAIZ, "docs/lista-servico-nacional/anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx");
const SAIDA = path.join(RAIZ, "apps/api/src/application/fiscal/nbs/nbs.data.js");
const ABA = "LISTA.NBS_v2.0";

const SO_CONFERE = process.argv.includes("--conferir");

/** ⚠ MEDIDO NA PLANILHA. A geração ABORTA se mudar. */
const ESPERADO = Object.freeze({
  linhas: 1210,
  /** Códigos que o Excel guardou como NÚMERO — perderam os pontos. Ver abaixo. */
  numericos: 102,
  /** As duas linhas terminais de "não classificado", que a planilha traz sem descrição. */
  semDescricao: 2,
});

function morrer(msg) {
  console.error(`\n⚠⚠ GERAÇÃO ABORTADA — ${msg}\n`);
  console.error("A lista NÃO foi reescrita. Tabela de código fiscal que muda sem alguém conferir é");
  console.error("exatamente o que este gate existe para impedir.\n");
  process.exit(1);
}

if (!fs.existsSync(FONTE)) morrer(`fonte não encontrada: ${FONTE}`);
const bytes = fs.readFileSync(FONTE);
const sha = createHash("sha256").update(bytes).digest("hex");

const wb = XLSX.read(bytes, { type: "buffer" });
if (!wb.SheetNames.includes(ABA)) morrer(`a aba "${ABA}" não existe na planilha (achei: ${wb.SheetNames.join(", ")})`);
const linhas = XLSX.utils.sheet_to_json(wb.Sheets[ABA], { header: 1, defval: null, raw: true });

const cabecalho = (linhas[0] || []).map((c) => String(c ?? "").trim());
if (cabecalho[0] !== "CÓDIGO NBS" || cabecalho[1] !== "DESCRIÇÃO") {
  morrer(`cabeçalho inesperado: ${JSON.stringify(cabecalho)}`);
}
const dados = linhas.slice(1);

// ─── A ARMADILHA DOS NUMÉRICOS ────────────────────────────────────────────────────────────────
// ⚠⚠ MESMA FAMÍLIA DA OUTRA ABA, e igualmente silenciosa: a coluna do código é MISTA. 1.108 linhas
// vêm como TEXTO (`1.0101.11.00`) e 102 vêm como NÚMERO — o Excel comeu os pontos e `1.0101` virou
// o inteiro `10101`. Transcrever cru produziria 102 códigos sem pontuação nenhuma, no meio de uma
// lista pontuada.
//
// ⚠ A remontagem é `C.PPPP` (capítulo 1 dígito + posição 4), e ela NÃO é suposição: o gate abaixo
// exige que TODO numérico remontado tenha pelo menos um FILHO entre os códigos que vieram como
// texto. Medido: 102 de 102. Falhando um só, a geração para.
function remontarNumerico(n) {
  const s = String(n);
  if (s.length !== 5) return null;
  return `${s[0]}.${s.slice(1)}`;
}

const emTexto = new Set(
  dados.filter((r) => typeof r[0] === "string").map((r) => String(r[0]).trim()),
);

const registros = [];
let numericos = 0;
let semDescricao = 0;
const orfaos = [];

for (const [i, linha] of dados.entries()) {
  const bruto = linha[0];
  const desc = linha[1] == null ? null : String(linha[1]).trim() || null;
  if (bruto == null) continue;

  let codigo;
  if (typeof bruto === "number") {
    numericos += 1;
    codigo = remontarNumerico(bruto);
    if (!codigo) morrer(`o código numérico ${bruto} (linha ${i + 2}) não tem 5 dígitos — a remontagem não se aplica`);
    // ⚠ A PROVA, linha a linha. Sem filho, a remontagem seria palpite.
    if (![...emTexto].some((t) => t.startsWith(`${codigo}.`))) orfaos.push([bruto, codigo]);
  } else {
    // ⚠ `trim`: 112 códigos da planilha vêm com espaço no fim. Sem isto, `"1.0101.11.00 "` e
    // `"1.0101.11.00"` seriam códigos diferentes, e a busca falharia para uns e não para outros.
    codigo = String(bruto).trim();
  }

  if (desc === null) semDescricao += 1;
  registros.push({ codigo, descricao: desc });
}

if (orfaos.length) {
  morrer(`${orfaos.length} código(s) numérico(s) remontado(s) NÃO têm filho na lista em texto — `
    + `a remontagem "C.PPPP" deixou de valer. Exemplos: ${JSON.stringify(orfaos.slice(0, 5))}`);
}

const medido = { linhas: registros.length, numericos, semDescricao };

console.log("\nFONTE   ", path.relative(RAIZ, FONTE));
console.log("aba     ", ABA);
console.log("SHA-256 ", sha);
console.log("\nMEDIDO x ESPERADO");
for (const k of Object.keys(ESPERADO)) {
  console.log(`  ${k.padEnd(14)} ${String(medido[k]).padStart(5)}  ${medido[k] === ESPERADO[k] ? "=" : "!="}  ${ESPERADO[k]}`);
}
for (const k of Object.keys(ESPERADO)) {
  if (medido[k] !== ESPERADO[k]) morrer(`${k}: medido ${medido[k]}, esperado ${ESPERADO[k]}`);
}
console.log(`OK: os ${numericos} códigos numéricos remontados têm filho na lista em texto`);

// Provas estruturais.
const vistos = new Set();
for (const r of registros) {
  if (!/^\d\.\d{4}(\.\d{1,2}){0,2}$/.test(r.codigo)) morrer(`código fora do formato NBS: ${JSON.stringify(r.codigo)}`);
  if (vistos.has(r.codigo)) morrer(`código NBS repetido: ${r.codigo}`);
  vistos.add(r.codigo);
}
if (!registros.some((r) => r.descricao && /[áàâãéêíóôõúüç]/i.test(r.descricao))) {
  morrer("nenhuma descrição tem acento — a planilha foi lida errado");
}
console.log("OK: todas as provas passaram");

if (SO_CONFERE) { console.log("(--conferir: nada foi escrito)\n"); process.exit(0); }

const saida = `// GERADO POR \`apps/api/scripts/gerar-lista-nbs.mjs\` — NÃO EDITAR À MÃO.
//
// Nomenclatura Brasileira de Serviços (NBS), versão 2.0 — aba \`${ABA}\` do Anexo B do portal
// \`gov.br/nfse\`, o MESMO arquivo de onde sai a lista de serviço nacional (\`cTribNac\`).
//
//   fonte    docs/lista-servico-nacional/anexo_b-nbs2-lista_servico_nacional-snnfse.xlsx
//   SHA-256  ${sha}
//   medido   ${medido.linhas} códigos · ${medido.numericos} vinham como NÚMERO e foram remontados ·
//            ${medido.semDescricao} sem descrição (as linhas terminais de "não classificado")
//
// ⚠⚠ ESTA TABELA NÃO TEM CONSUMIDOR HOJE, E ISSO É DECISÃO, NÃO ESQUECIMENTO. O \`cNBS\` é campo
// OPCIONAL da DPS e este projeto não o preenche. Ela foi gerada a pedido do dono (25/08/2026) para
// estar pronta quando houver leitor. ⚠ Ligar o \`cNBS\` na emissão MUDA O XML de nota fiscal em
// produção — é ato do dono, não consequência de a tabela existir.
//
// ⚠ NBS ≠ \`cTribNac\` ≠ item da LC 116. São três listas, três granularidades e três finalidades.
`
  + `\n/** Os ${medido.linhas} códigos da NBS 2.0, na ordem da planilha. */\n`
  + "export const NBS = Object.freeze([\n"
  + registros.map((r) => `  ${JSON.stringify(r)},`).join("\n")
  + "\n]);\n";

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, saida, "utf-8");
console.log(`escrito: ${path.relative(RAIZ, SAIDA)}\n`);
