// O IMPORT DE OFX PROTEGE CONTRA SUBIR O MESMO ARQUIVO DUAS VEZES?
//
// SOMENTE LEITURA. Nao existe --aplicar, nao escreve nada, nao chama servico externo.
//
// Pergunta do dono (24/08/2026): "temos alguma protecao caso o cliente queira importar varios,
// sendo mesmo?"
//
// A resposta do CODIGO e nao: nao ha hash de arquivo, `fitId` nao existe em `AccountingEntry`, e o
// lote e `OFX-${Date.now()}` -- duas subidas do mesmo arquivo produzem dois lotes distintos e dois
// conjuntos completos de lancamentos. Este script mede se isso JA ACONTECEU, e quanto custaria.
//
// A assinatura de uma linha reimportada: mesma empresa, mesma data, mesmo valor, mesmo historico,
// em LOTES DIFERENTES. Dentro do MESMO lote a repeticao e legitima (duas tarifas iguais no mesmo
// dia acontecem), entao ela e contada a parte e NAO e acusada.
//
// Uso:
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-ofx-duplicado.mjs'

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const linha = (c = "=") => console.log(c.repeat(96));
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

linha();
console.log("IMPORT DE OFX -- PROTECAO CONTRA REIMPORTACAO?");
console.log("SOMENTE LEITURA. Nada e escrito por este script.");
linha();

// ---------------------------------------------------------------- 1. o import foi usado?
const porOrigem = await prisma.accountingEntry.groupBy({ by: ["origem"], _count: { _all: true } });
console.log("\n## 1. LANCAMENTOS POR ORIGEM\n");
for (const g of porOrigem.sort((a, b) => b._count._all - a._count._all)) {
  console.log(`   ${String(g.origem).padEnd(12)} ${String(g._count._all).padStart(6)}`);
}

const ofx = await prisma.accountingEntry.findMany({
  where: { origem: "OFX" },
  select: {
    id: true, portalClientId: true, data: true, competencia: true, historico: true,
    loteImportacao: true, tipo: true, createdAt: true,
    lines: { select: { conta: true, tipo: true, valor: true } },
  },
  orderBy: { createdAt: "asc" },
});

if (!ofx.length) {
  console.log("\n## 2. NENHUM lancamento de origem OFX na base.\n");
  console.log("   O import do escritorio nunca foi usado em producao (ou nao deixou lancamento).");
  console.log("   ⚠ Isso NAO e protecao -- e ausencia de uso. A porta continua aberta:");
  console.log("     - `fitId` nao existe em `AccountingEntry` (conferido no schema)");
  console.log("     - nao ha hash do arquivo em lugar nenhum do import");
  console.log("     - o lote e `OFX-${Date.now()}`, entao duas subidas nunca colidem");
  linha();
  await prisma.$disconnect();
  process.exit(0);
}

// ---------------------------------------------------------------- 2. os lotes
const lotes = new Map();
for (const e of ofx) {
  const k = e.loteImportacao || "(sem lote)";
  if (!lotes.has(k)) lotes.set(k, { n: 0, empresa: e.portalClientId, quando: e.createdAt, valor: 0 });
  const l = lotes.get(k);
  l.n += 1;
  l.valor += e.lines.filter((x) => x.tipo === "D").reduce((s, x) => s + Number(x.valor || 0), 0);
}
console.log(`\n## 2. LOTES DE OFX -- ${lotes.size}\n`);
for (const [k, l] of [...lotes.entries()].sort((a, b) => new Date(a[1].quando) - new Date(b[1].quando))) {
  console.log(`   ${k.padEnd(22)} ${String(l.n).padStart(4)} linha(s)  R$ ${brl(l.valor).padStart(14)}  ${String(l.quando).slice(0, 19)}`);
}

// ---------------------------------------------------------------- 3. a assinatura da reimportacao
const nomes = new Map((await prisma.portalClient.findMany({ select: { id: true, razao: true } })).map((c) => [c.id, c.razao]));
const chave = (e) => {
  const d = e.lines.filter((x) => x.tipo === "D").reduce((s, x) => s + Number(x.valor || 0), 0);
  return [e.portalClientId, String(e.data).slice(0, 10), d.toFixed(2), String(e.historico || "").trim()].join("|");
};

const porChave = new Map();
for (const e of ofx) {
  const k = chave(e);
  if (!porChave.has(k)) porChave.set(k, []);
  porChave.get(k).push(e);
}

const entreLotes = [];
const mesmoLote = [];
for (const [k, grupo] of porChave.entries()) {
  if (grupo.length < 2) continue;
  const lotesDoGrupo = new Set(grupo.map((e) => e.loteImportacao || "(sem lote)"));
  if (lotesDoGrupo.size > 1) entreLotes.push({ k, grupo, lotes: [...lotesDoGrupo] });
  else mesmoLote.push({ k, grupo });
}

console.log("\n## 3. ⚠⚠ A ASSINATURA DA REIMPORTACAO (mesma linha em LOTES DIFERENTES)\n");
if (!entreLotes.length) {
  console.log("   NENHUMA. Nao ha evidencia de que o mesmo arquivo tenha sido subido duas vezes.");
} else {
  let valorDuplicado = 0;
  for (const { k, grupo, lotes: ls } of entreLotes.slice(0, 30)) {
    const [emp, data, valor, hist] = k.split("|");
    // ⚠ Contabiliza como duplicado tudo alem da PRIMEIRA ocorrencia.
    valorDuplicado += Number(valor) * (grupo.length - 1);
    console.log(`   ${data}  R$ ${brl(valor).padStart(12)}  x${grupo.length}  ${String(hist).slice(0, 34).padEnd(34)}  ${nomes.get(emp) || emp}`);
    console.log(`      lotes: ${ls.join("  ")}`);
  }
  if (entreLotes.length > 30) console.log(`   ... e mais ${entreLotes.length - 30} grupo(s)`);
  console.log(`\n   ⚠⚠ ${entreLotes.length} grupo(s) -- valor lancado em DUPLICIDADE: R$ ${brl(valorDuplicado)}`);
}

console.log("\n## 4. repeticao DENTRO do mesmo lote (legitima -- nao e acusacao)\n");
console.log(`   ${mesmoLote.length} grupo(s). Duas tarifas iguais no mesmo dia acontecem.`);

// ---------------------------------------------------------------- 5. o veredito
console.log("\n## 5. O QUE PROTEGE HOJE\n");
console.log("   hash do arquivo ................ NAO existe");
console.log("   `fitId` gravado ................ NAO -- a coluna nem existe em `AccountingEntry`");
console.log("   unique que alcance o OFX ....... NAO");
console.log("   lote ........................... `OFX-${Date.now()}` -- nunca colide");
console.log("\n   ⚠ As unicas guardas do commit sao de OUTRA natureza e nao pegam reimportacao:");
console.log("     campos obrigatorios, data invalida e conta sintetica.");
linha();

await prisma.$disconnect();
