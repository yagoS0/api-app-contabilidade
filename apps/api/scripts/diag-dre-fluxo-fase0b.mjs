// FASE 0 (parte B) — as perguntas que a parte A abriu. SOMENTE LEITURA: só SELECT.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const q = (sql) => p.$queryRawUnsafe(sql);
const n = (v) => (v == null ? 0 : Number(v));
const money = (v) => n(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const H = (t) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);

H("A. AS 13 CONTAS SEM `codigoCompleto` — quem são, e alguém lança nelas?");
for (const r of await q(`
  SELECT c.tipo, c.natureza, c.codigo, c.nome, (c."portalClientId" IS NULL) AS global, c.status,
    (SELECT COUNT(*)::int FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l."entryId"
      WHERE btrim(l.conta)=c.codigo AND (c."portalClientId" IS NULL OR e."portalClientId"=c."portalClientId")) AS linhas
  FROM chart_of_accounts c WHERE c."codigoCompleto" IS NULL ORDER BY c.tipo, c.codigo`))
  console.log(`  cod=${String(r.codigo).padEnd(6)} tipo=${String(r.tipo).padEnd(11)} ${r.global ? "GLOBAL " : "empresa"} status=${String(r.status).padEnd(12)} linhas=${String(r.linhas).padStart(4)}  ${r.nome}`);

H("B. OS 9 LANÇAMENTOS SEM NENHUMA LINHA");
for (const r of await q(`
  SELECT pc.razao AS empresa, e.competencia, e.data, e.tipo, e.origem, e.status, e.historico, e."createdAt"
  FROM accounting_entries e LEFT JOIN "PortalClient" pc ON pc.id=e."portalClientId"
  WHERE NOT EXISTS (SELECT 1 FROM accounting_entry_lines l WHERE l."entryId"=e.id)
  ORDER BY e."createdAt" DESC`))
  console.log(`  ${String(r.empresa || "?").slice(0,26).padEnd(26)} ${r.competencia} ${new Date(r.data).toISOString().slice(0,10)} tipo=${String(r.tipo).padEnd(9)} origem=${String(r.origem).padEnd(7)} ${String(r.status).padEnd(11)} ${String(r.historico||"").slice(0,40)}`);

H("C. OS 144 LANÇAMENTOS COM D≠C — é o desenho de PERNA ÚNICA ou defeito?");
for (const r of await q(`
  WITH b AS (
    SELECT e.id, e.tipo, e."tipoLinha", e.origem,
      COUNT(*)::int AS pernas,
      COUNT(*) FILTER (WHERE upper(btrim(l.tipo))='D')::int AS nd,
      COUNT(*) FILTER (WHERE upper(btrim(l.tipo))='C')::int AS nc,
      SUM(CASE WHEN upper(btrim(l.tipo))='D' THEN l.valor ELSE 0 END) AS d,
      SUM(CASE WHEN upper(btrim(l.tipo))='C' THEN l.valor ELSE 0 END) AS c
    FROM accounting_entries e JOIN accounting_entry_lines l ON l."entryId"=e.id GROUP BY 1,2,3,4)
  SELECT tipo, COALESCE("tipoLinha",'(null)') AS papel,
    CASE WHEN nd>0 AND nc=0 THEN 'só DÉBITO' WHEN nc>0 AND nd=0 THEN 'só CRÉDITO' ELSE 'tem D e C, mas não fecha' END AS forma,
    COUNT(*)::int AS lancamentos, SUM(abs(d-c)) AS soma_diferenca
  FROM b WHERE abs(d-c) > 0.01 GROUP BY 1,2,3 ORDER BY 4 DESC`))
  console.log(`  tipo=${String(r.tipo).padEnd(10)} papel=${String(r.papel).padEnd(14)} ${String(r.forma).padEnd(26)} n=${String(r.lancamentos).padStart(4)} Σ|D-C|=${money(r.soma_diferenca)}`);
