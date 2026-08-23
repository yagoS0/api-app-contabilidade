// SOMENTE LEITURA. Mede o plano de contas real para responder: da para identificar CAIXA/BANCOS
// pela ESTRUTURA do codigoCompleto em vez de casar o NOME contra uma lista de textos?
// Perguntas:
//  1) formato do codigoCompleto (largura, niveis) e cobertura (quantas contas NAO tem)
//  2) a premissa do dono: o plano e "basicamente o mesmo" para todas as empresas?
//  3) quantas contas caem no prefixo de DISPONIBILIDADES e o que a lista de textos acha hoje
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const all = await p.chartOfAccount.findMany({
  select: { codigo: true, codigoCompleto: true, nome: true, tipo: true, analitica: true, portalClientId: true },
});
console.log("=== TOTAL ===");
console.log("contas:", all.length);
const globais = all.filter((a) => !a.portalClientId);
const empresa = all.filter((a) => a.portalClientId);
console.log("globais (portalClientId null):", globais.length, "| de empresa:", empresa.length);
const empresas = [...new Set(empresa.map((a) => a.portalClientId))];
console.log("empresas com conta propria:", empresas.length);

console.log("\n=== codigoCompleto: COBERTURA ===");
const semCompleto = all.filter((a) => !a.codigoCompleto);
console.log("sem codigoCompleto:", semCompleto.length, `(${(semCompleto.length * 100 / all.length).toFixed(1)}%)`);
for (const c of semCompleto.slice(0, 20)) console.log(`   red=${String(c.codigo).padEnd(6)} ${c.nome}`);

console.log("\n=== codigoCompleto: LARGURA ===");
const porLen = {};
for (const a of all) if (a.codigoCompleto) { const L = a.codigoCompleto.length; porLen[L] = (porLen[L] || 0) + 1; }
for (const [L, n] of Object.entries(porLen).sort((a, b) => Number(a[0]) - Number(b[0]))) console.log(`  len ${String(L).padStart(2)}: ${n}`);
const naoNumerico = all.filter((a) => a.codigoCompleto && !/^\d+$/.test(a.codigoCompleto));
console.log("codigoCompleto NAO puramente numerico:", naoNumerico.length);
for (const c of naoNumerico.slice(0, 15)) console.log(`   completo=${c.codigoCompleto} red=${c.codigo} ${c.nome}`);

console.log("\n=== NIVEIS (prefixos de 1..5 chars, top por contagem) ===");
for (const nivel of [1, 2, 3, 5, 6]) {
  const m = {};
  for (const a of all) if (a.codigoCompleto && a.codigoCompleto.length >= nivel) {
    const k = a.codigoCompleto.slice(0, nivel); m[k] = (m[k] || 0) + 1;
  }
  const ord = Object.entries(m).sort((x, y) => y[1] - x[1]);
  console.log(`  -- prefixo ${nivel} char(s): ${ord.length} distintos`);
  for (const [k, n] of ord.slice(0, 14)) {
    const ex = all.find((a) => a.codigoCompleto === k);
    console.log(`     ${k.padEnd(7)} n=${String(n).padStart(4)} ${ex ? `<- existe conta: ${ex.nome}` : ""}`);
  }
}

console.log("\n=== PREMISSA DO DONO: o plano e o mesmo para todas as empresas? ===");
const porEmpresa = new Map();
for (const a of empresa) {
  if (!porEmpresa.has(a.portalClientId)) porEmpresa.set(a.portalClientId, new Set());
  porEmpresa.get(a.portalClientId).add(`${a.codigoCompleto || "SEM"}|${a.nome}`);
}
const listas = [...porEmpresa.entries()];
console.log("empresas comparadas:", listas.length);
if (listas.length >= 2) {
  const [, base] = listas[0];
  let iguais = 0;
  for (const [id, s] of listas) {
    const inter = [...s].filter((x) => base.has(x)).length;
    const uni = new Set([...s, ...base]).size;
    const jac = uni ? (inter * 100 / uni) : 0;
    if (jac === 100) iguais++;
    console.log(`  ${String(id).slice(0, 8)} contas=${String(s.size).padStart(4)} sobreposicao c/ 1a empresa=${jac.toFixed(1)}%`);
  }
  console.log("empresas identicas a primeira:", iguais);
}
// quantas empresas compartilham cada codigoCompleto (contas globais valem para todas)
const compartilhado = {};
for (const [, s] of listas) for (const x of s) { const k = x.split("|")[0]; compartilhado[k] = (compartilhado[k] || 0) + 1; }

