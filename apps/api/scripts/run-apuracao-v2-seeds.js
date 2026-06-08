// Q14.1 — roda os 3 seeders novos (alíquotas SN, CNAEs, regras v2)
// sem precisar reiniciar a API.
import { prisma } from "../src/infrastructure/db/prisma.js";
import { seedAliquotaSimplesNacional } from "../src/application/notas/apuracao/v2/seeds/AliquotaSimplesNacionalSeeds.js";
import { seedCnaeAnexo } from "../src/application/notas/apuracao/v2/seeds/CnaeAnexoSeeds.js";
import { seedRegraClassificacaoGlobal } from "../src/application/notas/apuracao/v2/seeds/RegraClassificacaoSeeds.js";

const log = {
  info: (obj, msg) => console.log("[seed]", msg || "", obj || ""),
  warn: (obj, msg) => console.warn("[seed][WARN]", msg || "", obj || ""),
  error: (obj, msg) => console.error("[seed][ERR]", msg || "", obj || ""),
};

(async () => {
  console.log("\n=== Alíquotas SN ===");
  console.log(await seedAliquotaSimplesNacional(prisma, { log }));
  console.log("\n=== CNAE → TipoReceita ===");
  console.log(await seedCnaeAnexo(prisma, { log }));
  console.log("\n=== Regras de Classificação (v2) ===");
  console.log(await seedRegraClassificacaoGlobal(prisma, { log }));
  console.log("\nFIM ✓");
})().catch((err) => { console.error(err); process.exit(1); }).finally(() => prisma.$disconnect());
