// GERA O ANEXO VIII — a correlação Item LC 116 → NBS → cIndOp → cClassTrib, do IBS/CBS.
//
// Fonte já versionada, com hash publicado no README de lá:
//   docs/leiaute-nfse/documentacao-tecnica/anexoviii-correlacaoitemnbsindopcclasstrib_ibscbs_v1-01-00.xlsx
//   (seção RTC do portal `gov.br/nfse`, baixado em 19/08/2026)
//
// ⚠⚠ **ELE NÃO É UM DE-PARA, E CHAMÁ-LO ASSIM FOI O PRIMEIRO ERRO DESTA ENTREGA.** O plano descrevia
// `Item LC116 → NBS → cIndOp → cClassTrib` como se cada item respondesse UM `cIndOp` e UM
// `cClassTrib`. Medido: **208 itens, 400 combinações** — 130 itens têm um cenário só (`cIndOp` +
// local de incidência) e **77 têm de dois a quatro**; para o `cClassTrib`, 147 itens têm um e
// **60 têm dois ou três** (ex.: "tributadas integralmente" × "fornecimento à administração
// pública"). Escolher entre elas depende de QUEM é o tomador daquela nota, não do serviço.
// **A tabela OFERECE; quem declara é o contador, no perfil de emissão.** O sistema não elege.
//
// ⚠⚠ **O REGISTRO É O PAR `(cIndOp, cClassTrib)`, NUNCA DUAS LISTAS SOLTAS** — e isto é medição, não
// gosto: em **7 itens** o produto cartesiano das duas listas contém combinações que a planilha NÃO
// autoriza. O caso mais claro é o `10.05`, que traz só `(020301, 200046)` e `(100301, 000001)`;
// achatado, ele passaria a oferecer `(020301, 000001)` e `(100301, 200046)`, que a fonte não diz.
// Há gate abaixo (`itensQueAchatarInventaria`) para que ninguém "simplifique" isso depois.
//
// ⚠⚠ **A ARMADILHA DA LEITURA SÃO AS 2.258 CÉLULAS MESCLADAS.** `sheet_to_json` devolve o valor só
// na ÂNCORA do bloco mesclado — todas as outras linhas voltam vazias. Lido assim, o item `01.01`
// pareceria ter um NBS e um `cClassTrib` em vez de onze e três. Por isso as fusões são expandidas
// à mão, a partir de `ws["!merges"]`, ANTES de qualquer leitura. ⚠ E a expansão é **não
// destrutiva**: célula que já tem valor próprio nunca é sobrescrita pela âncora.
//
// ⚠ SÓ LEITURA E ZERO REDE.
//
// Uso:
//   node apps/api/scripts/gerar-anexo-viii.mjs             # confere e reescreve
//   node apps/api/scripts/gerar-anexo-viii.mjs --conferir  # só confere
//
// (Rodar da raiz do monorepo — o `xlsx` está hoisted em `node_modules/`.)

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const FONTE = path.join(
  RAIZ,
  "docs/leiaute-nfse/documentacao-tecnica/anexoviii-correlacaoitemnbsindopcclasstrib_ibscbs_v1-01-00.xlsx",
);
const SAIDA = path.join(RAIZ, "apps/api/src/application/fiscal/ibscbs/anexoViii.data.js");
const ABA = "tabela geral";

/** ⚠ Publicado em `docs/leiaute-nfse/documentacao-tecnica/README.md`. */
const SHA_ESPERADO = "a21be0e86b7ae2c0c1cfec4ef0d398b96520345790b50f79e4c5b7d1dfe32fb3";

const SO_CONFERE = process.argv.includes("--conferir");

/** ⚠ MEDIDO NA PLANILHA EM 02/09/2026. A geração ABORTA se qualquer um mudar. */
const ESPERADO = Object.freeze({
  celulasMescladas: 2258,
  itens: 208,
  combinacoes: 400,
  nbsDistintos: 731,
  cIndOpDistintos: 21,
  cClassTribDistintos: 28,
  /** Só o `99.01.01`, o guarda-chuva "não classificado" — sem NBS, sem cIndOp, sem cClassTrib. */
  itensSemCombinacao: 1,
  /** Os itens em que a tabela responde sozinha. Nos outros o contador escolhe. */
  itensComUmaCombinacao: 89,
  /** ⚠⚠ A prova de que achatar em duas listas INVENTA combinação. Ver o cabeçalho. */
  itensQueAchatarInventaria: 7,
});

