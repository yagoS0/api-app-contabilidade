// A CLASSIFICAÇÃO NUNCA RODOU — MAS POR QUÊ? Este script separa as três causas possíveis.
//
// Medido antes dele: `tipoReceita` é NULO em 16.153 de 16.153 `NotaItem`. Isso trava a conciliação
// DAS × SERPRO (a Fase 5 exige `preApurado.ok`, hoje falso em 100% das empresas) e é o que faz
// parecer que falta o de-para LC 116 → tipo de receita.
//
// ⚠⚠ MAS O DE-PARA JÁ EXISTE, e medido em 26/08/2026 ele cobre TUDO: 205 subitens da LC 116, 87
// com regra específica em `RegraClassificacaoSeeds` e os 40 capítulos mapeados como fallback —
// **zero subitens sem resposta**. Ou seja: pode não faltar regra nenhuma. As causas possíveis são
// outras, e são muito mais baratas de consertar:
//
//   A) o SEED nunca foi aplicado em produção  → a tabela está vazia no banco, o classificador lê
//      zero regras e manda tudo para a fila. Conserto: rodar o seed.
//   B) o seed está aplicado e o CLASSIFICADOR nunca foi EXECUTADO → conserto: executá-lo.
//   C) ele rodou e as regras não casaram → aí sim falta regra, e o script diz QUAIS códigos.
//
// Distinguir A de B de C é a diferença entre um comando, um botão e um projeto de classificação.
//
// ⚠ SÓ LEITURA. Nenhum `create`/`update`/`delete`, nenhum `--aplicar`, e ZERO chamada externa
// (ADN, SEFAZ, SERPRO). Ele não classifica nada — só conta o que já está no banco.
//
// Uso:
//   node scripts/diag-classificacao-cobertura.mjs [--top=N]
//
// Contra produção (⚠ `railway run … bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-classificacao-cobertura.mjs'

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const TOP = Number((process.argv.find((a) => a.startsWith("--top=")) || "--top=20").split("=")[1]) || 20;

const n = (v) => Number(v || 0).toLocaleString("pt-BR");

