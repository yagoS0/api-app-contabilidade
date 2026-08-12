// Segunda leitura: PARA CADA uma das 62 linhas, onde está a NOTA que o evento sobrescreveu?
//
// SÓ LEITURA. Não escreve nada, não chama o ADN, não roda DDL.
//
// A primeira medição (`diag-evento-sobrescreveu-nota.mjs`) mostrou algo que a hipótese original
// não previa: as 62 linhas são **31 chaves de acesso × 2 empresas** (KAIZEN e LIFAT), e as 31
// chaves aparecem em MAIS de uma linha com pelo menos uma que ainda tem XML de NOTA.
//
// Se isso se confirmar, a nota NÃO se perdeu: ela está viva noutra linha do próprio banco, e a
// reconstrução não precisa de nenhuma chamada ao ADN.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const linha = (c = "─") => console.log(c.repeat(100));
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 19).replace("T", " ") : "—");

console.log("\nONDE ESTÁ A NOTA QUE CADA EVENTO SOBRESCREVEU?");
console.log("(somente leitura — nada é alterado, o ADN não é consultado)");
linha("═");

// Todas as linhas que compartilham chaveAcesso com alguma das 62.
const todas = await prisma.$queryRawUnsafe(`
  WITH afetadas AS (
    SELECT DISTINCT p."chaveAcesso"
      FROM "PortalInvoice" p
     WHERE p."xmlRaw" LIKE '%pedRegEvento%' AND p."chaveAcesso" IS NOT NULL
  )
  SELECT p.id, p."clientId", c.razao, c.cnpj AS cnpj_empresa,
         p.papel, p.status, p."statusEfetivo", p.numero, p.total,
         p."chaveAcesso", p.competencia, p."issueDate", p."createdAt",
         p."emitenteDoc", p."emitenteNome", p."tomadorDoc", p."tomadorNome",
         (p."xmlRaw" LIKE '%pedRegEvento%') AS eh_evento,
         length(p."xmlRaw") AS xml_len
    FROM "PortalInvoice" p
    JOIN "PortalClient" c ON c.id = p."clientId"
   WHERE p."chaveAcesso" IN (SELECT "chaveAcesso" FROM afetadas)
   ORDER BY p."chaveAcesso", p."createdAt"`);

const porChave = new Map();
for (const r of todas) {
  if (!porChave.has(r.chaveAcesso)) porChave.set(r.chaveAcesso, []);
  porChave.get(r.chaveAcesso).push(r);
}

console.log(`\nchaves envolvidas: ${porChave.size}   ·   linhas no total: ${todas.length}`);

let comNota = 0;
let semNota = 0;
const detalhe = [];
for (const [chave, rows] of porChave) {
  const eventos = rows.filter((r) => r.eh_evento);
  const notas = rows.filter((r) => !r.eh_evento);
  if (notas.length) comNota += 1; else semNota += 1;
  detalhe.push({ chave, eventos, notas });
}

console.log(`\nRESUMO`);
console.log(`  chaves em que a NOTA sobreviveu noutra linha ..... ${comNota}`);
console.log(`  chaves em que só há EVENTO (nota perdida) ........ ${semNota}`);

// ── Quem é a empresa que ficou com a NOTA de verdade? ────────────────────────────────────────
const donos = new Map();
for (const d of detalhe) {
  for (const n of d.notas) {
    const k = `${n.razao} (${n.papel}/${n.status}/${n.statusEfetivo})`;
    donos.set(k, (donos.get(k) || 0) + 1);
  }
}
console.log(`\nQUEM FICOU COM A NOTA (linha não-evento), por empresa/estado:`);
for (const [k, v] of [...donos].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);

// ── Amostra detalhada ───────────────────────────────────────────────────────────────────────
console.log(`\nAMOSTRA (primeiras 6 chaves, todas as linhas de cada uma)`);
linha();
for (const d of detalhe.slice(0, 6)) {
  console.log(`chave …${d.chave.slice(-12)}`);
  for (const r of [...d.eventos, ...d.notas]) {
    console.log(
      `   ${r.eh_evento ? "EVENTO" : "NOTA  "} ${String(r.razao).slice(0, 26).padEnd(26)}`
      + ` ${r.papel}/${String(r.status).padEnd(9)}/${String(r.statusEfetivo).padEnd(10)}`
      + ` nº=${String(r.numero ?? "—").padEnd(7)} tot=${String(r.total ?? "—").padEnd(9)}`
      + ` emit=${String(r.emitenteDoc ?? "—").padEnd(14)} tom=${String(r.tomadorDoc ?? "—").padEnd(14)} ${iso(r.createdAt)}`,
    );
  }
  linha();
}