function morrer(msg) {
  console.error(`\n⚠⚠ GERAÇÃO ABORTADA — ${msg}\n`);
  console.error("A tabela NÃO foi reescrita. Tabela de código fiscal que muda sem alguém conferir é");
  console.error("exatamente o que este gate existe para impedir.\n");
  process.exit(1);
}

if (!fs.existsSync(FONTE)) morrer(`fonte não encontrada: ${FONTE}`);
const bytes = fs.readFileSync(FONTE);
const sha = createHash("sha256").update(bytes).digest("hex");
if (sha !== SHA_ESPERADO) {
  morrer(`SHA-256 divergente.\n  esperado ${SHA_ESPERADO}\n  obtido   ${sha}`);
}

const wb = XLSX.read(bytes, { type: "buffer" });
if (!wb.SheetNames.includes(ABA)) {
  morrer(`a aba "${ABA}" não existe (achei: ${wb.SheetNames.join(", ")})`);
}
const ws = wb.Sheets[ABA];
const faixa = XLSX.utils.decode_range(ws["!ref"]);

// ── A EXPANSÃO DAS FUSÕES ────────────────────────────────────────────────────────────────────
// ⚠ Sem isto, 2.258 blocos mesclados viram uma linha preenchida e N-1 linhas vazias.
const merges = ws["!merges"] || [];
const grade = new Map();
const chave = (r, c) => `${r}:${c}`;
const bruto = (r, c) => {
  const cel = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cel) return "";
  // `w` é o texto FORMATADO; `v` é o valor cru. Um código como `000001` guardado pelo Excel como
  // NÚMERO volta `1` em `v` e `000001` em `w` — a armadilha que custou uma execução na lista de
  // serviço nacional (`010101` chegando como `10101`).
  //
  // ⚠ **NESTE ARQUIVO ELA NÃO SE MANIFESTA, e é honesto dizer**: experimento executado trocando
  // isto por `String(cel.v ?? "")` — **todos os gates continuam passando**. As três colunas de
  // código do ANEXO VIII são texto na origem. A preferência por `w` fica como defesa barata contra
  // uma revisão futura da planilha, **não** como conserto de um defeito medido aqui.
  return String(cel.w ?? cel.v ?? "").trim();
};
for (let r = faixa.s.r; r <= faixa.e.r; r += 1) {
  for (let c = faixa.s.c; c <= faixa.e.c; c += 1) grade.set(chave(r, c), bruto(r, c));
}
for (const m of merges) {
  const valor = grade.get(chave(m.s.r, m.s.c)) || "";
  if (!valor) continue;
  for (let r = m.s.r; r <= m.e.r; r += 1) {
    for (let c = m.s.c; c <= m.e.c; c += 1) {
      // ⚠ NÃO DESTRUTIVO: só preenche o que está vazio.
      if (!grade.get(chave(r, c))) grade.set(chave(r, c), valor);
    }
  }
}
const em = (r, c) => grade.get(chave(r, c)) || "";

// ── CABEÇALHO ────────────────────────────────────────────────────────────────────────────────
const COLS = {
  item: 0, descItem: 1, nbs: 2, descNbs: 3, onerosa: 4,
  exterior: 5, indop: 6, local: 7, cct: 8, nomeCct: 9,
};
const CABECALHO_ESPERADO = ["Item LC 116", "Descrição Item", "NBS", "DESCRIÇÃO NBS"];
for (let i = 0; i < CABECALHO_ESPERADO.length; i += 1) {
  if (em(faixa.s.r, i) !== CABECALHO_ESPERADO[i]) {
    morrer(
      `cabeçalho inesperado na coluna ${i}: ${JSON.stringify(em(faixa.s.r, i))} ` +
        `(esperado ${JSON.stringify(CABECALHO_ESPERADO[i])})`,
    );
  }
}

