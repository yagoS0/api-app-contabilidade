// Mostra ONDE está o número do documento dentro do payload que o SERPRO devolveu na captura da
// guia — lendo o `extracted.rawPayload` que já ficou salvo. NÃO faz nenhuma chamada ao SERPRO.
//
// Por que existe: as guias de DAS gravaram o CNPJ do ESCRITÓRIO como numeroDocumento (o extrator
// varria o payload inteiro e pegava `contratante.numero`, que vem ECOADO na resposta). O extrator
// já foi corrigido, mas antes de recapturar (chamada paga) vale conferir aqui, de graça, se o
// número real existe no payload e sob qual chave.
//
//   node scripts/diag-numero-documento.mjs --guia=<guideId>
//   node scripts/diag-numero-documento.mjs --cnpj=<cnpj> --tipo=SIMPLES
//
// Lê `extracted.rawPayload` e lista TODA chave cujo nome contenha "numero"/"documento", com o
// caminho completo — assim dá pra ver qual é o documento e qual é o eco do envelope.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const onlyDigits = (v) => String(v || "").replace(/\D+/g, "");

// Percorre o payload (inclusive strings que são JSON escapado, como o `dados` do Integra Contador).
function coletar(obj, caminho, achados, profundidade = 0) {
  if (obj == null || profundidade > 8) return;
  if (typeof obj === "string") {
    const t = obj.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try { coletar(JSON.parse(t), `${caminho}(json)`, achados, profundidade + 1); } catch { /* string comum */ }
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => coletar(v, `${caminho}[${i}]`, achados, profundidade + 1));
    return;
  }
  if (typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    const p = caminho ? `${caminho}.${k}` : k;
    if (/numero|documento|nosso/i.test(k) && v != null && typeof v !== "object") {
      achados.push({ caminho: p, valor: String(v).slice(0, 60) });
    }
    coletar(v, p, achados, profundidade + 1);
  }
}

try {
  const guiaId = arg("guia");
  const cnpj = arg("cnpj");
  const tipo = (arg("tipo") || "").toUpperCase();

  const where = guiaId
    ? { id: guiaId }
    : { ...(cnpj ? { cnpj: { in: [cnpj, onlyDigits(cnpj)] } } : {}), ...(tipo ? { tipo } : {}) };
  const guias = await prisma.guide.findMany({
    where,
    select: { id: true, tipo: true, competencia: true, cnpj: true, extracted: true },
    orderBy: { competencia: "desc" },
    take: guiaId ? 1 : 5,
  });
  if (!guias.length) { console.error("Nenhuma guia encontrada."); process.exit(1); }

  for (const g of guias) {
    const ex = g.extracted && typeof g.extracted === "object" ? g.extracted : {};
    console.log(`\n=== ${g.tipo} ${g.competencia} · ${g.id}`);
    console.log(`  numeroDocumento GRAVADO: ${ex.numeroDocumento || "(vazio)"}`);
    const cnpjEmpresa = onlyDigits(g.cnpj);
    if (onlyDigits(ex.numeroDocumento) && onlyDigits(ex.numeroDocumento) !== cnpjEmpresa && onlyDigits(ex.numeroDocumento).length === 14) {
      console.log("  ⚠ parece um CNPJ (14 dígitos) — provavelmente o eco do contratante, não o documento.");
    }

    if (!ex.rawPayload) {
      console.log("  (sem rawPayload salvo — não dá pra inspecionar sem recapturar)");
      continue;
    }
    const achados = [];
    coletar(ex.rawPayload, "", achados);
    if (!achados.length) {
      console.log("  Nenhuma chave com 'numero/documento' no payload.");
    } else {
      console.log("  Candidatos no payload:");
      for (const a of achados) console.log(`    ${a.caminho} = ${a.valor}`);
      console.log("\n  Regra: o que vier sob `dados` é o documento; contratante/contribuinte/autorPedidoDados são eco do envelope.");
    }
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
