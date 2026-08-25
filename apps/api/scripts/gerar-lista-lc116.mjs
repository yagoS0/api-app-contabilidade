// GERA A LISTA DE SERVIÇOS DA LC 116/2003 a partir do texto OFICIAL versionado.
//
// Mesma regra de `gerar-lista-servico-nacional.mjs`, `docs/leiaute-nfse/` e
// `docs/leiaute-efd-contribuicoes/`: tabela de código fiscal **não se transcreve de memória nem se
// deduz por analogia**. Ela entra no repositório como artefato oficial — com URL, data, contagem e
// hash — e o código é GERADO a partir dela, com uma prova que ABORTA na divergência.
//
// Fonte: `docs/lc116/lcp116.htm` (Planalto, texto compilado). Ver o README de lá.
//
// ⚠ SÓ LEITURA E ZERO REDE. O download foi feito uma vez, à mão, e o arquivo está versionado.
// Buscar em runtime faria a tabela mudar debaixo do sistema sem ninguém ter decidido.
//
// Uso:
//   node apps/api/scripts/gerar-lista-lc116.mjs             # confere e reescreve o .data.js
//   node apps/api/scripts/gerar-lista-lc116.mjs --conferir  # só confere, não escreve

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "../../..");
const FONTE = path.join(RAIZ, "docs/lc116/lcp116.htm");
const SAIDA = path.join(RAIZ, "apps/api/src/application/fiscal/lc116/lc116.data.js");

const SO_CONFERE = process.argv.includes("--conferir");

/** ⚠ CONTAGENS MEDIDAS NA FONTE, e a geração ABORTA se elas mudarem. */
const ESPERADO = Object.freeze({
  itens: 40,
  subitensBrutos: 213,
  /** Os que vêm em DUAS redações — a da LC 157/2016 vence e a original é descartada. */
  duplicados: 8,
  subitens: 205,
  vetados: 5,
});

function morrer(msg) {
  console.error(`\n⚠⚠ GERAÇÃO ABORTADA — ${msg}\n`);
  console.error("A lista NÃO foi reescrita. Tabela de código fiscal que muda sem alguém conferir é");
  console.error("exatamente o que este gate existe para impedir.\n");
  process.exit(1);
}

// ─── LEITURA ──────────────────────────────────────────────────────────────────────────────────
if (!fs.existsSync(FONTE)) morrer(`fonte não encontrada: ${FONTE}`);
const bytes = fs.readFileSync(FONTE);
const sha = crypto.createHash("sha256").update(bytes).digest("hex");
// ⚠ latin-1, NÃO utf-8: o Planalto serve o texto compilado em ISO-8859-1. Lido como utf-8, todo
// acento vira U+FFFD — e a descrição do serviço é texto que chega ao contador.
const texto = new TextDecoder("latin1").decode(bytes);
const semTags = texto.replace(/<[^>]+>/g, "\n");

// ⚠⚠ AS ENTIDADES NUMÉRICAS TAMBÉM, E É AQUI QUE A PRIMEIRA TENTATIVA MORREU. O separador entre o
// número e o nome do serviço não é um hífen: é `&#150;`, o travessão do CP1252. Tratando só as
// entidades NOMEADAS, o extrator achou 1 item de 40 — e o gate abortou em vez de escrever a lista
// mutilada, que é exatamente para isso que ele existe.
function decodificarEntidades(t) {
  return t
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&ordm;/g, "º").replace(/&ordf;/g, "ª")
    .replace(/&sect;/g, "§").replace(/&deg;/g, "°")
    // ⚠ `&amp;` POR ÚLTIMO: antes, "&amp;#150;" viraria "&#150;" e seria decodificado de novo.
    .replace(/&amp;/g, "&");
}

const linhas = decodificarEntidades(semTags)
  .replace(/ /g, " ")
  .split("\n")
  .map((l) => l.replace(/\s+/g, " ").trim())
  .filter(Boolean);

// ⚠ ANCORADO NO CABEÇALHO, não em "lista de serviços anexa" solto: essa expressão aparece QUATRO
// vezes dentro do corpo da lei ("referidos nos subitens 4.22 e 4.23 da lista de serviços anexa a
// esta Lei Complementar"). Pegar a primeira ocorrência começaria a extração no meio do art. 2º.
const inicio = linhas.findIndex((l) => /^Lista de servi[çc]os anexa/i.test(l));
if (inicio < 0) morrer("não achei o cabeçalho da lista anexa no texto oficial");

// ─── EXTRAÇÃO ─────────────────────────────────────────────────────────────────────────────────
// ⚠ TODOS OS TRAÇOS CONTAM. O documento mistura hífen comum (nas redações da LC 157/2016), o
// `&#150;` do CP1252 (U+0096) e travessões tipográficos. Uma lista de separadores que esquecesse
// um deles perderia justamente as entradas mais antigas — em silêncio.
const TRACO = "[\\u0096\\u0097\\u2010-\\u2015\\u2212-]";
const ENTRADA = new RegExp(`^(\\d{1,2})(?:\\.(\\d{2}))?[ \\t]*${TRACO}[ \\t]*(.*)$`);
const MARCA_REDACAO = /Reda[çc][ãa]o dada pela Lei Complementar/i;
const MARCA_VETADO = /\(VETADO\)/i;

