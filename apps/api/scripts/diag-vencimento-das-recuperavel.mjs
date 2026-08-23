// SOMENTE LEITURA — o vencimento do DAS que está GRAVADO no `rawPayload` e não chegou à coluna.
//
// `CaptureSerproGuidesService.parsePossibleDate` (linha ~211) não conhece o formato AAAAMMDD, que é
// o que o SERPRO devolve em `dados[].detalhamentoDas.dataVencimento` ("20260622"). `new Date()` o lê
// como Invalid Date, a função devolve null, e `Guide.vencimento` fica NULO com a data no payload.
//
// Este script NÃO ESCREVE NADA: só mostra o que seria recuperável e qual é o dia real do vencimento.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

function achatar(obj, prefixo = "", saida = []) {
  if (obj == null) return saida;
  if (typeof obj === "string") {
    const t = obj.trim();
    if (t.startsWith("{") || t.startsWith("[")) { try { return achatar(JSON.parse(t), prefixo, saida); } catch { /* texto */ } }
    saida.push([prefixo, obj]); return saida;
  }
  if (typeof obj !== "object") { saida.push([prefixo, obj]); return saida; }
  for (const [k, v] of Object.entries(obj)) achatar(v, prefixo ? `${prefixo}.${k}` : k, saida);
  return saida;
}
/** AAAAMMDD → Date UTC. É o formato do SERPRO, e é o que falta em `parsePossibleDate`. */
function dataAaaammdd(v) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v || "").trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const guias = await p.guide.findMany({
  where: { tipo: "SIMPLES", vencimento: null, status: { in: ["PROCESSED", "ERROR"] } },
  select: { id: true, competencia: true, valor: true, status: true, extracted: true, portalClientId: true },
});
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const porDia = {}, porSemana = {}, porComp = {};
let recuperaveis = 0, semData = 0;
const amostras = [];
for (const g of guias) {
  const pares = achatar(g.extracted?.rawPayload || {});
  const venc = pares.find(([k]) => /detalhamentoDas\.dataVencimento$/i.test(k));
  const d = venc ? dataAaaammdd(venc[1]) : null;
  if (!d) { semData++; continue; }
  recuperaveis++;
  const dia = d.getUTCDate();
  porDia[dia] = (porDia[dia] || 0) + 1;
  porSemana[DIAS[d.getUTCDay()]] = (porSemana[DIAS[d.getUTCDay()]] || 0) + 1;
  porComp[g.competencia] = (porComp[g.competencia] || 0) + 1;
  if (amostras.length < 12) amostras.push({ comp: g.competencia, bruto: venc[1], data: d.toISOString().slice(0, 10), sem: DIAS[d.getUTCDay()], valor: g.valor });
}
console.log("=== VENCIMENTO DO DAS QUE ESTÁ NO PAYLOAD E NÃO CHEGOU À COLUNA ===");
console.log(`  guias de SIMPLES sem \`vencimento\` na coluna : ${guias.length}`);
console.log(`  com \`detalhamentoDas.dataVencimento\` legível: ${recuperaveis}  ← recuperáveis SEM gastar chamada SERPRO`);
console.log(`  sem data no payload                         : ${semData}`);

console.log("\n— DIA DO MÊS do vencimento REAL do DAS (recuperado do payload) —");
for (const [d, c] of Object.entries(porDia).sort((a, b) => b[1] - a[1]))
  console.log(`  dia ${String(d).padStart(2)}: ${String(c).padStart(3)}  (${(c * 100 / (recuperaveis || 1)).toFixed(1)}%)`);
console.log("\n— DIA DA SEMANA (é o que explica o 'nem sempre dia 20') —");
for (const [d, c] of Object.entries(porSemana).sort((a, b) => b[1] - a[1])) console.log(`  ${d}: ${c}`);
console.log("\n— amostra —");
for (const a of amostras) console.log(`  comp=${String(a.comp).padEnd(8)} payload="${a.bruto}" → ${a.data} (${a.sem})  R$ ${a.valor}`);

// Contraprova: as guias que TÊM vencimento na coluna — o payload concorda?
const comVenc = await p.guide.findMany({
  where: { tipo: "SIMPLES", vencimento: { not: null } },
  select: { competencia: true, vencimento: true, extracted: true },
});
let bate = 0, diverge = 0, semPayloadData = 0;
for (const g of comVenc) {
  const pares = achatar(g.extracted?.rawPayload || {});
  const venc = pares.find(([k]) => /detalhamentoDas\.dataVencimento$/i.test(k));
  const d = venc ? dataAaaammdd(venc[1]) : null;
  if (!d) { semPayloadData++; continue; }
  if (d.toISOString().slice(0, 10) === g.vencimento.toISOString().slice(0, 10)) bate++; else diverge++;
}
console.log(`\n— contraprova nas ${comVenc.length} guias que TÊM a coluna: payload concorda em ${bate}, diverge em ${diverge}, sem data no payload em ${semPayloadData}`);

await p.$disconnect();
console.log("\n[fim] SOMENTE LEITURA — nada foi escrito.");
