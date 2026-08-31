// ⚠⚠ BACKFILL DO DIA DAS SÉRIES JÁ MARCADAS — DRY-RUN POR PADRÃO (31/08/2026)
//
// A base da observação passou a guardar `dia` (mediana dos dias de emissão) em 31/08. As séries
// que já estavam ATIVAS têm a base gravada ANTES disso: elas continuariam sem dia até alguém
// decidir sobre elas de novo, que pode não acontecer nunca.
//
// ⚠ Ele só toca em `baseDaObservacao`, e só para ACRESCENTAR `dia`/`dias`. Não muda estado, não
// muda valor, não toca `diaDoMes` (que é do CLIENTE — sobrescrevê-lo apagaria a correção dele).
//
// Uso:  node scripts/backfill-dia-das-series.mjs            (dry-run: mostra e não grava)
//       node scripts/backfill-dia-das-series.mjs --aplicar  (grava)
import { PrismaClient } from "@prisma/client";
import { diaTipico } from "../src/application/fluxo/lib/recorrencia.js";

const APLICAR = process.argv.includes("--aplicar");
const p = new PrismaClient();

const series = await p.$queryRawUnsafe(
  `SELECT id, "portalClientId", rotulo, "contraparteDoc", "baseDaObservacao", "diaDoMes"
     FROM "series_recorrentes"
    WHERE lado = 'DESPESA' AND "excluidaPeloClienteEm" IS NULL`
);
console.log(APLICAR ? "MODO: APLICAR" : "MODO: dry-run (nada é gravado)");
console.log("séries de despesa:", series.length, "\n");

for (const s of series) {
  const base = s.baseDaObservacao || {};
  if (Number.isInteger(base.dia)) { console.log(` = ${s.rotulo}: já tem dia ${base.dia}`); continue; }

  const notas = await p.$queryRawUnsafe(
    `SELECT "issueDate" FROM "PortalInvoice"
      WHERE "clientId" = $1 AND papel = 'DEST' AND "emitenteDoc" = $2 AND "issueDate" IS NOT NULL`,
    s.portalClientId, s.contraparteDoc || ""
  );
  // ⚠ UTC, o MESMO acessador de `diaDaNota` — local devolveria o dia seguinte às 21h de Brasília.
  const obs = notas.map((n) => ({ dia: n.issueDate.getUTCDate() }));
  const { dia, dias } = diaTipico(obs);

  if (dia == null) { console.log(` ! ${s.rotulo}: nenhuma nota com data — fica sem dia`); continue; }
  console.log(` → ${s.rotulo}: dia ${dia}  (observados: ${dias.join(", ")})${s.diaDoMes ? `  ⚠ o cliente já definiu dia ${s.diaDoMes}, que continua vencendo` : ""}`);

  if (APLICAR) {
    await p.serieRecorrente.update({
      where: { id: s.id },
      data: { baseDaObservacao: { ...base, dia, dias } },
    });
  }
}
await p.$disconnect();
