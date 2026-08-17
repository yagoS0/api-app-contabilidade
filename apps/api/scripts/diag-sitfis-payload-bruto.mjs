// SÓ LEITURA — o que o SERPRO devolve de fato no SITFIS: PDF embrulhado ou dado estruturado?
// Pergunta do dono: "temos como buscar esses dados brutos? em JSON ou algo assim?"
// ⚠ Não imprime conteúdo do relatório (dado fiscal de cliente) — só a FORMA: chaves e tamanhos.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const linhas = await prisma.companyFiscalStatus.findMany({
  select: {
    portalClientId: true, protocolo: true, relatorioPdfFileId: true,
    texto: true, rawPayload: true, ultimoRelatorioEm: true,
    portalClient: { select: { razao: true } },
  },
  orderBy: { updatedAt: "desc" },
});

console.log(`empresas com registro de situacao fiscal: ${linhas.length}\n`);

const formas = new Map();
for (const l of linhas) {
  const rp = l.rawPayload;
  const chaves = rp && typeof rp === "object" ? Object.keys(rp).sort().join(",") : `(${typeof rp})`;
  formas.set(chaves, (formas.get(chaves) || 0) + 1);
}
console.log("=== FORMA do rawPayload (chaves de topo) ===");
for (const [k, n] of [...formas].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x  {${k}}`);

const kb = (kod) => (kod == null ? "-" : `${Math.round(String(kod).length / 1024)}kB`);
console.log("\n=== POR EMPRESA (forma, nao conteudo) ===");
for (const l of linhas.slice(0, 12)) {
  const rp = l.rawPayload || {};
  const dados = rp.dados;
  console.log(
    `${String(l.portalClient?.razao || "?").slice(0, 22).padEnd(22)}` +
    ` | pdfFile ${l.relatorioPdfFileId ? "sim" : "NAO"}` +
    ` | texto ${l.texto ? kb(l.texto) : "NAO"}` +
    ` | rawPayload ${kb(JSON.stringify(rp))}` +
    ` | dados: ${dados == null ? "ausente" : typeof dados === "string" ? `string ${kb(dados)}` : `objeto {${Object.keys(dados).join(",")}}`}` +
    ` | ultimoRelatorio ${l.ultimoRelatorioEm ? String(l.ultimoRelatorioEm).slice(0, 10) : "nunca"}`,
  );
}
await prisma.$disconnect();
