// Diagnóstico: pra uma empresa+competência, mostra:
//   - quantas notas EMIT/autorizada na competência
//   - quantas têm itens vs sem itens
//   - 1 amostra de XML (primeiros 1500 chars)
//   - o que o parser extrai dessa amostra (codigoServico etc)
//   - quantos NotaItem têm anexoResolvido vs null
//   - receitaPorAnexo da Apuracao (se existir)
//
// Uso:
//   node apps/api/scripts/debug-nfse-itens.js <portalClientId> <YYYY-MM>

import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseXmlMetadata } from "../src/application/nfse/AdnXmlMetadata.js";

async function main() {
  const portalClientId = process.argv[2];
  const competencia = process.argv[3];
  if (!portalClientId || !competencia) {
    console.error("uso: node debug-nfse-itens.js <portalClientId> <YYYY-MM>");
    process.exit(1);
  }

  const [y, m] = competencia.split("-").map(Number);
  const range = {
    gte: new Date(Date.UTC(y, m - 1, 1)),
    lt: new Date(Date.UTC(y, m, 1)),
  };

  const notas = await prisma.portalInvoice.findMany({
    where: {
      clientId: portalClientId,
      papel: "EMIT",
      statusEfetivo: "autorizada",
      competencia: range,
    },
    select: {
      id: true, type: true, chaveAcesso: true, total: true,
      xmlRaw: true,
      itens: { select: { id: true, codigoServico: true, anexoResolvido: true, sujeitoFatorR: true, valor: true } },
    },
  });

  console.log(`\n=== Notas EMIT/autorizada em ${competencia}: ${notas.length} ===`);
  const semItens = notas.filter((n) => n.itens.length === 0);
  const comItens = notas.filter((n) => n.itens.length > 0);
  console.log(`  Com itens : ${comItens.length}`);
  console.log(`  Sem itens : ${semItens.length}`);

  if (comItens.length > 0) {
    const semAnexo = comItens.filter((n) => n.itens.some((i) => !i.anexoResolvido)).length;
    const comAnexo = comItens.filter((n) => n.itens.every((i) => i.anexoResolvido)).length;
    console.log(`  → com itens E anexoResolvido em TODOS  : ${comAnexo}`);
    console.log(`  → com itens MAS algum sem anexoResolvido: ${semAnexo}`);

    // Distribuição de codigoServico nos itens
    const counts = {};
    for (const n of comItens) {
      for (const i of n.itens) {
        const k = `${i.codigoServico || "(sem código)"} → anexo=${i.anexoResolvido || "(null)"} fatorR=${i.sujeitoFatorR ? "S" : "N"}`;
        counts[k] = (counts[k] || 0) + 1;
      }
    }
    console.log(`\n  Distribuição de (codigoServico → anexo):`);
    for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${v.toString().padStart(4)} × ${k}`);
    }
  }

  // Amostra de XML
  const amostra = notas.find((n) => n.xmlRaw);
  if (amostra) {
    console.log(`\n=== Amostra de XML (nota ${amostra.id.slice(0, 8)} · ${amostra.chaveAcesso}) ===`);
    console.log(amostra.xmlRaw.slice(0, 1500));
    console.log(amostra.xmlRaw.length > 1500 ? `\n... (XML completo: ${amostra.xmlRaw.length} chars)` : "");
    const parsed = parseXmlMetadata(amostra.xmlRaw);
    console.log(`\n--- parseXmlMetadata extraiu: ---`);
    console.log(JSON.stringify(parsed, null, 2));
  } else {
    console.log("\nNenhuma nota tem xmlRaw populado nessa competência.");
  }

  // Apuração
  const apuracao = await prisma.apuracao.findUnique({
    where: { portalClientId_competencia: { portalClientId, competencia } },
  });
  if (apuracao) {
    console.log(`\n=== Apuracao ===`);
    console.log(`  estado:           ${apuracao.estado}`);
    console.log(`  receitaMes:       ${apuracao.receitaMes}`);
    console.log(`  rb12:             ${apuracao.rb12}`);
    console.log(`  fs12:             ${apuracao.fs12}`);
    console.log(`  fatorR:           ${apuracao.fatorR}`);
    console.log(`  receitaPorAnexo:  ${JSON.stringify(apuracao.receitaPorAnexo)}`);
  } else {
    console.log(`\nNenhuma Apuracao calculada pra ${competencia}.`);
  }

  // DeparaAnexo pra códigos encontrados (testa lookup direto E conversão cTribNac→LC116)
  const codigos = new Set();
  for (const n of notas) for (const i of n.itens) if (i.codigoServico) codigos.add(i.codigoServico);
  if (codigos.size > 0) {
    const cTribNacToLc116 = (codigo) => {
      const d = String(codigo || "").replace(/\D+/g, "");
      if (d.length !== 6) return null;
      const cap = parseInt(d.slice(0, 2), 10);
      const item = parseInt(d.slice(2, 4), 10);
      if (!cap || !item) return null;
      return `${cap}.${String(item).padStart(2, "0")}`;
    };
    const candidatos = new Set();
    for (const c of codigos) {
      candidatos.add(c);
      const lc = cTribNacToLc116(c);
      if (lc) candidatos.add(lc);
    }
    const deparas = await prisma.deparaAnexo.findMany({
      where: { tipoCodigo: "LC116", codigo: { in: [...candidatos] } },
    });
    console.log(`\n=== DeparaAnexo lookup (direto + conversão cTribNac→LC116) ===`);
    for (const c of codigos) {
      const lc = cTribNacToLc116(c);
      const tries = [c, lc].filter(Boolean);
      const hits = deparas.filter((d) => tries.includes(d.codigo));
      if (hits.length === 0) {
        console.log(`  ${c}${lc && lc !== c ? ` (→ ${lc})` : ""}: SEM mapeamento — vai pro DEFAULT/III`);
      } else {
        console.log(`  ${c}${lc && lc !== c ? ` (→ ${lc})` : ""}: ${hits.map((d) => `${d.escopo}:LC116:${d.codigo}=${d.anexoResolvido}${d.sujeitoFatorR ? "+FR" : ""}`).join(", ")}`);
      }
    }
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
