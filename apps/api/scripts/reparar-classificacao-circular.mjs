// Diagnóstico por padrão. --aplicar exige --snapshot=<arquivo fora do repositório>.
// Corrige apenas classificação comprovada pelo evento; nunca inventa banco,
// pagamento ou converte uma provisão em baixa por semelhança de histórico.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/infrastructure/db/prisma.js";

const aplicar = process.argv.includes("--aplicar");
const snapshot = process.argv.find((a) => a.startsWith("--snapshot="))?.slice(11);
import { TRIBUTOS_CIRCULAR_LP as tributos, EVENTOS_BAIXA_LP as eventosBaixa, planejarClassificacaoCircular } from "../src/application/accounting/reparacaoClassificacaoCircular.js";


async function main() {
  const entries = await prisma.accountingEntry.findMany({
    where: { OR: [
      { subtipo: "PIS_COFINS" },
      { eventType: { in: Object.keys(eventosBaixa) } },
      { tipo: "BAIXA", openEntry: { subtipo: { in: tributos } } },
    ] },
    include: { lines: true, openEntry: { include: { lines: true } } },
    orderBy: { id: "asc" },
  });
  const { changes, revisar } = planejarClassificacaoCircular(entries);
  console.log(JSON.stringify({ modo: aplicar ? "APLICAR" : "SIMULACAO", examinados: entries.length, changes, revisar }, null, 2));
  if (!aplicar) return;
  if (!snapshot || !path.isAbsolute(snapshot)) throw new Error("Informe --snapshot com caminho absoluto fora do repositório.");
  const repo = path.resolve(import.meta.dirname, "../../..");
  const relative = path.relative(repo, path.resolve(snapshot));
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error("Snapshot deve ficar fora do repositório.");
  fs.writeFileSync(snapshot, JSON.stringify({ criadoEm: new Date().toISOString(), entries, changes, revisar }, null, 2), { flag: "wx", mode: 0o600 });
  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      const e = entries.find((item) => item.id === c.id);
      const result = await tx.accountingEntry.updateMany({
        where: { id: e.id, portalClientId: e.portalClientId, subtipo: e.subtipo, tipo: e.tipo, eventType: e.eventType, updatedAt: e.updatedAt },
        data: { subtipo: c.depois },
      });
      if (result.count !== 1) throw new Error(`Registro alterado durante a conferência: ${e.id}. Transação cancelada.`);
    }
  });
  console.log(JSON.stringify({ alterados: changes.length, revisaoNecessaria: revisar.length }));
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
