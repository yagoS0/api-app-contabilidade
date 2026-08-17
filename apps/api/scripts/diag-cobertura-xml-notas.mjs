// SÓ LEITURA — quanto do XML das notas nós de fato temos, e o que ele destrava.
//
// Pergunta do dono: "precisamos trazer os XMLs das notas (...) nos ajuda numa auditoria
// pré-apuração para entender se a nota está correta, baseado na atividade e na data de emissão".
// Antes de planejar, medir: quantas notas têm `xmlRaw`, por origem e por competência.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const linhas = await prisma.$queryRawUnsafe(`
  SELECT
    COALESCE("papel",'(sem papel)')                         AS papel,
    COUNT(*)                                                AS total,
    COUNT(*) FILTER (WHERE "xmlRaw" IS NOT NULL)            AS com_xml,
    COUNT(*) FILTER (WHERE "xmlRaw" IS NULL)                AS sem_xml,
    MIN("competencia")                                      AS comp_min,
    MAX("competencia")                                      AS comp_max
  FROM "PortalInvoice"
  GROUP BY 1 ORDER BY 2 DESC
`);
console.log("=== COBERTURA DE XML POR PAPEL ===");
for (const l of linhas) {
  const t = Number(l.total), c = Number(l.com_xml);
  console.log(`${String(l.papel).padEnd(12)} total ${String(t).padStart(5)} | com XML ${String(c).padStart(5)} (${t ? Math.round(c*100/t) : 0}%) | sem ${String(l.sem_xml).padStart(5)} | ${l.comp_min}..${l.comp_max}`);
}

const porComp = await prisma.$queryRawUnsafe(`
  SELECT "competencia",
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE "xmlRaw" IS NOT NULL) AS com_xml
  FROM "PortalInvoice" WHERE "papel" = 'EMIT'
  GROUP BY 1 ORDER BY 1 DESC LIMIT 8
`);
console.log("\n=== NOTAS EMITIDAS (EMIT) — ultimas competencias ===");
for (const l of porComp) {
  const t = Number(l.total), c = Number(l.com_xml);
  console.log(`${l.competencia}  total ${String(t).padStart(4)} | com XML ${String(c).padStart(4)} (${t ? Math.round(c*100/t) : 0}%)`);
}
await prisma.$disconnect();
