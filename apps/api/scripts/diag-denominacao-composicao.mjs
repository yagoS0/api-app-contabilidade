// ⚠ SÓ LEITURA — nenhuma escrita, nenhuma chamada externa.
//
// Responde UMA pergunta: quais formas de `denominacao` existem de verdade em
// `Guide.extracted.composicao`? É o insumo de `tributoCurto` (três cópias: api, portal do cliente,
// portal do escritório), que corta a string no primeiro hífen — então uma denominação que COMECE
// pelo código de receita ("2172-01 COFINS - …") devolveria "2172", um número, no lugar do nome do
// tributo, e a guia se chamaria "2172 · 8109" na tela de quem paga.
//
// Sem esta medição, mexer em `tributoCurto` seria consertar uma hipótese.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function curtoDeHoje(c) {
  if (c?.tributo) return String(c.tributo).trim();
  const den = String(c?.denominacao || "").trim();
  if (den) return (den.split(/\s*[-–—]\s*/)[0] || den).trim();
  return String(c?.codigo || "").trim() || "?";
}

const guias = await prisma.guide.findMany({
  where: { extracted: { not: null } },
  select: { id: true, tipo: true, competencia: true, extracted: true },
});

const formas = new Map();
const suspeitos = [];
let comComposicao = 0;
let itens = 0;

for (const g of guias) {
  const comp = g.extracted?.composicao;
  if (!Array.isArray(comp) || comp.length === 0) continue;
  comComposicao += 1;
  for (const c of comp) {
    itens += 1;
    const den = String(c?.denominacao || "").trim();
    const curto = curtoDeHoje(c);
    const origem = c?.tributo ? "tributo" : den ? "denominacao" : "codigo";
    const chave = `${origem} | ${curto}`;
    formas.set(chave, (formas.get(chave) || 0) + 1);
    // O curto virou NÚMERO PURO? Então o nome do tributo se perdeu no corte.
    if (/^\d+$/.test(curto)) suspeitos.push({ tipo: g.tipo, comp: g.competencia, den, curto });
  }
}

console.log(`guias com extracted: ${guias.length}`);
console.log(`guias com composicao: ${comComposicao}   itens de composicao: ${itens}`);
console.log("\n--- o que `tributoCurto` devolve hoje, por frequencia ---");
for (const [k, n] of [...formas.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(String(n).padStart(4), k);
}
console.log(`\n--- itens em que o curto virou NUMERO PURO: ${suspeitos.length} ---`);
for (const s of suspeitos.slice(0, 25)) {
  console.log(`  ${s.tipo} ${s.comp}  curto="${s.curto}"  denominacao="${s.den}"`);
}

await prisma.$disconnect();