const brutas = [];
let atual = null;
for (const linha of linhas.slice(inicio)) {
  const m = ENTRADA.exec(linha);
  if (m) {
    if (atual) brutas.push(atual);
    atual = { item: Number(m[1]), sub: m[2] || null, partes: [m[3]] };
  } else if (atual) {
    atual.partes.push(linha);
  }
}
if (atual) brutas.push(atual);

for (const e of brutas) {
  e.texto = e.partes.join(" ").replace(/\s+/g, " ").trim();
  delete e.partes;
}

const itens = brutas.filter((e) => e.sub === null);
const subitensBrutos = brutas.filter((e) => e.sub !== null);

// ⚠⚠ O TEXTO COMPILADO TRAZ AS DUAS REDAÇÕES, INTERLEAVADAS. O Planalto imprime a redação ORIGINAL
// e, logo abaixo, a alterada — as duas com o MESMO número. Lido cru, `1.03` sai duas vezes, e a
// versão que um mapa guardaria seria a ÚLTIMA escrita, que pode ser a REVOGADA. Descrição revogada
// num documento fiscal é erro silencioso.
//
// A regra: aparecendo o mesmo número, a versão com a marca "Redação dada pela LC …" VENCE.
const porNumero = new Map();
for (const e of subitensBrutos) {
  const numero = `${e.item}.${e.sub}`;
  const anterior = porNumero.get(numero);
  const temMarca = MARCA_REDACAO.test(e.texto);
  // ⚠ Sem marca em NENHUMA das duas não se escolhe: seria eleger por posição no arquivo.
  if (anterior && !temMarca && !MARCA_REDACAO.test(anterior.texto)) {
    morrer(`o subitem ${numero} aparece duas vezes e NENHUMA traz "Redação dada" — não há como saber qual vale`);
  }
  if (!anterior || temMarca) porNumero.set(numero, e);
}

const duplicados = subitensBrutos.length - porNumero.size;

// ⚠⚠ E A CONTAGEM NÃO PROVA QUAL REDAÇÃO FICOU. Achado por experimento: trocando a regra para "a
// última escrita vence", o total continua 205 e o gate PASSAVA — escrevendo a descrição REVOGADA,
// que é o erro mais caro desta tabela e o mais silencioso. Contagem igual, conteúdo trocado.
//
// A prova certa é estrutural: todo subitem que vinha em duas versões TEM de ter ficado com a que
// traz a marca da lei alteradora. Sem isto, o gate media o tamanho e não o conteúdo.
const numerosDuplicados = new Set();
const vistos = new Set();
for (const e of subitensBrutos) {
  const n = `${e.item}.${e.sub}`;
  if (vistos.has(n)) numerosDuplicados.add(n);
  vistos.add(n);
}
for (const n of numerosDuplicados) {
  if (!MARCA_REDACAO.test(porNumero.get(n).texto)) {
    morrer(`o subitem ${n} vinha em duas redações e ficou com a que NÃO traz a marca da lei alteradora — `
      + "ou seja, com a REVOGADA");
  }
}

