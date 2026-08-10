// Tira o VALOR da memória de apuração, PRESERVANDO A FORMA — dry-run por padrão.
//
// ⚠ SÓ LEITURA sem `--aplicar`. Nenhuma chamada externa (SERPRO/ADN), nenhum ato fiscal.
//
// ─── O QUE ACONTECEU ──────────────────────────────────────────────────────────────────────────
// `ApuracaoConfigMemory` tem chave `portalClientId` e **nenhuma competência**: um registro por
// empresa, reaberto em TODO mês seguinte. Enquanto `atividadesEscolhidas` guardava
// `valorInterno`/`valorExterno`, o valor de um mês era carregado para dentro de outro.
//
// Medido em produção (12 memórias; 95 pares empresa×competência, 02/2026→07/2026):
//   • o pré-preenchimento veio da memória em 72 casos;
//   • dos 85 com faturamento real, 48 DIVERGIAM da própria competência;
//   • dos 10 SEM faturamento, 10 de 10 abriram com valor > 0 na tela;
//   • o faturamento de 07/2026 da ARAUJO (R$ 20.301,21) aparecia em fev, mar, abr, mai e jun.
//
// E isso derrotava o gate por SOMA: com `somaAtividades > 0` a declaração não é lida como zerada, a
// caixa "Declarar SEM MOVIMENTO" não renderiza e o Calcular fica habilitado — chamada PAGA ao SERPRO
// declarando receita que não existe naquele mês.
//
// ─── ⚠ O QUE ESTE SCRIPT **NÃO** PODE FAZER: LEVAR O MERCADO JUNTO ────────────────────────────
// `NotaItem.flagExportacao` é `false` em 16.153/16.153 itens — o único escritor desse campo é o
// parser de NF-e (CFOP 7xxx); a criação do item da NFS-e nunca o toca. A CDA MARKETING presta
// serviço ao EXTERIOR e as duas declarações dela (65227792202606001, 65227792202607001) saíram com
// receita EXTERNA por causa do `mercado` gravado NESTA memória. Se a limpeza levasse o mercado, ela
// nasceria como interna na competência seguinte e o erro chegaria à declaração.
//
// Por isso o relatório imprime a forma ANTES e DEPOIS, empresa por empresa, e **aborta a escrita**
// se qualquer campo da forma mudar. O código não pede confiança: ele confere.
//
// ─── DEPOIS DE APLICAR ────────────────────────────────────────────────────────────────────────
// O modal passa a pré-preencher o valor com o faturamento da PRÓPRIA competência, na atividade e no
// mercado que a memória lembra (`aplicarFaturamentoNaForma`, em `FechamentoService`). Com 2+
// atividades o campo fica VAZIO, com o motivo na tela — não existe regra de rateio, e inventar uma
// seria o portal chutando o que vai numa declaração.
//
// ⚠ A LIMPEZA NÃO É PRÉ-REQUISITO PARA O CONSERTO. `lerConfigMemory` já normaliza na LEITURA, então
// o valor fantasma para de chegar à tela no primeiro deploy. Este script só torna o banco
// consistente com o que o código faz — e tira do disco um dado fiscal que não deveria estar lá.
//
// USO (leitura em produção, pelo dono):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/limpar-memoria-valor-apuracao.mjs'
//   … mesma linha com `--aplicar` no fim do comando node para gravar.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  CAMPOS_DA_FORMA, normalizarFormaAtividades, somaDaLista,
} from "../src/application/notas/apuracao/v2/ApuracaoConfigMemoryService.js";

const aplicar = process.argv.includes("--aplicar");
const money = (n) => Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const padL = (s, n) => String(s ?? "").slice(0, n).padStart(n);

/** A forma, escrita em uma linha, para o diff antes/depois ser lido a olho nu. */
function descreverForma(lista) {
  const linhas = Array.isArray(lista) ? lista : [];
  if (!linhas.length) return "(vazia)";
  return linhas.map((a) => {
    const partes = CAMPOS_DA_FORMA
      .filter((c) => a?.[c] !== undefined && a?.[c] !== null)
      .map((c) => `${c}=${a[c]}`);
    return `{${partes.join(" ")}}`;
  }).join(" + ");
}

/** Igualdade campo a campo da FORMA. É esta função que autoriza (ou não) a escrita. */
function formaIgual(antes, depois) {
  const a = normalizarFormaAtividades(antes);
  const b = normalizarFormaAtividades(depois);
  if (a.length !== b.length) return false;
  return a.every((linha, i) => CAMPOS_DA_FORMA.every((campo) => {
    const x = linha[campo];
    const y = b[i]?.[campo];
    // `undefined` de um lado e `undefined` do outro é igual; qualquer outra diferença não é.
    return (x === undefined && y === undefined) || String(x) === String(y);
  }));
}

