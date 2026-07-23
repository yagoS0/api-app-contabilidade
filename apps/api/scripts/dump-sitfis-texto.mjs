// Dump do TEXTO extraído do relatório SITFIS armazenado de uma empresa — pra CALIBRAR a heurística
// de leitura da situação fiscal com dados reais. Rode no ambiente que tem os PDFs (produção).
//   node scripts/dump-sitfis-texto.mjs --portalClientId=<id>
// Rode numa empresa LIMPA e numa COM pendência conhecidas, e mande os 2 textos — aí calibramos a
// regex de pendência/negação (deriveSituacaoFiscal em routes/firm/index.js). Read-only.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { GuideStorageService } from "../src/application/guides/GuideStorageService.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

const portalClientId = arg("portalClientId");
if (!portalClientId) {
  console.error("Uso: node scripts/dump-sitfis-texto.mjs --portalClientId=<id>");
  process.exit(2);
}

try {
  const status = await prisma.companyFiscalStatus.findUnique({
    where: { portalClientId },
    select: { relatorioPdfFileId: true, situacao: true, texto: true, checkedAt: true },
  });
  if (!status) {
    console.error("Sem CompanyFiscalStatus pra essa empresa. Consulte a Situação Fiscal primeiro.");
    process.exit(1);
  }
  console.log(`situação atual (heurística): ${status.situacao} · consultado em ${status.checkedAt}`);

  if (!status.relatorioPdfFileId) {
    console.error("Sem relatorioPdfFileId (PDF não armazenado).");
    if (status.texto) console.log(`\n=== texto salvo (${status.texto.length} chars) ===\n${status.texto}`);
    process.exit(1);
  }

  const buf = await GuideStorageService.create().downloadBuffer({ key: status.relatorioPdfFileId });
  if (!buf?.length) {
    console.error("PDF vazio/inacessível no storage.");
    process.exit(1);
  }
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buf);
  const texto = String(data?.text || "");
  console.log(`\n=== TEXTO EXTRAÍDO DO PDF SITFIS (${texto.length} chars) ===\n`);
  console.log(texto);
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