/** Tira a nota de rodapé legislativa do fim da descrição — ela não é o nome do serviço. */
function limpar(t) {
  return t
    .replace(/\((?:Reda[çc][ãa]o dada|Inclu[íi]do)\s+pela\s+Lei\s+Complementar[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\.$/, ".")
    .trim();
}

const lista = [...porNumero.values()]
  .map((e) => {
    const vetado = MARCA_VETADO.test(e.texto);
    return {
      codigo: `${e.item}.${e.sub}`,
      item: e.item,
      subitem: e.sub,
      // ⚠ `vetado` é DADO, não ausência. Os vetados deixam buracos na numeração; omiti-los faria o
      // próximo leitor achar que a extração falhou.
      vetado,
      descricao: vetado ? null : limpar(e.texto),
    };
  })
  .sort((a, b) => (a.item - b.item) || a.subitem.localeCompare(b.subitem));

const rotuloItem = new Map(itens.map((e) => [e.item, limpar(e.texto)]));

// ─── PROVA ────────────────────────────────────────────────────────────────────────────────────
const vetados = lista.filter((s) => s.vetado).length;
const medido = {
  itens: itens.length, subitensBrutos: subitensBrutos.length,
  duplicados, subitens: lista.length, vetados,
};

console.log("\nFONTE   ", path.relative(RAIZ, FONTE));
console.log("SHA-256 ", sha);
console.log("bytes   ", bytes.length.toLocaleString("pt-BR"));
console.log("\nMEDIDO x ESPERADO");
for (const chave of Object.keys(ESPERADO)) {
  const ok = medido[chave] === ESPERADO[chave];
  console.log(`  ${chave.padEnd(16)} ${String(medido[chave]).padStart(4)}  ${ok ? "=" : "!="}  ${ESPERADO[chave]}`);
}
for (const chave of Object.keys(ESPERADO)) {
  if (medido[chave] !== ESPERADO[chave]) morrer(`${chave}: medido ${medido[chave]}, esperado ${ESPERADO[chave]}`);
}

// Provas ESTRUTURAIS, além da contagem — contagem sozinha fecha por acaso.
const numerosItens = new Set(itens.map((e) => e.item));
for (let n = 1; n <= 40; n += 1) if (!numerosItens.has(n)) morrer(`falta o item ${n}`);
for (const s of lista) {
  if (!numerosItens.has(s.item)) morrer(`o subitem ${s.codigo} não pertence a nenhum item da lista`);
  if (!/^\d{1,2}\.\d{2}$/.test(s.codigo)) morrer(`código fora do formato N.NN: ${s.codigo}`);
  if (!s.vetado && (!s.descricao || s.descricao.length < 4)) morrer(`o subitem ${s.codigo} ficou sem descrição`);
  if (!s.vetado && MARCA_REDACAO.test(s.descricao)) morrer(`sobrou nota legislativa na descrição de ${s.codigo}`);
}
// ⚠ Acento preservado: decodificado como utf-8 por engano, isto cai.
if (!lista.some((s) => s.descricao && /[áàâãéêíóôõúüç]/i.test(s.descricao))) {
  morrer("nenhuma descrição tem acento — a fonte foi decodificada com a codificação errada");
}
console.log("\nOK: todas as provas passaram");

// A PROVA QUE VALE MAIS QUE A CONTAGEM: os subitens de cada item formam uma sequencia CONTIGUA
// .01 ate .N, com os vetados ocupando o slot deles. Contagem sozinha fecha por acaso — uma entrada
// perdida e outra duplicada dao o mesmo total. Aqui, se faltar UMA, o buraco aparece.
//
// E foi ela que DECIDIU o numero: uma primeira sondagem (em Python, com uma lista de tracos que nao
// incluia o U+0096) achou 204 subitens, e esta prova mostrou que o certo e 205 — a sondagem tinha
// COLADO uma entrada no texto da anterior, em silencio.
const porItem = new Map();
for (const s of lista) {
  if (!porItem.has(s.item)) porItem.set(s.item, []);
  porItem.get(s.item).push(Number(s.subitem));
}
const buracos = [];
for (const [item, subs] of porItem) {
  subs.sort((a, b) => a - b);
  if (subs[0] !== 1) buracos.push(`o item ${item} comeca em .${String(subs[0]).padStart(2, "0")}`);
  for (let n = 1; n <= subs[subs.length - 1]; n += 1) {
    if (!subs.includes(n)) buracos.push(`falta o subitem ${item}.${String(n).padStart(2, "0")}`);
  }
}
if (buracos.length) morrer(`a numeracao tem buraco — ${buracos.slice(0, 5).join(" - ")}`);
console.log(`OK: numeracao contigua nos ${porItem.size} itens, sem buraco`);

if (SO_CONFERE) { console.log("(--conferir: nada foi escrito)\n"); process.exit(0); }

// ─── ESCRITA ──────────────────────────────────────────────────────────────────────────────────
const cabecalho = `// GERADO POR \`apps/api/scripts/gerar-lista-lc116.mjs\` — NÃO EDITAR À MÃO.
//
// Lista de serviços anexa à Lei Complementar nº 116, de 31 de julho de 2003, já com as alterações
// da LC 157/2016. Extraída do texto compilado oficial do Planalto, versionado em \`docs/lc116/\`.
//
//   fonte    docs/lc116/lcp116.htm
//   SHA-256  ${sha}
//   medido   ${medido.itens} itens · ${medido.subitens} subitens (${medido.vetados} vetados);
//            ${medido.duplicados} subitens vinham em DUAS redações e a da LC 157/2016 venceu
//
// ⚠⚠ ISTO NÃO É O \`cTribNac\` DA NFS-e. O código de tributação nacional tem SEIS dígitos
// (item + subitem + desdobro nacional) e mora em \`apps/web/src/lib/servicosNacionais/\`; o item da
// LC 116 tem quatro (N.NN). Trocar um pelo outro dá granularidade errada, e o erro sai como nota
// emitida com o serviço errado — silenciosamente.
//
// ⚠ \`vetado: true\` é DADO. Os cinco vetados deixam buracos na numeração (3.01, 7.14, 7.15, 13.01
// e 17.07); omiti-los faria o próximo leitor achar que a extração falhou.
`;

const corpo = `
/** Os ${medido.itens} itens — o "capítulo" do serviço. */
export const ITENS_LC116 = Object.freeze({
${[...rotuloItem.entries()].sort((a, b) => a[0] - b[0]).map(([n, t]) => `  ${n}: ${JSON.stringify(t)},`).join("\n")}
});

/** Os ${medido.subitens} subitens, na ordem da lei. */
export const SUBITENS_LC116 = Object.freeze([
${lista.map((s) => `  ${JSON.stringify(s)},`).join("\n")}
]);
`;

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, cabecalho + corpo, "utf-8");
console.log(`escrito: ${path.relative(RAIZ, SAIDA)}\n`);
