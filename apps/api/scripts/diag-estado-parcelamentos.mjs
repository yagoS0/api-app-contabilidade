// O TERRENO REAL DO PARCELAMENTO — o que a leitura de código não responde.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa.
//
// POR QUE ELE EXISTE
// O mapeamento do módulo deixou sete incógnitas que só o banco fecha, e três delas mudam o
// dimensionamento de uma reestruturação inteira:
//
//   1. A migration `add_parcela` foi aplicada? Dela dependem QUATRO telas (fila de baixa,
//      conferência, contadores do card, risco de rescisão). Se não foi, metade da aba
//      Parcelamentos devolve vazio em produção — e vazio, ali, é indistinguível de "nada pendente".
//   2. Quantos parcelamentos são V1 × V2? `decorateParcelamento` bifurca em runtime
//      (`isV1 = linhasV1.length > 0`) e a MESMA rota devolve semântica diferente conforme o ramo.
//   3. Quantos "parcelamentos invisíveis" existem — os da rota `POST /entries/parcelamento`, que
//      cria N lançamentos com `subtipo:"PARC_DAS"` e `parcelamentoId` NULO. Eles não têm cabeçalho,
//      não têm card, não têm parcela e não aparecem em nenhuma aba. Qualquer plano que assuma
//      "todo parcelamento tem registro" está errado na proporção deste número.
//
// USO:
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node apps/api/scripts/diag-estado-parcelamentos.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const n = (v) => Number(v || 0).toLocaleString("pt-BR");
const linha = () => console.log("─".repeat(84));

console.log("═".repeat(84));
console.log("ESTADO REAL DO MÓDULO DE PARCELAMENTO");
console.log("═".repeat(84));

