// DIAGNÓSTICO — SOMENTE LEITURA.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const q = (s, ...a) => p.$queryRawUnsafe(s, ...a).catch((e) => { console.log("  (falhou:", e?.meta?.message || e.message, ")"); return []; });

const s = await q(`SELECT id, rotulo, "contraparteDoc", "baseDaObservacao", "portalClientId"
                     FROM "series_recorrentes"
                    WHERE lado = 'DESPESA' AND rotulo LIKE 'SPO%'`);
console.log("SERIE:", JSON.stringify(s[0]?.rotulo), s[0]?.contraparteDoc);
console.log("baseDaObservacao COMPLETA:");
console.log(JSON.stringify(s[0]?.baseDaObservacao, null, 1));

// Uma base tem dia? Amostra de 5 séries de despesa quaisquer, para ver se o formato varia.
const outras = await q(`SELECT rotulo, "baseDaObservacao" FROM "series_recorrentes"
                         WHERE lado = 'DESPESA' AND "baseDaObservacao" IS NOT NULL LIMIT 5`);
console.log("\nCHAVES PRESENTES em outras bases de despesa:");
for (const o of outras) console.log(" -", o.rotulo, "=>", Object.keys(o.baseDaObservacao || {}).join(", "));
await p.$disconnect();