// ── As empresas envolvidas e seus CNPJs ─────────────────────────────────────────────────────
const empresas = await prisma.$queryRawUnsafe(`
  SELECT DISTINCT c.id, c.razao, c.cnpj
    FROM "PortalInvoice" p JOIN "PortalClient" c ON c.id = p."clientId"
   WHERE p."chaveAcesso" IN (
     SELECT DISTINCT "chaveAcesso" FROM "PortalInvoice"
      WHERE "xmlRaw" LIKE '%pedRegEvento%' AND "chaveAcesso" IS NOT NULL)
   ORDER BY c.razao`);
console.log(`\nEMPRESAS ENVOLVIDAS`);
for (const e of empresas) console.log(`  ${String(e.razao).slice(0, 46).padEnd(46)} CNPJ ${e.cnpj}`);

// ── Essas notas são MESMO de KAIZEN ou LIFAT? (a pergunta que derruba a hipótese) ────────────
// ⚠ Conferido contra o metadado da NOTA viva, não do evento: é a nota que diz quem são as partes.
const CNPJ_KAIZEN = "60237497000198";
const CNPJ_LIFAT = "60994583000145";
const dig = (s) => String(s || "").replace(/\D+/g, "");
const notasVivas = detalhe.flatMap((d) => d.notas);
const daKaizen = notasVivas.filter((n) => dig(n.emitenteDoc) === CNPJ_KAIZEN || dig(n.tomadorDoc) === CNPJ_KAIZEN);
const daLifat = notasVivas.filter((n) => dig(n.emitenteDoc) === CNPJ_LIFAT || dig(n.tomadorDoc) === CNPJ_LIFAT);
console.log(`\nESSAS NOTAS SÃO DE KAIZEN OU LIFAT?`);
console.log(`  notas em que KAIZEN (${CNPJ_KAIZEN}) é prestadora ou tomadora ... ${daKaizen.length}`);
console.log(`  notas em que LIFAT  (${CNPJ_LIFAT}) é prestadora ou tomadora ... ${daLifat.length}`);
const partes = new Map();
for (const n of notasVivas) {
  const k = `emit=${n.emitenteDoc ?? "—"}  tom=${n.tomadorDoc ?? "—"}`;
  partes.set(k, (partes.get(k) || 0) + 1);
}
console.log(`  partes reais das notas vivas:`);
for (const [k, v] of [...partes].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}  ${k}`);

// ── O que MAIS essas empresas têm no banco? (dimensiona a classe inteira) ────────────────────
const carteira = await prisma.$queryRawUnsafe(`
  SELECT c.razao, p.papel, p.status, p."statusEfetivo",
         (p."xmlRaw" LIKE '%pedRegEvento%') AS eh_evento, count(*)::int AS n
    FROM "PortalInvoice" p JOIN "PortalClient" c ON c.id = p."clientId"
   WHERE c.cnpj IN ($1, $2)
   GROUP BY 1,2,3,4,5 ORDER BY c.razao, n DESC`, CNPJ_KAIZEN, CNPJ_LIFAT);
console.log(`\nTODAS AS NOTAS DE KAIZEN E LIFAT NO BANCO`);
for (const r of carteira) {
  console.log(`  ${String(r.razao).slice(0, 30).padEnd(30)} ${r.papel}/${String(r.status).padEnd(9)}/${String(r.statusEfetivo).padEnd(10)} ${r.eh_evento ? "EVENTO" : "nota  "} ${String(r.n).padStart(3)}`);
}

// ── O cinturão de CNPJ pegaria essas linhas hoje? ────────────────────────────────────────────
console.log(`\nO CINTURÃO \`rejeitada_outro_cnpj\` PEGARIA AS 62 HOJE?`);
const guarda = await prisma.$queryRawUnsafe(`
  SELECT c.razao, c.cnpj AS cnpj_empresa, p."emitenteDoc", p."tomadorDoc", count(*)::int AS n
    FROM "PortalInvoice" p JOIN "PortalClient" c ON c.id = p."clientId"
   WHERE p."xmlRaw" LIKE '%pedRegEvento%'
   GROUP BY 1,2,3,4 ORDER BY n DESC`);
for (const g of guarda) {
  const cnpjEmp = String(g.cnpj_empresa || "").replace(/\D+/g, "");
  const emit = String(g.emitenteDoc || "").replace(/\D+/g, "");
  const tom = String(g.tomadorDoc || "").replace(/\D+/g, "");
  const temCnpj = Boolean(emit || tom);
  const bate = emit === cnpjEmp || tom === cnpjEmp;
  const veredito = !temCnpj ? "PASSA (metadado sem CNPJ — não é evidência de nota alheia)"
    : bate ? "PASSA (a empresa é parte)" : "RECUSARIA (rejeitada_outro_cnpj)";
  console.log(`  ${String(g.razao).slice(0, 30).padEnd(30)} n=${String(g.n).padStart(3)} emit=${g.emitenteDoc ?? "NULL"} tom=${g.tomadorDoc ?? "NULL"} → ${veredito}`);
}

console.log("\nNada foi alterado. Nenhuma chamada externa foi feita.\n");
await prisma.$disconnect();
