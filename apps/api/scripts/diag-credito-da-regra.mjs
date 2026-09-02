/**
 * ⚠⚠ QUANTOS LANÇAMENTOS FICARAM COM O CRÉDITO ERRADO — só LEITURA.
 *
 * O defeito, achado em 01/09/2026: desde 29/08 a regra do fornecedor guardava `contaCredito` e
 * `lancarPorRegra` a passava para `aplicarTransicao`, que a DESCARTAVA (não havia coluna nem
 * tratamento). O lançamento saía creditando o CAIXA cravado, sem erro nenhum.
 *
 * O código foi consertado; o DADO que já nasceu torto, não. Este script mede quanto é.
 *
 * ⚠ Ele não escreve NADA. O conserto, se houver o que consertar, é decisão do dono — e mexer na
 * perna de crédito de um lançamento é mexer no razão.
 *
 *   node scripts/diag-credito-da-regra.mjs
 */
import { prisma } from "../src/infrastructure/db/prisma.js";

const CAIXA_COMPLETO = "111010001";

function linha(...c) {
  console.log(c.join(" | "));
}

async function main() {
  // 1. As regras que ESCOLHERAM um crédito diferente do caixa.
  let regras = [];
  try {
    regras = await prisma.regraContabilizacao.findMany({
      where: { contaCredito: { not: null } },
      select: { id: true, portalClientId: true, contaCredito: true, contaDestino: true, cnpjFornecedor: true, lancaSozinha: true },
    });
  } catch (e) {
    console.log(`⚠ Não consegui ler as regras: ${e?.code || ""} ${e?.message}`);
    return;
  }

  console.log(`\nREGRAS COM CRÉDITO ESCOLHIDO: ${regras.length}`);
  const comCreditoNaoCaixa = regras.filter((r) => String(r.contaCredito).trim() !== CAIXA_COMPLETO);
  console.log(`  destas, com crédito DIFERENTE do caixa: ${comCreditoNaoCaixa.length}`);
  if (!comCreditoNaoCaixa.length) {
    console.log("\n✓ NENHUMA regra escolheu crédito diferente do caixa — não há dado torto a consertar.");
    console.log("  (o defeito existia no código; ele nunca chegou a produzir um lançamento errado)");
  }

  // 2. Os declarados lançados POR ESSAS regras.
  const porRegra = new Map(regras.map((r) => [r.id, r]));
  const declarados = await prisma.lancamentoDeclarado.findMany({
    where: { regraId: { in: [...porRegra.keys()] }, accountingEntryId: { not: null } },
    select: {
      id: true, portalClientId: true, regraId: true, accountingEntryId: true,
      contaCredito: true, contaAplicada: true, descricaoOriginal: true, competencia: true,
    },
  });
  console.log(`\nLANÇAMENTOS NASCIDOS DESSAS REGRAS: ${declarados.length}`);

  if (!declarados.length) {
    console.log("✓ Nenhum lançamento foi criado por regra com crédito escolhido.");
    return;
  }

  // 3. O que cada `AccountingEntry` de fato creditou.
  const entries = await prisma.accountingEntry.findMany({
    where: { id: { in: declarados.map((d) => d.accountingEntryId) } },
    select: { id: true, portalClientId: true, lines: { select: { tipo: true, conta: true, valor: true } } },
  });
  const porEntry = new Map(entries.map((e) => [e.id, e]));

  const plano = await prisma.chartOfAccount.findMany({
    select: { codigo: true, codigoCompleto: true, portalClientId: true },
  });
  const completoDoReduzido = new Map();
  for (const c of plano) {
    const k = String(c.codigo || "").trim();
    if (!k) continue;
    const atual = completoDoReduzido.get(k);
    if (!atual || (c.portalClientId && !atual.portalClientId)) completoDoReduzido.set(k, c);
  }

  const tortos = [];
  for (const d of declarados) {
    const e = porEntry.get(d.accountingEntryId);
    if (!e) continue;
    const creditos = (e.lines || []).filter((l) => String(l.tipo).toUpperCase() === "C");
    const esperado = String(porRegra.get(d.regraId)?.contaCredito || "").trim();
    for (const c of creditos) {
      const completo = String(completoDoReduzido.get(String(c.conta).trim())?.codigoCompleto || "").trim();
      if (esperado && completo && completo !== esperado) {
        tortos.push({ ...d, creditouReduzido: c.conta, creditouCompleto: completo, esperado });
      }
    }
  }

  console.log(`\n⚠ LANÇAMENTOS QUE CREDITARAM CONTA DIFERENTE DA QUE A REGRA ESCOLHEU: ${tortos.length}`);
  if (tortos.length) {
    linha("declarado", "empresa", "competência", "creditou", "a regra queria", "descrição");
    for (const t of tortos.slice(0, 50)) {
      linha(t.id, t.portalClientId, t.competencia, `${t.creditouReduzido} (${t.creditouCompleto})`, t.esperado, t.descricaoOriginal);
    }
    if (tortos.length > 50) console.log(`… e mais ${tortos.length - 50}`);
  }

  // 4. A coluna nova: alguém já escolheu crédito na Conferência?
  const comColuna = await prisma.lancamentoDeclarado.count({ where: { contaCredito: { not: null } } });
  console.log(`\nDECLARADOS COM \`contaCredito\` PRÓPRIO (coluna nova): ${comColuna}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
