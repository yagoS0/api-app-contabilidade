// Teste rápido do motor de apuração v2.
// Uso: node apps/api/scripts/test-motor-apuracao.js <portalClientId> <YYYY-MM>
import { prisma } from "../src/infrastructure/db/prisma.js";
import { calcularApuracaoLocal } from "../src/application/notas/apuracao/v2/MotorApuracaoService.js";

const [portalClientId, competencia] = process.argv.slice(2);
if (!portalClientId || !competencia) { console.error("uso: <portalClientId> <YYYY-MM>"); process.exit(1); }

(async () => {
  console.log(`\n=== Motor apuração: ${portalClientId} / ${competencia} ===`);
  const result = await calcularApuracaoLocal({ portalClientId, competencia });
  console.log(JSON.stringify(result, null, 2));
})().catch((err) => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
