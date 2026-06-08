// Teste rápido do ClassificadorService v2 numa empresa.
// Uso: node apps/api/scripts/test-classificador-v2.js <portalClientId>

import { prisma } from "../src/infrastructure/db/prisma.js";
import { classificarItensV2 } from "../src/application/notas/apuracao/v2/ClassificadorService.js";

const portalClientId = process.argv[2];
if (!portalClientId) { console.error("uso: <portalClientId>"); process.exit(1); }

(async () => {
  console.log(`\n=== Classificando empresa ${portalClientId} (force=true) ===`);
  const result = await classificarItensV2({ portalClientId, force: true });
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n=== Distribuição final NotaItem ===`);
  const byTipo = await prisma.notaItem.groupBy({
    by: ["tipoReceita"],
    where: { nota: { clientId: portalClientId } },
    _count: true,
  });
  for (const g of byTipo) console.log(`  ${g.tipoReceita || "(null)"}: ${g._count}`);

  console.log(`\n=== Pendências abertas ===`);
  const pends = await prisma.filaPendencia.findMany({
    where: { portalClientId, resolvida: false },
    orderBy: { createdAt: "desc" },
  });
  console.log(`Total: ${pends.length}`);
  for (const p of pends.slice(0, 10)) {
    console.log(`  [${p.tipo}] ${p.resumo}`);
  }
})().catch((err) => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