async function main() {
  console.log("\n═══ COBERTURA DA CLASSIFICAÇÃO — só leitura, zero chamada externa ═══\n");

  // ─── 1. AS REGRAS EXISTEM NO BANCO? (separa a causa A) ────────────────────────────────────
  const [regrasTotal, regrasGlobais, regrasEmpresa, cnaeCatalogo, atividades] = await Promise.all([
    prisma.regraClassificacao.count(),
    prisma.regraClassificacao.count({ where: { escopo: "GLOBAL" } }),
    prisma.regraClassificacao.count({ where: { escopo: "EMPRESA" } }),
    prisma.cnaeAnexo.count(),
    prisma.atividadePgdasd.count(),
  ]);

  console.log("1) AS REGRAS ESTÃO NO BANCO?");
  console.log(`   RegraClassificacao total .......... ${n(regrasTotal)}`);
  console.log(`     escopo GLOBAL .................. ${n(regrasGlobais)}   (o seed traz 87 itens + 40 capítulos)`);
  console.log(`     escopo EMPRESA ................. ${n(regrasEmpresa)}   (nascem do AprendizadoService)`);
  console.log(`   CnaeAnexo (catálogo) ............. ${n(cnaeCatalogo)}   (o seed traz 127; a CNAE 2.3 tem ~1.330)`);
  console.log(`   AtividadePgdasd .................. ${n(atividades)}   (o seed traz 43)`);
  if (regrasGlobais === 0) {
    console.log("\n   ⚠⚠ CAUSA (A): NÃO HÁ UMA ÚNICA REGRA GLOBAL NO BANCO.");
    console.log("      O de-para existe no código e nunca chegou à produção. O classificador lê zero");
    console.log("      regras e manda 100% dos itens para a fila — que é exatamente o que se vê.");
    console.log("      Conserto: aplicar `RegraClassificacaoSeeds`. Nenhuma regra nova precisa ser escrita.");
  }

  // ─── 2. OS ITENS FORAM CLASSIFICADOS? (separa B de C) ─────────────────────────────────────
  const [itensTotal, itensNulos, itensNaoClass] = await Promise.all([
    prisma.notaItem.count(),
    prisma.notaItem.count({ where: { tipoReceita: null } }),
    prisma.notaItem.count({ where: { tipoReceita: "RECEITA_NAO_CLASSIFICADA" } }),
  ]);
  const classificados = itensTotal - itensNulos - itensNaoClass;

  console.log("\n2) OS ITENS FORAM CLASSIFICADOS?");
  console.log(`   NotaItem total ................... ${n(itensTotal)}`);
  console.log(`     tipoReceita NULO .............. ${n(itensNulos)}   ⚠ o classificador NUNCA ENCOSTOU nesta linha`);
  console.log(`     RECEITA_NAO_CLASSIFICADA ...... ${n(itensNaoClass)}   ⚠ ele rodou e NÃO ACHOU regra`);
  console.log(`     classificados de fato ......... ${n(classificados)}`);
  console.log("\n   ⚠ A DIFERENÇA ENTRE AS DUAS PRIMEIRAS LINHAS É O DIAGNÓSTICO:");
  console.log("     tudo NULO  ⇒ causa (B): o classificador nunca foi executado sobre a base.");
  console.log("     tudo NAO_CLASSIFICADA ⇒ causa (C): ele rodou e faltou regra — veja o item 4.");

  // ─── 3. A FILA DE PENDÊNCIA ESCALA? ───────────────────────────────────────────────────────
  const pendAbertas = await prisma.filaPendencia.count({ where: { tipo: "ITEM_SEM_REGRA", resolvida: false } });
  const pendPorCodigo = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "detalhes"->>'codigo')::int AS codigos,
           COUNT(DISTINCT "portalClientId")::int      AS empresas
    FROM "fila_pendencias"
    WHERE "tipo" = 'ITEM_SEM_REGRA' AND "resolvida" = false
  `.catch(() => null);

  console.log("\n3) A FILA DE PENDÊNCIA ESCALA?");
  console.log(`   ITEM_SEM_REGRA abertas ........... ${n(pendAbertas)}`);
  if (pendPorCodigo?.[0]) {
    const { codigos, empresas } = pendPorCodigo[0];
    console.log(`     códigos DISTINTOS ............. ${n(codigos)}`);
    console.log(`     empresas afetadas ............. ${n(empresas)}`);
    if (codigos > 0) {
      const fator = (pendAbertas / codigos).toFixed(1);
      console.log(`\n   ⚠⚠ ${fator}× — é quantas VEZES a mesma decisão é pedida ao contador.`);
      console.log("      A pendência é deduplicada por (empresa, código), não por código. O mesmo");
      console.log("      código de serviço vira uma pendência POR EMPRESA, e resolver cada uma cria");
      console.log("      RegraClassificacao de escopo EMPRESA (AprendizadoService) — ou seja, a");
      console.log("      decisão é paga de novo a cada cliente. A 1.000 empresas isso é O(n) onde a");
      console.log("      natureza do problema é O(1): o código de serviço não muda de significado");
      console.log("      conforme o cliente. É o item que mais custa HORA HUMANA nesta base.");
    }
  }

  // ─── 4. QUAIS CÓDIGOS FALTAM (só faz sentido na causa C) ──────────────────────────────────
  const topCodigos = await prisma.$queryRaw`
    SELECT "detalhes"->>'codigo' AS codigo,
           COUNT(*)::int                        AS pendencias,
           COUNT(DISTINCT "portalClientId")::int AS empresas
    FROM "fila_pendencias"
    WHERE "tipo" = 'ITEM_SEM_REGRA' AND "resolvida" = false
    GROUP BY 1 ORDER BY 2 DESC LIMIT ${TOP}
  `.catch(() => []);

  if (topCodigos.length) {
    console.log(`\n4) OS ${TOP} CÓDIGOS QUE MAIS PEDEM DECISÃO`);
    console.log("   (resolver UM destes como GLOBAL apagaria todas as linhas dele de uma vez)\n");
    console.log("   código          pendências  empresas");
    for (const r of topCodigos) {
      console.log(`   ${String(r.codigo || "(sem código)").padEnd(15)} ${String(r.pendencias).padStart(10)} ${String(r.empresas).padStart(9)}`);
    }
  } else {
    console.log("\n4) Nenhuma pendência aberta com código — nada a listar.");
  }

  console.log("\n═══ fim — nada foi escrito ═══\n");
}

main()
  .catch((e) => { console.error("\n⚠ falhou:", e?.message || e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
