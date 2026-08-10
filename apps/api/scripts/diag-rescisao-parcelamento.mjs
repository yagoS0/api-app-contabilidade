// DE ONDE VEIO A RESCISÃO — e o que um parcelamento deixa no banco.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum DDL.
//
// POR QUE ELE EXISTE
// O dono relatou "um lançamento de rescisão de um parcelamento que não faz sentido". Um lançamento
// de rescisão é o sistema AFIRMANDO um fato fiscal (o acordo caiu, o saldo vai para a Dívida Ativa,
// as reduções da adesão são restabelecidas). Antes de dar a alguém um botão de apagar, é preciso
// saber QUEM escreveu aquilo — senão o gerador roda de novo e a rescisão volta.
//
// A leitura de código já respondeu que NÃO existe geração automática (ver o relatório da fase):
// `riscoRescisao.js` calcula RISCO (indicador de tela) e não grava nada; o único escritor é
// `ParcelamentoService.rescindirParcelamento`, alcançável só por
// `POST /firm/companies/:id/parcelamentos/:parcId/rescindir`. Este script MEDE isso no banco.
//
// USO:
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node apps/api/scripts/diag-rescisao-parcelamento.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const n = (v) => Number(v || 0).toLocaleString("pt-BR");
const money = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (v) => (v ? new Date(v).toISOString().slice(0, 19).replace("T", " ") : "—");
const linha = () => console.log("─".repeat(92));

console.log("═".repeat(92));
console.log("A RESCISÃO DE PARCELAMENTO — quem escreveu, quando, e o que o contrato deixa no banco");
console.log("═".repeat(92));

// ─── 1. Os parcelamentos, por status ─────────────────────────────────────────────────────────
console.log("\n1) PARCELAMENTOS POR STATUS\n");
const porStatus = await prisma.$queryRaw`
  SELECT status, count(*)::int AS n FROM "parcelamentos" GROUP BY 1 ORDER BY 2 DESC`;
if (!porStatus.length) console.log("   (nenhum parcelamento na base)");
for (const s of porStatus) console.log(`   ${String(s.status).padEnd(12)} ${n(s.n)}`);

const rescindidos = await prisma.$queryRaw`
  SELECT p.id, p.label, p.tipo, p.kind, p."numeroParcelamento", p.status,
         p."competenciaInicial", p."numParcelas", p."totalValue", p."principalTotal",
         p."createdAt", p."updatedAt", p."createdByUserId", p.observacoes, p.origem,
         p."templateRescisionFunctionId", p."aberturaEntryId",
         c.razao, c.cnpj
    FROM "parcelamentos" p
    JOIN "PortalClient" c ON c.id = p."portalClientId"
   WHERE p.status = 'RESCINDIDO'
   ORDER BY p."updatedAt" DESC`;

console.log(`\n   RESCINDIDOS: ${n(rescindidos.length)}`);
for (const p of rescindidos) {
  console.log(`\n   • ${p.razao} (${p.cnpj})`);
  console.log(`     parcelamento ${p.id}`);
  console.log(`     label=${p.label}`);
  console.log(`     tipo=${p.tipo || "—"} kind=${p.kind} nº=${p.numeroParcelamento || "—"} origem=${p.origem}`);
  console.log(`     ${p.numParcelas} parcelas · total ${money(p.totalValue)} · principal ${money(p.principalTotal)} · comp. inicial ${p.competenciaInicial}`);
  console.log(`     criado ${dt(p.createdAt)} por ${p.createdByUserId || "(sem autor)"} · última alteração ${dt(p.updatedAt)}`);
  console.log(`     templateRescision=${p.templateRescisionFunctionId || "(nenhum → ramo V2, estorno reverso da provisão)"}`);
  console.log(`     observacoes=${p.observacoes ? JSON.stringify(p.observacoes) : "(vazio) ⚠ nenhum motivo gravado"}`);
}

// ─── 2. OS LANÇAMENTOS DE RESCISÃO ───────────────────────────────────────────────────────────
linha();
console.log("\n2) LANÇAMENTOS DE RESCISÃO — quantos, de quando, por qual caminho\n");
console.log("   ⚠ Três marcas possíveis, medidas SEPARADAMENTE para não confundir caminhos:");
console.log("      A) loteImportacao LIKE 'PARC-%-RESCISAO'  → escrito por `rescindirParcelamento` (os DOIS ramos)");
console.log("      B) subtipo LIKE '%RESCISAO%'              → só o ramo com TEMPLATE (seeds PARC_DAS_RESCISAO/PARC_INSS_RESCISAO)");
console.log("      C) historico ILIKE '%RESCIS%'             → a rede mais larga, pega lançamento digitado à mão\n");

