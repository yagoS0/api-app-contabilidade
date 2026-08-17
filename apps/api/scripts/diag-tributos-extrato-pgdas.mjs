// A REPARTIÇÃO POR TRIBUTO DO EXTRATO DO PGDAS-D — SOMENTE LEITURA, e ela existe para MEDIR ANTES.
//
// ─── POR QUE ESTE SCRIPT VEM ANTES DO PARSER ────────────────────────────────────────────────
//
// `SerproPgdasDeclaracaoService.parsePgdasDeclarationPdf` (linhas 416-422) já casa a linha de
// tributos do extrato e **já parte o texto em N valores** — e então usa **só o último** (o Total),
// jogando os outros fora na mesma instrução:
//
//     const tributoTableMatch = rawText.match(
//       /IRPJ\s*CSLL\s*COFINS\s*PIS\S*Pasep\s*INSS\S*CPP\s*ICMS\s*IPI\s*ISS\s*Total\s*([\d.,]+)/i
//     );
//     const values = tributoTableMatch[1].match(/\d+(?:\.\d{3})*,\d{2}/g);
//     if (values && values.length > 0) impostoApurado = parseDecimal(values[values.length - 1]);
//
// A coluna `ApuracaoSnapshot.tributosPorTributo` existe no schema para receber exatamente esse
// resto, e está **morta** (ninguém escreve, ninguém lê).
//
// ⚠ **O PARSER NÃO PODE SER ESCRITO SEM O TEXTO REAL, E O TEXTO REAL NÃO ESTÁ NO REPOSITÓRIO.**
// Os três PDFs que calibraram o parser de atividades (SOLUCLEAN / GARDEN BRASA / PRO-FACILITIES,
// citados no comentário da linha 349 daquele arquivo) **não estão versionados**, não há nenhuma
// fixture com a linha de tributos, e não há banco alcançável nesta máquina (`DATABASE_URL` aponta
// para `localhost:5432`, que não responde). Escrever a leitura contra um leiaute imaginado é
// exatamente o que a regra 1 proíbe — e a lição já foi paga em
// `parseComprovanteArrecadacao.js`, onde os valores vêm **COLADOS** (`"178,3112,941,78193,03"`) e
// a ordem das colunas é o **INVERSO** do cabeçalho impresso. Nenhuma das duas coisas se adivinha.
//
// Então este script mede, sobre o que JÁ está guardado, as quatro perguntas que decidem o desenho:
//
//   1. em quantos extratos a linha de tributos existe e é casada pela regex de hoje;
//   2. em quantos valores ela se parte (**9** = 8 tributos + Total é a hipótese; qualquer outro
//      número diz que o leiaute não é esse);
//   3. em quantos a soma dos 8 primeiros bate com o último (a autoverificação, no molde de
//      `parseComprovanteArrecadacao`: sem ela, nada é gravado);
//   4. ⚠ e a mais importante: **o último valor é mesmo o Total?** Isso se responde sem nenhuma
//      suposição, comparando com `CompanyMonthlyCircular.dasTotal`, que é gravado a partir dele e
//      já foi conferido contra a guia real em produção.
//
// ⚠ A pergunta 2 tem uma resposta que seria DEFEITO EM PRODUÇÃO, e é por isso que ela é medida:
// `([\d.,]+)` casa um trecho **contíguo**. Se no texto real os nove números vierem separados por
// espaço, o grupo captura **só o primeiro**, `values` tem comprimento 1, e
// `values[values.length - 1]` devolve o **IRPJ** achando que devolve o Total — com `dasTotal`
// errado desde sempre. A coluna `contagem=1` na saída é esse alarme.
//
// ⚠ E há uma coisa que a soma NÃO pega, pelo mesmo motivo documentado no PAGTOWEB: **permutação**.
// Trocar ISS por IPI mantém a soma idêntica. Por isso a saída imprime a AMOSTRA dos valores lado a
// lado com os rótulos do cabeçalho, para o contador conferir contra o PDF antes de a gravação ser
// ligada — a ordem dos oito não é dedutível daqui, e um ISS rotulado como IPI numa coluna de
// auditoria é pior que coluna vazia.
//
// ⚠ ELE NÃO ESCREVE NADA. Não existe `--aplicar`, não há `update`/`create`/`$transaction`, e não
// há nenhuma chamada a SERPRO/ADN/SEFAZ — tudo o que ele lê já está em `metadata`, guardado por
// capturas que já foram pagas.
//
// Uso:
//   node scripts/diag-tributos-extrato-pgdas.mjs [--cnpj=...] [--comp=AAAA-MM] [--amostra=N]
//
//   --cnpj     limita a uma empresa
//   --comp     limita a uma competência
//   --amostra  quantos casos imprimir valor a valor (padrão: 5; 0 desliga)
//
// Contra produção (⚠ `railway run … bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-tributos-extrato-pgdas.mjs'

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

