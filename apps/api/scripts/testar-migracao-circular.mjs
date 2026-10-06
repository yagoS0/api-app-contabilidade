import fs from "node:fs";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";

// Ensaio local: tudo é criado em schema isolado e revertido ao terminar.
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Este ensaio aceita somente PostgreSQL local.");
}
const prisma = new PrismaClient();
const migration = fs.readFileSync(new URL("../prisma/migrations/20261006153000_circular_classificacao_historica/migration.sql", import.meta.url), "utf8");
const rollback = new Error("ROLLBACK_DO_ENSAIO");
try {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE SCHEMA "teste_circular_20261006"');
    await tx.$executeRawUnsafe('SET LOCAL search_path TO "teste_circular_20261006"');
    await tx.$executeRawUnsafe(`CREATE TABLE accounting_entries (id TEXT PRIMARY KEY, "portalClientId" TEXT, subtipo TEXT,
      "eventType" TEXT, tipo TEXT, "openEntryId" TEXT, "updatedAt" TIMESTAMP, valor NUMERIC, status TEXT)`);
    await tx.$executeRawUnsafe(`INSERT INTO accounting_entries VALUES
      ('p','a','PIS_COFINS','DARF_PIS','PROVISAO',NULL,NOW(),100,'EXPORTADO'),
      ('c','a','PIS_COFINS','DARF_COFINS','PROVISAO',NULL,NOW(),200,'CONFIRMADO'),
      ('i','a',NULL,'BAIXA_DARF_IRPJ','BAIXA',NULL,NOW(),300,'CONFIRMADO'),
      ('s','a',NULL,'BAIXA_DARF_CSLL','BAIXA',NULL,NOW(),400,'CONFIRMADO'),
      ('bp','a',NULL,NULL,'BAIXA','p',NOW(),100,'CONFIRMADO'),
      ('estranho','b',NULL,NULL,'BAIXA','p',NOW(),100,'CONFIRMADO'),
      ('ambiguo','a','PIS_COFINS',NULL,'PROVISAO',NULL,NOW(),150,'CONFIRMADO'),
      ('tipo_errado','a','IRPJ','BAIXA_DARF_IRPJ','PROVISAO',NULL,NOW(),300,'CONFIRMADO')`);
    const before = await tx.$queryRawUnsafe('SELECT * FROM accounting_entries ORDER BY id');
    const sql = migration.replace(/--[^\n]*/g, "");
    for (const statement of sql.split(";").map((s) => s.trim()).filter((s) => s && !["BEGIN", "COMMIT"].includes(s))) {
      await tx.$executeRawUnsafe(statement);
    }
    const after = await tx.$queryRawUnsafe('SELECT * FROM accounting_entries ORDER BY id');
    const audit = await tx.$queryRawUnsafe('SELECT * FROM circular_classificacao_reparos');
    assert.equal(audit.length, 5);
    assert.deepEqual(Object.fromEntries(after.map((e) => [e.id, e.subtipo])), {
      ambiguo: "PIS_COFINS", bp: "PIS", c: "COFINS", estranho: null, i: "IRPJ", p: "PIS", s: "CSLL", tipo_errado: "IRPJ",
    });
    for (let n = 0; n < before.length; n++) {
      for (const field of ["tipo", "valor", "status", "openEntryId", "eventType"]) assert.equal(String(after[n][field]), String(before[n][field]));
    }
    for (const row of audit) assert.equal(row.registroAnterior.subtipo, before.find((e) => e.id === row.entryId).subtipo);
    throw rollback;
  }, { timeout: 30000 });
} catch (err) {
  if (err !== rollback) throw err;
  console.log("Ensaio PostgreSQL aprovado: 5 classificações, 3 casos preservados, snapshot conferido; ROLLBACK concluído.");
} finally { await prisma.$disconnect(); }