try {
  const memorias = await prisma.apuracaoConfigMemory.findMany({
    select: { portalClientId: true, atividadesEscolhidas: true, atualizadoEm: true },
    orderBy: { atualizadoEm: "desc" },
  });

  if (!memorias.length) {
    console.log("Nenhuma memória de apuração. Nada a fazer.");
    await prisma.$disconnect();
    process.exit(0);
  }

  const empresas = await prisma.portalClient.findMany({
    where: { id: { in: memorias.map((m) => m.portalClientId) } },
    select: { id: true, razao: true, cnpj: true },
  });
  const nomePorId = new Map(empresas.map((e) => [e.id, e]));

  console.log("=".repeat(120));
  console.log(`MEMÓRIA DE APURAÇÃO — tirar o VALOR, preservar a FORMA  (${memorias.length} empresa(s))`);
  console.log(aplicar ? "MODO: APLICAR (grava)" : "MODO: DRY-RUN (nada é alterado)");
  console.log("=".repeat(120));

  const paraLimpar = [];
  const jaLimpas = [];
  const semMercado = [];
  let abortar = false;

  for (const m of memorias) {
    const empresa = nomePorId.get(m.portalClientId);
    const antes = Array.isArray(m.atividadesEscolhidas) ? m.atividadesEscolhidas : [];
    const depois = normalizarFormaAtividades(antes);
    const soma = somaDaLista(antes);

    // ⚠ O PORTÃO. Se a forma mudou, nada é gravado — nem nesta empresa, nem em nenhuma outra.
    if (!formaIgual(antes, depois)) {
      abortar = true;
      console.log(`\n⛔ FORMA MUDARIA — ${empresa?.razao || m.portalClientId}`);
      console.log(`   antes : ${descreverForma(antes)}`);
      console.log(`   depois: ${descreverForma(depois)}`);
      continue;
    }
    // Mercado ausente não é erro deste script (ele preserva o que existe), mas precisa APARECER: é
    // a informação que não tem segunda fonte nesta base.
    if (depois.some((a) => !a.mercado)) semMercado.push(empresa?.razao || m.portalClientId);

    const registro = { m, empresa, antes, depois, soma };
    if (soma > 0 || JSON.stringify(antes) !== JSON.stringify(depois)) paraLimpar.push(registro);
    else jaLimpas.push(registro);
  }

  console.log(`\n[1] FORMA — ANTES × DEPOIS (o mercado é a coluna que precisa sobreviver)`);
  console.log(`    ${pad("empresa", 30)}${padL("valor gravado", 16)}  ${pad("mercados", 22)}forma`);
  for (const r of [...paraLimpar, ...jaLimpas]) {
    const mercados = [...new Set(r.depois.map((a) => a.mercado || "(ausente)"))].join("/");
    console.log(`    ${pad(r.empresa?.razao || r.m.portalClientId, 30)}${padL(money(r.soma), 16)}  ${pad(mercados, 22)}${descreverForma(r.depois)}`);
    if (r.soma > 0) {
      console.log(`    ${" ".repeat(30)}${padL("↑ sai da memória", 16)}  ${" ".repeat(22)}(antes: ${descreverForma(r.antes)})`);
    }
  }

  console.log(`\n[2] RESUMO`);
  console.log(`    com valor gravado (serão limpas) .... ${paraLimpar.length}`);
  console.log(`    já sem valor ........................ ${jaLimpas.length}`);
  console.log(`    formas que mudariam (⛔ bloqueio) ... ${abortar ? "SIM — nada será gravado" : "nenhuma"}`);
  console.log(`    sem \`mercado\` gravado ............... ${semMercado.length}${semMercado.length ? `: ${semMercado.join(", ")}` : ""}`);
  if (semMercado.length) {
    console.log("    ⚠ Estas nascem SEM mercado na memória. O portal completa pelo catálogo oficial");
    console.log("      (`AtividadePgdasd.mercado`, pelo idAtividade) — não por suposição. Confira se");
    console.log("      alguma delas presta serviço ao exterior antes da próxima apuração.");
  }

  if (abortar) {
    console.log("\n⛔ ABORTADO: a normalização mudaria a FORMA de pelo menos uma memória.");
    console.log("   Nada foi gravado. Isto é bug do normalizador, não dado ruim — investigue antes.");
    process.exitCode = 1;
  } else if (!aplicar) {
    console.log(`\n${paraLimpar.length} memória(s) seriam reescritas SEM valor. NADA foi alterado.`);
    console.log("Para aplicar, acrescente --aplicar ao comando node.");
  } else if (!paraLimpar.length) {
    console.log("\nNada a gravar: todas as memórias já estão sem valor.");
  } else {
    let gravadas = 0;
    for (const r of paraLimpar) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.apuracaoConfigMemory.update({
        where: { portalClientId: r.m.portalClientId },
        data: { atividadesEscolhidas: r.depois },
      });
      gravadas += 1;
    }
    console.log(`\n${gravadas} memória(s) reescritas SEM valor.`);

    // Reler e conferir do banco — não do que temos em memória. O portão da tarefa é o mercado.
    const conferencia = await prisma.apuracaoConfigMemory.findMany({
      where: { portalClientId: { in: paraLimpar.map((r) => r.m.portalClientId) } },
      select: { portalClientId: true, atividadesEscolhidas: true },
    });
    const porId = new Map(conferencia.map((c) => [c.portalClientId, c.atividadesEscolhidas]));
    let ok = 0;
    for (const r of paraLimpar) {
      const noBanco = porId.get(r.m.portalClientId);
      const formaOk = formaIgual(r.antes, noBanco);
      const semValor = somaDaLista(noBanco) === 0;
      if (formaOk && semValor) ok += 1;
      else {
        console.log(`    ⛔ ${r.empresa?.razao || r.m.portalClientId}: forma=${formaOk ? "ok" : "MUDOU"} valor=${semValor ? "zerado" : "AINDA PRESENTE"}`);
        console.log(`       no banco: ${descreverForma(noBanco)}`);
        process.exitCode = 1;
      }
    }
    console.log(`\n[3] CONFERÊNCIA PÓS-ESCRITA (relida do banco): ${ok}/${paraLimpar.length} com a FORMA intacta e sem valor.`);
  }

  console.log("\n" + "=".repeat(120));
} catch (err) {
  console.error("ERRO:", err?.message || err);
  console.error(err?.stack);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
