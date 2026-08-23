// FASE 0 — MEDIR (DRE gerencial + fluxo de caixa). SOMENTE LEITURA: só SELECT, nenhuma DDL/DML.
//
// Responde, com número, as 6 perguntas da Fase 0:
//   1) contas usadas em lançamentos com/sem `codigoCompleto`, e quantas ficariam SEM GRUPO no DRE
//   2) contas de resultado que podem ter caído em DESPESA por DESCARTE da importação
//   3) lançamentos de BAIXA com data == dia da digitação (createdAt)
//   4) Σ débitos == Σ créditos por competência (com recorte de competência FECHADA)
//   5) empresas com movimento em conta de caixa/banco, e desde quando
//   6) cobertura do extrato PGDAS-D em CompanyMonthlyCircular
//   7) (bônus) ApuracaoSnapshot/CalculoFiscal já calculam imposto a partir das notas?
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const q = (sql) => p.$queryRawUnsafe(sql);
const n = (v) => (v == null ? 0 : Number(v));
const money = (v) => n(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const H = (t) => console.log(`\n${"=".repeat(78)}\n${t}\n${"=".repeat(78)}`);

// ─────────────────────────────────────────────────────────────────────────────
H("0. ESCALA");
const escala = await q(`
  SELECT
    (SELECT COUNT(*) FROM "PortalClient")             AS empresas,
    (SELECT COUNT(*) FROM chart_of_accounts)          AS contas,
    (SELECT COUNT(*) FROM chart_of_accounts WHERE "portalClientId" IS NULL) AS contas_globais,
    (SELECT COUNT(*) FROM chart_of_accounts WHERE "codigoCompleto" IS NOT NULL) AS contas_com_completo,
    (SELECT COUNT(*) FROM accounting_entries)         AS lancamentos,
    (SELECT COUNT(*) FROM accounting_entry_lines)     AS linhas,
    (SELECT COUNT(*) FROM company_monthly_circulars)  AS circulares,
    (SELECT COUNT(*) FROM apuracao_snapshots)         AS snapshots,
    (SELECT COUNT(*) FROM "Guide")                     AS guias
`);
console.table(escala.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, n(v)]))));

// ─────────────────────────────────────────────────────────────────────────────
// A resolução conta→plano replica `resolverPlanoPorCodigo`: EMPRESA vence GLOBAL, casando pelo
// código REDUZIDO (é o que `AccountingEntryLine.conta` guarda, como texto e sem FK).
const CTE_RESOLVE = `
WITH usadas AS (
  SELECT e."portalClientId" AS pcid, btrim(l.conta) AS conta,
         COUNT(*)::int AS linhas, SUM(l.valor) AS soma
  FROM accounting_entry_lines l
  JOIN accounting_entries e ON e.id = l."entryId"
  GROUP BY 1, 2
),
resolvidas AS (
  SELECT u.pcid, u.conta, u.linhas, u.soma,
         COALESCE(ce.id, cg.id)                             AS conta_id,
         COALESCE(ce."codigoCompleto", cg."codigoCompleto")  AS cc,
         COALESCE(ce.tipo, cg.tipo)                          AS tipo,
         COALESCE(ce.nome, cg.nome)                          AS nome
  FROM usadas u
  LEFT JOIN chart_of_accounts ce ON ce."portalClientId" = u.pcid AND ce.codigo = u.conta
  LEFT JOIN chart_of_accounts cg ON cg."portalClientId" IS NULL   AND cg.codigo = u.conta
),
classificadas AS (
  SELECT r.*,
    CASE
      WHEN r.conta = '' OR r.conta IS NULL           THEN 'EM_BRANCO'
      WHEN r.conta_id IS NULL                        THEN 'FORA_DO_PLANO'
      WHEN r.cc IS NULL                              THEN 'SEM_CODIGO_COMPLETO'
      WHEN left(r.cc,1) NOT IN ('1','2','3','4','5') THEN 'GRUPO_DESCONHECIDO'
      ELSE 'OK'
    END AS situacao,
    CASE WHEN r.cc IS NOT NULL AND left(r.cc,1) IN ('1','2','3','4','5')
         THEN left(r.cc,1) ELSE NULL END AS grupo
  FROM resolvidas r
)`;

