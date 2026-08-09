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

console.log("\nGuias que o LEGADO diz enviadas e que não têm linha em envios_guia:");
if (!orfas.length) {
  console.log("   nenhuma.");
} else {
  let total = 0;
  for (const o of orfas) { console.log(`   ${o.status}: ${num(o.n)}`); total += o.n; }
  console.log(`\n   TOTAL: ${num(total)} guia(s) — é o que o backfill converteria.`);
}

// ⚠ A LEITURA DESTE NÚMERO É O CONTRÁRIO DO QUE PARECE.
if (enviosTotal === 0) {
  console.log("\n✓ envios_guia VAZIA — este é o estado SEGURO, e é para ficar assim.");
  console.log("  `foiEnviadaComLegado` cai no `emailStatus` quando não há nenhuma linha, então");
  console.log("  tudo se comporta como antes da F2 e as duas leituras concordam.");
  console.log("\n⚠ NÃO RODE `scripts/backfill-envio-guia.mjs` COMO ELE ESTÁ HOJE.");
  console.log("  Ele converte TODOS os estados (PENDING/ERROR viram `pendente`/`falhou`), e a");
  console.log("  tolerância desliga na PRIMEIRA linha que existir. Como nenhum caminho de envio");
  console.log("  escreve em envios_guia (a F5 do WhatsApp não foi feita), essas guias ficariam");
  console.log("  `enviada: false` PARA SEMPRE no guideCompliance: o card do dashboard nunca");
  console.log("  fecharia, enquanto a aba Guias mostra '✓ enviado'.");
  console.log("  O CLAUDE.md da raiz manda rodar o backfill 'depois do deploy' — essa instrução");
  console.log("  só volta a valer quando o envio passar a gravar em envios_guia.");
} else {
  console.log(`\n⚠ envios_guia TEM ${num(enviosTotal)} registro(s) — a tolerância legada está DESLIGADA.`);
  console.log("  A partir da primeira linha, `foiEnviadaComLegado` para de olhar o `emailStatus`.");
  console.log("  Confira as duas divergências que isso cria:");
  const presas = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM "envios_guia" e JOIN "Guide" g ON g.id = e."guideId"
     WHERE e.status NOT IN ('enviado','entregue','lido') AND g."emailStatus" = 'SENT'`;
  const fuga = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM "envios_guia" e JOIN "Guide" g ON g.id = e."guideId"
     WHERE e.status IN ('enviado','entregue','lido') AND g."emailStatus" IN ('PENDING','ERROR')`;
  console.log(`   e-mail enviado mas envio não-terminal (card nunca fecha): ${num(presas?.[0]?.n)}`);
  console.log(`   envio terminal mas e-mail pendente (card diz enviada e o lote reoferece): ${num(fuga?.[0]?.n)}`);
}

// 4) ⚠ O furo do LOTE, independente da F2: guia com `emailStatus` NULL.
//    `LucroPresumidoProvisaoService` cria a DARF consolidada do LP sem definir `emailStatus`, e a
//    coluna não tem `@default` — nasce NULL. A matriz do lote INCLUI `emailStatus: null` e a
//    oferece como pendente, mas `sendCompanyGuidesEmail` filtra por `{ in: ["PENDING","ERROR"] }`,
//    e `IN` do SQL nunca casa com NULL. A guia é excluída dos anexos e a rota responde
//    `ok: true, sent: 0`. O envio POR GUIA passa (não filtra `emailStatus`).
const nulas = await prisma.$queryRaw`
  SELECT count(*)::int AS n FROM "Guide" WHERE "emailStatus" IS NULL AND status = 'PROCESSED'
`;
const nulasLp = await prisma.$queryRaw`
  SELECT count(*)::int AS n FROM "Guide"
   WHERE "emailStatus" IS NULL AND status = 'PROCESSED'
     AND "sourceFileId" LIKE 'serpro:dctfweb:lp:%'
`;

console.log("\n⚠ Guias PROCESSED com `emailStatus` NULL — o lote as MOSTRA e NÃO as envia:");
console.log(`   total: ${num(nulas?.[0]?.n)}`);
console.log(`   dessas, DARF consolidada do Lucro Presumido: ${num(nulasLp?.[0]?.n)}`);
if ((nulas?.[0]?.n || 0) > 0) {
  console.log("   Para essas, o lote responde sucesso com `sent: 0` e a célula continua '📄 guia'.");
  console.log("   O envio POR GUIA funciona normalmente — é só o lote que as pula.");
}

console.log("\nNada foi alterado.");
await prisma.$disconnect();
