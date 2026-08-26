// RODAR O CLASSIFICADOR SOBRE A CARTEIRA — o passo que destrava a conciliação DAS × SERPRO.
//
// Medido em 26/08/2026 (`diag-classificacao-cobertura.mjs` · `-55`): o de-para NÃO é o bloqueio.
// As 127 regras GLOBAIS estão no banco, 54 dos 55 códigos não classificados já têm regra, e onde o
// classificador rodou ele acertou **1.315 de 1.315** (zero `RECEITA_NAO_CLASSIFICADA`, zero
// pendência). O que faltava era EXECUTAR — tempo de máquina, não hora humana.
//
// ⚠⚠ ESTE SCRIPT ESCREVE. É o primeiro desta família que não é só leitura, e por isso:
//
//   · **ENSAIO POR PADRÃO.** Sem `--aplicar` ele conta o que faria e não grava nada.
//   · **A LISTA DE DESFAZER É GRAVADA ANTES DA PRIMEIRA ESCRITA**, num arquivo local com os ids
//     que estavam `tipoReceita: null`. Sem ela o caminho de volta dependeria de adivinhar quais
//     linhas foram tocadas.
//   · **CANÁRIO OBRIGATÓRIO.** `--aplicar` sozinho roda UMA empresa e para. Só `--aplicar --tudo`
//     segue para a carteira. Uma carteira inteira escrita antes de alguém olhar o primeiro
//     resultado é o tipo de erro que não se desfaz com pressa.
//
// ⚠ `force` NÃO é oferecido, de propósito. Com `force: true` o classificador varre TAMBÉM o que já
// está classificado — inclusive competências já TRANSMITIDAS à Receita. O default (`false`) filtra
// `tipoReceita: null`, que é exatamente o alvo, e deixa os 1.315 existentes intocados.
//
// ⚠ ZERO CHAMADA EXTERNA. Não fala com ADN, SEFAZ nem SERPRO — é cálculo local sobre o que já está
// no banco. E não transmite nada: classificar não é ato fiscal.
//
// Uso:
//   node scripts/rodar-classificacao.mjs                    # ensaio da carteira
//   node scripts/rodar-classificacao.mjs --aplicar          # ⚠ ESCREVE — só o canário
//   node scripts/rodar-classificacao.mjs --aplicar --tudo   # ⚠ ESCREVE — a carteira
//
// Contra produção (⚠ `railway run … bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/rodar-classificacao.mjs'

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { classificarItensV2 } from "../src/application/notas/apuracao/v2/ClassificadorService.js";

const APLICAR = process.argv.includes("--aplicar");
const TUDO = process.argv.includes("--tudo");
const n = (v) => Number(v || 0).toLocaleString("pt-BR");

