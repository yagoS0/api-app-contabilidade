// Levantamento das linhas de `PortalInvoice` em que o XML de um EVENTO ocupou o lugar da NOTA.
//
// SÓ LEITURA. Não escreve nada, não chama o ADN, não roda DDL.
//
// O mecanismo (já documentado em `notas/cicloNota.js` e `scripts/diag-ciclo-nfse.mjs`): o evento
// traz a chave da NOTA AFETADA. Quando ele entrou por `upsertNfseFromItem` em vez de
// `applyNfseEvento`, o upsert casou a `@@unique([clientId, chaveAcesso])` e escreveu por cima da
// nota que ele cancelava. O registro ficou sem `numero` e sem `total`, com o XML do evento em
// `xmlRaw` — e `status='EMITIDA'` / `statusEfetivo='autorizada'`, ou seja, a tela pinta de verde
// uma nota que foi cancelada.
//
// O marcador é `xmlRaw LIKE '%pedRegEvento%'` — é a raiz do pedido de registro de evento, e é o
// mesmo marcador que `diag-ciclo-nfse.mjs` já usa. `<tpEvento>` NÃO existe nesses XMLs (medido nos
// 62): o código do evento só se lê do `@Id` (`EVT`/`PRE` + chave(50) + tpEvento(6) [+ nSeq(3)]).
//
// Uso:
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node apps/api/scripts/diag-evento-sobrescreveu-nota.mjs'
//
// Opcional: `--json=<arquivo>` grava o inventário para o passo seguinte (a releitura no ADN).

import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/infrastructure/db/prisma.js";

const argJson = process.argv.find((a) => a.startsWith("--json="));
const jsonPath = argJson ? argJson.slice("--json=".length) : null;

const linha = (c = "─") => console.log(c.repeat(96));
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace("T", " ") : "—");

console.log("\nLINHAS DE `PortalInvoice` EM QUE O XML DE UM EVENTO OCUPOU O LUGAR DA NOTA");
console.log("(somente leitura — nada é alterado, o ADN não é consultado)");
linha("═");

// ── 1) A população, sem nenhum filtro além do marcador ──────────────────────────────────────
// Deliberadamente NÃO filtramos por status/papel/data aqui: o número tem de sair do marcador, e
// os recortes aparecem depois. Filtrar antes seria confirmar a medição de ontem em vez de medir.
const todas = await prisma.$queryRawUnsafe(`
  SELECT p.id, p."clientId", c.razao, c.cnpj,
         p.papel, p.status, p."statusEfetivo",
         p.numero, p.total, p."chaveAcesso", p."idNfse",
         p.competencia, p."issueDate", p."createdAt", p."updatedAt",
         p."emitenteDoc", p."tomadorDoc",
         length(p."xmlRaw") AS xml_len,
         substring(p."xmlRaw" from '(?:EVT|PRE)([0-9]{50})') AS chave_no_id,
         substring(p."xmlRaw" from '<chNFSe>([0-9]+)</chNFSe>') AS ch_nfse,
         substring(p."xmlRaw" from '<chSubstituta>([0-9]+)</chSubstituta>') AS ch_substituta,
         substring(p."xmlRaw" from '<dhEvento>([^<]+)</dhEvento>') AS dh_evento,
         (p."xmlRaw" LIKE '%e101101%') AS tem_e101101,
         (p."xmlRaw" LIKE '%e105102%') AS tem_e105102,
         (SELECT count(*)::int FROM "nota_itens" ni WHERE ni."notaId" = p.id) AS n_itens,
         (SELECT count(*)::int FROM "PortalInvoiceEvent" e WHERE e."invoiceId" = p.id) AS n_eventos
    FROM "PortalInvoice" p
    JOIN "PortalClient" c ON c.id = p."clientId"
   WHERE p."xmlRaw" LIKE '%pedRegEvento%'
   ORDER BY c.razao, p."createdAt", p.id`);

