// A MEMÓRIA DE HISTÓRICO QUE JÁ EXISTE — mede antes de a Fase C construir uma segunda.
//
// ⚠⚠ POR QUE ESTE SCRIPT EXISTE. O plano da conferência previa aprender "descrição → conta" numa
// tabela NOVA (`RegraContabilizacao`). Ao escrever o backfill (C0) apareceu `AccountingHistorico`,
// que já responde exatamente isso e já está POVOADA. Construir a segunda sem medir a primeira
// produziria duas memórias discordando sobre a mesma descrição da mesma empresa — o defeito que
// este projeto já pagou com o parser de OFX, com a ingestão de NFS-e e com o filtro de envio de
// guia (quatro cópias).
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum `--aplicar`.
//
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-memoria-historico.mjs'

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** ⚠ A MESMA normalização do backfill: maiúsculas, sem acento, pontuação vira espaço. */
function chave(texto) {
  return String(texto ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

async function main() {
  console.log("=".repeat(96));
  console.log("A MEMÓRIA `AccountingHistorico` — o que ela já sabe");
  console.log("=".repeat(96));

  const memoria = await prisma.accountingHistorico.findMany({
    select: {
      companyPortalClientId: true,
      createdByUserId: true,
      text: true,
      contaDebito: true,
      contaCredito: true,
      usageCount: true,
    },
  });

  const comDebito = memoria.filter((m) => m.contaDebito);
  const daEmpresa = memoria.filter((m) => m.companyPortalClientId);
  console.log(`\ntotal de registros ................ ${memoria.length}`);
  console.log(`  com contaDebito ................. ${comDebito.length} (${pct(comDebito.length, memoria.length)})`);
  console.log(`  com escopo de EMPRESA ........... ${daEmpresa.length} (${pct(daEmpresa.length, memoria.length)})`);
  console.log(`  ⚠ GLOBAIS (companyPortalClientId nulo) ... ${memoria.length - daEmpresa.length}`);
  console.log(`  usuários distintos .............. ${new Set(memoria.map((m) => m.createdByUserId)).size}`);
  console.log(`  empresas distintas .............. ${new Set(daEmpresa.map((m) => m.companyPortalClientId)).size}`);

  // ── O QUE O BACKFILL (C0) PRODUZIRIA ────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(96));
  console.log("O QUE O BACKFILL DOS 155 DESPESA PRODUZIRIA — e quanto disso a memória JÁ tem");
  console.log("=".repeat(96));

  const entries = await prisma.accountingEntry.findMany({
    where: { tipo: "DESPESA" },
    select: {
      id: true,
      portalClientId: true,
      historico: true,
      origem: true,
      lines: { select: { conta: true, tipo: true } },
    },
  });
  console.log(`\nlançamentos tipo DESPESA .......... ${entries.length}`);

  // ⚠ A conta que interessa é a do DÉBITO — a de crédito é sempre o caixa (medido: 155/155).
  const pares = new Map(); // empresa|chave -> Map(contaDebito -> n)
  let semDebito = 0;
  for (const e of entries) {
    const d = (e.lines || []).filter((l) => l.tipo === "D");
    if (d.length !== 1 || !d[0].conta) {
      semDebito += 1;
      continue;
    }
    const k = `${e.portalClientId}|${chave(e.historico)}`;
    if (!pares.has(k)) pares.set(k, new Map());
    const m = pares.get(k);
    m.set(d[0].conta, (m.get(d[0].conta) || 0) + 1);
  }
  console.log(`⚠ fora (sem exatamente uma linha de débito com conta) ... ${semDebito}`);
  console.log(`chaves empresa × descrição ........ ${pares.size}`);

  const unanimes = [...pares.entries()].filter(([, m]) => m.size === 1);
  const divididos = [...pares.entries()].filter(([, m]) => m.size > 1);
  console.log(`  UNÂNIMES (uma conta só) ......... ${unanimes.length}`);
  console.log(`  ⚠ DIVIDIDOS (2+ contas) ......... ${divididos.length}`);
  for (const [k, m] of divididos.slice(0, 10)) {
    console.log(`      ${k.split("|")[1].slice(0, 50)} → ${[...m.entries()].map(([c, n]) => `${c}×${n}`).join("  ")}`);
  }

  const pisoDois = unanimes.filter(([, m]) => [...m.values()][0] >= 2);
  console.log(`  unânimes com PISO 2+ ............ ${pisoDois.length}`);

  // ── A SOBREPOSIÇÃO: quanto o backfill descobriria que a memória já sabe ─────────────────────
  console.log("\n" + "=".repeat(96));
  console.log("⚠⚠ A SOBREPOSIÇÃO — é ela que decide se a Fase C constrói ou LÊ");
  console.log("=".repeat(96));

  const naMemoria = new Map(); // empresa|chave -> Set(contaDebito)
  for (const m of memoria) {
    if (!m.contaDebito) continue;
    const k = `${m.companyPortalClientId}|${chave(m.text)}`;
    if (!naMemoria.has(k)) naMemoria.set(k, new Set());
    naMemoria.get(k).add(m.contaDebito);
  }

  let jaSabe = 0;
  let jaSabeIgual = 0;
  let jaSabeDIFERENTE = 0;
  const conflitos = [];
  for (const [k, m] of unanimes) {
    const na = naMemoria.get(k);
    if (!na) continue;
    jaSabe += 1;
    const contaDoBackfill = [...m.keys()][0];
    if (na.size === 1 && [...na][0] === contaDoBackfill) jaSabeIgual += 1;
    else {
      jaSabeDIFERENTE += 1;
      conflitos.push({ k, backfill: contaDoBackfill, memoria: [...na] });
    }
  }
  console.log(`\ndas ${unanimes.length} chaves unânimes do histórico:`);
  console.log(`  a memória JÁ conhece ............ ${jaSabe} (${pct(jaSabe, unanimes.length)})`);
  console.log(`     e concorda .................. ${jaSabeIgual}`);
  console.log(`  ⚠⚠ e DISCORDA .................. ${jaSabeDIFERENTE}`);
  for (const c of conflitos.slice(0, 15)) {
    console.log(`      ${c.k.split("|")[1].slice(0, 44)} | backfill=${c.backfill} memória=${c.memoria.join(",")}`);
  }
  console.log(`  a memória NÃO conhece .......... ${unanimes.length - jaSabe}  ← o que o backfill acrescentaria`);

  console.log("\n⚠ LIMITE DESTA MEDIÇÃO: a chave da memória inclui `createdByUserId`, e a do backfill");
  console.log("  não. Duas linhas do mesmo texto e da mesma empresa, de usuários diferentes, aparecem");
  console.log("  aqui achatadas — é de propósito: a pergunta é o que a EMPRESA sabe, não o usuário.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