H("1. CONTAS USADAS EM LANÇAMENTOS — tem `codigoCompleto`? ficaria SEM GRUPO no DRE?");
const g1 = await q(`${CTE_RESOLVE}
  SELECT situacao, COUNT(*)::int AS contas_distintas, SUM(linhas)::int AS linhas, SUM(soma) AS valor
  FROM classificadas GROUP BY 1 ORDER BY 3 DESC`);
console.log("— por SITUAÇÃO (par empresa×conta; uma conta usada por 3 empresas conta 3x) —");
for (const r of g1) console.log(`  ${String(r.situacao).padEnd(22)} pares=${String(r.contas_distintas).padStart(5)}  linhas=${String(r.linhas).padStart(7)}  R$ ${money(r.valor).padStart(16)}`);

const g1grupo = await q(`${CTE_RESOLVE}
  SELECT COALESCE(grupo,'(sem grupo)') AS grupo, COUNT(*)::int AS pares, SUM(linhas)::int AS linhas, SUM(soma) AS valor
  FROM classificadas GROUP BY 1 ORDER BY 1`);
console.log("\n— por GRUPO de topo (1º dígito do codigoCompleto) —");
const NOME_GRUPO = { 1: "ATIVO", 2: "PASSIVO", 3: "RECEITAS", 4: "DESPESAS", 5: "(-) IRPJ/CSLL" };
for (const r of g1grupo) console.log(`  ${String(r.grupo).padEnd(12)} ${String(NOME_GRUPO[r.grupo] || "").padEnd(14)} pares=${String(r.pares).padStart(5)}  linhas=${String(r.linhas).padStart(7)}  R$ ${money(r.valor).padStart(16)}`);

const g1emp = await q(`${CTE_RESOLVE}
  SELECT c.pcid, pc.razao AS empresa,
    COUNT(*)::int AS contas_usadas,
    COUNT(*) FILTER (WHERE situacao = 'OK')::int AS com_grupo,
    COUNT(*) FILTER (WHERE situacao <> 'OK')::int AS sem_grupo,
    SUM(linhas) FILTER (WHERE situacao <> 'OK')::int AS linhas_sem_grupo,
    SUM(soma)   FILTER (WHERE situacao <> 'OK')     AS valor_sem_grupo,
    SUM(soma)                                       AS valor_total
  FROM classificadas c LEFT JOIN "PortalClient" pc ON pc.id = c.pcid
  GROUP BY 1,2 ORDER BY 5 DESC, 3 DESC`);
console.log(`\n— POR EMPRESA (${g1emp.length} empresas com lançamento) —`);
console.log("  empresa                                   usadas  c/grupo  s/grupo   linhas s/g   R$ s/grupo");
for (const r of g1emp) {
  console.log(`  ${String(r.empresa || r.pcid).slice(0, 40).padEnd(40)} ${String(r.contas_usadas).padStart(6)} ${String(r.com_grupo).padStart(8)} ${String(r.sem_grupo).padStart(8)} ${String(n(r.linhas_sem_grupo)).padStart(12)}   ${money(r.valor_sem_grupo).padStart(14)}`);
}
const tot1 = g1emp.reduce((a, r) => ({
  usadas: a.usadas + n(r.contas_usadas), ok: a.ok + n(r.com_grupo), sg: a.sg + n(r.sem_grupo),
  linhas: a.linhas + n(r.linhas_sem_grupo), valor: a.valor + n(r.valor_sem_grupo),
}), { usadas: 0, ok: 0, sg: 0, linhas: 0, valor: 0 });
console.log(`  TOTAL: ${tot1.usadas} pares empresa×conta · ${tot1.ok} com grupo · ${tot1.sg} SEM grupo (${tot1.linhas} linhas, R$ ${money(tot1.valor)})`);

console.log("\n— as 25 contas SEM GRUPO com mais dinheiro —");
const g1det = await q(`${CTE_RESOLVE}
  SELECT c.pcid, pc.razao AS empresa, c.conta, c.nome, c.tipo, c.cc, c.situacao, c.linhas, c.soma
  FROM classificadas c LEFT JOIN "PortalClient" pc ON pc.id = c.pcid
  WHERE c.situacao <> 'OK' ORDER BY c.soma DESC NULLS LAST LIMIT 25`);