// ⚠ AS DUAS REGEX SÃO CÓPIA LITERAL DE `SerproPgdasDeclaracaoService` (linhas 417 e 420), e é
// proposital que sejam cópia e não uma segunda formulação: o que este script mede é o
// comportamento DAQUELE código sobre o texto real. Uma regex "melhorada" aqui mediria outra coisa
// e o número do relatório não descreveria a produção.
const RE_LINHA_TRIBUTOS =
  /IRPJ\s*CSLL\s*COFINS\s*PIS\S*Pasep\s*INSS\S*CPP\s*ICMS\s*IPI\s*ISS\s*Total\s*([\d.,]+)/i;
const RE_MOEDA_G = /\d+(?:\.\d{3})*,\d{2}/g;

// Os rótulos, na ordem em que o CABEÇALHO os imprime — que é a ordem exigida pela regex acima.
// ⚠ Isto NÃO é a ordem provada dos valores; é a ordem do cabeçalho, e a saída existe justamente
// para confrontar as duas. Ver a nota sobre permutação no topo.
const ROTULOS_DO_CABECALHO = Object.freeze([
  "IRPJ", "CSLL", "COFINS", "PIS/Pasep", "INSS/CPP", "ICMS", "IPI", "ISS",
]);

// Sonda LARGA, só para detectar variação de grafia do cabeçalho que a regex estreita PERDERIA.
// É a armadilha nº 8 do SITFIS (`Vl. Original` × `Vl.Original`): o cabeçalho existe, escrito de
// outro jeito, e a leitura estreita simplesmente não acha — silenciosamente.
const RE_SONDA_LARGA = /IRPJ[\s\S]{0,80}?CSLL[\s\S]{0,120}?ISS[\s\S]{0,40}?Total/i;

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

const soDigitos = (v) => String(v || "").replace(/\D+/g, "");
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const num = (n, w = 5) => String(n ?? 0).padStart(w);

