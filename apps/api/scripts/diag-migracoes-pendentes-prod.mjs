// SO LEITURA. Quais migrations do repositorio ainda NAO estao aplicadas em producao?
// ⚠ Nao aplica nada. `_prisma_migrations` e a tabela de controle do proprio Prisma.
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
const prisma = new PrismaClient();

const dir = path.resolve("prisma/migrations");
const noRepo = fs.readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name).sort();

const linhas = await prisma.$queryRawUnsafe(
  `SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name`
);
const aplicadas = new Set(linhas.filter((l) => l.finished_at).map((l) => l.migration_name));

const pendentes = noRepo.filter((m) => !aplicadas.has(m));
console.log(`migrations no repositorio: ${noRepo.length}`);
console.log(`aplicadas em PRODUCAO:     ${aplicadas.size}`);
console.log(`PENDENTES:                 ${pendentes.length}`);
for (const p of pendentes) console.log(`   - ${p}`);
if (!pendentes.length) console.log("   (nenhuma)");
await prisma.$disconnect();
