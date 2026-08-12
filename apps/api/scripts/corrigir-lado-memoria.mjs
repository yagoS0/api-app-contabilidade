// O LADO INVERTIDO DA MEMÓRIA DE D/C — trocar débito por crédito.
//
// ⚠ DRY-RUN POR PADRÃO. Só grava com `--aplicar`.
//
// POR QUE ELE EXISTE
// Depois de corrigir as memórias que apontavam para conta sintética, sobrou uma diferença de EIXO
// que a correção de conta não alcança: a memória da KAIZEN ficou `D=372 C=5` — débito na conta de
// RECEITA, crédito no CAIXA —, o INVERSO das outras cinco memórias equivalentes do escritório
// (`D=5 C=372`).
//
// ⚠ Isso NÃO é detalhe de arrumação: a memória alimenta o gerador do extrato do SERPRO, que lança
// SOZINHO todo mês. Um eixo invertido ali produz lançamento invertido para sempre, sem ninguém na
// frente da tela para perceber.
//
// Decisão do dono, textual: *"pode mudar o lado das contas, estava errado isso"*.
//
// ⚠ ELE NÃO TOCA EM LANÇAMENTO. A memória só influencia lançamento FUTURO. O lançamento de
// R$ 8.116,00 já gravado (competência 2026-02, origem SERPRO) tem a MESMA inversão e é decisão
// separada — está listado no fim, sem ser alterado.
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/corrigir-lado-memoria.mjs'
//   … acrescente `--aplicar` ao final do `node` para gravar.

import { prisma } from "../src/infrastructure/db/prisma.js";

const APLICAR = process.argv.includes("--aplicar");
const linha = () => console.log("─".repeat(88));

console.log("═".repeat(88));
console.log(`LADO INVERTIDO NA MEMÓRIA DE D/C  ${APLICAR ? "⚠ MODO APLICAR" : "(dry-run)"}`);
console.log("═".repeat(88));

// ─── 1. O padrão do escritório: qual eixo as memórias equivalentes usam? ─────────────────────
// ⚠ Não se define o certo por opinião: define-se pela MAIORIA das memórias que já existem para o
// mesmo par de contas. Se não houver maioria clara, o script para.
const todas = await prisma.$queryRaw`
  SELECT h.id, h."createdByUserId", h."companyPortalClientId", h.text, h."eventType",
         h."contaDebito", h."contaCredito", c.razao
    FROM "accounting_historicos" h
    LEFT JOIN "PortalClient" c ON c.id = h."companyPortalClientId"
   WHERE h."contaDebito" IS NOT NULL AND h."contaCredito" IS NOT NULL
   ORDER BY h."companyPortalClientId" NULLS FIRST`;

// O par de interesse: uma perna é a receita de serviço (372), a outra é o caixa (5).
const PAR = new Set(["372", "5"]);
const doPar = todas.filter((h) => PAR.has(String(h.contaDebito)) && PAR.has(String(h.contaCredito)));

console.log(`\nmemórias que usam o par {5, 372}: ${doPar.length}\n`);
const normal = doPar.filter((h) => String(h.contaDebito) === "5" && String(h.contaCredito) === "372");
const invertidas = doPar.filter((h) => String(h.contaDebito) === "372" && String(h.contaCredito) === "5");

for (const h of doPar) {
  const marca = String(h.contaDebito) === "372" ? "  ⚠ INVERTIDA" : "";
  console.log(`   ${(h.razao || "(GLOBAL)").padEnd(34)} D=${String(h.contaDebito).padEnd(4)} C=${String(h.contaCredito).padEnd(4)} ${h.eventType || h.text?.slice(0, 30) || ""}${marca}`);
}

console.log(`\n   no eixo D=5 C=372 (caixa debitado, receita creditada): ${normal.length}`);
console.log(`   no eixo D=372 C=5 (INVERTIDO): ${invertidas.length}`);

if (!invertidas.length) {
  console.log("\n   ✓ nenhuma invertida. Nada a fazer.");
  await prisma.$disconnect();
  process.exit(0);
}
// ⚠ A guarda: só inverte se o outro eixo for de fato o padrão dominante. Sem maioria, para.
if (normal.length <= invertidas.length) {
  console.log("\n   ⚠ NÃO HÁ MAIORIA CLARA no outro eixo. Não vou escolher qual é o certo.");
  console.log("     Isto é decisão do contador — o script para aqui de propósito.");
  await prisma.$disconnect();
  process.exit(1);
}

// ─── 2. A troca ──────────────────────────────────────────────────────────────────────────────
linha();
console.log(`\nO QUE SERÁ TROCADO (${invertidas.length}):\n`);
for (const h of invertidas) {
  console.log(`   ${h.razao || "(GLOBAL)"} · ${h.eventType || h.text}`);
  console.log(`      antes:  D=${h.contaDebito}  C=${h.contaCredito}`);
  console.log(`      depois: D=${h.contaCredito}  C=${h.contaDebito}`);
}

if (!APLICAR) {
  console.log("\n   (dry-run — nada foi gravado. Acrescente `--aplicar` para valer.)");
} else {
  for (const h of invertidas) {
    await prisma.accountingHistorico.update({
      where: { id: h.id },
      data: { contaDebito: h.contaCredito, contaCredito: h.contaDebito, updatedAt: new Date() },
    });
  }
  console.log(`\n   ✓ ${invertidas.length} memória(s) trocada(s).`);
  // ⚠ Relê do banco: confiar no retorno do update é confiar no que se acabou de mandar.
  const conferencia = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM "accounting_historicos"
     WHERE "contaDebito" = '372' AND "contaCredito" = '5'`;
  console.log(`   conferido no banco — ainda invertidas: ${conferencia?.[0]?.n ?? "?"}`);
}

// ─── 3. ⚠ O LANÇAMENTO JÁ GRAVADO com a mesma inversão — listado, NÃO tocado ─────────────────
linha();
console.log("\n⚠ LANÇAMENTOS JÁ GRAVADOS COM A MESMA INVERSÃO — não são tocados por este script:\n");
const lancs = await prisma.$queryRaw`
  SELECT e.competencia, e.historico, e.origem, e.tipo, l.conta, l.tipo AS lado, l.valor, c.razao
    FROM "accounting_entry_lines" l
    JOIN "accounting_entries" e ON e.id = l."entryId"
    LEFT JOIN "PortalClient" c ON c.id = e."portalClientId"
   WHERE l.conta IN ('365', '372') AND l.tipo = 'D'
   ORDER BY e.competencia`;
if (!lancs.length) console.log("   (nenhum)");
for (const l of lancs) {
  console.log(`   ${l.competencia} · ${l.razao} · conta ${l.conta} lado ${l.lado} · R$ ${Number(l.valor).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log(`      ${l.tipo}/${l.origem} — ${String(l.historico || "").slice(0, 60)}`);
}
console.log("\n   ⚠ Débito numa conta de RECEITA. Corrigi-los é mexer no razão — decisão do dono,");
console.log("     e o caminho é `corrigir-conta-sintetica.mjs`, que já trata a conta.");

linha();
await prisma.$disconnect();
