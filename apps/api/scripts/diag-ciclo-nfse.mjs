// DIAGNÓSTICO: o CICLO DE VIDA da NFS-e (emitida → cancelada → substituída) chegou até nós?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa — em especial NENHUMA chamada ao ADN.
//
// POR QUE ELE EXISTE
// A aba de Notas mostra um RETRATO (`PortalInvoice.status`/`statusEfetivo`), não uma HISTÓRIA.
// Quando o contador cancela uma nota, emite outra e a substitui, o padrão nacional produz DOIS
// artefatos distintos, e eles ficam em lugares diferentes do que capturamos:
//
//   1. na NOTA SUBSTITUTA, dentro do próprio XML da DPS:
//        <subst><chSubstda>…50 dígitos…</chSubstda><cMotivo>…</cMotivo><xMotivo>…</xMotivo></subst>
//      "eu substituo AQUELA" — está gravado em `PortalInvoice.xmlRaw` e não é lido por ninguém.
//
//   2. um EVENTO separado (documento próprio no lote do ADN), cancelando a substituída:
//        <evento><infEvento Id="EVT<chave50><tpEvento6><nSeq3>">…
//          <pedRegEvento><infPedReg><e101101|e105102>…<chSubstituta>…</chSubstituta>
//      "eu fui substituída por AQUELA" — hoje o evento é aplicado e DESCARTADO (nada é gravado).
//
// ⚠ TRÊS NOMES DE TAG DIFERENTES PARA A MESMA IDEIA, e confundi-los faz o script mentir:
//   `chSubstda`    → dentro da nota substituta (medido em produção: 22 notas)
//   `chSubstituta` → dentro do evento e105102 devolvido pelo ADN (medido: 6 eventos)
//   `chNFSeSubst`  → o que o NOSSO `NfseService.buildEventoXml` escreve ao PEDIR o evento
//                    (`application/nfse/NfseService.js:234`) — não aparece em nenhum XML capturado.
// A 1ª versão deste script procurava só `chNFSeSubst`, achava ZERO e concluía "não temos o dado".
// Ausência de match não é ausência de dado — é o nome errado.
//
// ⚠ AUSÊNCIA NUNCA É RESPOSTA: "zero eventos" pode significar "não houve evento" OU "nunca
// capturamos o evento". Por isso o script separa as duas coisas: o que está em COLUNA
// (status/statusEfetivo) e o que está no XML CRU (a prova de que o fato existiu).
//
// USO (o host interno do Railway não resolve fora da rede deles):
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" \
//     node apps/api/scripts/diag-ciclo-nfse.mjs [trecho-da-razao-social] [competencia YYYY-MM]'

import { prisma } from "../src/infrastructure/db/prisma.js";

const alvo = process.argv[2] || "";
const compArg = process.argv[3] || null;
const num = (v) => Number(v || 0).toLocaleString("pt-BR");
const mascara = (s) => {
  const t = String(s || "");
  return t.length <= 8 ? t : `${t.slice(0, 4)}…${t.slice(-6)}`;
};
const linha = (c = "─") => console.log(c.repeat(96));
const um = async (sql, ...p) => (await prisma.$queryRawUnsafe(sql, ...p).catch(() => null))?.[0] ?? null;
const contarLike = async (frag) =>
  (await um(`SELECT count(*)::int AS n FROM "PortalInvoice" WHERE type='NFSE' AND "xmlRaw" LIKE $1`, `%${frag}%`))?.n ?? null;

linha("═");
console.log("CICLO DE VIDA DA NFS-e — o que está REALMENTE gravado");
linha("═");