for (const r of g1det) console.log(`  ${String(r.empresa || "?").slice(0, 22).padEnd(22)} conta=${String(r.conta === "" ? "(vazia)" : r.conta).padEnd(9)} ${String(r.situacao).padEnd(20)} tipo=${String(r.tipo || "-").padEnd(11)} cc=${String(r.cc || "-").padEnd(11)} n=${String(r.linhas).padStart(5)} R$ ${money(r.soma).padStart(14)}  ${String(r.nome || "").slice(0, 30)}`);

// ─────────────────────────────────────────────────────────────────────────────
H("2. `DESPESA` POR DESCARTE DA IMPORTAÇÃO");
console.log("Regra do import (`chartOfAccountsImport.tipoFromCodigoPadrao`): 1=ATIVO 2=PASSIVO(24=PATRIMONIO)");
console.log("3=RECEITA 4|5=DESPESA — e TUDO O QUE SOBRA cai no `return \"DESPESA\"` final (descarte).\n");
const g2 = await q(`
  SELECT
    CASE
      WHEN "codigoCompleto" IS NULL THEN 'sem codigoCompleto (indeterminavel)'
      WHEN left("codigoCompleto",1) IN ('4','5') THEN 'coerente (cc 4 ou 5)'
      ELSE 'INCOERENTE: cc=' || left("codigoCompleto",1)
    END AS caso,
    COUNT(*)::int AS contas,
    COUNT(*) FILTER (WHERE "portalClientId" IS NULL)::int AS globais
  FROM chart_of_accounts WHERE tipo = 'DESPESA' GROUP BY 1 ORDER BY 2 DESC`);
for (const r of g2) console.log(`  ${String(r.caso).padEnd(40)} contas=${String(r.contas).padStart(5)} (globais=${r.globais})`);

console.log("\n— dessas, QUANTAS SÃO USADAS em lançamento (é o que muda um DRE) —");
const g2u = await q(`${CTE_RESOLVE}
  SELECT
    CASE WHEN cc IS NULL THEN 'DESPESA sem codigoCompleto'
         WHEN left(cc,1) IN ('4','5') THEN 'DESPESA coerente'
         ELSE 'DESPESA INCOERENTE (cc=' || left(cc,1) || ')' END AS caso,
    COUNT(*)::int AS pares, SUM(linhas)::int AS linhas, SUM(soma) AS valor
  FROM classificadas WHERE tipo = 'DESPESA' GROUP BY 1 ORDER BY 3 DESC`);
for (const r of g2u) console.log(`  ${String(r.caso).padEnd(40)} pares=${String(r.pares).padStart(5)} linhas=${String(r.linhas).padStart(7)} R$ ${money(r.valor).padStart(16)}`);

console.log("\n— o inverso: conta com cc de RESULTADO (3/4/5) e `tipo` que não bate —");
const g2i = await q(`
  SELECT left("codigoCompleto",1) AS cc1, tipo, COUNT(*)::int AS contas
  FROM chart_of_accounts
  WHERE "codigoCompleto" IS NOT NULL AND left("codigoCompleto",1) IN ('3','4','5')
  GROUP BY 1,2 ORDER BY 1,3 DESC`);
for (const r of g2i) console.log(`  cc começa com ${r.cc1}  tipo=${String(r.tipo).padEnd(11)} contas=${r.contas}`);

console.log("\n— TODOS os grupos de topo do plano, por 1º dígito do codigoCompleto —");
const g2t = await q(`
  SELECT COALESCE(left("codigoCompleto",1),'(null)') AS d, COUNT(*)::int AS contas,
         COUNT(*) FILTER (WHERE analitica IS TRUE)::int AS analiticas,
         COUNT(*) FILTER (WHERE analitica IS FALSE)::int AS sinteticas,
         COUNT(*) FILTER (WHERE analitica IS NULL)::int AS indefinidas
  FROM chart_of_accounts GROUP BY 1 ORDER BY 1`);
for (const r of g2t) console.log(`  ${String(r.d).padEnd(8)} contas=${String(r.contas).padStart(5)}  analiticas=${String(r.analiticas).padStart(4)} sinteticas=${String(r.sinteticas).padStart(4)} indefinidas=${String(r.indefinidas).padStart(4)}`);

