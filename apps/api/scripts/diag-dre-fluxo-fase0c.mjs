// FASE 0 (parte C) — os dois buracos que a parte B abriu. SOMENTE LEITURA.
//   1) o vencimento do DAS está no `rawPayload` e não está sendo lido? ou nunca veio?
//   2) as 13 competências em que EXTRATO e NOTAS discordam — e as 40 sem extrato com nota
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const q = (sql) => p.$queryRawUnsafe(sql);
const n = (v) => (v == null ? 0 : Number(v));
const money = (v) => n(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const H = (t) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);

H("1. O VENCIMENTO DO DAS ESTÁ NO PAYLOAD DO SERPRO?");
const guias = await p.guide.findMany({
  where: { tipo: "SIMPLES", status: "PROCESSED", vencimento: null },
  select: { id: true, competencia: true, valor: true, extracted: true, portalClientId: true },
});
console.log(`  guias de SIMPLES PROCESSED sem \`vencimento\`: ${guias.length}`);

// varre o rawPayload atrás de QUALQUER valor com cara de data ou de chave com "venc"
function achatar(obj, prefixo = "", saida = []) {
  if (obj == null) return saida;
  if (typeof obj === "string") {
    // dados vem como string JSON escapada no envelope Integra Contador
    const t = obj.trim();
    if (t.startsWith("{") || t.startsWith("[")) {
      try { return achatar(JSON.parse(t), prefixo, saida); } catch { /* texto mesmo */ }
    }
    saida.push([prefixo, obj]);
    return saida;
  }
  if (typeof obj !== "object") { saida.push([prefixo, obj]); return saida; }
  for (const [k, v] of Object.entries(obj)) achatar(v, prefixo ? `${prefixo}.${k}` : k, saida);
  return saida;
}
const RE_DATA = /^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}|\d{8})$/;
const chavesVenc = new Map();
const chavesData = new Map();
let comAlgumaData = 0, semPayload = 0;
for (const g of guias) {
  const raw = g.extracted?.rawPayload;
  if (!raw) { semPayload++; continue; }
  const pares = achatar(raw);
  let achouData = false;
  for (const [k, v] of pares) {
    const kl = k.toLowerCase();
    if (/venc/.test(kl)) chavesVenc.set(k, (chavesVenc.get(k) || 0) + 1);
    if (typeof v === "string" && RE_DATA.test(v.trim())) {
      chavesData.set(k, (chavesData.get(k) || 0) + 1);
      achouData = true;
    }
    if (typeof v === "number" && String(v).length === 8 && /^20\d{6}$/.test(String(v))) {
      chavesData.set(`${k} (num)`, (chavesData.get(`${k} (num)`) || 0) + 1);
      achouData = true;
    }
  }
  if (achouData) comAlgumaData++;
}
console.log(`  sem \`rawPayload\` gravado: ${semPayload}`);
console.log(`  com pelo menos UM valor com cara de data no payload: ${comAlgumaData}`);
console.log("\n  — chaves cujo NOME contém 'venc' (é o que `extractDateValue` procura) —");
if (!chavesVenc.size) console.log("    (nenhuma — o payload do SERPRO NÃO traz chave de vencimento)");
for (const [k, c] of [...chavesVenc].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`    ${k.padEnd(60)} ${c}`);
console.log("\n  — TODAS as chaves com valor em forma de DATA (top 25) —");
for (const [k, c] of [...chavesData].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`    ${k.padEnd(60)} ${c}`);

console.log("\n  — amostra: as chaves de UMA guia inteira (a mais recente) —");
if (guias.length) {
  const amostra = achatar(guias[0].extracted?.rawPayload || {});
  for (const [k, v] of amostra.slice(0, 60)) {
    const s = String(v);
    console.log(`    ${k.padEnd(50)} = ${s.length > 60 ? s.slice(0, 60) + "…" : s}`);
  }
  console.log(`    (${amostra.length} campos ao todo)`);
}

console.log("\n  — e as 16 que TÊM vencimento: de onde veio? —");
const comVenc = await p.guide.findMany({
  where: { tipo: "SIMPLES", vencimento: { not: null } },
  select: { competencia: true, vencimento: true, extracted: true }, take: 25,
});
for (const g of comVenc) {
  const pares = achatar(g.extracted?.rawPayload || {});
  const cand = pares.filter(([k]) => /venc/i.test(k)).map(([k, v]) => `${k}=${v}`);
  console.log(`    ${g.competencia}  venc=${g.vencimento.toISOString().slice(0, 10)}  chaves 'venc' no payload: ${cand.length ? cand.join(" · ") : "(nenhuma — veio de upload/manual?)"}`);
}