// ── 1) Onde CABERIA um evento: as três tabelas candidatas ────────────────────────────────────
console.log("\n[1] ONDE UM EVENTO CABERIA — as tabelas existem? têm linha?");
for (const t of [`"PortalInvoiceEvent"`, "documentos", "eventos", "nsu_watermark", "nsu_gaps"]) {
  const r = await um(`SELECT count(*)::int AS n FROM ${t}`);
  console.log(`   ${t.replace(/"/g, "").padEnd(22)} ${r === null ? "NÃO EXISTE / ilegível" : `linhas=${num(r.n)}`}`);
}
console.log("   (`documentos`/`eventos` são o ledger da Fase 1 — existem e estão VAZIOS: não");
console.log("    foram ligados à captura. Ver docs/robustez-nfse-adn.md.)");

// ── 2) O retrato em COLUNA ───────────────────────────────────────────────────────────────────
console.log("\n[2] PortalInvoice — o RETRATO que a tela lê (base inteira):");
const porStatus = await prisma.$queryRaw`
  SELECT type, COALESCE(status,'(null)') AS status, COALESCE("statusEfetivo",'(null)') AS efetivo,
         COALESCE(papel,'(null)') AS papel, count(*)::int AS n
    FROM "PortalInvoice" GROUP BY 1,2,3,4 ORDER BY n DESC`;
for (const r of porStatus) {
  console.log(`   ${r.type} · status=${r.status} · statusEfetivo=${r.efetivo} · papel=${r.papel}: ${num(r.n)}`);
}
console.log("   ⚠ `statusEfetivo` tem só DOIS valores em uso: autorizada e cancelada.");
console.log("     'substituida' está documentado no schema (schema.prisma:849) e NUNCA é escrito.");

// ── 3) A HISTÓRIA que está no XML e ninguém lê ───────────────────────────────────────────────
console.log("\n[3] O QUE O XML CRU PROVA (e que nenhuma coluna registra):");
const provas = [
  ["<subst>", "notas SUBSTITUTAS (a DPS declara que substitui outra)"],
  ["chSubstda", "  └ com a chave da substituída legível"],
  ["pedRegEvento", "linhas cujo xmlRaw é um EVENTO, não uma nota"],
  ["e101101", "  └ cancelamento simples"],
  ["e105102", "  └ cancelamento por SUBSTITUIÇÃO"],
  ["chSubstituta", "  └ com a chave da substituta legível"],
];
for (const [frag, rotulo] of provas) {
  console.log(`   ${String(num(await contarLike(frag))).padStart(6)}  ${rotulo}  (LIKE '%${frag}%')`);
}

// ── 4) cStat de cada nota — o que o emissor nacional carimbou ────────────────────────────────
console.log("\n[4] cStat gravado DENTRO do XML da nota:");
const cstats = await prisma.$queryRawUnsafe(`
  SELECT COALESCE(substring("xmlRaw" from '<cStat>([0-9]+)</cStat>'),'(ausente)') AS cstat,
         status, count(*)::int AS n
    FROM "PortalInvoice" WHERE type='NFSE' GROUP BY 1,2 ORDER BY n DESC`);
for (const r of cstats) console.log(`   cStat=${String(r.cstat).padEnd(9)} status=${String(r.status).padEnd(10)} → ${num(r.n)}`);
console.log("   ⚠ O SIGNIFICADO de cada cStat NÃO está neste repositório — a tabela oficial do");
console.log("     Padrão Nacional não foi versionada aqui. Só `100` aparece citado, num comentário");
console.log("     (application/nfse/AdnXmlMetadata.js:108). Não deduza os outros: regra 1.");
console.log("   ⚠ `situacao` do parser cai em cStat como fallback e só compara com 'CANCELADA'/'2'");
console.log("     (AdnXmlMetadata.js:109 + AdnNotasService.js:162) — nenhum cStat numérico casa.");

