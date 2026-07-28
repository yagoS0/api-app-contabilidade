// Conserta provisões que ficaram PARCIAL com "saldo em aberto" fantasma.
//
// COMO O ESTADO RUIM SURGIU: ao corrigir na Circular o valor de um tributo (pra menor, porque o
// valor original estava errado), o lançamento da provisão MANTINHA as linhas antigas — havia uma
// regra que preservava o valor original do DAS ao recalcular (feita pro recálculo automático do
// SERPRO, que soma juros após o vencimento). A baixa era feita pelo valor CERTO, menor que o
// principal antigo, e a diferença ficava eternamente "em aberto" (PARCIAL).
//
// Isso já foi corrigido no fluxo (edição manual agora atualiza as linhas e o status é recalculado
// a partir das baixas). Este script arruma o que ficou para trás.
//
//   node scripts/corrigir-provisao-parcial.mjs                 → simulação (não grava)
//   node scripts/corrigir-provisao-parcial.mjs --aplicar       → grava
//   node scripts/corrigir-provisao-parcial.mjs --cnpj=<cnpj>   → limita a uma empresa
//
// O que ele faz: para cada provisão PARCIAL, compara o principal do lançamento com o valor
// CORRIGIDO na circular (acrescimos.<TRIBUTO>.principal). Se o valor corrigido for menor e já
// estiver coberto pelas baixas, ajusta as linhas e marca PAGO.
//
// ⚠ Só mexe em provisão PARCIAL cujo valor corrigido está COBERTO pelas baixas. Não inventa
// valor, não cria nem apaga lançamento, não toca em baixa.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const aplicar = process.argv.includes("--aplicar");
function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CONTAS_ACRESCIMO = new Set(["501", "506"]); // juros / multa — não amortizam o passivo
const SUBTIPO_TO_TRIBUTO = { DAS: "DAS", INSS: "INSS", IRPJ: "IRPJ", CSLL: "CSLL", ISS: "ISS", PIS_COFINS: "PIS" };

try {
  const cnpj = arg("cnpj");
  let filtroEmpresa = {};
  if (cnpj) {
    const dig = String(cnpj).replace(/\D+/g, "");
    const p = await prisma.portalClient.findFirst({
      where: { OR: [{ cnpj }, { cnpj: dig }] }, select: { id: true, razao: true },
    });
    if (!p) { console.error("Empresa não encontrada."); process.exit(1); }
    filtroEmpresa = { portalClientId: p.id };
    console.log(`Empresa: ${p.razao}\n`);
  }

  const provisoes = await prisma.accountingEntry.findMany({
    where: { tipo: "PROVISAO", statusPagamento: "PARCIAL", ...filtroEmpresa },
    include: {
      lines: true,
      baixas: { include: { lines: true } },
      portalClient: { select: { razao: true } },
    },
  });

  console.log(`${provisoes.length} provisão(ões) em PARCIAL analisada(s)\n`);
  const consertos = [];

  for (const p of provisoes) {
    const principalLancamento = r2(p.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0));
    const abatido = r2(p.baixas.reduce((s, b) => s + b.lines
      .filter((l) => String(l.tipo).toUpperCase() === "D" && !CONTAS_ACRESCIMO.has(String(l.conta || "").trim()))
      .reduce((x, l) => x + Number(l.valor || 0), 0), 0));

    // Valor CORRIGIDO pelo contador, na circular da competência.
    const circular = await prisma.companyMonthlyCircular.findUnique({
      where: { portalClientId_competencia: { portalClientId: p.portalClientId, competencia: p.competencia } },
      select: { acrescimos: true },
    });
    const tributo = SUBTIPO_TO_TRIBUTO[p.subtipo] || p.subtipo;
    const corrigido = Number(circular?.acrescimos?.[tributo]?.principal);
    if (!Number.isFinite(corrigido) || corrigido <= 0) continue;

    // Só corrige quando o valor certo é MENOR que o lançado e já está coberto pelas baixas.
    if (corrigido >= principalLancamento - 0.01) continue;
    if (abatido + 0.01 < corrigido) continue;

    consertos.push({
      id: p.id, razao: p.portalClient?.razao || p.portalClientId,
      competencia: p.competencia, subtipo: p.subtipo,
      de: principalLancamento, para: corrigido, abatido,
    });
  }

  if (!consertos.length) {
    console.log("Nada a corrigir — nenhuma provisão PARCIAL com valor corrigido já coberto pelas baixas.");
  } else {
    for (const c of consertos) {
      console.log(`  ${c.razao} · ${c.competencia} · ${c.subtipo}: principal R$ ${c.de.toFixed(2)} → R$ ${c.para.toFixed(2)} (baixado R$ ${c.abatido.toFixed(2)}) ⇒ PAGO`);
    }
    if (!aplicar) {
      console.log(`\nSimulação — nada gravado. Rode com --aplicar para efetivar.`);
    } else {
      for (const c of consertos) {
        await prisma.$transaction(async (tx) => {
          const linhas = await tx.accountingEntryLine.findMany({ where: { entryId: c.id }, orderBy: { ordem: "asc" } });
          // Ajusta o valor mantendo as CONTAS que o contador já preencheu.
          for (const l of linhas) {
            await tx.accountingEntryLine.update({ where: { id: l.id }, data: { valor: c.para } });
          }
          await tx.accountingEntry.update({ where: { id: c.id }, data: { statusPagamento: "PAGO" } });
        });
      }
      console.log(`\n✓ ${consertos.length} provisão(ões) corrigida(s) e marcada(s) como PAGO.`);
    }
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
