// Roda seedDeparaAnexoGlobal manualmente (sem precisar reiniciar a API).
// Útil pra atualizar a tabela DeparaAnexo após mudanças nos seeds.

import { prisma } from "../src/infrastructure/db/prisma.js";
import { seedDeparaAnexoGlobal } from "../src/application/notas/apuracao/DeparaAnexoSeeds.js";

const log = {
  info: (...a) => console.log("[seed]", ...a),
  warn: (...a) => console.warn("[seed][WARN]", ...a),
  error: (...a) => console.error("[seed][ERR]", ...a),
};

seedDeparaAnexoGlobal(prisma, { log })
  .then((res) => {
    console.log("\n=== Resultado ===");
    console.log(JSON.stringify(res, null, 2));
  })
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