// ── 5) Os PARES substituta → substituída, reconstruídos do XML ───────────────────────────────
const pares = await prisma.$queryRawUnsafe(`
  SELECT c.razao,
         s.numero AS n_sub, s.status AS st_sub, s."statusEfetivo" AS ef_sub, s.total AS v_sub,
         substring(s."xmlRaw" from '<chSubstda>([0-9]+)</chSubstda>') AS chave_substituida,
         o.numero AS n_orig, o.status AS st_orig, o."statusEfetivo" AS ef_orig, o.total AS v_orig
    FROM "PortalInvoice" s
    JOIN "PortalClient" c ON c.id = s."clientId"
    LEFT JOIN "PortalInvoice" o
           ON o."clientId" = s."clientId"
          AND o."chaveAcesso" = substring(s."xmlRaw" from '<chSubstda>([0-9]+)</chSubstda>')
   WHERE s.type='NFSE' AND s."xmlRaw" LIKE '%chSubstda%'
   ORDER BY c.razao, s."issueDate"`);
console.log(`\n[5] PARES SUBSTITUTA → SUBSTITUÍDA reconstruídos do XML: ${pares.length}`);
console.log("    (o vínculo existe no banco; NÃO existe nenhuma coluna que o expresse)");
for (const p of pares) {
  const orig = p.n_orig == null
    ? "⚠ A SUBSTITUÍDA NÃO ESTÁ NO NOSSO BANCO"
    : `nº ${p.n_orig} (${p.st_orig}/${p.ef_orig}) R$ ${p.v_orig}`;
  console.log(`   ${String(p.razao).slice(0, 44).padEnd(44)} nº ${String(p.n_sub).padEnd(8)} (${p.st_sub}/${p.ef_sub}) R$ ${p.v_sub}`);
  console.log(`   ${" ".repeat(44)}   └ substitui ${orig}  chave …${String(p.chave_substituida || "").slice(-6)}`);
}

// ── 6) Linhas em que o EVENTO SOBRESCREVEU A NOTA ────────────────────────────────────────────
console.log("\n[6] ⚠ LINHAS ONDE O XML DE UM EVENTO OCUPOU O LUGAR DA NOTA");
console.log("    (o evento entrou por `upsertNfseFromItem` em vez de `applyNfseEvento`: a chave do");
console.log("     evento é a da nota afetada, então o upsert ESCREVEU POR CIMA dela)");
const sobrescritas = await prisma.$queryRawUnsafe(`
  SELECT c.razao, p.papel, p.status, p."statusEfetivo",
         count(*)::int AS n,
         count(*) FILTER (WHERE p.numero IS NULL)::int AS sem_numero,
         count(*) FILTER (WHERE p.total  IS NULL)::int AS sem_valor,
         min(p."createdAt") AS de, max(p."createdAt") AS ate
    FROM "PortalInvoice" p JOIN "PortalClient" c ON c.id = p."clientId"
   WHERE p.type='NFSE' AND p."xmlRaw" LIKE '%pedRegEvento%'
   GROUP BY 1,2,3,4 ORDER BY n DESC`);
if (!sobrescritas.length) console.log("   nenhuma.");
for (const s of sobrescritas) {
  console.log(`   ${String(s.razao).slice(0, 44).padEnd(44)} ${s.papel}/${s.status}/${s.statusEfetivo}: ${num(s.n)}`);
  console.log(`   ${" ".repeat(44)}   sem número: ${s.sem_numero} · sem valor: ${s.sem_valor} · entre ${new Date(s.de).toISOString().slice(0, 19)} e ${new Date(s.ate).toISOString().slice(0, 19)}`);
}
console.log("   ⚠ Essas linhas ficam `EMITIDA/autorizada` — o evento que as cancelava virou o");
console.log("     conteúdo delas. É o caso em que 'não temos o dado' se PARECE com 'nada houve'.");

// ── 7) A empresa pedida ──────────────────────────────────────────────────────────────────────
if (!alvo) {
  console.log("\n(Sem trecho de razão social no argumento — parando na visão global.)\nNada foi alterado.");
  await prisma.$disconnect();
  process.exit(0);
}

const empresas = await prisma.$queryRawUnsafe(
  `SELECT id, razao, cnpj, status FROM "PortalClient" WHERE razao ILIKE $1 ORDER BY razao`, `%${alvo}%`);