const porMarca = await prisma.$queryRaw`
  SELECT
    count(*) FILTER (WHERE "loteImportacao" LIKE 'PARC-%-RESCISAO')::int AS a_lote,
    count(*) FILTER (WHERE subtipo LIKE '%RESCISAO%')::int              AS b_subtipo,
    count(*) FILTER (WHERE historico ILIKE '%RESCIS%')::int             AS c_historico
  FROM "accounting_entries"`;
const m = porMarca[0] || {};
console.log(`   A) por loteImportacao: ${n(m.a_lote)}`);
console.log(`   B) por subtipo:        ${n(m.b_subtipo)}`);
console.log(`   C) por historico:      ${n(m.c_historico)}`);

const lancs = await prisma.$queryRaw`
  SELECT e.id, e.historico, e.tipo, e.subtipo, e.origem, e."loteImportacao", e.competencia,
         e.data, e.status, e."statusPagamento", e."tipoLinha", e."numeroParcela",
         e."parcelamentoId", e."createdAt", e."updatedAt",
         c.razao, c.cnpj,
         (SELECT count(*)::int FROM "accounting_entry_lines" l WHERE l."entryId" = e.id) AS n_linhas,
         (SELECT COALESCE(sum(l.valor),0) FROM "accounting_entry_lines" l WHERE l."entryId" = e.id AND l.tipo = 'D') AS soma_d,
         (SELECT COALESCE(sum(l.valor),0) FROM "accounting_entry_lines" l WHERE l."entryId" = e.id AND l.tipo = 'C') AS soma_c
    FROM "accounting_entries" e
    JOIN "PortalClient" c ON c.id = e."portalClientId"
   WHERE e."loteImportacao" LIKE 'PARC-%-RESCISAO'
      OR e.subtipo LIKE '%RESCISAO%'
      OR e.historico ILIKE '%RESCIS%'
   ORDER BY e."createdAt" DESC`;

console.log(`\n   UNIÃO das três marcas: ${n(lancs.length)} lançamento(s)\n`);
for (const e of lancs) {
  console.log(`   • ${e.razao} (${e.cnpj}) — ${e.competencia} · data ${dt(e.data).slice(0, 10)}`);
  console.log(`     ${e.historico}`);
  console.log(`     tipo=${e.tipo} subtipo=${e.subtipo || "—"} origem=${e.origem} tipoLinha=${e.tipoLinha || "—"} status=${e.status}`);
  console.log(`     lote=${e.loteImportacao || "—"} · parcelamentoId=${e.parcelamentoId || "⚠ NULO"} · numeroParcela=${e.numeroParcela ?? "—"}`);
  console.log(`     ${e.n_linhas} linha(s) · ΣD ${money(e.soma_d)} · ΣC ${money(e.soma_c)}`);
  console.log(`     criado ${dt(e.createdAt)} · id ${e.id}`);
  const ls = await prisma.$queryRaw`
    SELECT conta, tipo, valor, ordem, "tipoLinha", "codigoTributo"
      FROM "accounting_entry_lines" WHERE "entryId" = ${e.id} ORDER BY ordem`;
  for (const l of ls) {
    console.log(`        ${l.tipo} ${String(l.conta || "(conta EM BRANCO)").padEnd(28)} ${money(l.valor).padStart(14)}  papel=${l.tipoLinha || "—"} trib=${l.codigoTributo || "—"}`);
  }
  console.log("");
}

// ⚠ A competência do lançamento de rescisão é a de ABERTURA do contrato, não a data do clique.
// Isso importa muito para a exclusão: pode ser um mês FECHADO.
console.log("   MÊS FECHADO? (a rescisão grava na competência de ABERTURA do contrato, não na de hoje)\n");
for (const e of lancs) {
  const f = await prisma.$queryRaw`
    SELECT "fechadoContabilEm", "fechadoContabilPor"
      FROM "company_monthly_circulars" mc
      JOIN "PortalClient" c ON c.id = mc."portalClientId"
     WHERE c.cnpj = ${e.cnpj} AND mc.competencia = ${e.competencia}`;
  const fe = f?.[0]?.fechadoContabilEm;
  console.log(`   ${e.competencia} · ${e.razao}: ${fe ? `⚠ FECHADO em ${dt(fe)}` : "aberto"}`);
}

// ─── 3. O RASTRO COMPLETO DE CADA PARCELAMENTO ───────────────────────────────────────────────
linha();
console.log("\n3) O QUE UM PARCELAMENTO DEIXA NO BANCO (todos, não só os rescindidos)\n");

