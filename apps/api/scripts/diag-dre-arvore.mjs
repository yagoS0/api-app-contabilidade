// SOMENTE LEITURA — a ÁRVORE do DRE gerencial montada a partir do plano de contas real,
// para provar (ou derrubar) que `codigoCompleto` sustenta os "subtipos" que o dono pediu.
//
// Nada aqui vira código de produção: é medição. A hierarquia sai de `codigoCompleto` (NUNCA do
// reduzido — 41 contas apontam para grupos diferentes nas duas colunas).
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const money = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const contas = await p.chartOfAccount.findMany({
  select: { portalClientId: true, codigo: true, nome: true, codigoCompleto: true, analitica: true, tipo: true },
});
// EMPRESA vence GLOBAL — a mesma resolução de `resolverPlanoPorCodigo`.
function planoDa(pcid) {
  const m = new Map();
  for (const c of contas) {
    const cod = String(c.codigo || "").trim();
    if (!cod) continue;
    const at = m.get(cod);
    const daEmpresa = c.portalClientId === pcid;
    if (c.portalClientId && !daEmpresa) continue;
    if (!at || (daEmpresa && !at.portalClientId)) m.set(cod, c);
  }
  return m;
}

console.log("=== 1. NÍVEIS: onde um nível NÃO acrescenta nada (filho único de mesmo nome) ===");
const globais = contas.filter((c) => !c.portalClientId && c.codigoCompleto);
const porCC = new Map(globais.map((c) => [c.codigoCompleto, c]));
let redundantes = 0;
for (const c of globais) {
  const filhos = globais.filter((f) => f.codigoCompleto.length > c.codigoCompleto.length && f.codigoCompleto.startsWith(c.codigoCompleto));
  if (!filhos.length) continue;
  const menor = Math.min(...filhos.map((f) => f.codigoCompleto.length));
  const diretos = filhos.filter((f) => f.codigoCompleto.length === menor);
  if (diretos.length === 1 && diretos[0].nome.trim().toUpperCase() === c.nome.trim().toUpperCase()) {
    redundantes++;
    console.log(`  ${c.codigoCompleto.padEnd(6)} "${c.nome}"  →  filho ÚNICO ${diretos[0].codigoCompleto.padEnd(6)} com o MESMO nome`);
  }
}
console.log(`  total: ${redundantes} níveis redundantes no plano GLOBAL\n`);

console.log("=== 2. ONDE O IMPOSTO É LANÇADO HOJE (a conta que a provisão do DAS usa) ===");
const linhasImposto = await p.$queryRawUnsafe(`
  SELECT e."eventType", e.subtipo, btrim(l.conta) AS conta, upper(btrim(l.tipo)) AS dc,
         COUNT(*)::int AS linhas, SUM(l.valor) AS total
  FROM accounting_entry_lines l JOIN accounting_entries e ON e.id = l."entryId"
  WHERE e."eventType" IS NOT NULL OR e.subtipo IS NOT NULL
  GROUP BY 1,2,3,4 ORDER BY 5 DESC LIMIT 25`);
for (const r of linhasImposto) {
  const c = porCC.size ? contas.find((x) => x.codigo === r.conta && !x.portalClientId) : null;
  console.log(`  evento=${String(r.eventType || "-").padEnd(22)} sub=${String(r.subtipo || "-").padEnd(9)} conta=${String(r.conta || "(vazia)").padEnd(8)} ${r.dc} n=${String(r.linhas).padStart(4)} R$ ${money(r.total).padStart(13)}  cc=${String(c?.codigoCompleto || "?").padEnd(10)} ${String(c?.nome || "").slice(0, 30)}`);
}

console.log("\n=== 3. O DRE GERENCIAL MONTADO, para as 3 empresas com mais movimento ===");
const topEmpresas = await p.$queryRawUnsafe(`
  SELECT e."portalClientId" AS pcid, pc.razao, COUNT(*)::int AS linhas
  FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l."entryId"
  LEFT JOIN "PortalClient" pc ON pc.id = e."portalClientId"
  GROUP BY 1,2 ORDER BY 3 DESC LIMIT 3`);