console.log(`\n[7] EMPRESAS que casam com "${alvo}": ${empresas.length}`);

for (const emp of empresas) {
  linha();
  console.log(`${emp.razao}  ·  CNPJ ${mascara(emp.cnpj)}  ·  ${emp.status}`);
  linha();

  const notas = await prisma.$queryRawUnsafe(`
    SELECT numero, "chaveAcesso", "issueDate", competencia, status, "statusEfetivo", papel, total,
           "createdAt", "updatedAt",
           substring("xmlRaw" from '<cStat>([0-9]+)</cStat>') AS cstat,
           substring("xmlRaw" from '<chSubstda>([0-9]+)</chSubstda>') AS substitui,
           ("xmlRaw" LIKE '%pedRegEvento%') AS e_evento
      FROM "PortalInvoice"
     WHERE "clientId" = $1 AND type='NFSE'
     ORDER BY "issueDate" NULLS LAST, "createdAt"`, emp.id);

  const filtradas = compArg
    ? notas.filter((n) => n.competencia && new Date(n.competencia).toISOString().slice(0, 7) === compArg)
    : notas;
  console.log(`\n   NFS-e: ${num(notas.length)} no total` + (compArg ? ` · ${num(filtradas.length)} em ${compArg}` : ""));

  for (const n of filtradas) {
    const comp = n.competencia ? new Date(n.competencia).toISOString().slice(0, 7) : "?";
    const emis = n.issueDate ? new Date(n.issueDate).toISOString().slice(0, 10) : "?";
    console.log(
      `   nº ${String(n.numero ?? "(SEM NÚMERO)").padEnd(12)} ${comp} emiss ${emis} R$ ${String(n.total ?? "-").padStart(11)} ` +
      `${String(n.status).padEnd(10)}/${String(n.statusEfetivo || "-").padEnd(11)} ${n.papel || "-"} ` +
      `cStat=${n.cstat || "-"} chave=${mascara(n.chaveAcesso)}` +
      `${n.e_evento ? "  ⚠ XML-É-EVENTO (nota sobrescrita)" : ""}`);
    if (n.substitui) console.log(`      └ SUBSTITUI a nota de chave …${n.substitui.slice(-6)}  ← só no XML, nenhuma coluna diz isso`);
    console.log(`      capturada ${new Date(n.createdAt).toISOString().slice(0, 19)} · atualizada ${new Date(n.updatedAt).toISOString().slice(0, 19)}`);
  }

  // O que a APURAÇÃO enxerga (mesmo filtro de faturamentoEmitDaCompetencia)
  const fat = filtradas.filter((n) => n.papel === "EMIT" && n.statusEfetivo === "autorizada");
  const soma = fat.reduce((a, n) => a + Number(n.total || 0), 0);
  console.log(`\n   FATURAMENTO que a apuração conta (papel=EMIT + statusEfetivo=autorizada): ` +
    `${fat.length} nota(s), R$ ${soma.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  console.log("   (a aba de Notas ESCONDE as canceladas por padrão — routes/firm/notas.js:420)");

  const ev = await um(`SELECT count(*)::int AS n FROM "PortalInvoiceEvent" WHERE "clientId" = $1`, emp.id);
  const st = await um(`SELECT "adnNsuCursor","adnLastSyncAt","adnLastAttemptAt","adnLastError" FROM "PortalSyncState" WHERE "clientId" = $1`, emp.id);
  console.log(`\n   PortalInvoiceEvent desta empresa: ${ev === null ? "ilegível" : num(ev.n)}`);
  if (st) {
    console.log(`   cursor NSU=${st.adnNsuCursor} · recebemos ${st.adnLastSyncAt || "nunca"} · olhamos ${st.adnLastAttemptAt || "nunca"}`);
    console.log(`   último erro: ${st.adnLastError || "(nenhum)"}`);
  } else console.log("   ⚠ sem PortalSyncState — captura ADN nunca iniciada.");
}

console.log("\nNada foi alterado.");
await prisma.$disconnect();
