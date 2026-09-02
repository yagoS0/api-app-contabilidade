// ⚠⚠ SOMENTE LEITURA. Relato do dono (30/08/2026): *"a aba de guias — INSS e parcelamento não
// aparecem"*.
//
// A aba lê `GET /client/companies/:id/guides`, que chama `listGuidesByCompany` com
// `apenasLiberadas: true`. Este script mostra TODAS as guias da empresa e marca quais a rota
// deixaria passar — para separar "o contador não liberou" de "a consulta perde a linha".
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const ALVO = (process.argv[2] || "ERISANGELA").toUpperCase();
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const empresas = await p.portalClient.findMany({ select: { id: true, razao: true } });
const alvo = empresas.find((e) => String(e.razao || "").toUpperCase().includes(ALVO));
if (!alvo) { console.log("nao achei"); await p.$disconnect(); process.exit(0); }
console.log(`EMPRESA: ${alvo.razao}\n`);

const guias = await p.guide.findMany({
  where: { portalClientId: alvo.id },
  select: {
    id: true, tipo: true, competencia: true, valor: true, vencimento: true,
    paymentStatus: true, liberadaCliente: true, parcelamentoId: true, emailStatus: true,
  },
  orderBy: [{ competencia: "desc" }, { tipo: "asc" }],
});
console.log(`${guias.length} guias na base\n`);
console.log("comp".padEnd(9), "tipo".padEnd(10), "valor".padStart(13), "venc".padEnd(11), "pgto".padEnd(9), "liberada", "parc", " VÊ?");
let veem = 0;
for (const g of guias) {
  const ve = g.liberadaCliente === true;
  if (ve) veem += 1;
  console.log(
    String(g.competencia || "—").padEnd(9),
    String(g.tipo || "—").padEnd(10),
    brl(g.valor).padStart(13),
    (g.vencimento ? g.vencimento.toISOString().slice(0, 10) : "—").padEnd(11),
    String(g.paymentStatus || "—").padEnd(9),
    String(g.liberadaCliente).padEnd(8),
    g.parcelamentoId ? "sim " : "—   ",
    ve ? " VÊ" : " ——— não vê"
  );
}
console.log(`\nO CLIENTE VÊ ${veem} de ${guias.length}.`);

const porTipo = new Map();
for (const g of guias) {
  const k = `${g.tipo}${g.parcelamentoId ? " (parcela)" : ""}`;
  const at = porTipo.get(k) || { total: 0, liberadas: 0 };
  at.total += 1; if (g.liberadaCliente === true) at.liberadas += 1;
  porTipo.set(k, at);
}
console.log("\npor tipo:");
for (const [k, v] of porTipo) console.log(`  ${k.padEnd(22)} ${v.liberadas}/${v.total} liberadas`);

// E na carteira inteira, para saber se é caso isolado.
console.log("\n=== CARTEIRA INTEIRA, por tipo ===");
const todas = await p.guide.groupBy({
  by: ["tipo", "liberadaCliente"],
  _count: { _all: true },
});
const mapa = new Map();
for (const t of todas) {
  const at = mapa.get(t.tipo) || { sim: 0, nao: 0 };
  if (t.liberadaCliente === true) at.sim += t._count._all; else at.nao += t._count._all;
  mapa.set(t.tipo, at);
}
for (const [t, v] of [...mapa].sort((a, b) => (b[1].sim + b[1].nao) - (a[1].sim + a[1].nao)))
  console.log(`  ${String(t).padEnd(12)} liberadas ${String(v.sim).padStart(5)} · não liberadas ${String(v.nao).padStart(5)}`);
const parc = await p.guide.groupBy({ by: ["liberadaCliente"], where: { parcelamentoId: { not: null } }, _count: { _all: true } });
console.log("  parcelas de parcelamento:", parc.map((x) => `${x.liberadaCliente} = ${x._count._all}`).join(" · "));
await p.$disconnect();