async function main() {
  console.log(`\n═══ CLASSIFICADOR — ${APLICAR ? "⚠ APLICANDO (ESCREVE)" : "ENSAIO (nada é gravado)"} ═══\n`);

  // ─── 1. O ALVO, contado no banco ──────────────────────────────────────────────────────────
  const porEmpresa = await prisma.$queryRaw`
    SELECT p."id"    AS "portalClientId",
           p."razao" AS razao,
           COUNT(*)::int AS itens
    FROM "nota_itens" i
    JOIN "PortalInvoice" nt ON nt."id" = i."notaId"
    JOIN "PortalClient"  p  ON p."id"  = nt."clientId"
    WHERE i."tipoReceita" IS NULL
    GROUP BY 1, 2
    ORDER BY 3 DESC
  `;
  const total = porEmpresa.reduce((s, e) => s + e.itens, 0);
  console.log(`empresas com item não classificado ... ${porEmpresa.length}`);
  console.log(`itens a classificar .................. ${n(total)}\n`);
  if (!porEmpresa.length) {
    console.log("Nada a fazer — nenhum item com `tipoReceita` nulo.\n");
    return;
  }

  for (const e of porEmpresa.slice(0, 40)) {
    console.log(`   ${String(e.razao || e.portalClientId).slice(0, 44).padEnd(46)} ${String(n(e.itens)).padStart(8)}`);
  }
  if (porEmpresa.length > 40) console.log(`   … e mais ${porEmpresa.length - 40} empresa(s)`);

  if (!APLICAR) {
    console.log("\n⚠ ENSAIO. Nada foi gravado. Para aplicar: `--aplicar` (canário) e depois `--aplicar --tudo`.\n");
    return;
  }

  // ─── 2. A LISTA DE DESFAZER, gravada ANTES da primeira escrita ────────────────────────────
  // ⚠⚠ O CANÁRIO É A MENOR EXPOSIÇÃO, NUNCA A PRIMEIRA DA LISTA. A lista vem ordenada por VOLUME
  // (desc), então `slice(0, 1)` pegaria a SINTROPIA — 15.577 dos 16.476 itens, 94,5% do total.
  // Canário que escreve quase tudo não é canário: é a carteira com outro nome.
  //
  // ⚠ E não é a MENOR de todas (1 item não exercita quase nada): é a menor com pelo menos alguns
  // itens, para o resultado ter o que dizer.
  const MIN_CANARIO = 5;
  const canario = [...porEmpresa].reverse().find((e) => e.itens >= MIN_CANARIO) || porEmpresa[porEmpresa.length - 1];
  const alvos = APLICAR && !TUDO ? [canario] : porEmpresa;
  const ids = await prisma.notaItem.findMany({
    where: {
      tipoReceita: null,
      nota: { clientId: { in: alvos.map((a) => a.portalClientId) } },
    },
    select: { id: true },
  });
  const arquivo = path.resolve(process.cwd(), `desfazer-classificacao-${Date.now()}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({
    gravadoEm: new Date().toISOString(),
    empresas: alvos.map((a) => ({ portalClientId: a.portalClientId, razao: a.razao, itens: a.itens })),
    // ⚠ É ESTA LISTA que permite voltar: são os ids que estavam `tipoReceita: null` ANTES da
    // execução. Sem ela, desfazer dependeria de adivinhar quais linhas foram tocadas.
    idsQueEstavamNulos: ids.map((x) => x.id),
  }, null, 2));
  // ⚠ Ela cai no CWD (a raiz do repo, quando rodado pelo `railway run`) e está no `.gitignore`:
  // são MILHARES de ids de PRODUÇÃO, artefato operacional que não pertence ao histórico do git.
  // Guarde-a fora da árvore enquanto a execução ainda puder precisar ser revertida.
  console.log(`\n⚠ lista de desfazer gravada: ${arquivo} (${n(ids.length)} ids)`);
  console.log("   ⚠ ela tem ids de PRODUÇÃO e está no .gitignore — mova-a para fora do repo.");
  console.log(`   para reverter: UPDATE "nota_itens" SET "tipoReceita" = NULL, "classificadoEm" = NULL WHERE "id" = ANY(<ids>);\n`);

  if (!TUDO) {
    console.log(`⚠⚠ CANÁRIO: rodando SÓ ${alvos[0].razao} — ${n(alvos[0].itens)} itens, a MENOR exposição com ao menos ${MIN_CANARIO}. Confira o resultado antes de usar --tudo.`);
    console.log("");
  }

  // ─── 3. A EXECUÇÃO, empresa a empresa ────────────────────────────────────────────────────
  const somas = { processed: 0, classified: 0, pendentes: 0, pendenciasNovas: 0 };
  const porTipo = new Map();
  for (const e of alvos) {
    try {
      // ⚠ Sem `force`: só toca o que está nulo. Competência já transmitida fica intacta.
      const r = await classificarItensV2({ portalClientId: e.portalClientId });
      somas.processed += r.processed || 0;
      somas.classified += r.classified || 0;
      somas.pendentes += r.pendentes || 0;
      somas.pendenciasNovas += r.pendenciasNovas || 0;
      for (const [t, q] of Object.entries(r.byTipo || {})) porTipo.set(t, (porTipo.get(t) || 0) + q);
      const alerta = r.pendentes > 0 ? `  ⚠ ${r.pendentes} sem regra` : "";
      console.log(`   ✓ ${String(e.razao || "").slice(0, 40).padEnd(42)} ${String(n(r.classified)).padStart(7)} classificados${alerta}`);
    } catch (err) {
      // ⚠ Uma empresa que falha NÃO derruba a carteira — e o erro aparece nomeado, nunca engolido.
      console.log(`   ✗ ${String(e.razao || "").slice(0, 40).padEnd(42)} FALHOU: ${err?.message || err}`);
    }
  }

  console.log(`\n─── RESULTADO ───`);
  console.log(`   processados ......... ${n(somas.processed)}`);
  console.log(`   classificados ....... ${n(somas.classified)}`);
  console.log(`   sem regra (pendência) ${n(somas.pendentes)}`);
  console.log(`   pendências criadas ... ${n(somas.pendenciasNovas)}`);
  if (porTipo.size) {
    console.log(`\n   por tipo de receita:`);
    for (const [t, q] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`     ${t.padEnd(28)} ${String(n(q)).padStart(8)}`);
    }
  }
  console.log("");
}

main()
  .catch((e) => { console.error("\n⚠ falhou:", e?.message || e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