// ─────────────────────────────────────────────────────────────────────────────
H("3. BAIXA: a data do lançamento é a DATA DO PAGAMENTO ou o DIA DA DIGITAÇÃO?");
const g3 = await q(`
  SELECT tipo, COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE (data AT TIME ZONE 'UTC')::date = ("createdAt" AT TIME ZONE 'UTC')::date)::int AS data_igual_digitacao,
    COUNT(*) FILTER (WHERE (data AT TIME ZONE 'UTC')::date > ("createdAt" AT TIME ZONE 'UTC')::date)::int AS data_futura,
    COUNT(*) FILTER (WHERE (data AT TIME ZONE 'UTC')::date < ("createdAt" AT TIME ZONE 'UTC')::date)::int AS data_passada
  FROM accounting_entries GROUP BY 1 ORDER BY 2 DESC`);
console.log("— por TIPO de lançamento —");
console.log("  tipo         total   data==digitação   data>dig   data<dig    %igual");
for (const r of g3) {
  const pct = n(r.total) ? (n(r.data_igual_digitacao) * 100 / n(r.total)).toFixed(1) : "0.0";
  console.log(`  ${String(r.tipo).padEnd(11)} ${String(r.total).padStart(6)} ${String(r.data_igual_digitacao).padStart(17)} ${String(r.data_futura).padStart(10)} ${String(r.data_passada).padStart(10)} ${pct.padStart(8)}%`);
}

