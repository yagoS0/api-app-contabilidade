// O "EM ABERTO" DA CIRCULAR — de onde sai o número, e por que ele diverge.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa.
//
// O dono apontou a LENTE, competência 2026-07: a célula mostra "R$ 18.842,28 em aberto" e ele diz
// que está incorreto. A linha exibe, nas outras colunas, 19.539,95 (com ⚠), 495,00 e 147.450,00.
//
// ⚠ DUAS PISTAS QUE JÁ EXISTEM, e este script existe para SEPARÁ-LAS:
//
//  1. A LENTE 2026-07 é UMA DAS 12 competências cujo lançamento de DAS DIVERGE do extrato mais
//     recente, e é uma das DUAS retificadas (`24352609202607002`). O valor pode ser simplesmente o
//     ANTERIOR à retificação — o defeito corrigido em código hoje, ainda vivo no dado.
//  2. 18.842,28 − 18.347,28 = 495,00 — e 495,00 é EXATAMENTE a segunda coluna da tela. Se for isso,
//     o "em aberto" está SOMANDO dois tributos numa célula só, e a causa é outra.
//
// As duas explicam o mesmo pixel e pedem consertos opostos. Por isso: medir, não escolher.
//
// ⚠ USA O CLIENTE DO PRISMA, NÃO SQL CRU — de propósito. Eu errei o nome da tabela duas vezes hoje
// escrevendo `$queryRaw` de memória (`chart_accounts` e `CompanyMonthlyCircular`, que na verdade são
// `chart_of_accounts` e `company_monthly_circulars`). O cliente resolve o `@@map` sozinho, e
// `competencia` aqui é STRING, não data — outro detalhe que o SQL cru errou.
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-em-aberto-lente.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const money = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
const linha = () => console.log("─".repeat(92));

const COMP = "2026-07";
const NA_TELA = 18842.28;

console.log("═".repeat(92));
console.log(`O "EM ABERTO" — LENTE · ${COMP}`);
console.log("═".repeat(92));

const empresa = await prisma.portalClient.findFirst({
  where: { razao: { contains: "LENTE", mode: "insensitive" } },
  select: { id: true, razao: true, cnpj: true },
});
if (!empresa) { console.log("empresa não encontrada"); await prisma.$disconnect(); process.exit(1); }
console.log(`\n${empresa.razao} (${empresa.cnpj})`);

// ─── 1. A CIRCULAR ──────────────────────────────────────────────────────────────────────────
linha();
console.log("\n1) A CIRCULAR — o que a sincronia do extrato gravou\n");
const c = await prisma.companyMonthlyCircular.findFirst({
  where: { portalClientId: empresa.id, competencia: COMP },
});
if (!c) console.log("   (sem circular nesta competência)");
else {
  for (const [k, v] of Object.entries(c)) {
    if (v == null || k === "id" || k === "portalClientId") continue;
    if (typeof v === "object" && !(v instanceof Date)) continue;
    const num = Number(v);
    if (typeof v !== "boolean" && Number.isFinite(num) && num !== 0) console.log(`   ${k.padEnd(32)} ${money(num)}`);
    else if (typeof v === "string" && v.length < 60) console.log(`   ${k.padEnd(32)} ${v}`);
    else if (v instanceof Date) console.log(`   ${k.padEnd(32)} ${v.toISOString().slice(0, 10)}`);
  }
}

// ─── 2. OS LANÇAMENTOS ──────────────────────────────────────────────────────────────────────
linha();
console.log("\n2) LANÇAMENTOS DA COMPETÊNCIA\n");
const entries = await prisma.accountingEntry.findMany({
  where: { portalClientId: empresa.id, competencia: COMP },
  include: { lines: { orderBy: { ordem: "asc" } } },
  orderBy: { eventType: "asc" },
});
for (const e of entries) {
  const somaD = e.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
  console.log(`   ${String(e.tipo).padEnd(9)} ${String(e.eventType || e.subtipo || "").padEnd(20)} pag=${String(e.statusPagamento || "—").padEnd(7)} ΣD ${money(somaD)}`);
  console.log(`      ${String(e.historico || "").slice(0, 66)}`);
  console.log(`      ${e.lines.map((l) => `${l.tipo} ${l.conta || "(vazia)"} ${money(l.valor)}`).join(" · ")}`);
  if (e.recalculatedFromValor != null || e.recalculatedToValor != null) {
    console.log(`      ⚠ carimbo: de ${money(e.recalculatedFromValor)} para ${money(e.recalculatedToValor)}`);
  }
}

// ─── 3. AS GUIAS — o "em aberto" costuma sair daqui ─────────────────────────────────────────
linha();
console.log("\n3) GUIAS DA COMPETÊNCIA\n");
const guias = await prisma.guide.findMany({
  where: { portalClientId: empresa.id },
  select: {
    tipo: true, valor: true, paymentStatus: true, baixada: true,
    lancamentoId: true, competencia: true, vencimento: true, status: true,
  },
});
const doMes = guias.filter((g) => {
  const comp = g.competencia instanceof Date ? g.competencia.toISOString().slice(0, 7) : String(g.competencia || "").slice(0, 7);
  return comp === COMP;
});
if (!doMes.length) console.log("   (nenhuma guia nesta competência)");
for (const g of doMes) {
  console.log(`   ${String(g.tipo).padEnd(12)} R$ ${money(g.valor).padStart(13)}  ${String(g.paymentStatus || "—").padEnd(8)} baixada=${String(g.baixada).padEnd(5)} lanc=${g.lancamentoId ? "sim" : "não"}`);
}
const somaTodas = doMes.reduce((s, g) => s + Number(g.valor || 0), 0);
const somaAbertas = doMes.filter((g) => !g.baixada).reduce((s, g) => s + Number(g.valor || 0), 0);
console.log(`\n   soma de TODAS:        ${money(somaTodas)}`);
console.log(`   soma das NÃO baixadas: ${money(somaAbertas)}`);

// ─── 4. AS DUAS HIPÓTESES ───────────────────────────────────────────────────────────────────
linha();
console.log("\n4) ⚠ AS DUAS HIPÓTESES, CONFRONTADAS\n");
console.log(`   a tela mostra "em aberto":  ${money(NA_TELA)}`);
const das = entries.find((e) => e.eventType === "DAS_SIMPLES");
if (das) {
  const dasD = das.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
  console.log(`   DAS lançado (ΣD):           ${money(dasD)}`);
  console.log(`   diferença:                  ${money(NA_TELA - dasD)}`);
}
if (c?.dasTotal != null) {
  console.log(`   dasTotal na circular:       ${money(c.dasTotal)}`);
  console.log(`   diferença para a tela:      ${money(NA_TELA - Number(c.dasTotal))}`);
}
console.log(`   soma das guias não baixadas: ${money(somaAbertas)}`);
console.log(`\n   ⚠ Se o "em aberto" bater com a SOMA DAS GUIAS, ele lê guia e não lançamento —`);
console.log(`     e aí a divergência é entre a guia capturada e o extrato retificado.`);
console.log(`   ⚠ Se bater com o DAS lançado, é o valor ANTERIOR à retificação (12 competências).`);

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