H("2. EXTRATO × NOTAS — onde discordam, e onde o extrato NÃO EXISTE");
const g2 = await q(`
  WITH extrato AS (
    SELECT "portalClientId" AS pcid, competencia, "receitaBruta" AS receita, "dasTotal" AS das,
           "serproSyncStatus" AS sync, "semFaturamento" AS sem_fat, "receitaStatus" AS rstatus
    FROM company_monthly_circulars),
  notas AS (
    SELECT "clientId" AS pcid, to_char(COALESCE(competencia,"issueDate"),'YYYY-MM') AS competencia,
           SUM(total) AS valor, COUNT(*)::int AS qtd
    FROM "PortalInvoice" WHERE papel='EMIT' AND "statusEfetivo"='autorizada' GROUP BY 1,2)
  SELECT pc.razao AS empresa, COALESCE(x.competencia, nt.competencia) AS competencia,
         x.receita AS extrato, x.das, x.sync, x.sem_fat, x.rstatus, nt.valor AS notas, nt.qtd
  FROM extrato x
  FULL JOIN notas nt ON nt.pcid = x.pcid AND nt.competencia = x.competencia
  LEFT JOIN "PortalClient" pc ON pc.id = COALESCE(x.pcid, nt.pcid)
  WHERE (x.receita IS NULL AND nt.valor IS NOT NULL)
     OR (x.receita IS NOT NULL AND nt.valor IS NOT NULL AND abs(x.receita - nt.valor) > 0.01)
  ORDER BY 1,2`);
console.log("  empresa                       comp      extrato        notas   qtd  sync         semFat");
for (const r of g2)
  console.log(`  ${String(r.empresa || "?").slice(0,28).padEnd(28)} ${String(r.competencia).padEnd(8)} ${(r.extrato==null?"SEM EXTRATO":money(r.extrato)).padStart(12)} ${money(r.notas).padStart(12)} ${String(r.qtd).padStart(4)}  ${String(r.sync||"-").padEnd(11)} ${String(r.sem_fat ?? "-")}`);
console.log(`  TOTAL: ${g2.length} células`);

console.log("\n  — o caso EXTRATO = 0,00 COM notas autorizadas (o pior dos dois: parece receita zero) —");
const g3 = await q(`
  WITH notas AS (
    SELECT "clientId" AS pcid, to_char(COALESCE(competencia,"issueDate"),'YYYY-MM') AS competencia,
           SUM(total) AS valor, COUNT(*)::int AS qtd
    FROM "PortalInvoice" WHERE papel='EMIT' AND "statusEfetivo"='autorizada' GROUP BY 1,2)
  SELECT pc.razao AS empresa, c.competencia, c."receitaBruta" AS extrato, c."dasTotal" AS das,
         c."serproSyncStatus" AS sync, c."pgdasNumeroDeclaracao" AS decl, nt.valor AS notas, nt.qtd
  FROM company_monthly_circulars c
  JOIN notas nt ON nt.pcid = c."portalClientId" AND nt.competencia = c.competencia
  LEFT JOIN "PortalClient" pc ON pc.id = c."portalClientId"
  WHERE c."receitaBruta" = 0 AND nt.valor > 0 ORDER BY 1,2`);
for (const r of g3)
  console.log(`  ${String(r.empresa||"?").slice(0,26).padEnd(26)} ${r.competencia} extrato=0,00 das=${money(r.das)} notas=${money(r.notas)} (${r.qtd}) sync=${r.sync} decl=${r.decl || "-"}`);
console.log(`  TOTAL: ${g3.length}`);

H("3. O QUE JÁ EXISTE DE 'ÚLTIMO MÊS' PARA PROJETAR O MÊS CORRENTE");
console.table((await q(`
  SELECT COUNT(*)::int AS pares_com_extrato,
    COUNT(*) FILTER (WHERE "dasTotal" IS NOT NULL AND "receitaBruta" IS NOT NULL AND "receitaBruta" > 0)::int AS com_receita_e_das,
    round(avg(CASE WHEN "receitaBruta" > 0 AND "dasTotal" IS NOT NULL THEN "dasTotal"/"receitaBruta" END)::numeric, 4) AS carga_media,
    round(min(CASE WHEN "receitaBruta" > 0 AND "dasTotal" IS NOT NULL THEN "dasTotal"/"receitaBruta" END)::numeric, 4) AS carga_min,
    round(max(CASE WHEN "receitaBruta" > 0 AND "dasTotal" IS NOT NULL THEN "dasTotal"/"receitaBruta" END)::numeric, 4) AS carga_max
  FROM company_monthly_circulars WHERE "receitaBruta" IS NOT NULL`)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, n(v)]))));
console.log("— quantas empresas têm DOIS meses seguidos de extrato (mínimo para projetar) —");
console.table(await q(`
  WITH s AS (
    SELECT "portalClientId" AS pcid, competencia,
      lag(competencia) OVER (PARTITION BY "portalClientId" ORDER BY competencia) AS anterior
    FROM company_monthly_circulars WHERE "receitaBruta" IS NOT NULL AND "dasTotal" IS NOT NULL)
  SELECT COUNT(DISTINCT pcid)::int AS empresas_com_2_meses_seguidos FROM s WHERE anterior IS NOT NULL`));

await p.$disconnect();
console.log("\n[fim] SOMENTE LEITURA.");
