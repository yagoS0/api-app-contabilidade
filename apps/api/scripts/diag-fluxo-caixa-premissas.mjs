// SOMENTE LEITURA. Duas perguntas do dono, medidas na base:
//   1) o vencimento de guia e "sempre dia 20"?
//   2) quais sao as contas de topo do plano (1/2/3/4...)?
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const g = await p.guide.findMany({ where: { vencimento: { not: null } }, select: { vencimento: true, tipo: true } });
const porDia = {};
for (const x of g) { const d = x.vencimento.getUTCDate(); porDia[d] = (porDia[d] || 0) + 1; }
console.log("=== VENCIMENTO DE GUIA: dia do mes (todas as guias com vencimento) ===");
console.log("total:", g.length);
for (const [d, n] of Object.entries(porDia).sort((a,b)=>b[1]-a[1]))
  console.log(`  dia ${String(d).padStart(2)}: ${String(n).padStart(4)}  (${(n*100/g.length).toFixed(1)}%)`);
const porTipoDia = {};
for (const x of g) { const k = `${x.tipo}|${x.vencimento.getUTCDate()}`; porTipoDia[k] = (porTipoDia[k]||0)+1; }
console.log("\n=== por TIPO de guia (top 12) ===");
for (const [k,n] of Object.entries(porTipoDia).sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(`  ${k.padEnd(28)} ${n}`);
const topo = await p.chartOfAccount.findMany({
  where: { OR: [{ codigoCompleto: { in: ["1","2","3","4","5","6"] } }] },
  select: { codigoCompleto: true, codigo: true, nome: true, tipo: true, portalClientId: true },
  take: 60,
});
console.log("\n=== CONTAS DE TOPO (codigoCompleto 1..6) ===");
for (const c of topo) console.log(`  completo=${String(c.codigoCompleto).padEnd(3)} reduzido=${String(c.codigo).padEnd(6)} tipo=${String(c.tipo).padEnd(11)} ${c.nome}${c.portalClientId?" [empresa]":" [global]"}`);
await p.$disconnect();