console.log("\n— SÓ BAIXA: defasagem (dias entre a data do lançamento e o dia da digitação) —");
const g3d = await q(`
  SELECT (("createdAt" AT TIME ZONE 'UTC')::date - (data AT TIME ZONE 'UTC')::date) AS dias, COUNT(*)::int AS n
  FROM accounting_entries WHERE tipo = 'BAIXA' GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
const totBaixa = g3d.reduce((a, r) => a + n(r.n), 0);
for (const r of g3d) console.log(`  ${String(r.dias).padStart(5)} dia(s)  ${String(r.n).padStart(6)}  (${(n(r.n) * 100 / (totBaixa || 1)).toFixed(1)}%)`);

console.log("\n— SÓ BAIXA: a defasagem CRUZA O MÊS? (competência do lançamento vs mês da digitação) —");
const g3c = await q(`
  SELECT origem,
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE competencia = to_char(("createdAt" AT TIME ZONE 'UTC'),'YYYY-MM'))::int AS mesmo_mes,
    COUNT(*) FILTER (WHERE competencia <> to_char(("createdAt" AT TIME ZONE 'UTC'),'YYYY-MM'))::int AS mes_diferente,
    COUNT(*) FILTER (WHERE (data AT TIME ZONE 'UTC')::date = ("createdAt" AT TIME ZONE 'UTC')::date)::int AS data_igual_digitacao
  FROM accounting_entries WHERE tipo = 'BAIXA' GROUP BY 1 ORDER BY 2 DESC`);
for (const r of g3c) console.log(`  origem=${String(r.origem).padEnd(8)} total=${String(r.total).padStart(5)} mesmo_mes=${String(r.mesmo_mes).padStart(5)} MES_DIFERENTE=${String(r.mes_diferente).padStart(5)} data==digitação=${String(r.data_igual_digitacao).padStart(5)}`);

console.log("\n— BAIXA cuja data == digitação, por papel (`tipoLinha`) e por ter guia —");
const g3p = await q(`
  SELECT COALESCE("tipoLinha",'(null)') AS papel,
         CASE WHEN "sourceGuideId" IS NOT NULL THEN 'com guia'
              WHEN "parcelamentoId" IS NOT NULL THEN 'parcela s/guia' ELSE 'avulsa' END AS ancora,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE (data AT TIME ZONE 'UTC')::date = ("createdAt" AT TIME ZONE 'UTC')::date)::int AS igual
  FROM accounting_entries WHERE tipo='BAIXA' GROUP BY 1,2 ORDER BY 3 DESC LIMIT 20`);
for (const r of g3p) console.log(`  papel=${String(r.papel).padEnd(14)} ${String(r.ancora).padEnd(15)} total=${String(r.total).padStart(5)} igual=${String(r.igual).padStart(5)} (${(n(r.igual) * 100 / (n(r.total) || 1)).toFixed(0)}%)`);

console.log("\n— controle: quando HÁ comprovante do SERPRO na guia, a data do lançamento bate com a arrecadação? —");
const g3v = await q(`
  SELECT COUNT(*)::int AS baixas_com_guia,
    COUNT(*) FILTER (WHERE g.extracted->'comprovante'->>'dataArrecadacao' IS NOT NULL)::int AS com_data_arrecadacao,
    COUNT(*) FILTER (WHERE g.extracted->'comprovante'->>'dataArrecadacao' IS NOT NULL
                       AND to_char((e.data AT TIME ZONE 'UTC'),'DD/MM/YYYY') = g.extracted->'comprovante'->>'dataArrecadacao')::int AS bate,
    COUNT(*) FILTER (WHERE g.extracted->'comprovante'->>'dataArrecadacao' IS NOT NULL
                       AND to_char((e.data AT TIME ZONE 'UTC'),'DD/MM/YYYY') <> g.extracted->'comprovante'->>'dataArrecadacao')::int AS diverge
  FROM accounting_entries e JOIN "Guide" g ON g.id = e."sourceGuideId" WHERE e.tipo='BAIXA'`);
console.log("  ", JSON.stringify(g3v[0]));

// ─────────────────────────────────────────────────────────────────────────────
H("4. PARTIDA DOBRADA: Σ DÉBITOS == Σ CRÉDITOS?");
const g4l = await q(`
  SELECT COUNT(*)::int AS lancamentos_desbalanceados FROM (
    SELECT l."entryId",
      SUM(CASE WHEN upper(btrim(l.tipo))='D' THEN l.valor ELSE 0 END) AS d,
      SUM(CASE WHEN upper(btrim(l.tipo))='C' THEN l.valor ELSE 0 END) AS c
    FROM accounting_entry_lines l GROUP BY 1
  ) t WHERE abs(t.d - t.c) > 0.01`);
console.log(`  lançamentos individuais com D≠C (tolerância 1 centavo): ${n(g4l[0].lancamentos_desbalanceados)}`);

const g4t = await q(`
  SELECT COUNT(*)::int AS lancamentos_sem_linha
  FROM accounting_entries e WHERE NOT EXISTS (SELECT 1 FROM accounting_entry_lines l WHERE l."entryId"=e.id)`);
console.log(`  lançamentos SEM nenhuma linha: ${n(g4t[0].lancamentos_sem_linha)}`);

const g4 = await q(`
  SELECT e."portalClientId" AS pcid, pc.razao AS empresa, e.competencia,
    (c."fechadoContabilEm" IS NOT NULL) AS fechado,
    SUM(CASE WHEN upper(btrim(l.tipo))='D' THEN l.valor ELSE 0 END) AS deb,
    SUM(CASE WHEN upper(btrim(l.tipo))='C' THEN l.valor ELSE 0 END) AS cre,
    COUNT(DISTINCT e.id)::int AS lancamentos
  FROM accounting_entries e
  JOIN accounting_entry_lines l ON l."entryId" = e.id
  LEFT JOIN company_monthly_circulars c ON c."portalClientId" = e."portalClientId" AND c.competencia = e.competencia
  LEFT JOIN "PortalClient" pc ON pc.id = e."portalClientId"
  GROUP BY 1,2,3,4`);
const fechadas = g4.filter((r) => r.fechado);
const abertas = g4.filter((r) => !r.fechado);
const naoFecha = (rs) => rs.filter((r) => Math.abs(n(r.deb) - n(r.cre)) > 0.01);
console.log(`\n  competências FECHADAS contabilmente : ${fechadas.length}  · com Σ D≠Σ C: ${naoFecha(fechadas).length}`);
console.log(`  competências ABERTAS               : ${abertas.length}  · com Σ D≠Σ C: ${naoFecha(abertas).length}`);
const quebradas = naoFecha(g4).sort((a, b) => Math.abs(n(b.deb) - n(b.cre)) - Math.abs(n(a.deb) - n(a.cre)));
if (quebradas.length) {
  console.log(`\n  — as ${Math.min(20, quebradas.length)} maiores diferenças —`);
  for (const r of quebradas.slice(0, 20)) {
    console.log(`  ${String(r.empresa || r.pcid).slice(0, 26).padEnd(26)} ${r.competencia} ${r.fechado ? "FECHADA" : "aberta "}  D=${money(r.deb).padStart(14)}  C=${money(r.cre).padStart(14)}  Δ=${money(n(r.deb) - n(r.cre)).padStart(13)}`);
  }
} else console.log("  (nenhuma competência com diferença)");

// ─────────────────────────────────────────────────────────────────────────────
H("5. MOVIMENTO EM CONTA DE CAIXA / BANCO — quantas empresas, e desde quando");
console.log("⚠ APROXIMAÇÃO, e por duas vias: (a) `codigoCompleto` que começa com 11 (Disponibilidades)");
console.log("  e (b) NOME da conta (CAIXA/BANCO/BCO), que é como `resolveCaixaAccount` faz hoje.");
console.log("  A identificação DEFINITIVA de conta de caixa é de outra sessão — aqui só se mede.\n");
for (const [rotulo, filtro] of [
  ["(a) codigoCompleto LIKE '11%'", `cc LIKE '11%'`],
  ["(b) nome ~ CAIXA|BANCO|BCO", `(upper(unaccent_nome) LIKE '%CAIXA%' OR upper(unaccent_nome) LIKE '%BANCO%' OR upper(unaccent_nome) LIKE '%BCO%')`],
]) {
  const rs = await q(`${CTE_RESOLVE}
    , comnome AS (SELECT c.*, COALESCE(c.nome,'') AS unaccent_nome FROM classificadas c)
    SELECT COUNT(DISTINCT pcid)::int AS empresas, SUM(linhas)::int AS linhas, COUNT(*)::int AS pares
    FROM comnome WHERE ${filtro}`);
  console.log(`  ${rotulo.padEnd(34)} empresas=${String(n(rs[0].empresas)).padStart(4)} pares=${String(n(rs[0].pares)).padStart(5)} linhas=${String(n(rs[0].linhas)).padStart(7)}`);
}
const g5 = await q(`${CTE_RESOLVE}
  , contas_caixa AS (SELECT pcid, conta FROM classificadas
      WHERE (cc LIKE '11%')
         OR upper(COALESCE(nome,'')) LIKE '%CAIXA%'
         OR upper(COALESCE(nome,'')) LIKE '%BANCO%'
         OR upper(COALESCE(nome,'')) LIKE '%BCO%')
  SELECT e."portalClientId" AS pcid, pc.razao AS empresa,
    MIN(e.data) AS primeiro, MAX(e.data) AS ultimo,
    MIN(e.competencia) AS primeira_comp, MAX(e.competencia) AS ultima_comp,
    COUNT(*)::int AS linhas, COUNT(DISTINCT e.competencia)::int AS competencias
  FROM accounting_entry_lines l
  JOIN accounting_entries e ON e.id = l."entryId"
  JOIN contas_caixa cc2 ON cc2.pcid = e."portalClientId" AND cc2.conta = btrim(l.conta)
  LEFT JOIN "PortalClient" pc ON pc.id = e."portalClientId"
  GROUP BY 1,2 ORDER BY 7 DESC`);
console.log(`\n  ${g5.length} empresas com movimento em conta de caixa/banco (união das duas vias):`);
console.log("  empresa                                  linhas  comps  1ª comp  últ comp   1º mov      últ mov");
for (const r of g5) {
  const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : "-");
  console.log(`  ${String(r.empresa || r.pcid).slice(0, 38).padEnd(38)} ${String(r.linhas).padStart(6)} ${String(r.competencias).padStart(6)}  ${String(r.primeira_comp).padEnd(8)} ${String(r.ultima_comp).padEnd(9)} ${d(r.primeiro)}  ${d(r.ultimo)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
H("6. EXTRATO PGDAS-D / SERPRO — cobertura de receita e imposto por competência");
const g6 = await q(`
  SELECT
    COUNT(*)::int AS circulares,
    COUNT(DISTINCT "portalClientId")::int AS empresas,
    COUNT(*) FILTER (WHERE "receitaBruta" IS NOT NULL)::int AS com_receita_bruta,
    COUNT(*) FILTER (WHERE "receitaBruta" IS NULL)::int AS sem_receita_bruta,
    COUNT(*) FILTER (WHERE "dasTotal" IS NOT NULL)::int AS com_das,
    COUNT(*) FILTER (WHERE "dasTotal" IS NULL)::int AS sem_das,
    COUNT(*) FILTER (WHERE "receitaBruta" IS NOT NULL AND "dasTotal" IS NOT NULL)::int AS com_os_dois,
    COUNT(*) FILTER (WHERE "receitaBruta" IS NULL AND "dasTotal" IS NULL)::int AS sem_nenhum,
    COUNT(*) FILTER (WHERE "pgdasNumeroDeclaracao" IS NOT NULL)::int AS com_num_declaracao,
    COUNT(*) FILTER (WHERE "serproLastSyncAt" IS NOT NULL)::int AS ja_sincronizada_serpro,
    COUNT(*) FILTER (WHERE "semFaturamento" IS TRUE)::int AS declarada_sem_faturamento,
    COUNT(*) FILTER (WHERE "fechadoContabilEm" IS NOT NULL)::int AS fechada_contabil
  FROM company_monthly_circulars`);
console.table(g6.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, n(v)]))));

