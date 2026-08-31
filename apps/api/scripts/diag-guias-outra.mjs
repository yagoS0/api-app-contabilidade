// DIAGNÓSTICO — SOMENTE LEITURA.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const q = (s, ...a) => p.$queryRawUnsafe(s, ...a).catch((e) => { console.log("  (falhou:", e?.meta?.message || e.message, ")"); return []; });

const guias = await q(
  `SELECT g.id, g.tipo, g.competencia, g.valor, g."liberadaCliente", g.extracted,
          pc.razao
     FROM "Guide" g LEFT JOIN "PortalClient" pc ON pc.id = g."portalClientId"
    WHERE UPPER(COALESCE(pc.razao,'')) LIKE '%SINCROSAT%'
    ORDER BY g.competencia DESC LIMIT 12`);
console.log("GUIAS DA SINCROSAT:", guias.length);
for (const g of guias) {
  const comp = g.extracted?.composicao;
  const nomes = Array.isArray(comp) ? comp.map(c => c?.denominacao || c?.codigo || "?").join(", ") : null;
  console.log(`  ${String(g.competencia).slice(0,10)} | tipo=${g.tipo} | R$ ${g.valor} | liberada=${g.liberadaCliente}`);
  console.log(`     extracted? ${g.extracted ? "sim" : "NAO"} | composicao: ${Array.isArray(comp) ? `${comp.length} item(ns) → ${nomes}` : "AUSENTE"}`);
}

// A base inteira: quantas OUTRA tem composicao?
const resumo = await q(
  `SELECT tipo,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE jsonb_typeof(extracted->'composicao') = 'array')::int AS "comComposicao"
     FROM "Guide" GROUP BY tipo ORDER BY total DESC`);
console.log("\nPOR TIPO, EM TODA A BASE:");
for (const r of resumo) console.log(`  ${r.tipo}: ${r.total} guia(s), ${r.comComposicao} com composicao`);
await p.$disconnect();
