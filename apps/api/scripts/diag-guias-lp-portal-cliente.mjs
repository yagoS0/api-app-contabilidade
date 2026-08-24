// SOMENTE LEITURA. "Por que a guia do Lucro Presumido nao aparece no portal do cliente?"
// Nao escreve nada, nao chama SERPRO/SEFAZ/ADN.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const cs = await p.company.findMany({
  where: { regimeTributario: "LUCRO_PRESUMIDO" },
  select: { cnpj: true, razaoSocial: true },
});
const porCnpj = new Map(cs.map((c) => [String(c.cnpj || "").replace(/\D+/g, ""), c.razaoSocial]));
const pcs = await p.portalClient.findMany({ select: { id: true, cnpj: true, razao: true } });
const ids = pcs.filter((x) => porCnpj.has(String(x.cnpj || "").replace(/\D+/g, ""))).map((x) => x.id);
const nome = new Map(pcs.map((x) => [x.id, x.razao]));

console.log(`empresas LUCRO_PRESUMIDO: ${cs.length} | com PortalClient: ${ids.length}\n`);

const guias = await p.guide.findMany({
  where: { portalClientId: { in: ids }, tipo: "OUTRA" },
  select: {
    id: true, portalClientId: true, competencia: true, status: true, valor: true,
    vencimento: true, liberadaCliente: true, emailStatus: true, extracted: true,
  },
  orderBy: [{ competencia: "desc" }],
});

console.log(`DARF consolidada do LP (tipo="OUTRA"): ${guias.length} guia(s)\n`);
console.log("empresa                          | comp    | status    | liberada | composicao (o que a tela leria)");
console.log("-".repeat(120));
let semComposicao = 0, naoLiberadas = 0;
for (const g of guias) {
  const comp = Array.isArray(g.extracted?.composicao) ? g.extracted.composicao : [];
  if (!comp.length) semComposicao++;
  if (!g.liberadaCliente) naoLiberadas++;
  const nomes = [...new Set(comp.map((c) => String(c?.tributo || c?.denominacao || c?.codigo || "").split(/\s*[-–—]\s*/)[0].trim()).filter(Boolean))];
  console.log(
    `${String(nome.get(g.portalClientId) || "?").slice(0, 32).padEnd(32)} | ${String(g.competencia || "-").padEnd(7)} | ` +
    `${String(g.status).padEnd(9)} | ${(g.liberadaCliente ? "SIM" : "nao").padEnd(8)} | ` +
    (nomes.length ? nomes.join(" · ') ".slice(0, 3)) : "⚠ SEM COMPOSICAO -> a tela diria 'OUTRA'")
  );
}
console.log("-".repeat(120));
console.log(`\nRESUMO: ${naoLiberadas} de ${guias.length} NAO liberadas ao cliente (invisiveis por regra).`);
console.log(`        ${semComposicao} de ${guias.length} sem composicao gravada (apareceriam como "OUTRA", nao "PIS · COFINS").`);
await p.$disconnect();