console.log("— `serproSyncStatus` das circulares —");
for (const r of await q(`SELECT COALESCE("serproSyncStatus",'(null)') AS s, COUNT(*)::int AS n FROM company_monthly_circulars GROUP BY 1 ORDER BY 2 DESC`))
  console.log(`  ${String(r.s).padEnd(22)} ${r.n}`);

console.log("\n— BURACO REAL: competências que EXISTEM no intervalo de cada empresa mas NÃO têm extrato —");
const g6b = await q(`
  WITH faixa AS (
    SELECT "portalClientId" AS pcid, MIN(competencia) AS ini, MAX(competencia) AS fim,
           COUNT(*)::int AS circulares,
           COUNT(*) FILTER (WHERE "receitaBruta" IS NOT NULL)::int AS com_receita,
           COUNT(*) FILTER (WHERE "dasTotal" IS NOT NULL)::int AS com_das
    FROM company_monthly_circulars GROUP BY 1)
  SELECT f.*, pc.razao AS empresa,
    ((substring(f.fim,1,4)::int * 12 + substring(f.fim,6,2)::int)
     - (substring(f.ini,1,4)::int * 12 + substring(f.ini,6,2)::int) + 1) AS meses_no_intervalo
  FROM faixa f LEFT JOIN "PortalClient" pc ON pc.id = f.pcid ORDER BY 4 DESC`);