console.log("\n  — e os que TÊM D e C mas não fecham (esses seriam defeito) —");
const g = await q(`
  WITH b AS (
    SELECT e.id, e."portalClientId", e.competencia, e.tipo, e.historico,
      COUNT(*) FILTER (WHERE upper(btrim(l.tipo))='D')::int AS nd,
      COUNT(*) FILTER (WHERE upper(btrim(l.tipo))='C')::int AS nc,
      SUM(CASE WHEN upper(btrim(l.tipo))='D' THEN l.valor ELSE 0 END) AS d,
      SUM(CASE WHEN upper(btrim(l.tipo))='C' THEN l.valor ELSE 0 END) AS c
    FROM accounting_entries e JOIN accounting_entry_lines l ON l."entryId"=e.id GROUP BY 1,2,3,4,5)
  SELECT pc.razao AS empresa, b.competencia, b.tipo, b.nd, b.nc, b.d, b.c, b.historico
  FROM b LEFT JOIN "PortalClient" pc ON pc.id=b."portalClientId"
  WHERE abs(b.d-b.c) > 0.01 AND b.nd>0 AND b.nc>0 ORDER BY abs(b.d-b.c) DESC LIMIT 15`);
if (!g.length) console.log("  (nenhum — todo desbalanço é lançamento de PERNA ÚNICA, por desenho)");
for (const r of g) console.log(`  ${String(r.empresa||"?").slice(0,24).padEnd(24)} ${r.competencia} ${String(r.tipo).padEnd(9)} D=${money(r.d)} (${r.nd}) C=${money(r.c)} (${r.nc})  ${String(r.historico||"").slice(0,30)}`);

H("D. IMPORTAÇÃO DUPLICADA (OFX/Excel) — o mesmo dinheiro contado duas vezes?");
console.table((await q(`SELECT origem, COUNT(*)::int AS lancamentos, COUNT(DISTINCT "loteImportacao")::int AS lotes FROM accounting_entries GROUP BY 1 ORDER BY 2 DESC`))
  .map((r) => ({ origem: r.origem, lancamentos: n(r.lancamentos), lotes: n(r.lotes) })));
const dup = await q(`
  WITH assinatura AS (
    SELECT e."portalClientId" AS pcid, e.data, e.historico, e.origem,
      (SELECT SUM(l.valor) FROM accounting_entry_lines l WHERE l."entryId"=e.id AND upper(btrim(l.tipo))='D') AS valor,
      COUNT(*)::int AS repeticoes, COUNT(DISTINCT e."loteImportacao")::int AS lotes_distintos
    FROM accounting_entries e WHERE e.origem IN ('OFX','PDF') GROUP BY 1,2,3,4,5)
  SELECT pc.razao AS empresa, a.data, a.origem, a.valor, a.repeticoes, a.lotes_distintos, a.historico
  FROM assinatura a LEFT JOIN "PortalClient" pc ON pc.id=a.pcid
  WHERE a.repeticoes > 1 ORDER BY a.repeticoes DESC, a.valor DESC LIMIT 20`);
console.log(`\n  assinaturas (empresa+data+histórico+valor) REPETIDAS em origem OFX/PDF: ${dup.length}`);
for (const r of dup) console.log(`  ${String(r.empresa||"?").slice(0,24).padEnd(24)} ${new Date(r.data).toISOString().slice(0,10)} ${String(r.origem).padEnd(4)} R$ ${money(r.valor).padStart(12)} ×${r.repeticoes} (lotes=${r.lotes_distintos})  ${String(r.historico||"").slice(0,30)}`);

H("E. `Guide.vencimento` — o buraco do SIMPLES");
for (const r of await q(`
  SELECT tipo, status,
    COUNT(*)::int AS guias,
    COUNT(*) FILTER (WHERE vencimento IS NULL)::int AS sem_vencimento,
    COUNT(*) FILTER (WHERE vencimento IS NULL AND extracted->>'vencimento' IS NOT NULL)::int AS sem_col_mas_no_extracted,
    COUNT(*) FILTER (WHERE "parcelamentoId" IS NOT NULL)::int AS de_parcelamento
  FROM "Guide" GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20`))
  console.log(`  tipo=${String(r.tipo).padEnd(9)} status=${String(r.status).padEnd(11)} guias=${String(r.guias).padStart(4)} SEM venc=${String(r.sem_vencimento).padStart(4)} (no extracted=${String(r.sem_col_mas_no_extracted).padStart(3)}) parc=${r.de_parcelamento}`);
console.log("\n  — chaves presentes no `extracted` das guias de SIMPLES sem vencimento (top 15) —");
for (const r of await q(`
  SELECT k AS chave, COUNT(*)::int AS n FROM "Guide" g, LATERAL jsonb_object_keys(g.extracted) k
  WHERE g.tipo='SIMPLES' AND g.vencimento IS NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`))
  console.log(`    ${String(r.chave).padEnd(28)} ${r.n}`);