function parseValorBR(txt) {
  const n = Number(String(txt).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** O `rawText` guardado, se houver. Nada é reparseado de PDF — o PDF pode nem existir mais. */
function rawTextDe(circular) {
  const m = circular?.metadata;
  if (!m || typeof m !== "object") return null;
  const t = m?.parsedPgdas?.rawText;
  return typeof t === "string" && t.trim() ? t : null;
}

/**
 * A leitura CANDIDATA, exatamente como a produção a faz — mais a parte que ela descarta.
 *
 * Devolve `motivo` nomeado em vez de valor provável, no mesmo vocabulário fechado que o resto do
 * projeto usa: quem não fecha não vira dado.
 */
function lerLinhaDeTributos(texto) {
  const m = String(texto || "").match(RE_LINHA_TRIBUTOS);
  if (!m) {
    return {
      ok: false,
      motivo: RE_SONDA_LARGA.test(texto) ? "CABECALHO_EM_OUTRA_GRAFIA" : "SEM_LINHA_DE_TRIBUTOS",
      valores: [],
    };
  }
  // ⚠ O MATCH INTEIRO (grupo 0) viaja junto do grupo 1 porque é ele que traz o **cabeçalho como
  // ele realmente está escrito** no `rawText` — com o espaçamento real entre `IRPJ`, `CSLL`, … A
  // regex usa `\s*` em toda junta, então ela casa tanto o cabeçalho colado quanto o espaçado: só o
  // grupo 1 não permite distinguir os dois. Uma fixture escrita a partir do grupo 1 teria de
  // SUPOR o espaçamento do cabeçalho — que é exatamente o tipo de transcrição inventada que este
  // trabalho não admite.
  const matchInteiro = m[0];
  const brutos = m[1].match(RE_MOEDA_G) || [];
  const valores = brutos.map(parseValorBR);
  if (valores.some((v) => v == null)) {
    return { ok: false, motivo: "VALOR_ILEGIVEL", valores: [], brutos, trecho: m[1], matchInteiro };
  }
  const esperados = ROTULOS_DO_CABECALHO.length + 1; // 8 tributos + Total
  if (valores.length !== esperados) {
    return {
      ok: false,
      motivo: valores.length === 1 ? "UM_VALOR_SO" : "CONTAGEM_INESPERADA",
      valores, brutos, trecho: m[1], matchInteiro,
    };
  }
  const total = valores[valores.length - 1];
  const partes = valores.slice(0, -1);
  const soma = r2(partes.reduce((s, v) => s + v, 0));
  // A AUTOVERIFICAÇÃO, no molde de `parseComprovanteArrecadacao`: 1 centavo de tolerância.
  if (Math.abs(soma - r2(total)) > 0.01) {
    return { ok: false, motivo: "SOMA_NAO_FECHA", valores, brutos, trecho: m[1], matchInteiro, soma, total };
  }
  return { ok: true, motivo: null, valores, brutos, trecho: m[1], matchInteiro, soma, total, partes };
}

async function main() {
  const cnpjFiltro = soDigitos(arg("cnpj"));
  const compFiltro = arg("comp");
  const amostraMax = arg("amostra") == null ? 5 : Number(arg("amostra"));

  console.log("╔══════════════════════════════════════════════════════════════════════════════╗");
  console.log("║ REPARTIÇÃO POR TRIBUTO NO EXTRATO DO PGDAS-D — SOMENTE LEITURA               ║");
  console.log("╚══════════════════════════════════════════════════════════════════════════════╝");
  console.log("Nada é gravado. Nenhuma chamada externa. Fonte: metadata.parsedPgdas.rawText\n");

  const where = {};
  if (compFiltro) where.competencia = compFiltro;

  const circulares = await prisma.companyMonthlyCircular.findMany({
    where,
    select: {
      id: true, competencia: true, metadata: true, dasTotal: true,
      portalClient: { select: { cnpj: true, razao: true } },
    },
    orderBy: [{ competencia: "desc" }],
  });

  const linhas = circulares.filter((c) => {
    if (!cnpjFiltro) return true;
    return soDigitos(c.portalClient?.cnpj) === cnpjFiltro;
  });

  const comTexto = linhas.filter((c) => rawTextDe(c));

  console.log(`Circulares lidas ............... ${num(linhas.length, 6)}`);
  console.log(`  com extrato guardado ......... ${num(comTexto.length, 6)}`);
  if (!comTexto.length) {
    console.log("\n⚠ Nenhum extrato guardado no recorte pedido — não há o que medir.");
    return;
  }

  const porMotivo = new Map();
  const porContagem = new Map();
  const conta = (mapa, chave) => mapa.set(chave, (mapa.get(chave) || 0) + 1);

  let fecham = 0;
  let totalBateComDasTotal = 0;
  let totalDivergeDeDasTotal = 0;
  let semDasTotalGravado = 0;
  const amostras = [];
  const divergentes = [];

  for (const c of comTexto) {
    const r = lerLinhaDeTributos(rawTextDe(c));
    conta(porMotivo, r.ok ? "OK" : r.motivo);
    conta(porContagem, r.valores.length);
    if (!r.ok) continue;
    fecham += 1;

    // ⚠ A PROVA DE QUE O ÚLTIMO VALOR É O TOTAL, e ela não custa suposição nenhuma:
    // `dasTotal` foi gravado A PARTIR deste mesmo último valor e já foi conferido contra a guia
    // real. Batendo, "Total é o último" deixa de ser hipótese. Divergindo, o alarme é grave e
    // aponta para a leitura de hoje, não para este script.
    if (c.dasTotal == null) semDasTotalGravado += 1;
    else if (Math.abs(r2(Number(c.dasTotal)) - r2(r.total)) <= 0.01) totalBateComDasTotal += 1;
    else {
      totalDivergeDeDasTotal += 1;
      divergentes.push({ c, r });
    }

    if (amostras.length < amostraMax) amostras.push({ c, r });
  }

  console.log("\n── A linha de tributos, sobre os extratos guardados ──────────────────────────");
  for (const [motivo, n] of [...porMotivo.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(motivo, 30)} ${num(n, 6)}`);
  }

  console.log("\n── Em quantos VALORES a linha se parte ───────────────────────────────────────");
  console.log("   (9 = 8 tributos + Total. 1 = os números NÃO vêm colados, e aí o `dasTotal`");
  console.log("    de hoje é o IRPJ, não o Total — ver a nota no topo deste arquivo.)");
  for (const [q, n] of [...porContagem.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  ${pad(`${q} valor(es)`, 30)} ${num(n, 6)}`);
  }

  console.log("\n── Autoverificação da soma (8 tributos == Total, tolerância 1 centavo) ───────");
  console.log(`  fecham ......................... ${num(fecham, 6)} de ${comTexto.length}`);

  console.log("\n── O último valor é mesmo o Total? (confronto com CompanyMonthlyCircular.dasTotal)");
  console.log(`  bate com o dasTotal gravado .... ${num(totalBateComDasTotal, 6)}`);
  console.log(`  ⚠ DIVERGE do dasTotal .......... ${num(totalDivergeDeDasTotal, 6)}`);
  console.log(`  sem dasTotal gravado ........... ${num(semDasTotalGravado, 6)}`);

  if (divergentes.length) {
    console.log("\n⚠ DIVERGÊNCIAS (investigar ANTES de ligar qualquer gravação):");
    for (const { c, r } of divergentes.slice(0, 10)) {
      console.log(`  ${pad(c.portalClient?.razao, 28)} ${pad(c.competencia, 9)} `
        + `dasTotal=${String(c.dasTotal)} · último valor lido=${r.total}`);
    }
  }

  if (amostras.length) {
    console.log("\n── AMOSTRA: os valores lado a lado com os rótulos DO CABEÇALHO ───────────────");
    console.log("   ⚠ Isto é a leitura POSICIONAL a conferir contra o PDF. A soma NÃO pega");
    console.log("     permutação (trocar ISS por IPI dá a mesma soma) — é o contador que confirma.");
    for (const { c, r } of amostras) {
      console.log(`\n  ${c.portalClient?.razao || "?"} · ${c.competencia}`);
      // ⚠ O MATCH INTEIRO e o que uma fixture precisa copiar: traz o cabecalho com o
      // espacamento REAL. Sai por `JSON.stringify` para que quebra de linha e retorno de
      // carro aparecam escapados em vez de sumirem na impressao — e a diferenca entre
      // copiar o leiaute e copiar o que o terminal mostrou dele.
      console.log(`    match inteiro (grupo 0): ${JSON.stringify(r.matchInteiro)}`);
      console.log(`    só os valores (grupo 1): ${JSON.stringify(r.trecho)}`);
      r.partes.forEach((v, i) => {
        console.log(`    ${pad(ROTULOS_DO_CABECALHO[i], 12)} ${String(v).padStart(14)}`);
      });
      console.log(`    ${pad("TOTAL", 12)} ${String(r.total).padStart(14)}  (soma dos 8 = ${r.soma})`);
    }
    console.log("\n  ⚠ Ao copiar um destes trechos para uma fixture de teste: ANONIMIZE razão");
    console.log("    social, CNPJ e inscrições — fixture entra no git para sempre. Valores,");
    console.log("    datas e códigos de receita NÃO se tocam: são estrutura (mesma disciplina de");
    console.log("    `serpro/__tests__/parseSitfisRelatorio.test.js`).");
  }

  console.log("\n── O que este número decide ──────────────────────────────────────────────────");
  console.log("  · contagem 9 + soma fechando + total batendo com dasTotal ⇒ a repartição EXISTE");
  console.log("    e é gravável; falta só o contador confirmar a ORDEM dos oito contra o PDF.");
  console.log("  · contagem 1 ⇒ leiaute com valores separados: a leitura de hoje já está errada,");
  console.log("    e o conserto do `dasTotal` vem ANTES de qualquer coluna nova.");
  console.log("  · CABECALHO_EM_OUTRA_GRAFIA > 0 ⇒ há mais de um leiaute de extrato, como no SITFIS.");
}

main()
  .catch((e) => { console.error("Falhou:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => {}));