console.log("  empresa                              intervalo          meses  circ  c/receita  c/DAS  FALTANDO");
let somaFalta = 0, somaMeses = 0, somaReceita = 0;
for (const r of g6b) {
  const falta = n(r.meses_no_intervalo) - n(r.com_receita);
  somaFalta += falta; somaMeses += n(r.meses_no_intervalo); somaReceita += n(r.com_receita);
  console.log(`  ${String(r.empresa || r.pcid).slice(0, 34).padEnd(34)} ${r.ini}..${r.fim} ${String(r.meses_no_intervalo).padStart(6)} ${String(r.circulares).padStart(5)} ${String(r.com_receita).padStart(10)} ${String(r.com_das).padStart(6)} ${String(falta).padStart(9)}`);
}
console.log(`  TOTAL: ${somaMeses} meses-empresa no intervalo · ${somaReceita} com receita de extrato · ${somaFalta} SEM (receita DESCONHECIDA, não zero)`);

// ─────────────────────────────────────────────────────────────────────────────
H("7. JÁ EXISTE CÁLCULO DE IMPOSTO A PARTIR DAS NOTAS? (não reimplementar)");
const g7 = await q(`
  SELECT COUNT(*)::int AS snapshots,
    COUNT(DISTINCT "portalClientId")::int AS empresas,
    COUNT(*) FILTER (WHERE "dasCalculadoLocal" IS NOT NULL)::int AS com_das_local,
    COUNT(*) FILTER (WHERE "dasSimuladoSerpro" IS NOT NULL)::int AS com_das_simulado,
    COUNT(*) FILTER (WHERE "dasRetornadoSerpro" IS NOT NULL)::int AS com_das_transmitido,
    COUNT(*) FILTER (WHERE "receitaPorAnexo" IS NOT NULL)::int AS com_receita_por_anexo,
    COUNT(*) FILTER (WHERE "fechadaEm" IS NOT NULL)::int AS fechadas,
    MIN(competencia) AS primeira, MAX(competencia) AS ultima
  FROM apuracao_snapshots`);