const todos = await prisma.$queryRaw`
  SELECT p.id, p.label, p.tipo, p.kind, p.status, p."numeroParcelamento", p."numParcelas",
         p."principalTotal" AS principal_total, p."totalValue" AS total_value,
         c.razao, c.cnpj
    FROM "parcelamentos" p
    JOIN "PortalClient" c ON c.id = p."portalClientId"
   ORDER BY p."createdAt" DESC`;

for (const p of todos) {
  const r = await prisma.$queryRaw`
    SELECT
      (SELECT count(*)::int FROM "parcelas"            WHERE "parcelamentoId" = ${p.id})                       AS parcelas_contratadas,
      (SELECT count(*)::int FROM "parcelas"            WHERE "parcelamentoId" = ${p.id} AND "origemBaixa" IS NOT NULL) AS parcelas_baixadas,
      (SELECT count(*)::int FROM "parcelas"            WHERE "parcelamentoId" = ${p.id} AND "guiaId" IS NOT NULL)      AS parcelas_com_guia,
      (SELECT count(*)::int FROM "Guide"               WHERE "parcelamentoId" = ${p.id})                       AS guias,
      (SELECT count(*)::int FROM "Guide"               WHERE "parcelamentoId" = ${p.id} AND baixada = true)    AS guias_baixadas,
      (SELECT count(*)::int FROM "Guide"               WHERE "parcelamentoId" = ${p.id} AND "paymentStatus" = 'PAID') AS guias_pagas,
      (SELECT count(*)::int FROM "accounting_entries"  WHERE "parcelamentoId" = ${p.id})                       AS entries_total,
      (SELECT count(*)::int FROM "accounting_entries"  WHERE "parcelamentoId" = ${p.id} AND tipo = 'PROVISAO') AS entries_provisao,
      (SELECT count(*)::int FROM "accounting_entries"  WHERE "parcelamentoId" = ${p.id} AND tipo = 'BAIXA')    AS entries_baixa,
      (SELECT count(*)::int FROM "accounting_entries"  WHERE "parcelamentoId" = ${p.id} AND tipo = 'PARCELA')  AS entries_parcela_leve,
      (SELECT count(*)::int FROM "accounting_entries"  WHERE "parcelamentoId" = ${p.id} AND tipo = 'ESTORNO')  AS entries_estorno,
      (SELECT count(*)::int FROM "accounting_entry_lines" l
         JOIN "accounting_entries" e ON e.id = l."entryId"
        WHERE e."parcelamentoId" = ${p.id})                                                                   AS linhas,
      (SELECT count(*)::int FROM "tributos_parcela" tp
         JOIN "Guide" g ON g.id = tp."guideId"
        WHERE g."parcelamentoId" = ${p.id})                                                                   AS tributos_parcela`;
  const x = r[0] || {};
  const compFechadas = await prisma.$queryRaw`
    SELECT DISTINCT e.competencia
      FROM "accounting_entries" e
      JOIN "company_monthly_circulars" mc
        ON mc."portalClientId" = e."portalClientId" AND mc.competencia = e.competencia
     WHERE e."parcelamentoId" = ${p.id} AND mc."fechadoContabilEm" IS NOT NULL
     ORDER BY 1`;
  console.log(`   • [${p.status}] ${p.razao} — ${p.tipo || p.kind} nº ${p.numeroParcelamento || "—"} (${p.numParcelas} parcelas)`);
  console.log(`     parcelas: ${n(x.parcelas_contratadas)} contratadas · ${n(x.parcelas_baixadas)} com origemBaixa · ${n(x.parcelas_com_guia)} com guia`);
  console.log(`     guias:    ${n(x.guias)} · ${n(x.guias_pagas)} PAID · ${n(x.guias_baixadas)} baixadas`);
  console.log(`     lançamentos: ${n(x.entries_total)} (${n(x.entries_provisao)} provisão · ${n(x.entries_baixa)} baixa · ${n(x.entries_parcela_leve)} linha leve · ${n(x.entries_estorno)} estorno) · ${n(x.linhas)} linhas D/C`);
  console.log(`     TributoParcela: ${n(x.tributos_parcela)}`);
  console.log(`     competências JÁ FECHADAS com lançamento deste contrato: ${compFechadas.length ? compFechadas.map((z) => z.competencia).join(", ") : "(nenhuma)"}`);
}

