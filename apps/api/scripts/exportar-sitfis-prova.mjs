// Exporta, para uma pasta FORA do repositório, os insumos da prova da extração posicional do SITFIS:
//
//   <destino>/<i>-<cnpj>.pdf     o PDF ORIGINAL, tirado de `CompanyFiscalStatus.rawPayload.dados.pdf`
//   <destino>/<i>-<cnpj>.txt     o texto que a produção usa hoje (`CompanyFiscalStatus.texto`)
//   <destino>/<i>-<cnpj>.json    o que o PARSER DE TEXTO devolve hoje sobre esse texto
//   <destino>/index.json         o índice dos três, por relatório
//
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/exportar-sitfis-prova.mjs --destino=<pasta>'
//
// ⚠ SÓ LEITURA. Não grava no banco, não chama o SERPRO, não escreve nada dentro do repositório.
// ⚠ O DESTINO TEM DE FICAR FORA DO REPO: o PDF traz CNPJ, razão social, sócios e débitos reais.
//    O script RECUSA gravar dentro da árvore do projeto.
//
// Reprocessar o PDF guardado custa ZERO chamada ao SERPRO — é o que torna a prova repetível.

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseSitfisRelatorio } from "../src/application/fiscal/serpro/parseSitfisRelatorio.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}

const destino = arg("destino");
if (!destino) {
  console.error("Uso: node apps/api/scripts/exportar-sitfis-prova.mjs --destino=<pasta fora do repo>");
  process.exit(2);
}

const raizDoRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const destinoAbs = path.resolve(destino);
if (destinoAbs.toLowerCase().startsWith(raizDoRepo.toLowerCase())) {
  console.error(`RECUSADO: ${destinoAbs} está dentro do repositório (${raizDoRepo}).`);
  console.error("O PDF do SITFIS traz identificadores reais. Escolha uma pasta fora da árvore do git.");
  process.exit(2);
}

try {
  await mkdir(destinoAbs, { recursive: true });

  const status = await prisma.companyFiscalStatus.findMany({
    select: {
      portalClientId: true,
      situacao: true,
      texto: true,
      rawPayload: true,
      checkedAt: true,
      ultimoRelatorioEm: true,
      portalClient: { select: { razao: true, cnpj: true } },
    },
    orderBy: { portalClientId: "asc" },
  });

  const indice = [];
  let comPdf = 0;
  let semPdf = 0;

  for (let i = 0; i < status.length; i += 1) {
    const s = status[i];
    const cnpj = String(s.portalClient?.cnpj || "sem-cnpj").replace(/\D+/g, "") || "sem-cnpj";
    const base = `${String(i + 1).padStart(2, "0")}-${cnpj}`;

    let pdfBytes = null;
    try {
      const rp = s.rawPayload;
      const dados = typeof rp?.dados === "string" ? JSON.parse(rp.dados) : rp?.dados;
      if (dados?.pdf) pdfBytes = Buffer.from(dados.pdf, "base64");
    } catch (e) {
      console.error(`  [${cnpj}] rawPayload ilegível: ${e?.message || e}`);
    }

    if (pdfBytes?.length) {
      await writeFile(path.join(destinoAbs, `${base}.pdf`), pdfBytes);
      comPdf += 1;
    } else {
      semPdf += 1;
    }

    const texto = s.texto || "";
    await writeFile(path.join(destinoAbs, `${base}.txt`), texto, "utf8");

    // O que a produção mostra HOJE. É contra isto que a extração posicional será confrontada.
    const rel = texto.trim() ? parseSitfisRelatorio(texto) : null;
    await writeFile(path.join(destinoAbs, `${base}.json`), JSON.stringify(rel, null, 2), "utf8");

    indice.push({
      base,
      cnpj,
      razao: s.portalClient?.razao || null,
      situacao: s.situacao || null,
      checkedAt: s.checkedAt || null,
      ultimoRelatorioEm: s.ultimoRelatorioEm || null,
      pdfBytes: pdfBytes?.length || 0,
      temTexto: Boolean(texto.trim()),
      blocos: (rel?.diagnosticos || []).reduce((n, d) => n + (d.blocos?.length || 0), 0),
    });
  }

  await writeFile(path.join(destinoAbs, "index.json"), JSON.stringify(indice, null, 2), "utf8");

  console.log(`\n=== SITFIS · exportação para a prova posicional ===`);
  console.log(`  relatórios ............. ${status.length}`);
  console.log(`  com PDF no rawPayload .. ${comPdf}`);
  console.log(`  SEM PDF ................ ${semPdf}`);
  console.log(`  blocos (parser de texto) ${indice.reduce((n, x) => n + x.blocos, 0)}`);
  console.log(`  destino ................ ${destinoAbs}`);
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
