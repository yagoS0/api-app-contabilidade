// DIAGNÓSTICO — SOMENTE LEITURA. Nenhum ato fiscal.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const q = (s, ...a) => p.$queryRawUnsafe(s, ...a).catch((e) => { console.log("  (falhou:", e?.meta?.message || e.message, ")"); return []; });

const nossas = await q(
  `SELECT id, "numeroNfse", status, "chaveAcesso", "createdAt"
     FROM "ServiceInvoice" WHERE "createdAt" > now() - interval '2 days' ORDER BY "createdAt" DESC`);
console.log("AS NOTAS DE HOJE (ServiceInvoice):", nossas.length);
for (const n of nossas) {
  const todas = await q(
    `SELECT pi.id, pi.papel, pi.type, pi.status, pi."statusEfetivo", pi."clientId",
            pi."tomadorDoc", pi."emitenteDoc", pc.cnpj AS "cnpjDaEmpresa", pc.razao
       FROM "PortalInvoice" pi LEFT JOIN "PortalClient" pc ON pc.id = pi."clientId"
      WHERE pi."chaveAcesso" = $1`, n.chaveAcesso);
  console.log(`\n  ServiceInvoice ${String(n.id).slice(0,8)} | ${String(n.createdAt).slice(16,24)} | ${n.status}`);
  if (!todas.length) { console.log("    → AINDA NAO CAPTURADA: a lista mostra este id, e a rota de cancelar (que le PortalInvoice) responderia 404"); continue; }
  console.log(`    → ${todas.length} copia(s) desta MESMA nota na base (a emitida e a recebida sao linhas diferentes)`);
  for (const pi of todas) {
  console.log(`      • PortalInvoice ${String(pi.id).slice(0,8)} | empresa=${pi.razao}`);
  console.log(`        papel=${pi.papel} type=${pi.type} status=${pi.status} statusEfetivo=${pi.statusEfetivo}`);
  const doc = (v) => String(v || "").replace(/\D+/g, "");
  const recebida = String(pi.papel || "").toUpperCase() === "DEST"
    || (Boolean(doc(pi.cnpjDaEmpresa)) && doc(pi.tomadorDoc) === doc(pi.cnpjDaEmpresa) && doc(pi.emitenteDoc) !== doc(pi.cnpjDaEmpresa));
  console.log(`        recusaria por "nota_recebida"? ${recebida}   | nao e NFSE? ${String(pi.type || "").toUpperCase() !== "NFSE"}`);
  }
}
await p.$disconnect();