console.log("\n=== DISPONIBILIDADES: o que existe sob os prefixos de ATIVO CIRCULANTE ===");
// nao assume prefixo: lista TODAS as contas cujo codigoCompleto comeca com 1 e tem nivel 3 <= '113'
const ativo = all.filter((a) => a.codigoCompleto && a.codigoCompleto.startsWith("1"));
console.log("contas com codigoCompleto sob 1 (ATIVO):", ativo.length);
const pref3 = {};
for (const a of ativo) { const k = a.codigoCompleto.slice(0, 3); (pref3[k] ||= []).push(a); }
for (const [k, arr] of Object.entries(pref3).sort()) {
  const sint = all.find((a) => a.codigoCompleto === k);
  console.log(`\n  [${k}] n=${arr.length} ${sint ? `SINTETICA: ${sint.nome}` : "(sem conta sintetica com esse codigo)"}`);
  if (arr.length <= 40) for (const a of arr.sort((x, y) => x.codigoCompleto.localeCompare(y.codigoCompleto)))
    console.log(`      ${a.codigoCompleto.padEnd(11)} red=${String(a.codigo).padEnd(6)} ${a.portalClientId ? "[emp]" : "[glo]"} ${a.nome}`);
  else {
    for (const a of arr.slice(0, 12)) console.log(`      ${a.codigoCompleto.padEnd(11)} red=${String(a.codigo).padEnd(6)} ${a.nome}`);
    console.log(`      ... +${arr.length - 12}`);
  }
}

console.log("\n=== CONTRAPROVA: contas cujo NOME cita caixa/banco, ONDE elas estao no codigoCompleto ===");
const norm = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const suspeitas = all.filter((a) => /\b(caixa|banco|bancos|bco)\b/.test(norm(a.nome)));
console.log("contas com caixa/banco no nome:", suspeitas.length);
const forA = {};
for (const a of suspeitas) { const k = a.codigoCompleto ? a.codigoCompleto.slice(0, 3) : "SEM_COMPLETO"; (forA[k] ||= []).push(a); }
for (const [k, arr] of Object.entries(forA).sort()) {
  console.log(`  prefixo ${k}: ${arr.length}`);
  for (const a of arr.slice(0, 25)) console.log(`      ${String(a.codigoCompleto).padEnd(11)} red=${String(a.codigo).padEnd(6)} tipo=${String(a.tipo).padEnd(9)} ${a.nome}`);
  if (arr.length > 25) console.log(`      ... +${arr.length - 25}`);
}

console.log("\n=== O QUE A LISTA DE TEXTOS RESOLVE HOJE (replica de resolveCaixaAccount) ===");
const HINTS = ["caixa matriz", "caixa geral", "caixa", "banco conta movimento", "banco conta corrente", "banco itau", "banco bradesco", "banco do brasil", "banco santander", "banco caixa", "bancos contas com movimentos", "banco"]
  .map((h) => norm(h).replace(/[\s\-_/]+/g, " ").trim());
const normN = (v) => norm(v).replace(/[\s\-_/]+/g, " ").trim();
function resolve(pid) {
  const raw = all.filter((a) => a.portalClientId === pid || a.portalClientId === null);
  const byCodigo = new Map();
  for (const acc of raw) { const ex = byCodigo.get(acc.codigo); if (!ex || (acc.portalClientId && !ex.portalClientId)) byCodigo.set(acc.codigo, acc); }
  const accounts = [...byCodigo.values()].map((a) => ({ ...a, _norm: normN(a.nome) }));
  for (const h of HINTS) { const f = accounts.find((a) => a._norm === h); if (f) return f; }
  for (const h of HINTS) { const f = accounts.find((a) => a._norm.startsWith(h)); if (f) return f; }
  for (const h of HINTS) { const f = accounts.find((a) => a._norm.includes(h)); if (f) return f; }
  return null;
}
const clientes = await p.portalClient.findMany({ select: { id: true, razao: true }, take: 500 });
let vazio = 0; const resumo = {};
for (const c of clientes) {
  const r = resolve(c.id);
  if (!r) { vazio++; continue; }
  const k = `${r.codigoCompleto || "SEM"}|red=${r.codigo}|${r.nome}`;
  resumo[k] = (resumo[k] || 0) + 1;
}
console.log("clientes:", clientes.length, "| resolveCaixaAccount devolve VAZIO em:", vazio);
for (const [k, n] of Object.entries(resumo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}x  ${k}`);

console.log("\n=== ARMADILHA reduzido x completo (checagem) ===");
let divergentes = 0;
for (const a of all) if (a.codigoCompleto && /^\d+$/.test(a.codigo) && a.codigoCompleto[0] !== a.codigo[0]) divergentes++;
console.log("contas em que 1o digito do reduzido != 1o digito do completo:", divergentes);

await p.$disconnect();
