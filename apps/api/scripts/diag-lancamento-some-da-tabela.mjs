// LANÇAMENTO QUE ESTÁ NO EXPORT E NÃO ESTÁ NA TABELA.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa.
//
// POR QUE ELE EXISTE
// O dono exportou os lançamentos da SINTROPIA (2026-04 a 2026-06) e relatou: o CSV traz
// **11/05** e **26/05**, e a tabela do app não mostra nenhum dos dois.
//
// ⚠ A HIPÓTESE A TESTAR — e ela precisa ser DERRUBADA ou CONFIRMADA, não assumida:
// o export é por INTERVALO DE DATAS e a tabela filtra por COMPETÊNCIA. Um lançamento com
// `data` em maio e `competencia` diferente de "2026-05" aparece no primeiro e some no segundo,
// sem erro nenhum. É o mesmo eixo do `diag-competencia-cruzada.mjs`, visto pelo outro lado:
// lá a pergunta era "o texto fala de outro mês"; aqui é "a DATA fala de outro mês".
//
// ⚠ HIPÓTESES CONCORRENTES, que este script também mede — porque escolher uma antes de olhar foi
// o erro que eu já cometi nesta base:
//   1. competência ≠ mês da data (a principal)
//   2. `tipo: "PARCELA"` — linha leve, que toda listagem exclui de propósito
//   3. status/origem que a tela filtre
//   4. o lançamento simplesmente não existe (o CSV veio de outro sistema)
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-lancamento-some-da-tabela.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const RAZAO = process.argv[2] || "SINTROPIA";
const DE = process.argv[3] || "2026-04-01";
const ATE = process.argv[4] || "2026-06-30";

const money = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
const compDaData = (d) => (d ? new Date(d).toISOString().slice(0, 7) : null);
const linha = () => console.log("─".repeat(104));

console.log("═".repeat(104));
console.log(`LANÇAMENTO NO EXPORT E FORA DA TABELA — ${RAZAO} · ${DE} a ${ATE}`);
console.log("═".repeat(104));

const empresa = await prisma.portalClient.findFirst({
  where: { razao: { contains: RAZAO, mode: "insensitive" } },
  select: { id: true, razao: true, cnpj: true },
});
if (!empresa) {
  console.log("empresa não encontrada");
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`\n${empresa.razao} (${empresa.cnpj})`);

const entries = await prisma.accountingEntry.findMany({
  where: { portalClientId: empresa.id, data: { gte: new Date(DE), lte: new Date(`${ATE}T23:59:59`) } },
  select: {
    id: true, data: true, competencia: true, tipo: true, subtipo: true, origem: true,
    status: true, statusPagamento: true, historico: true, eventType: true,
    lines: { select: { conta: true, tipo: true, valor: true }, orderBy: { ordem: "asc" } },
  },
  orderBy: [{ data: "asc" }],
});

console.log(`lançamentos com DATA no intervalo: ${entries.length}\n`);

// ─── 1. A hipótese principal: data e competência discordam ───────────────────────────────────
const discordantes = entries.filter((e) => e.competencia !== compDaData(e.data));
linha();
console.log("\n1) ⚠ DATA EM UM MÊS, COMPETÊNCIA EM OUTRO\n");
console.log(`   ${discordantes.length} de ${entries.length}\n`);
for (const e of discordantes) {
  const somaD = e.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
  console.log(`   data ${dia(e.data)}  →  competencia ${e.competencia}   ${e.tipo}/${e.origem}  R$ ${money(somaD)}`);
  console.log(`      "${String(e.historico || "").slice(0, 70)}"`);
  console.log(`      ${e.lines.map((l) => `${l.tipo} ${l.conta || "(vazia)"}`).join(" · ")}`);
}
if (!discordantes.length) console.log("   (nenhum — a hipótese principal CAI)");

// ─── 2. Os dois dias que o dono citou ────────────────────────────────────────────────────────
linha();
console.log("\n2) OS DIAS RELATADOS — 11/05 e 26/05\n");
for (const alvo of ["2026-05-11", "2026-05-26"]) {
  const doDia = entries.filter((e) => dia(e.data) === alvo);
  console.log(`   ${alvo} — ${doDia.length} lançamento(s) no banco`);
  for (const e of doDia) {
    const somaD = e.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
    const alerta = e.competencia !== compDaData(e.data) ? "  ⚠ COMPETÊNCIA DIVERGE" : "";
    console.log(`      comp=${e.competencia} ${String(e.tipo).padEnd(9)} ${String(e.status || "—").padEnd(11)} R$ ${money(somaD).padStart(12)}${alerta}`);
    console.log(`         "${String(e.historico || "").slice(0, 66)}"`);
  }
  if (!doDia.length) console.log("      ⚠ NENHUM no banco — o CSV não veio deste sistema, ou foram apagados.");
  console.log("");
}

// ─── 3. As hipóteses concorrentes ────────────────────────────────────────────────────────────
linha();
console.log("\n3) O QUE MAIS PODERIA ESCONDÊ-LOS\n");
const porTipo = {};
const porStatus = {};
for (const e of entries) {
  porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1;
  porStatus[e.status || "(nulo)"] = (porStatus[e.status || "(nulo)"] || 0) + 1;
}
console.log(`   por tipo:   ${Object.entries(porTipo).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`   por status: ${Object.entries(porStatus).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`   ⚠ tipo="PARCELA" é linha leve e TODA listagem a exclui de propósito.`);

// ─── 4. Quantos a tabela mostraria, competência a competência ────────────────────────────────
linha();
console.log("\n4) O QUE A TABELA MOSTRA, POR COMPETÊNCIA (excluindo PARCELA, como a tela faz)\n");
const porComp = {};
for (const e of entries) {
  if (e.tipo === "PARCELA") continue;
  porComp[e.competencia] = (porComp[e.competencia] || 0) + 1;
}
const totalVisivel = Object.values(porComp).reduce((a, b) => a + b, 0);
for (const [c, n] of Object.entries(porComp).sort()) console.log(`   ${c}: ${n}`);
console.log(`\n   soma do que a tela mostraria: ${totalVisivel}`);
console.log(`   lançamentos com data no intervalo: ${entries.length}`);
if (totalVisivel !== entries.length) {
  console.log(`   ⚠ diferença de ${entries.length - totalVisivel} — são os PARCELA, que a tela esconde de propósito.`);
}

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