// ── LEITURA ──────────────────────────────────────────────────────────────────────────────────
const itens = [];
const porItem = new Map();
for (let r = faixa.s.r + 1; r <= faixa.e.r; r += 1) {
  const codigo = em(r, COLS.item);
  if (!codigo) continue;
  let it = porItem.get(codigo);
  if (!it) {
    it = { item: codigo, descricao: em(r, COLS.descItem), nbs: [], combinacoes: [], _vistas: new Set() };
    porItem.set(codigo, it);
    itens.push(it);
  }
  const nbs = em(r, COLS.nbs);
  if (nbs && !it.nbs.includes(nbs)) it.nbs.push(nbs);

  const cIndOp = em(r, COLS.indop);
  const cClassTrib = em(r, COLS.cct);
  if (!cIndOp && !cClassTrib) continue;
  const par = `${cIndOp}|${cClassTrib}`;
  if (it._vistas.has(par)) continue;
  it._vistas.add(par);
  it.combinacoes.push({
    cIndOp,
    localIncidencia: em(r, COLS.local),
    cClassTrib,
    nomeClassTrib: em(r, COLS.nomeCct),
    onerosa: em(r, COLS.onerosa) || null,
    adquiridoDoExterior: em(r, COLS.exterior) || null,
  });
}
for (const it of itens) delete it._vistas;

// ── AS PROVAS ────────────────────────────────────────────────────────────────────────────────
const todas = itens.flatMap((i) => i.combinacoes);
const semComb = itens.filter((i) => !i.combinacoes.length);
const achataInventa = itens.filter((i) => {
  const ind = new Set(i.combinacoes.map((c) => c.cIndOp).filter(Boolean));
  const cct = new Set(i.combinacoes.map((c) => c.cClassTrib).filter(Boolean));
  return ind.size && cct.size && i.combinacoes.length < ind.size * cct.size;
});

const medido = {
  celulasMescladas: merges.length,
  itens: itens.length,
  combinacoes: todas.length,
  nbsDistintos: new Set(itens.flatMap((i) => i.nbs)).size,
  cIndOpDistintos: new Set(todas.map((c) => c.cIndOp).filter(Boolean)).size,
  cClassTribDistintos: new Set(todas.map((c) => c.cClassTrib).filter(Boolean)).size,
  itensSemCombinacao: semComb.length,
  itensComUmaCombinacao: itens.filter((i) => i.combinacoes.length === 1).length,
  itensQueAchatarInventaria: achataInventa.length,
};

console.log("\nFONTE   ", path.relative(RAIZ, FONTE));
console.log("aba     ", ABA);
console.log("SHA-256 ", sha, "(confere)");
console.log("\nMEDIDO x ESPERADO");
for (const k of Object.keys(ESPERADO)) {
  const ok = medido[k] === ESPERADO[k];
  console.log(`  ${k.padEnd(26)} ${String(medido[k]).padStart(5)}  ${ok ? "=" : "!="}  ${ESPERADO[k]}`);
}
for (const k of Object.keys(ESPERADO)) {
  if (medido[k] !== ESPERADO[k]) morrer(`${k}: medido ${medido[k]}, esperado ${ESPERADO[k]}`);
}

// ⚠ A CONTAGEM NÃO É PROVA — uma entrada perdida e outra duplicada dão o mesmo total. Daqui para
// baixo é prova de CONTEÚDO, a mesma disciplina da LC 116 e da NBS.
if (semComb.length !== 1 || semComb[0].item !== "99.01.01") {
  morrer(
    `o único item sem combinação tem de ser o 99.01.01 ` +
      `(achei: ${semComb.map((i) => i.item).join(", ") || "nenhum"})`,
  );
}
for (const c of todas) {
  // Os dois padrões vêm do XSD 1.01: `TSRTCCodIndOp` e `TSRTCCodClassTrib`, ambos `[0-9]{6}`.
  if (!/^[0-9]{6}$/.test(c.cIndOp)) morrer(`cIndOp fora de [0-9]{6}: ${JSON.stringify(c.cIndOp)}`);
  if (!/^[0-9]{6}$/.test(c.cClassTrib)) morrer(`cClassTrib fora de [0-9]{6}: ${JSON.stringify(c.cClassTrib)}`);
  if (!c.nomeClassTrib) morrer(`cClassTrib ${c.cClassTrib} sem nome`);
  if (!c.localIncidencia) morrer(`combinação de cIndOp ${c.cIndOp} sem local de incidência`);
}
for (const i of itens) {
  for (const n of i.nbs) {
    if (!/^\d\.\d{4}(\.\d{1,2}){0,2}$/.test(n)) {
      morrer(`NBS fora do formato no item ${i.item}: ${JSON.stringify(n)}`);
    }
  }
  if (!i.descricao) morrer(`item ${i.item} sem descrição`);
}
if (!itens.some((i) => /[áàâãéêíóôõúüç]/i.test(i.descricao))) {
  morrer("nenhuma descrição de item tem acento — a planilha foi lida errado");
}

