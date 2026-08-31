// DIAGNÓSTICO — SOMENTE LEITURA.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const q = (s, ...a) => p.$queryRawUnsafe(s, ...a).catch((e) => { console.log("  (falhou:", e?.meta?.message || e.message, ")"); return []; });

// 1) O issueDate existe nas notas que formaram a serie da SPO?
const notas = await q(
  `SELECT i."issueDate", i.competencia, i.total
     FROM "PortalInvoice" i
    WHERE i."clientId" = $1 AND i.papel = 'DEST' AND i."emitenteDoc" = $2
    ORDER BY i.competencia`, "fa327dab-ac8a-4a97-8de3-8d5a9e43335c", "28070056000131");
console.log("NOTAS DA SPO (", notas.length, "):");
for (const n of notas) console.log("  competencia=", String(n.competencia).slice(0,10), "issueDate=", n.issueDate ? String(n.issueDate).slice(0,10) : "NULO", "total=", String(n.total));

// 2) Em toda a base: quantas notas RECEBIDAS tem issueDate?
const cob = await q(
  `SELECT COUNT(*)::int AS total,
          COUNT("issueDate")::int AS "comData"
     FROM "PortalInvoice" WHERE papel = 'DEST'`);
console.log("\nCOBERTURA de issueDate nas RECEBIDAS:", JSON.stringify(cob[0]));

// 3) Quantas series de RECEITA existem, e em quantas empresas?
const rec = await q(
  `SELECT lado, estado, COUNT(*)::int AS n, COUNT(DISTINCT "portalClientId")::int AS empresas
     FROM "series_recorrentes" GROUP BY lado, estado ORDER BY lado, estado`);
console.log("\nSERIES POR LADO/ESTADO:");
for (const r of rec) console.log(`  ${r.lado} ${r.estado}: ${r.n} serie(s) em ${r.empresas} empresa(s)`);
await p.$disconnect();
