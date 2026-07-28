// Reextrai `extracted.numeroDocumento` das guias já gravadas, a partir do `rawPayload` que
// ficou salvo. NÃO chama o SERPRO — é releitura de dado que já está no banco.
//
// Por que: o extrator antigo varria o payload inteiro e pegava `contratante.numero` (o CNPJ do
// ESCRITÓRIO, ecoado na resposta), então toda guia de DAS ficou com um número que não existe —
// e a busca de comprovante no PAGTOWEB não achava nada. O número real vem em
// `dados.detalhamentoDas.numeroDocumento` (confirmado no payload real do GERARDAS12).
//
//   node scripts/corrigir-numero-documento.mjs            → só relatório (nada é gravado)
//   node scripts/corrigir-numero-documento.mjs --aplicar  → grava as correções
//   ... --cnpj=<cnpj>  --tipo=SIMPLES                     → recorta o alvo
//
// Guias sem `rawPayload` NÃO têm conserto aqui: só recapturando no SERPRO.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { extractDocumentNumber } from "../src/application/fiscal/serpro/CaptureSerproGuidesService.js";

const aplicar = process.argv.includes("--aplicar");
function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");

try {
  const cnpj = arg("cnpj");
  const tipo = (arg("tipo") || "").toUpperCase();
  const guias = await prisma.guide.findMany({
    where: {
      ...(cnpj ? { cnpj: { in: [cnpj, onlyDigits(cnpj)] } } : {}),
      ...(tipo ? { tipo } : {}),
    },
    select: { id: true, tipo: true, competencia: true, cnpj: true, extracted: true },
    orderBy: [{ cnpj: "asc" }, { competencia: "desc" }],
  });

  console.log(`${guias.length} guia(s) analisada(s)${aplicar ? "" : "  (simulação — use --aplicar para gravar)"}\n`);

  const corrigir = [];
  let semPayload = 0;
  let jaOk = 0;

  for (const g of guias) {
    const ex = g.extracted && typeof g.extracted === "object" ? g.extracted : {};
    const atual = ex.numeroDocumento ? String(ex.numeroDocumento).trim() : "";
    if (!ex.rawPayload) {
      // Só conta como problema se o número atual for suspeito ou inexistente.
      if (!atual || onlyDigits(atual).length === 14) semPayload += 1;
      continue;
    }

    const novo = extractDocumentNumber(ex.rawPayload);
    if (!novo) continue;
    if (novo === atual) { jaOk += 1; continue; }

    corrigir.push({ guia: g, atual, novo });
    const motivo = !atual
      ? "estava vazio"
      : onlyDigits(atual).length === 14
        ? "era um CNPJ (eco do envelope)"
        : "divergente";
    console.log(`  ${g.tipo.padEnd(8)} ${g.competencia}  ${g.cnpj}`);
    console.log(`    ${atual || "(vazio)"}  →  ${novo}   [${motivo}]`);
  }

  console.log(`\nJá corretas ....: ${jaOk}`);
  console.log(`A corrigir .....: ${corrigir.length}`);
  console.log(`Sem rawPayload .: ${semPayload}  (só recapturando no SERPRO)`);

  if (!corrigir.length) {
    console.log("\nNada a fazer.");
  } else if (!aplicar) {
    console.log("\nRode de novo com --aplicar para gravar.");
  } else {
    for (const { guia, novo } of corrigir) {
      const ex = { ...guia.extracted, numeroDocumento: novo };
      await prisma.guide.update({ where: { id: guia.id }, data: { extracted: ex } });
    }
    console.log(`\n✓ ${corrigir.length} guia(s) corrigida(s).`);
    console.log("Agora a busca de pagamento (PAGTOWEB) tem um número consultável para essas guias.");
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
