// Marca idAtividade(s) como verificadoTrial=true (após validação real no SERPRO).
// Uso: node apps/api/scripts/mark-atividade-verificada.js 11 [29 30 ...]
import { prisma } from "../src/infrastructure/db/prisma.js";

const ids = process.argv.slice(2).map(Number).filter(Boolean);
if (ids.length === 0) { console.error("uso: <idAtividade> [outros...]"); process.exit(1); }

const r = await prisma.atividadePgdasd.updateMany({
  where: { idAtividade: { in: ids } },
  data: { verificadoTrial: true },
});
console.log(`Marcados verificadoTrial=true: idAtividade ${ids.join(", ")} (${r.count} linha(s))`);
await prisma.$disconnect();
