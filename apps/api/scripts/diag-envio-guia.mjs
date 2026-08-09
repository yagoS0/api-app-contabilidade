// DIAGNÓSTICO: o estado de ENVIO das guias bate entre a fonte nova e a legada?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhum e-mail, nenhuma chamada externa.
//
// POR QUE ELE EXISTE
// A Entrega 1 do WhatsApp (F2) trocou a fonte da verdade: `Guide.emailStatus` deixou de responder
// "esta guia foi enviada?" e quem responde passou a ser `envios_guia` (um registro por guia ×
// canal) — porque um campo só não representa "enviada por WhatsApp e ainda não por e-mail".
//
// A migração previa rodar `scripts/backfill-envio-guia.mjs` DEPOIS DO DEPLOY. Se isso não
// aconteceu, toda guia anterior à F2 tem `emailStatus` preenchido e NENHUMA linha em `envios_guia`
// — e aí cada tela responde uma coisa diferente sobre a mesma guia, conforme a fonte que ela leia.
//
// Este script não conserta nada: ele MEDE a divergência, que é o que decide se o backfill precisa
// rodar e quantas guias ele alcançaria.
//
// USO (o host interno do Railway não resolve fora da rede deles):
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node apps/api/scripts/diag-envio-guia.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const num = (v) => Number(v || 0).toLocaleString("pt-BR");

// 1) Existe a tabela nova, e ela tem alguma coisa?
let enviosTotal = null;
let porCanal = [];
try {
  const r = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "envios_guia"`;
  enviosTotal = r?.[0]?.n ?? 0;
  porCanal = await prisma.$queryRaw`
    SELECT canal, status, count(*)::int AS n
      FROM "envios_guia"
     GROUP BY canal, status
     ORDER BY n DESC
  `;
} catch (err) {
  console.log("⚠ Não consegui ler `envios_guia`:", err?.message);
  console.log("  Se a tabela não existe, a migration da F2 não foi aplicada nesta base.");
}

// 2) O retrato legado: quantas guias têm `emailStatus` dizendo que foram enviadas?
const porEmailStatus = await prisma.$queryRaw`
  SELECT COALESCE("emailStatus", '(null)') AS status, count(*)::int AS n
    FROM "Guide"
   GROUP BY "emailStatus"
   ORDER BY n DESC
`;

// 3) A DIVERGÊNCIA que importa: guia que o legado diz ENVIADA e que não tem nenhuma linha nova.
//    É exatamente o conjunto que o backfill criaria.
let orfas = [];
if (enviosTotal !== null) {
  orfas = await prisma.$queryRaw`
    SELECT g."emailStatus" AS status, count(*)::int AS n
      FROM "Guide" g
     WHERE g."emailStatus" IS NOT NULL
       AND g."emailStatus" <> 'PENDING'
       AND NOT EXISTS (SELECT 1 FROM "envios_guia" e WHERE e."guideId" = g."id")
     GROUP BY g."emailStatus"
     ORDER BY n DESC
  `;
}

console.log("═".repeat(78));
console.log("ENVIO DE GUIAS — fonte nova (`envios_guia`) vs legado (`Guide.emailStatus`)");
console.log("═".repeat(78));

console.log(`\nRegistros em envios_guia: ${enviosTotal === null ? "(tabela ilegível)" : num(enviosTotal)}`);
for (const c of porCanal) console.log(`   ${c.canal} · ${c.status}: ${num(c.n)}`);

console.log("\nGuide.emailStatus (retrato legado):");
for (const s of porEmailStatus) console.log(`   ${s.status}: ${num(s.n)}`);

console.log("\n⚠ Guias que o LEGADO diz enviadas e que NÃO têm linha em envios_guia:");
if (!orfas.length) {
  console.log("   nenhuma — as duas fontes concordam.");
} else {
  let total = 0;
  for (const o of orfas) { console.log(`   ${o.status}: ${num(o.n)}`); total += o.n; }
  console.log(`\n   TOTAL: ${num(total)} guia(s).`);
  console.log("   É o conjunto que `scripts/backfill-envio-guia.mjs` criaria. Enquanto ele não");
  console.log("   rodar, toda tela que lê `envios_guia` direto (sem `foiEnviadaComLegado`) vê");
  console.log("   essas guias como NÃO ENVIADAS.");
}

console.log("\nNada foi alterado.");
await prisma.$disconnect();
