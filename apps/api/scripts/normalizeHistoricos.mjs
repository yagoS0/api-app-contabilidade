// Q50 — Backfill dos históricos: normaliza a competência ({{competencia}}) e FUNDE duplicatas.
//
// Uso:
//   node scripts/normalizeHistoricos.mjs            → DRY-RUN (só mostra o que faria)
//   node scripts/normalizeHistoricos.mjs --apply    → executa (FAÇA BACKUP DO BANCO ANTES)
//
// Regra de merge por grupo (createdByUserId, companyPortalClientId, textoNormalizado):
//   - vence a linha de maior usageCount (desempate: updatedAt mais recente)
//   - text = forma normalizada; usageCount = soma do grupo
//   - contas D/C: as da vencedora; null é completado com a primeira não-nula do grupo
//   - demais linhas do grupo são DELETADAS

import { prisma } from "../src/infrastructure/db/prisma.js";
import { normalizarHistorico } from "../src/application/accounting/historicoCompetencia.js";

const APPLY = process.argv.includes("--apply");

const rows = await prisma.accountingHistorico.findMany({
  orderBy: [{ usageCount: "desc" }, { updatedAt: "desc" }],
});

const grupos = new Map();
for (const r of rows) {
  const norm = normalizarHistorico(r.text);
  const key = `${r.createdByUserId}||${r.companyPortalClientId ?? "GLOBAL"}||${norm}`;
  if (!grupos.has(key)) grupos.set(key, { norm, rows: [] });
  grupos.get(key).rows.push(r);
}

let renomear = 0;
let fundir = 0;
let deletar = 0;

for (const { norm, rows: grupo } of grupos.values()) {
  // rows já vêm ordenadas por usageCount desc / updatedAt desc → o primeiro é o vencedor
  const [vencedor, ...resto] = grupo;
  const somaUso = grupo.reduce((s, r) => s + (r.usageCount || 0), 0);
  const contaD = vencedor.contaDebito ?? resto.find((r) => r.contaDebito)?.contaDebito ?? null;
  const contaC = vencedor.contaCredito ?? resto.find((r) => r.contaCredito)?.contaCredito ?? null;
  const eventType = vencedor.eventType ?? resto.find((r) => r.eventType)?.eventType ?? null;

  const precisaUpdate =
    vencedor.text !== norm ||
    vencedor.usageCount !== somaUso ||
    vencedor.contaDebito !== contaD ||
    vencedor.contaCredito !== contaC ||
    vencedor.eventType !== eventType;

  if (resto.length) fundir += 1;
  if (vencedor.text !== norm) renomear += 1;
  deletar += resto.length;

  if (resto.length || precisaUpdate) {
    const escopo = vencedor.companyPortalClientId ? `empresa ${vencedor.companyPortalClientId.slice(0, 8)}` : "GLOBAL";
    console.log(`${resto.length ? "MERGE " : "RENAME"} [${escopo}] ${grupo.length}x "${vencedor.text}" → "${norm}" (uso=${somaUso})`);
  }

  if (!APPLY) continue;
  if (precisaUpdate) {
    await prisma.accountingHistorico.update({
      where: { id: vencedor.id },
      data: { text: norm, usageCount: somaUso, contaDebito: contaD, contaCredito: contaC, eventType },
    });
  }
  if (resto.length) {
    await prisma.accountingHistorico.deleteMany({ where: { id: { in: resto.map((r) => r.id) } } });
  }
}

console.log("");
console.log(`Total de históricos: ${rows.length} | grupos: ${grupos.size}`);
console.log(`Renomear (texto → normalizado): ${renomear} | grupos com merge: ${fundir} | linhas a deletar: ${deletar}`);
console.log(APPLY ? "✔ APLICADO." : "DRY-RUN — nada foi alterado. Rode com --apply (após backup) para executar.");
await prisma.$disconnect();