console.log(`\n[1] TOTAL com o marcador \`pedRegEvento\` no xmlRaw: ${todas.length}`);
if (todas.length !== 62) {
  console.log(`    ⚠ ATENÇÃO: NÃO são 62. A medição que originou esta tarefa é de 06/07/2026 e`);
  console.log(`      pode ter mudado. NÃO siga para a releitura no ADN sem falar com o dono.`);
} else {
  console.log("    (bate com as 62 medidas anteriormente)");
}

// ── 2) Os recortes: é mesmo a categoria perigosa? ───────────────────────────────────────────
const conta = (f) => todas.filter(f).length;
console.log("\n[2] RECORTES");
console.log(`    numero NULL .................. ${conta((r) => r.numero == null)}`);
console.log(`    total  NULL .................. ${conta((r) => r.total == null)}`);
console.log(`    status = EMITIDA ............. ${conta((r) => r.status === "EMITIDA")}`);
console.log(`    statusEfetivo = autorizada ... ${conta((r) => r.statusEfetivo === "autorizada")}`);
console.log(`    papel = DEST ................. ${conta((r) => r.papel === "DEST")}`);
console.log(`    papel = EMIT ................. ${conta((r) => r.papel === "EMIT")}  ⚠ estes afetariam FATURAMENTO`);
console.log(`    com NotaItem órfão ........... ${conta((r) => r.n_itens > 0)}`);
console.log(`    com PortalInvoiceEvent ....... ${conta((r) => r.n_eventos > 0)}`);
console.log(`    cancelamento simples (e101101) ${conta((r) => r.tem_e101101)}`);
console.log(`    por substituição (e105102) ... ${conta((r) => r.tem_e105102)}`);
console.log(`    chave do XML == chaveAcesso .. ${conta((r) => r.chave_no_id && r.chave_no_id === r.chaveAcesso)}`);

// ── 3) Por empresa e por janela de entrada ──────────────────────────────────────────────────
const porEmpresa = new Map();
for (const r of todas) {
  const k = `${r.razao}`;
  if (!porEmpresa.has(k)) porEmpresa.set(k, []);
  porEmpresa.get(k).push(r);
}
console.log("\n[3] POR EMPRESA");
for (const [razao, rows] of porEmpresa) {
  const de = rows.reduce((a, r) => (a && a < r.createdAt ? a : r.createdAt), null);
  const ate = rows.reduce((a, r) => (a && a > r.createdAt ? a : r.createdAt), null);
  const segs = Math.round((new Date(ate) - new Date(de)) / 1000);
  console.log(`    ${String(razao).slice(0, 44).padEnd(44)} ${String(rows.length).padStart(3)}  ${iso(de)} → ${iso(ate)}  (${segs}s)`);
}
const deG = todas.reduce((a, r) => (a && a < r.createdAt ? a : r.createdAt), null);
const ateG = todas.reduce((a, r) => (a && a > r.createdAt ? a : r.createdAt), null);
console.log(`    ${"JANELA GLOBAL".padEnd(44)} ${String(todas.length).padStart(3)}  ${iso(deG)} → ${iso(ateG)}  (${Math.round((new Date(ateG) - new Date(deG)) / 1000)}s)`);

// ── 4) Entrou alguma DEPOIS da correção? ────────────────────────────────────────────────────
const fora = todas.filter((r) => new Date(r.createdAt) > new Date(ateG.valueOf ? ateG : ateG));
console.log(`\n[4] O caminho ainda produz linhas assim? Última entrada: ${iso(ateG)}`);
console.log(`    (a ramificação \`TipoDocumento === "EVENTO"\` já existe em AdnNotasService)`);

