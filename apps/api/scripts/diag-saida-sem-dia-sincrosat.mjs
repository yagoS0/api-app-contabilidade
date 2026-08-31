// DIAGNÓSTICO — SOMENTE LEITURA. Nenhuma escrita, nenhum DDL.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const q = (sql, ...a) => p.$queryRawUnsafe(sql, ...a).catch((e) => { console.log("  (falhou:", e?.meta?.message || e.message, ")"); return []; });

const emp = await q(`SELECT id, razao, "companyId" FROM "PortalClient" WHERE UPPER(razao) LIKE '%SINCROSAT%'`);
console.log("EMPRESA:", JSON.stringify(emp));
if (!emp.length) { await p.$disconnect(); process.exit(0); }
const pcid = emp[0].id;

const series = await q(
  `SELECT id, lado, rotulo, chave, "contraparteDoc", periodicidade, origem, estado,
          "valorDeclarado", "baseDaObservacao", "confirmadoPor", "declaradoPor"
     FROM "series_recorrentes" WHERE "portalClientId" = $1 ORDER BY lado, rotulo`, pcid);
console.log("\nSERIES (", series.length, "):");
for (const s of series) {
  const b = s.baseDaObservacao || {};
  console.log(` - [${s.estado}/${s.origem}] ${s.lado} "${s.rotulo}"`);
  console.log(`     chave=${s.chave} | doc=${s.contraparteDoc || "—"} | ${s.periodicidade}`);
  console.log(`     valorDeclarado=${s.valorDeclarado ?? "—"} mediana=${b.mediana ?? "—"} n=${b.n ?? "—"} min=${b.min ?? "—"} max=${b.max ?? "—"}`);
  console.log(`     confirmadoPor=${s.confirmadoPor || "—"} declaradoPor=${s.declaradoPor || "—"}`);
}

const saidas = await q(`SELECT id, data, valor, descricao, estado FROM "saidas_avulsas_cliente" WHERE "portalClientId" = $1`, pcid);
console.log("\nSAIDAS AVULSAS (", saidas.length, "):", JSON.stringify(saidas));
await p.$disconnect();