for (const emp of topEmpresas) {
  const plano = planoDa(emp.pcid);
  const linhas = await p.$queryRawUnsafe(`
    SELECT btrim(l.conta) AS conta, upper(btrim(l.tipo)) AS dc, SUM(l.valor) AS v, COUNT(*)::int AS n, e.competencia
    FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l."entryId"
    WHERE e."portalClientId" = '${emp.pcid}'
    GROUP BY 1,2,5`);
  // saldo de resultado por conta: RECEITA soma C-D; DESPESA soma D-C
  const saldo = new Map(); const naoClassificado = { valor: 0, linhas: 0, casos: new Map() };
  for (const l of linhas) {
    const cod = String(l.conta || "").trim();
    const c = cod ? plano.get(cod) : null;
    const cc = c?.codigoCompleto;
    if (!cc || !"345".includes(cc[0])) {
      if (!cod || !c || !cc) {
        // só o que é de RESULTADO deveria entrar num DRE; conta patrimonial resolvida sai daqui
        if (!cod) { naoClassificado.valor += Number(l.v); naoClassificado.linhas += l.n; naoClassificado.casos.set("conta EM BRANCO", (naoClassificado.casos.get("conta EM BRANCO") || 0) + Number(l.v)); }
        else if (!c) { naoClassificado.valor += Number(l.v); naoClassificado.linhas += l.n; naoClassificado.casos.set(`conta ${cod} FORA DO PLANO`, (naoClassificado.casos.get(`conta ${cod} FORA DO PLANO`) || 0) + Number(l.v)); }
        else if (!cc) { naoClassificado.valor += Number(l.v); naoClassificado.linhas += l.n; naoClassificado.casos.set(`conta ${cod} SEM codigoCompleto`, (naoClassificado.casos.get(`conta ${cod} SEM codigoCompleto`) || 0) + Number(l.v)); }
      }
      continue;
    }
    const sinal = cc[0] === "3" ? (l.dc === "C" ? 1 : -1) : (l.dc === "D" ? 1 : -1);
    saldo.set(cc, (saldo.get(cc) || 0) + sinal * Number(l.v));
  }
  // agrega para cima: todo prefixo de um cc analítico recebe o valor
  const agregado = new Map();
  for (const [cc, v] of saldo) {
    for (const outro of new Set([...contas].filter((x) => x.codigoCompleto && cc.startsWith(x.codigoCompleto)).map((x) => x.codigoCompleto)))
      agregado.set(outro, (agregado.get(outro) || 0) + v);
  }
  const nomeDe = (cc) => (contas.find((x) => x.codigoCompleto === cc && (!x.portalClientId || x.portalClientId === emp.pcid))?.nome) || "?";
  console.log(`\n  ── ${emp.razao} (${emp.linhas} linhas) ──`);
  const ccs = [...agregado.keys()].filter((cc) => "345".includes(cc[0])).sort();
  for (const cc of ccs) {
    const v = agregado.get(cc);
    if (Math.abs(v) < 0.005) continue;
    console.log(`    ${"  ".repeat(Math.max(0, [1,2,3,5,9].indexOf(cc.length)))}${cc.padEnd(10)} ${money(v).padStart(14)}  ${nomeDe(cc)}`);
  }
  if (naoClassificado.linhas) {
    console.log(`    ⚠ NÃO CLASSIFICADO  ${money(naoClassificado.valor).padStart(14)}  (${naoClassificado.linhas} linhas)`);
    for (const [k, v] of naoClassificado.casos) console.log(`         · ${k.padEnd(34)} ${money(v).padStart(14)}`);
  } else console.log("    (nada não classificado)");
}

await p.$disconnect();
console.log("\n[fim] SOMENTE LEITURA.");
