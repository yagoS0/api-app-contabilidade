// SOMENTE LEITURA. Reparseia o PDF já guardado das guias tipo="INSS" e mostra a COMPOSIÇÃO
// (código de receita + denominação) que está impressa no documento. Não chama SERPRO, não escreve.
//
// Pergunta que este script responde: o documento que gravamos como INSS diz que é INSS?
//
//   node scripts/diag-inss-composicao-pdf.mjs
//   node scripts/diag-inss-composicao-pdf.mjs --guia=<id> --dump

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseArrecadacaoComposicao } from "../src/application/fiscal/serpro/parseArrecadacao.js";

function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const tem = (n) => process.argv.includes(`--${n}`);
const guiaFiltro = arg("guia");

function pdfDoRawPayload(extracted) {
  const raw = extracted && extracted.rawPayload;
  if (!raw) return null;
  let dados = raw.dados ?? raw.Dados;
  if (typeof dados === "string") { try { dados = JSON.parse(dados); } catch { return null; } }
  const itens = Array.isArray(dados) ? dados : dados ? [dados] : [];
  for (const item of itens) {
    const b64 = item && (item.pdf || item.docArrecadacaoPdfB64 || item.pdfBase64);
    if (typeof b64 === "string" && b64.length > 100) {
      try { return Buffer.from(b64, "base64"); } catch { return null; }
    }
  }
  return null;
}

async function main() {
  const pdfParse = (await import("pdf-parse")).default;

  const guides = await prisma.guide.findMany({
    where: { tipo: "INSS", status: "PROCESSED", source: "SERPRO", ...(guiaFiltro ? { id: guiaFiltro } : {}) },
    select: { id: true, portalClientId: true, competencia: true, valor: true, pdfBytes: true, extracted: true },
    orderBy: { competencia: "asc" },
  });

  const pIds = [...new Set(guides.map((g) => g.portalClientId).filter(Boolean))];
  const portais = await prisma.portalClient.findMany({
    where: { id: { in: pIds } },
    select: { id: true, razao: true, hasProlabore: true, companyId: true },
  });
  const pMap = new Map(portais.map((p) => [p.id, p]));
  const lIds = portais.map((p) => p.companyId).filter(Boolean);
  const legacy = lIds.length ? await prisma.company.findMany({ where: { id: { in: lIds } }, select: { id: true, regimeTributario: true, tipoTributario: true } }) : [];
  const lMap = new Map(legacy.map((c) => [c.id, c]));
  const regimeDe = (p) => {
    const l = p?.companyId ? lMap.get(p.companyId) : null;
    return String(l?.regimeTributario || l?.tipoTributario || "").trim().toUpperCase() || "(indef)";
  };

  const porCodigo = new Map(); // codigo -> { denominacoes:Set, n, empresas:Set }
  let semPdf = 0;

  for (const g of guides) {
    const buf = g.pdfBytes ? Buffer.from(g.pdfBytes) : pdfDoRawPayload(g.extracted);
    if (!buf || !buf.length) { semPdf += 1; continue; }
    let texto = "";
    try { texto = String((await pdfParse(buf))?.text || ""); } catch { semPdf += 1; continue; }
    if (tem("dump")) { console.log("=== TEXTO ===\n", texto.slice(0, 3000), "\n=== FIM ==="); }
    const comp = parseArrecadacaoComposicao(texto);
    const p = pMap.get(g.portalClientId);
    const codigos = comp.itens.map((i) => i.codigo);
    console.log(
      `${(p?.razao || g.portalClientId).slice(0, 38).padEnd(38)} ${g.competencia} R$${String(Number(g.valor).toFixed(2)).padStart(10)} ` +
      `regime=${regimeDe(p).padEnd(16)} prolab=${String(p?.hasProlabore).padEnd(5)} ` +
      `codigos=[${comp.itens.map((i) => `${i.codigo} ${i.denominacao || ""} ${i.total}`).join(" | ")}]`
    );
    for (const it of comp.itens) {
      if (!porCodigo.has(it.codigo)) porCodigo.set(it.codigo, { den: new Set(), n: 0, emp: new Set() });
      const e = porCodigo.get(it.codigo);
      e.den.add(it.denominacao || "(sem denominação)");
      e.n += 1;
      e.emp.add(p?.razao || g.portalClientId);
    }
  }

  console.log("\n== Códigos de receita encontrados dentro dos PDFs rotulados como INSS ==");
  for (const [cod, e] of [...porCodigo.entries()].sort()) {
    console.log(`  ${cod}  ocorrências=${e.n}  empresas=${e.emp.size}  denominações: ${[...e.den].join(" / ")}`);
  }
  console.log(`\nguias analisadas: ${guides.length}; sem PDF legível: ${semPdf}`);
}

main()
  .catch((e) => { console.error("FALHOU:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