console.table(g7);
console.log("— estado dos snapshots —");
for (const r of await q(`SELECT estado, COUNT(*)::int AS n FROM apuracao_snapshots GROUP BY 1 ORDER BY 2 DESC`))
  console.log(`  ${String(r.estado).padEnd(24)} ${r.n}`);
console.log("— procedência do dasCalculadoLocal —");
for (const r of await q(`SELECT COALESCE("dasCalculadoLocalProcedencia",'(null)') AS s, COUNT(*)::int AS n FROM apuracao_snapshots GROUP BY 1 ORDER BY 2 DESC`))
  console.log(`  ${String(r.s).padEnd(24)} ${r.n}`);

console.log("\n— GUIAS: vencimento real (é o dado, não a regra do dia 20) —");
const g8 = await q(`
  SELECT tipo, COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE vencimento IS NOT NULL)::int AS com_vencimento,
    COUNT(*) FILTER (WHERE vencimento IS NULL)::int AS SEM_vencimento,
    COUNT(*) FILTER (WHERE extract(day from (vencimento AT TIME ZONE 'UTC')) = 20)::int AS dia_20
  FROM "Guide" GROUP BY 1 ORDER BY 2 DESC`);
for (const r of g8) console.log(`  tipo=${String(r.tipo).padEnd(14)} total=${String(r.total).padStart(5)} com_venc=${String(r.com_vencimento).padStart(5)} SEM_venc=${String(r.sem_vencimento ?? r.SEM_vencimento).padStart(5)} dia20=${String(r.dia_20).padStart(5)}`);

console.log("\n— DESPESA RECORRENTE: matéria-prima disponível (conta × meses distintos com lançamento) —");
const g9 = await q(`${CTE_RESOLVE}
  , mov AS (
    SELECT e."portalClientId" AS pcid, btrim(l.conta) AS conta, e.competencia,
           SUM(CASE WHEN upper(btrim(l.tipo))='D' THEN l.valor ELSE 0 END) AS deb
    FROM accounting_entry_lines l JOIN accounting_entries e ON e.id = l."entryId"
    WHERE e.tipo <> 'BAIXA'
    GROUP BY 1,2,3),
  cad AS (
    SELECT m.pcid, m.conta, COUNT(DISTINCT m.competencia)::int AS meses,
           SUM(m.deb) AS total_deb, avg(m.deb) AS media, stddev_pop(m.deb) AS desvio
    FROM mov m JOIN classificadas c ON c.pcid = m.pcid AND c.conta = m.conta
    WHERE c.cc IS NOT NULL AND left(c.cc,1) IN ('4','5') AND m.deb > 0
    GROUP BY 1,2)
  SELECT
    COUNT(*)::int AS pares_despesa,
    COUNT(*) FILTER (WHERE meses >= 3)::int AS com_3_ou_mais_meses,
    COUNT(*) FILTER (WHERE meses >= 6)::int AS com_6_ou_mais_meses,
    COUNT(*) FILTER (WHERE meses >= 12)::int AS com_12_ou_mais_meses,
    COUNT(*) FILTER (WHERE meses >= 3 AND desvio IS NOT NULL AND media > 0 AND desvio/media <= 0.25)::int AS estaveis_cv_ate_25pct
  FROM cad`);
console.table(g9);

console.log("\n— quantos MESES de histórico contábil existem, por empresa (top 15) —");
for (const r of await q(`
  SELECT pc.razao AS empresa, COUNT(DISTINCT e.competencia)::int AS meses, MIN(e.competencia) AS ini, MAX(e.competencia) AS fim, COUNT(*)::int AS lancamentos
  FROM accounting_entries e LEFT JOIN "PortalClient" pc ON pc.id = e."portalClientId"
  GROUP BY 1 ORDER BY 2 DESC LIMIT 15`))
  console.log(`  ${String(r.empresa || "?").slice(0, 34).padEnd(34)} meses=${String(r.meses).padStart(3)} ${r.ini}..${r.fim}  lançamentos=${r.lancamentos}`);

await p.$disconnect();
console.log("\n[fim] SOMENTE LEITURA — nenhuma escrita foi feita.");