// ─── 1. As migrations ────────────────────────────────────────────────────────────────────────
console.log("\n1) MIGRATIONS — aplicada de verdade?\n");
try {
  const migs = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
     WHERE migration_name LIKE '%parcela%'
        OR migration_name LIKE '%onboarding%'
        OR migration_name LIKE '%tipo_linha%'
        OR migration_name LIKE '%estorno%'
     ORDER BY started_at DESC`;
  if (!migs.length) console.log("   (nenhuma das quatro consta na tabela de migrations)");
  for (const m of migs) {
    const estado = m.rolled_back_at ? "⚠ REVERTIDA" : m.finished_at ? "✓ aplicada" : "⚠ NÃO CONCLUÍDA";
    console.log(`   ${estado}  ${m.migration_name}`);
  }
} catch (err) {
  console.log("   ⚠ não consegui ler `_prisma_migrations`:", err?.message);
}

// A prova direta: a tabela existe?
try {
  const t = await prisma.$queryRaw`SELECT to_regclass('public.parcelas') AS t`;
  console.log(`\n   tabela "parcelas" existe? ${t?.[0]?.t ? "SIM" : "⚠ NÃO"}`);
  if (t?.[0]?.t) {
    const c = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "parcelas"`;
    console.log(`   linhas em "parcelas": ${n(c?.[0]?.n)}`);
    const ob = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "parcelas" WHERE "origemBaixa" IS NOT NULL`;
    console.log(`   com "origemBaixa" preenchida: ${n(ob?.[0]?.n)}  (o código nunca escreve — F2.2 é quem vai)`);
  }
} catch (err) {
  console.log("   ⚠ falha ao inspecionar `parcelas`:", err?.message);
}

// ─── 2. V1 × V2 × invisíveis ─────────────────────────────────────────────────────────────────
linha();
console.log("\n2) QUANTOS SÃO DE CADA GERAÇÃO\n");

const totalParc = await prisma.parcelamento.count();
const v1 = await prisma.$queryRaw`
  SELECT count(DISTINCT p.id)::int AS n
    FROM "parcelamentos" p
   WHERE EXISTS (SELECT 1 FROM "accounting_entries" e
                  WHERE e."parcelamentoId" = p.id AND e.tipo = 'PARCELA')`;
const nV1 = v1?.[0]?.n || 0;
console.log(`   parcelamentos com cabeçalho: ${n(totalParc)}`);
console.log(`      V1 (têm linhas leves tipo:"PARCELA"): ${n(nV1)}`);
console.log(`      V2 (não têm):                        ${n(totalParc - nV1)}`);

// ⚠ Os invisíveis: lote de lançamentos sem cabeçalho nenhum.
const invisiveis = await prisma.$queryRaw`
  SELECT count(*)::int AS lancamentos, count(DISTINCT "portalClientId")::int AS empresas
    FROM "accounting_entries"
   WHERE subtipo = 'PARC_DAS' AND "parcelamentoId" IS NULL`;
console.log(`\n   ⚠ "parcelamentos invisíveis" (POST /entries/parcelamento):`);
console.log(`      ${n(invisiveis?.[0]?.lancamentos)} lançamento(s) em ${n(invisiveis?.[0]?.empresas)} empresa(s)`);
console.log(`      Não têm cabeçalho, card, parcela nem risco de rescisão. Nenhuma aba os mostra.`);

// ─── 3. Cronogramas sem data ─────────────────────────────────────────────────────────────────
linha();
console.log("\n3) CRONOGRAMA UTILIZÁVEL?\n");
const sentinela = await prisma.parcelamento.count({ where: { competenciaInicial: "1970-01" } });
console.log(`   com competenciaInicial = "1970-01" (sentinela): ${n(sentinela)}`);
if (sentinela) console.log(`      ⚠ esses têm cronograma SEM DATAS — risco de rescisão não avaliável.`);

// ⚠ `diaPagamento` nunca é coletado pelo modal V2 — todo parcelamento V2 nasce com 1.
const porDia = await prisma.$queryRaw`
  SELECT "diaPagamento", count(*)::int AS n FROM "parcelamentos" GROUP BY "diaPagamento" ORDER BY n DESC`;
console.log(`\n   dia de vencimento gravado:`);
for (const d of porDia) console.log(`      dia ${String(d.diaPagamento).padStart(2)} → ${n(d.n)}`);
console.log(`      ⚠ o modal de ingestão V2 NÃO coleta esse campo; o default é 1.`);

// ─── 4. A memória de contas ──────────────────────────────────────────────────────────────────
linha();
console.log("\n4) MEMÓRIA DE CONTAS (MapaContaTributo)\n");
try {
  const mapa = await prisma.$queryRaw`
    SELECT CASE WHEN "portalClientId" IS NULL THEN 'GLOBAL do escritório' ELSE 'override por empresa' END AS escopo,
           count(*)::int AS n
      FROM "mapa_conta_tributo" GROUP BY 1 ORDER BY 2 DESC`;
  if (!mapa.length) console.log("   (vazia)");
  for (const m of mapa) console.log(`   ${m.escopo}: ${n(m.n)}`);
  console.log(`   ⚠ o escritor grava SEMPRE com portalClientId NULL — o override existe no leitor e`);
  console.log(`     não existe no escritor. "Salvar como padrão da modalidade" já acontece, sem checkbox.`);
} catch (err) {
  console.log("   ⚠ falha ao ler `mapa_conta_tributo`:", err?.message);
}

// ─── 5. ⚠ Baixa MANUAL (F2.2) já existente — a que o estorno ainda não alcança ────────────────
linha();
console.log("\n5) ⚠ BAIXA POR DECLARAÇÃO (F2.2) — o estorno ainda NÃO a alcança\n");
console.log("   `EstornoBaixaService` reabre a GUIA. Numa baixa sem guia não há guia a reabrir, e");
console.log("   `parcelas.origemBaixa` não é limpo — a parcela ficaria presa, que é exatamente o");
console.log("   defeito que a F2.4 corrigiu. Se já existir alguma, o estorno novo precisa alcançá-la");
console.log("   RETROATIVAMENTE.\n");

const manuais = await prisma.$queryRaw`
  SELECT count(*)::int AS n FROM "parcelas" WHERE "origemBaixa" = 'MANUAL'`;
const nManuais = manuais?.[0]?.n || 0;
console.log(`   parcelas com origemBaixa = 'MANUAL': ${n(nManuais)}`);

const lancManuais = await prisma.$queryRaw`
  SELECT count(*)::int AS n FROM "accounting_entries"
   WHERE tipo = 'BAIXA' AND "sourceGuideId" IS NULL AND "parcelamentoId" IS NOT NULL`;
console.log(`   lançamentos de BAIXA sem guia ancorados em parcelamento: ${n(lancManuais?.[0]?.n)}`);

const porOrigem = await prisma.$queryRaw`
  SELECT COALESCE("origemBaixa", '(nula)') AS origem, count(*)::int AS n
    FROM "parcelas" GROUP BY 1 ORDER BY 2 DESC`;
console.log(`\n   distribuição de origemBaixa em "parcelas":`);
for (const o of porOrigem) console.log(`      ${o.origem}: ${n(o.n)}`);

if (nManuais === 0) {
  console.log(`\n   ✓ NENHUMA. O estorno pode ser escrito sem tratar dado retroativo —`);
  console.log(`     e a janela para fechá-lo antes da primeira baixa manual ainda está aberta.`);
} else {
  console.log(`\n   ⚠ EXISTEM ${n(nManuais)}. Cada uma está hoje IRREVERSÍVEL pela interface.`);
  console.log(`     O estorno precisa alcançá-las, e isso amplia o passo 2.`);
}

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
