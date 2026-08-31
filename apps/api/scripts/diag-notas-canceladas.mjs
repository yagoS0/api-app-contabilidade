// DIAGNÓSTICO — SOMENTE LEITURA.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const q = (s, ...a) => p.$queryRawUnsafe(s, ...a).catch((e) => { console.log("  (falhou:", e?.meta?.message || e.message, ")"); return []; });

console.log("=== AS NOSSAS EMISSOES DE HOJE (ServiceInvoice) ===");
const si = await q(
  `SELECT id, "numeroNfse", status, "chaveAcesso", "rpsSerie", "rpsNumero", "createdAt", "updatedAt"
     FROM "ServiceInvoice" WHERE "createdAt" > now() - interval '1 day' ORDER BY "createdAt"`);
for (const n of si) {
  const [pi] = await q(`SELECT numero, status, "statusEfetivo", "clientId" FROM "PortalInvoice" WHERE "chaveAcesso" = $1 AND papel = 'EMIT'`, n.chaveAcesso || "");
  console.log(`  rps ${n.rpsSerie}/${n.rpsNumero} | criada ${String(n.createdAt).slice(16,24)} | NOSSO status=${n.status} (atualizado ${String(n.updatedAt).slice(16,24)})`);
  console.log(`     capturada como: ${pi ? `nº ${pi.numero} | statusEfetivo=${pi.statusEfetivo}` : "AINDA NAO"}`);
}

console.log("\n=== OS LOTES (a idempotencia) ===");
const lotes = await q(
  `SELECT id, status, "totalLinhas", "criadoEm" FROM "lotes_emissao_nfse" ORDER BY "criadoEm" DESC LIMIT 5`);
for (const l of lotes) {
  const linhas = await q(`SELECT "numeroLinha", desfecho, "serviceInvoiceId", "rpsNumero", "tentadaEm" FROM "lotes_emissao_nfse_linhas" WHERE "loteId" = $1 ORDER BY "numeroLinha"`, l.id);
  console.log(`  lote ${String(l.id).slice(0,8)} | ${l.status} | ${l.totalLinhas} linha(s) | criado ${String(l.criadoEm).slice(16,24)}`);
  for (const x of linhas) console.log(`     linha ${x.numeroLinha}: ${x.desfecho} | rps ${x.rpsNumero || "—"} | tentada ${x.tentadaEm ? String(x.tentadaEm).slice(16,24) : "—"}`);
}
await p.$disconnect();
