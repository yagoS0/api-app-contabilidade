// Backfill: cria NotaItem pras NFS-e (papel=EMIT, type=NFSE) já capturadas
// que estão sem itens. Lê xmlRaw, parseia codigoServico via AdnXmlMetadata
// e insere 1 item por nota.
//
// Uso:
//   node apps/api/scripts/backfill-nfse-itens.js              # all companies
//   node apps/api/scripts/backfill-nfse-itens.js <portalClientId>   # uma empresa
//
// Idempotente: se a nota já tem item, pula.

import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseXmlMetadata } from "../src/application/nfse/AdnXmlMetadata.js";

async function main() {
  const portalClientId = process.argv[2] || null;

  const where = {
    type: "NFSE",
    xmlRaw: { not: null },
    itens: { none: {} },
    ...(portalClientId ? { clientId: portalClientId } : {}),
  };

  const total = await prisma.portalInvoice.count({ where });
  console.log(`[backfill] ${total} NFS-e sem itens encontradas` + (portalClientId ? ` (empresa ${portalClientId})` : ""));
  if (total === 0) return;

  const batchSize = 200;
  let processed = 0;
  let created = 0;
  let skippedNoCode = 0;
  let skippedNoXml = 0;

  while (processed < total) {
    const batch = await prisma.portalInvoice.findMany({
      where,
      select: { id: true, xmlRaw: true, total: true, clientId: true },
      take: batchSize,
    });
    if (batch.length === 0) break;

    for (const nota of batch) {
      if (!nota.xmlRaw) { skippedNoXml++; continue; }
      try {
        const meta = parseXmlMetadata(nota.xmlRaw);
        if (!meta.codigoServico) { skippedNoCode++; continue; }
        await prisma.notaItem.create({
          data: {
            notaId: nota.id,
            codigoServico: meta.codigoServico,
            descricao: meta.descricaoServico || null,
            valor: Number(meta.valorServicos || nota.total || 0),
          },
        });
        created++;
      } catch (err) {
        console.warn(`[backfill] erro nota ${nota.id}: ${err?.message}`);
      }
    }
    processed += batch.length;
    console.log(`[backfill] progresso: ${processed}/${total} · criados ${created} · sem código ${skippedNoCode} · sem xml ${skippedNoXml}`);
  }

  console.log(`[backfill] FIM · criados=${created} sem_código=${skippedNoCode} sem_xml=${skippedNoXml}`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