console.log("\n  — dia do vencimento REAL, só das guias que TÊM (por tipo) —");
for (const r of await q(`
  SELECT tipo, extract(day from (vencimento AT TIME ZONE 'UTC'))::int AS dia, COUNT(*)::int AS n
  FROM "Guide" WHERE vencimento IS NOT NULL GROUP BY 1,2 ORDER BY 1,3 DESC`))
  console.log(`    ${String(r.tipo).padEnd(9)} dia ${String(r.dia).padStart(2)}: ${r.n}`);

H("F. O IMPOSTO JÁ É CALCULADO A PARTIR DAS NOTAS? (`Apuracao` + `ApuracaoSnapshot`)");
console.table(await q(`
  SELECT COUNT(*)::int AS apuracoes, COUNT(DISTINCT "portalClientId")::int AS empresas,
    MIN(competencia) AS primeira, MAX(competencia) AS ultima
  FROM apuracoes`));
console.log("— colunas de `apuracoes` (o que ela guarda de fato) —");
for (const r of await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='apuracoes' ORDER BY ordinal_position`))
  console.log(`    ${String(r.column_name).padEnd(28)} ${r.data_type}`);

H("G. RECEITA: extrato (PGDAS-D) × notas × lançamento contábil — as três batem?");
const g7 = await q(`
  WITH extrato AS (
    SELECT "portalClientId" AS pcid, competencia, "receitaBruta" AS receita, "dasTotal" AS das
    FROM company_monthly_circulars),
  notas AS (
    SELECT "clientId" AS pcid, to_char(COALESCE(competencia,"issueDate"),'YYYY-MM') AS competencia, SUM(total) AS valor, COUNT(*)::int AS qtd
    FROM "PortalInvoice" WHERE papel='EMIT' AND "statusEfetivo"='autorizada' GROUP BY 1,2),
  contabil AS (
    SELECT e."portalClientId" AS pcid, e.competencia,
      SUM(CASE WHEN upper(btrim(l.tipo))='C' THEN l.valor ELSE -l.valor END) AS receita
    FROM accounting_entry_lines l
    JOIN accounting_entries e ON e.id=l."entryId"
    JOIN chart_of_accounts c ON c.codigo=btrim(l.conta) AND (c."portalClientId"=e."portalClientId" OR c."portalClientId" IS NULL)
    WHERE c."codigoCompleto" LIKE '3%' GROUP BY 1,2)
  SELECT pc.razao AS empresa, COALESCE(x.competencia,nt.competencia,ct.competencia) AS competencia,
    x.receita AS extrato, x.das, nt.valor AS notas, nt.qtd, ct.receita AS contabil
  FROM extrato x
  FULL JOIN notas nt ON nt.pcid=x.pcid AND nt.competencia=x.competencia
  FULL JOIN contabil ct ON ct.pcid=COALESCE(x.pcid,nt.pcid) AND ct.competencia=COALESCE(x.competencia,nt.competencia)
  LEFT JOIN "PortalClient" pc ON pc.id=COALESCE(x.pcid,nt.pcid,ct.pcid)
  ORDER BY 1,2`);
let comExtrato = 0, semExtratoComNota = 0, batem = 0, divergem = 0;
console.log("  empresa                        comp     extrato        notas       contábil");
for (const r of g7) {
  if (r.extrato != null) comExtrato++;
  if (r.extrato == null && n(r.notas) > 0) semExtratoComNota++;
  if (r.extrato != null && r.notas != null) (Math.abs(n(r.extrato) - n(r.notas)) <= 0.01 ? batem++ : divergem++);
}
for (const r of g7.slice(0, 40))
  console.log(`  ${String(r.empresa||"?").slice(0,28).padEnd(28)} ${String(r.competencia).padEnd(8)} ${(r.extrato==null?"—":money(r.extrato)).padStart(12)} ${(r.notas==null?"—":money(r.notas)).padStart(12)} ${(r.contabil==null?"—":money(r.contabil)).padStart(14)}`);
console.log(`  ... (${g7.length} linhas ao todo)`);
console.log(`  células com extrato: ${comExtrato} · SEM extrato mas COM nota: ${semExtratoComNota} · extrato==notas: ${batem} · divergem: ${divergem}`);

H("H. DESPESA RECORRENTE — o material que a 'inteligência' teria hoje");
const g8 = await q(`
  WITH mov AS (
    SELECT e."portalClientId" AS pcid, btrim(l.conta) AS conta, e.competencia,
           SUM(CASE WHEN upper(btrim(l.tipo))='D' THEN l.valor ELSE 0 END) AS deb
    FROM accounting_entry_lines l JOIN accounting_entries e ON e.id=l."entryId"
    WHERE e.tipo <> 'BAIXA' AND btrim(l.conta) <> ''
    GROUP BY 1,2,3),
  plano AS (
    SELECT m.*, COALESCE(ce.nome,cg.nome) AS nome, COALESCE(ce."codigoCompleto",cg."codigoCompleto") AS cc
    FROM mov m
    LEFT JOIN chart_of_accounts ce ON ce."portalClientId"=m.pcid AND ce.codigo=m.conta
    LEFT JOIN chart_of_accounts cg ON cg."portalClientId" IS NULL AND cg.codigo=m.conta)
  SELECT pc.razao AS empresa, pl.conta, pl.nome,
    COUNT(*)::int AS meses, MIN(pl.competencia) AS ini, MAX(pl.competencia) AS fim,
    round(avg(pl.deb),2) AS media, round(COALESCE(stddev_pop(pl.deb),0),2) AS desvio,
    round(COALESCE(stddev_pop(pl.deb),0) / NULLIF(avg(pl.deb),0), 3) AS cv
  FROM plano pl LEFT JOIN "PortalClient" pc ON pc.id=pl.pcid
  WHERE pl.cc IS NOT NULL AND left(pl.cc,1) IN ('4','5') AND pl.deb > 0
  GROUP BY 1,2,3 HAVING COUNT(*) >= 2 ORDER BY 4 DESC, 8 ASC LIMIT 30`);
console.log("  empresa                     conta  meses  janela             média        CV   nome");
for (const r of g8) console.log(`  ${String(r.empresa||"?").slice(0,26).padEnd(26)} ${String(r.conta).padEnd(6)} ${String(r.meses).padStart(5)}  ${r.ini}..${r.fim}  ${money(r.media).padStart(12)} ${String(r.cv ?? "-").padStart(7)}   ${String(r.nome||"").slice(0,26)}`);
console.log(`\n  pares empresa×conta de DESPESA com >=2 meses: ${g8.length} (listados os 30 primeiros)`);

H("I. RECEITA/DESPESA NO PLANO — quantas contas ANALÍTICAS existem em cada ramo (a árvore do DRE)");
for (const r of await q(`
  SELECT left("codigoCompleto",1) AS grupo, length("codigoCompleto") AS niveis, COUNT(*)::int AS contas,
    COUNT(*) FILTER (WHERE analitica IS TRUE)::int AS analiticas
  FROM chart_of_accounts WHERE "codigoCompleto" IS NOT NULL AND left("codigoCompleto",1) IN ('3','4','5')
  GROUP BY 1,2 ORDER BY 1,2`))
  console.log(`  grupo ${r.grupo}  |codigoCompleto|=${String(r.niveis).padStart(2)}  contas=${String(r.contas).padStart(4)} analíticas=${r.analiticas}`);
console.log("\n— a árvore de DESPESAS (grupo 4), os 2 primeiros níveis, escopo GLOBAL —");
for (const r of await q(`
  SELECT "codigoCompleto" AS cc, codigo, nome, analitica
  FROM chart_of_accounts WHERE "portalClientId" IS NULL AND "codigoCompleto" LIKE '4%' AND length("codigoCompleto") <= 5
  ORDER BY "codigoCompleto"`))
  console.log(`  ${String(r.cc).padEnd(8)} red=${String(r.codigo).padEnd(5)} ${r.analitica === false ? "SINT" : "anal"}  ${r.nome}`);
console.log("\n— a árvore de RECEITAS (grupo 3), níveis rasos, escopo GLOBAL —");
for (const r of await q(`
  SELECT "codigoCompleto" AS cc, codigo, nome, analitica
  FROM chart_of_accounts WHERE "portalClientId" IS NULL AND "codigoCompleto" LIKE '3%' AND length("codigoCompleto") <= 5
  ORDER BY "codigoCompleto"`))
  console.log(`  ${String(r.cc).padEnd(8)} red=${String(r.codigo).padEnd(5)} ${r.analitica === false ? "SINT" : "anal"}  ${r.nome}`);

await p.$disconnect();
console.log("\n[fim] SOMENTE LEITURA.");
