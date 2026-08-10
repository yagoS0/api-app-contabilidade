// O VOLUME REAL — quantas linhas tem um import, e quantas contas tem um plano.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum DDL.
//
// POR QUE ELE EXISTE
// A medição da digitação lenta mostrou que TODO o custo é linear em duas variáveis, e nas duas o
// custo por tecla é o mesmo para sempre:
//
//   · linhas do import  → ~1,45 ms por linha, por tecla (o array de estado sem fronteira de memo)
//   · contas do plano   → imposto FIXO por tecla, independente do nº de linhas (os `<datalist>`
//                         com o plano inteiro, recriados a cada render): 20 contas = 7 ms,
//                         300 = 47 ms, 1000 = 184 ms
//
// Sem os números reais, "o passo 1 sozinho resolve o dia a dia?" é chute. Com eles, é conta.
//
// ⚠ O import não deixa rastro de "quantas linhas tinha o arquivo" — o que existe é o LOTE
// (`loteImportacao`), um por importação. Contar lançamentos por lote é a melhor aproximação
// disponível, e ela SUBESTIMA: linha pulada no modal não vira lançamento. Está dito no output.
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-volume-import.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const n = (v) => Number(v || 0).toLocaleString("pt-BR");
const linha = () => console.log("─".repeat(88));

// O custo por tecla medido no Chrome, para converter volume em milissegundos.
const MS_POR_LINHA = 1.45;
const impostoDoPlano = (contas) => (contas <= 20 ? 7 : contas <= 300 ? 47 : contas <= 1000 ? 184 : 184 * (contas / 1000));

console.log("═".repeat(88));
console.log("VOLUME REAL DO IMPORT — e o que ele custa por tecla");
console.log("═".repeat(88));

// ─── 1. O plano de contas por empresa ────────────────────────────────────────────────────────
console.log("\n1) PLANO DE CONTAS — o imposto FIXO por tecla\n");
// ⚠ `portalClientId` NULO = conta GLOBAL, compartilhada por todas as empresas (`schema.prisma:1042`).
// A empresa enxerga as PRÓPRIAS mais as globais — e é esse total que vai para o `<datalist>`.
// Contar só as próprias subestimaria o custo em todo mundo, e em quem não tem plano próprio daria
// zero, que é o oposto da verdade.
const globais = await prisma.$queryRaw`
  SELECT count(*)::int AS n FROM "chart_of_accounts" WHERE "portalClientId" IS NULL`;
const nGlobais = globais?.[0]?.n || 0;
console.log(`   contas GLOBAIS (valem para todas as empresas): ${n(nGlobais)}\n`);

const planos = await prisma.$queryRaw`
  SELECT c.razao, (count(a.id) + ${nGlobais})::int AS contas, count(a.id)::int AS proprias
    FROM "PortalClient" c
    LEFT JOIN "chart_of_accounts" a ON a."portalClientId" = c.id
   GROUP BY c.id, c.razao
   ORDER BY contas DESC`;
const comPlano = planos.filter((p) => p.contas > 0);
if (!comPlano.length) {
  console.log("   ⚠ nenhuma empresa tem plano de contas próprio — verifique se a tabela é outra.");
} else {
  const maior = comPlano[0];
  const menor = comPlano[comPlano.length - 1];
  const media = Math.round(comPlano.reduce((s, p) => s + p.contas, 0) / comPlano.length);
  for (const p of comPlano.slice(0, 8)) {
    console.log(`   ${String(n(p.contas)).padStart(5)} contas  ${p.razao}   → ~${Math.round(impostoDoPlano(p.contas))} ms/tecla só de datalist`);
  }
  if (comPlano.length > 8) console.log(`   … e mais ${comPlano.length - 8} empresa(s)`);
  console.log(`\n   maior ${n(maior.contas)} · menor ${n(menor.contas)} · média ${n(media)}`);
  console.log(`   ⚠ este custo NÃO depende do nº de linhas: vale igual num import de 1 ou de 500.`);
}

// ─── 2. O tamanho dos imports que já aconteceram ─────────────────────────────────────────────
linha();
console.log("\n2) IMPORTS JÁ FEITOS — linhas por lote\n");
const lotes = await prisma.$queryRaw`
  SELECT e."loteImportacao" AS lote, e.origem, c.razao,
         count(*)::int AS linhas, min(e."createdAt") AS quando
    FROM "accounting_entries" e
    JOIN "PortalClient" c ON c.id = e."portalClientId"
   WHERE e."loteImportacao" IS NOT NULL
   GROUP BY e."loteImportacao", e.origem, c.razao
   ORDER BY linhas DESC`;
if (!lotes.length) {
  console.log("   (nenhum lote de importação registrado)");
} else {
  console.log(`   lotes: ${n(lotes.length)}\n`);
  for (const l of lotes.slice(0, 10)) {
    const quando = l.quando ? new Date(l.quando).toISOString().slice(0, 10) : "—";
    console.log(`   ${String(n(l.linhas)).padStart(5)} linhas  ${String(l.origem).padEnd(8)} ${quando}  ${l.razao}`);
  }
  if (lotes.length > 10) console.log(`   … e mais ${lotes.length - 10} lote(s)`);
  const maiorLote = lotes[0].linhas;
  const mediaLote = Math.round(lotes.reduce((s, l) => s + l.linhas, 0) / lotes.length);
  console.log(`\n   maior ${n(maiorLote)} · média ${n(mediaLote)} linhas por import`);
  console.log(`   ⚠ SUBESTIMA: linha pulada no modal não vira lançamento, então o arquivo tinha mais.`);
}

// ─── 3. A conta ──────────────────────────────────────────────────────────────────────────────
linha();
console.log("\n3) O QUE ISSO CUSTA HOJE, POR TECLA\n");
const contasTipicas = comPlano.length ? Math.round(comPlano.reduce((s, p) => s + p.contas, 0) / comPlano.length) : 0;
const linhasTipicas = lotes.length ? Math.round(lotes.reduce((s, l) => s + l.linhas, 0) / lotes.length) : 0;
const maiorLinhas = lotes.length ? lotes[0].linhas : 0;
for (const [rotulo, qtdLinhas] of [["import médio", linhasTipicas], ["maior import já feito", maiorLinhas]]) {
  if (!qtdLinhas) continue;
  const fixo = impostoDoPlano(contasTipicas);
  const variavel = qtdLinhas * MS_POR_LINHA;
  console.log(`   ${rotulo} (${n(qtdLinhas)} linhas, ${n(contasTipicas)} contas):`);
  console.log(`      datalist do plano: ~${Math.round(fixo)} ms   ← o passo 1 mata este`);
  console.log(`      linhas sem memo:   ~${Math.round(variavel)} ms   ← o passo 2 mata este`);
  console.log(`      TOTAL por tecla:   ~${Math.round(fixo + variavel)} ms\n`);
}
console.log("   Referência: acima de ~100 ms/tecla a digitação fica perceptivelmente atrás do teclado.");
console.log("   ⚠ E o Excel é PIOR que o OFX: ele tem um `<datalist>` POR LINHA, não um só.");

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
