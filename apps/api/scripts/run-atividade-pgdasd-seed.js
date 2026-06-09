// Roda o seed de AtividadePgdasd (de-para idAtividade). ⚠ IDs a confirmar no trial.
import { prisma } from "../src/infrastructure/db/prisma.js";
import { seedAtividadePgdasd } from "../src/application/notas/apuracao/v2/seeds/AtividadePgdasdSeeds.js";

const log = {
  info: (o, m) => console.log("[seed]", m || "", o || ""),
  warn: (o, m) => console.warn("[seed][WARN]", m || "", o || ""),
};

seedAtividadePgdasd(prisma, { log })
  .then((r) => console.log("\nRESULT", JSON.stringify(r)))
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