// ─── 4. Dinheiro que já saiu — o que uma exclusão apagaria ───────────────────────────────────
linha();
console.log("\n4) ⚠ PARCELA JÁ BAIXADA — o registro de dinheiro que saiu\n");
const baixasReais = await prisma.$queryRaw`
  SELECT c.razao, p."numeroParcelamento", p.status,
         count(*)::int AS lancamentos_baixa,
         COALESCE(sum(l.valor) FILTER (WHERE l.tipo = 'D'), 0) AS total_debitado
    FROM "accounting_entries" e
    JOIN "parcelamentos" p ON p.id = e."parcelamentoId"
    JOIN "PortalClient" c ON c.id = e."portalClientId"
    LEFT JOIN "accounting_entry_lines" l ON l."entryId" = e.id
   WHERE e.tipo = 'BAIXA'
   GROUP BY 1, 2, 3
   ORDER BY 4 DESC`;
if (!baixasReais.length) console.log("   (nenhuma baixa de parcela lançada)");
for (const b of baixasReais) {
  console.log(`   ${b.razao} · parc nº ${b.numeroParcelamento || "—"} [${b.status}]: ${n(b.lancamentos_baixa)} lançamento(s) de baixa, ΣD ${money(b.total_debitado)}`);
}

// ─── 5. Estornos já registrados (o precedente de auditoria que a exclusão deve seguir) ───────
linha();
console.log("\n5) AUDITORIA DE ESTORNO JÁ EXISTENTE (o padrão a seguir)\n");
try {
  const est = await prisma.$queryRaw`SELECT count(*)::int AS n FROM "estornos_baixa"`;
  console.log(`   registros em "estornos_baixa": ${n(est?.[0]?.n)}`);
} catch (err) {
  console.log("   ⚠ não consegui ler `estornos_baixa`:", err?.message);
}
try {
  const t = await prisma.$queryRaw`SELECT to_regclass('public.anulacoes_parcelamento') AS t`;
  console.log(`   tabela "anulacoes_parcelamento" existe? ${t?.[0]?.t ? "SIM" : "NÃO (migration ainda não aplicada)"}`);
} catch (err) {
  console.log("   ⚠ falha ao inspecionar `anulacoes_parcelamento`:", err?.message);
}

// ─── 6. ⚠ A PROVISÃO DE ABERTURA AINDA EXISTE? ───────────────────────────────────────────────
// O ramo V2 de `rescindirParcelamento` ESTORNA a provisão invertendo D↔C de todas as suas pernas.
// Se a provisão não existir mais (ou estiver com valor que não é o do contrato), o lançamento de
// rescisão nasce dizendo qualquer coisa — e é aí que "não faz sentido" começa.
linha();
console.log("\n6) ⚠ A PROVISÃO DE ABERTURA — a fonte que o estorno-reverso inverte\n");
for (const p of todos) {
  const cab = await prisma.$queryRaw`
    SELECT "aberturaEntryId" FROM "parcelamentos" WHERE id = ${p.id}`;
  const abId = cab?.[0]?.aberturaEntryId || null;
  const abExiste = abId
    ? await prisma.$queryRaw`SELECT id, historico, competencia, tipo, "loteImportacao" FROM "accounting_entries" WHERE id = ${abId}`
    : [];
  console.log(`   • [${p.status}] ${p.razao} — ${p.tipo || p.kind} nº ${p.numeroParcelamento || "—"}`);
  console.log(`     aberturaEntryId = ${abId || "⚠ NULO (a busca automática do SERPRO nem liga)"}`);
  if (abId) {
    console.log(`     aponta para lançamento EXISTENTE? ${abExiste.length ? "sim" : "⚠ NÃO — ponteiro pendurado (onDelete: SetNull não disparou?)"}`);
    if (abExiste.length) console.log(`       ${abExiste[0].historico} · ${abExiste[0].competencia} · tipo=${abExiste[0].tipo} · lote=${abExiste[0].loteImportacao || "—"}`);
  }
  const todosEntries = await prisma.$queryRaw`
    SELECT e.id, e.historico, e.tipo, e."loteImportacao", e.competencia, e."createdAt",
           (SELECT COALESCE(sum(l.valor),0) FROM "accounting_entry_lines" l WHERE l."entryId" = e.id AND l.tipo='D') AS d,
           (SELECT COALESCE(sum(l.valor),0) FROM "accounting_entry_lines" l WHERE l."entryId" = e.id AND l.tipo='C') AS c
      FROM "accounting_entries" e WHERE e."parcelamentoId" = ${p.id}
     ORDER BY e."createdAt", e.id`;
  console.log(`     lançamentos vivos (${todosEntries.length}):`);
  for (const e of todosEntries) {
    console.log(`       ${dt(e.createdAt)} · ${e.tipo.padEnd(9)} · ΣD ${money(e.d).padStart(12)} ΣC ${money(e.c).padStart(12)} · ${e.historico}`);
  }
  console.log(`     ⚠ contrato diz: principal ${money(p.principal_total)} · total ${money(p.total_value)}`);
  console.log("");
}

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