// ⚠ CRUZAMENTO COM OUTRA FONTE JÁ VERSIONADA: fora da família `99.` (que é criação do próprio
// ANEXO_VIII para o "não classificado"), todo item tem de existir na LC 116 que já está no projeto.
// ⚠ A LC 116 grava `1.01` e o ANEXO_VIII grava `01.01` — sem normalizar, 85 itens pareceriam órfãos.
const lc116 = fs.readFileSync(
  path.join(RAIZ, "apps/api/src/application/fiscal/lc116/lc116.data.js"),
  "utf-8",
);
const codigosLc = new Set([...lc116.matchAll(/"codigo":"([\d.]+)"/g)].map((m) => m[1]));
if (codigosLc.size !== 205) morrer(`esperava 205 subitens da LC 116, li ${codigosLc.size}`);
// ⚠ O zero à esquerda cai SÓ NO ITEM: a LC 116 escreve `1.01`, não `1.1`. Normalizar as duas
// metades (`String(Number(p))` em todas) devolve `1.1` e faz os 208 itens parecerem órfãos —
// defeito cometido na primeira versão deste gate, e pego por ele.
const semZero = (c) => {
  const [item, ...resto] = c.split(".");
  return [String(Number(item)), ...resto].join(".");
};
const orfaos = itens.filter((i) => !i.item.startsWith("99.") && !codigosLc.has(semZero(i.item)));
if (orfaos.length) {
  morrer(`itens fora da LC 116 e fora da família 99.: ${orfaos.map((i) => i.item).join(", ")}`);
}
const daLc = itens.filter((i) => !i.item.startsWith("99.")).length;
console.log(`OK: os ${daLc} itens não-99 cruzam com a LC 116 versionada`);
console.log("OK: todas as provas passaram");

if (SO_CONFERE) {
  console.log("(--conferir: nada foi escrito)\n");
  process.exit(0);
}

const saida = `// GERADO POR \`apps/api/scripts/gerar-anexo-viii.mjs\` — NÃO EDITAR À MÃO.
//
// ANEXO VIII do leiaute da NFS-e nacional — a correlação do IBS/CBS (reforma tributária).
//
//   fonte    docs/leiaute-nfse/documentacao-tecnica/anexoviii-correlacaoitemnbsindopcclasstrib_ibscbs_v1-01-00.xlsx
//   aba      ${ABA}
//   SHA-256  ${sha}
//   medido   ${medido.itens} itens · ${medido.combinacoes} combinações · ${medido.nbsDistintos} códigos NBS ·
//            ${medido.cIndOpDistintos} cIndOp · ${medido.cClassTribDistintos} cClassTrib · ${medido.celulasMescladas} células mescladas expandidas
//
// ⚠⚠ **ISTO NÃO É UM DE-PARA — É UM CATÁLOGO DE OPÇÕES.** Só ${medido.itensComUmaCombinacao} dos ${medido.itens} itens têm UMA
// combinação; nos outros ${medido.itens - medido.itensComUmaCombinacao} a tabela oferece de duas a quatro, e escolher entre elas
// depende de QUEM é o tomador daquela nota. **O sistema não elege — quem declara é o contador.**
//
// ⚠⚠ **A COMBINAÇÃO É O PAR \`(cIndOp, cClassTrib)\`.** Guardá-los como duas listas separadas
// inventaria, em ${medido.itensQueAchatarInventaria} itens, combinações que a fonte NÃO autoriza (ver o gerador).
//
// ⚠ \`99.01.01\` vem sem NBS, sem cIndOp e sem cClassTrib: é o guarda-chuva "não classificado",
// a mesma família do \`990101\` que a classificação de notas manda para a fila de pendência.
`
  + `\n/** Os ${medido.itens} itens do ANEXO VIII, na ordem da planilha. */\n`
  + "export const ANEXO_VIII = Object.freeze([\n"
  + itens.map((i) => `  ${JSON.stringify(i)},`).join("\n")
  + "\n]);\n";

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, saida, "utf-8");
console.log(`escrito: ${path.relative(RAIZ, SAIDA)}\n`);