// ── 5) A nota original ainda existe em algum lugar? ─────────────────────────────────────────
// Se a mesma chave aparece em OUTRA linha (outro clientId), há de onde reconstruir sem o ADN.
console.log("\n[5] A NOTA ORIGINAL SOBREVIVEU EM OUTRA LINHA?");
const chaves = todas.map((r) => r.chaveAcesso).filter(Boolean);
let gemeas = [];
if (chaves.length) {
  gemeas = await prisma.$queryRawUnsafe(`
    SELECT p."chaveAcesso", count(*)::int AS n,
           count(*) FILTER (WHERE p."xmlRaw" NOT LIKE '%pedRegEvento%')::int AS n_com_nota
      FROM "PortalInvoice" p
     WHERE p."chaveAcesso" = ANY($1::text[])
     GROUP BY 1 HAVING count(*) > 1`, chaves);
}
console.log(`    chaves que aparecem em mais de uma linha: ${gemeas.length}`);
const comNotaViva = gemeas.filter((g) => g.n_com_nota > 0);
console.log(`    …dessas, com uma linha que AINDA tem o XML da nota: ${comNotaViva.length}`);
if (!comNotaViva.length) {
  console.log("    ⚠ Nenhuma. O XML da nota foi sobrescrito e NÃO é recuperável do nosso dado.");
}

// ── 6) O NSU de origem existe? (é o que permitiria reler pelo caminho que o projeto TEM) ─────
console.log("\n[6] NSU DE ORIGEM");
console.log("    ⚠ `PortalInvoice` NÃO guarda o NSU (já registrado em apps/api/CLAUDE.md).");
const ledger = await prisma.$queryRawUnsafe(`
  SELECT count(*)::int AS c FROM information_schema.tables
   WHERE table_schema='public' AND table_name IN ('documentos','eventos','nsu_watermark')`);
console.log(`    tabelas do ledger (documentos/eventos/nsu_watermark) presentes: ${ledger[0].c}/3`);
if (ledger[0].c === 3) {
  const noLedger = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS c FROM eventos WHERE chave = ANY($1::text[])`, chaves).catch(() => [{ c: null }]);
  console.log(`    eventos no ledger para essas chaves: ${noLedger[0].c ?? "(coluna/tabela não bate)"}`);
  const cursores = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS c FROM nsu_watermark`).catch(() => [{ c: null }]);
  console.log(`    linhas em nsu_watermark: ${cursores[0].c ?? "—"}  (o ledger não foi ligado à captura)`);
}

// ── 7) Cursor NSU atual das empresas afetadas ───────────────────────────────────────────────
const clientIds = [...new Set(todas.map((r) => r.clientId))];
if (clientIds.length) {
  const est = await prisma.$queryRawUnsafe(`
    SELECT c.razao, s."adnNsuCursor", s."adnLastSyncAt", s."adnLastError"
      FROM "PortalSyncState" s JOIN "PortalClient" c ON c.id = s."clientId"
     WHERE s."clientId" = ANY($1::text[])`, clientIds);
  console.log("\n[7] CURSOR NSU DAS EMPRESAS AFETADAS");
  for (const e of est) {
    console.log(`    ${String(e.razao).slice(0, 40).padEnd(40)} cursor=${e.adnNsuCursor}  últimoSync=${iso(e.adnLastSyncAt)}`);
    if (e.adnLastError) console.log(`    ${" ".repeat(40)} últimoErro: ${String(e.adnLastError).slice(0, 90)}`);
  }
}

// ── 8) Inventário linha a linha ─────────────────────────────────────────────────────────────
console.log("\n[8] INVENTÁRIO");
linha();
for (const r of todas) {
  const tipo = r.tem_e105102 ? "e105102 subst" : r.tem_e101101 ? "e101101 canc " : "?????????????";
  console.log(
    `${String(r.razao).slice(0, 22).padEnd(22)} ${r.papel}/${String(r.status).padEnd(8)}/${String(r.statusEfetivo).padEnd(10)}`
    + ` nº=${String(r.numero ?? "—").padEnd(6)} tot=${String(r.total ?? "—").padEnd(6)}`
    + ` itens=${r.n_itens} ev=${r.n_eventos} ${tipo} …${String(r.chaveAcesso || "").slice(-8)} ${iso(r.createdAt)}`,
  );
}
linha();

if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(todas, (k, v) => (typeof v === "bigint" ? String(v) : v), 2));
  console.log(`\nInventário gravado em ${jsonPath}`);
}

console.log("\nNada foi alterado. Nenhuma chamada externa foi feita.\n");
await prisma.$disconnect();
