// Separa BAIXAS antigas que ficaram com principal + juros + multa num lançamento só (3D/1C).
//
// A regra do projeto é que cada componente seja um LANÇAMENTO próprio, balanceado contra o caixa:
//   D principal / C caixa · D juros / C caixa · D multa / C caixa
// Juros e multa são DESPESA do mês do pagamento, não amortização do passivo — misturados num
// lançamento só eles somem dentro do dropdown e inflam a baixa do tributo.
//
// O fluxo já foi corrigido (baixa do INSS e a genérica criam lançamentos separados); este script
// arruma o que foi lançado ANTES.
//
//   node scripts/separar-baixas-agrupadas.mjs                → simulação (não grava)
//   node scripts/separar-baixas-agrupadas.mjs --aplicar      → grava
//   node scripts/separar-baixas-agrupadas.mjs --cnpj=<cnpj>  → limita a uma empresa
//
// Como identifica: lançamento tipo BAIXA com 2+ linhas de DÉBITO, sendo ao menos uma nas contas
// de acréscimo (501 juros / 506 multa). O que tem só principal já está certo e é ignorado.
//
// Preserva tudo que liga o lançamento ao resto: data, competência, subtipo, origem, openEntryId
// (vínculo com a provisão, base do cálculo de saldo) e sourceGuideId. `guide.lancamentoId` passa
// a apontar para o lançamento do PRINCIPAL.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const aplicar = process.argv.includes("--aplicar");
function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const CONTA_JUROS = "501";
const CONTA_MULTA = "506";
const SUFIXO = { PRINCIPAL: "", JUROS: " (juros)", MULTA: " (multa)" };

function papelDaLinha(conta) {
  const c = String(conta || "").trim();
  if (c === CONTA_JUROS) return "JUROS";
  if (c === CONTA_MULTA) return "MULTA";
  return "PRINCIPAL";
}

try {
  const cnpj = arg("cnpj");
  let filtro = {};
  if (cnpj) {
    const dig = String(cnpj).replace(/\D+/g, "");
    const p = await prisma.portalClient.findFirst({
      where: { OR: [{ cnpj }, { cnpj: dig }] }, select: { id: true, razao: true },
    });
    if (!p) { console.error("Empresa não encontrada."); process.exit(1); }
    filtro = { portalClientId: p.id };
    console.log(`Empresa: ${p.razao}\n`);
  }

  const baixas = await prisma.accountingEntry.findMany({
    where: { tipo: "BAIXA", ...filtro },
    include: { lines: { orderBy: { ordem: "asc" } }, portalClient: { select: { razao: true } } },
    orderBy: { data: "asc" },
  });

  const alvos = baixas.filter((b) => {
    const debitos = b.lines.filter((l) => String(l.tipo).toUpperCase() === "D");
    if (debitos.length < 2) return false;
    return debitos.some((l) => [CONTA_JUROS, CONTA_MULTA].includes(String(l.conta || "").trim()));
  });

  console.log(`${baixas.length} baixa(s) analisada(s) · ${alvos.length} com principal+juros/multa juntos\n`);

  if (!alvos.length) {
    console.log("Nada a separar.");
  } else {
    for (const b of alvos) {
      const debitos = b.lines.filter((l) => String(l.tipo).toUpperCase() === "D");
      const grupos = {};
      for (const l of debitos) {
        const papel = papelDaLinha(l.conta);
        grupos[papel] = grupos[papel] || [];
        grupos[papel].push(l);
      }
      const resumo = Object.entries(grupos)
        .map(([papel, ls]) => `${papel} R$ ${r2(ls.reduce((s, l) => s + Number(l.valor || 0), 0)).toFixed(2)}`)
        .join(" + ");
      console.log(`  ${b.portalClient?.razao || b.portalClientId} · ${b.competencia} · ${b.historico}`);
      console.log(`     ${debitos.length}D/1C  →  ${Object.keys(grupos).length} lançamentos: ${resumo}`);

      if (!aplicar) continue;

      const credito = b.lines.find((l) => String(l.tipo).toUpperCase() === "C");
      const contaCaixa = String(credito?.conta || "").trim();

      await prisma.$transaction(async (tx) => {
        const criados = [];
        for (const papel of ["PRINCIPAL", "JUROS", "MULTA"]) {
          const ls = grupos[papel];
          if (!ls?.length) continue;
          const total = r2(ls.reduce((s, l) => s + Number(l.valor || 0), 0));
          if (total <= 0) continue;
          const novo = await tx.accountingEntry.create({
            data: {
              portalClientId: b.portalClientId,
              data: b.data,
              competencia: b.competencia,
              historico: `${b.historico}${SUFIXO[papel] || ""}`,
              tipo: "BAIXA",
              subtipo: b.subtipo,
              eventType: b.eventType,
              origem: b.origem,
              loteImportacao: b.loteImportacao,
              status: b.status,
              statusPagamento: b.statusPagamento,
              // Vínculos preservados: sem openEntryId o saldo da provisão sai errado.
              openEntryId: b.openEntryId,
              sourceGuideId: b.sourceGuideId,
              lines: {
                createMany: {
                  data: [
                    ...ls.map((l, i) => ({ conta: l.conta, tipo: "D", valor: r2(l.valor), ordem: i })),
                    { conta: contaCaixa, tipo: "C", valor: total, ordem: ls.length },
                  ],
                },
              },
            },
          });
          criados.push({ papel, id: novo.id });
        }
        // A guia passa a apontar pro lançamento do PRINCIPAL (é o que amortiza o passivo).
        const principal = criados.find((c) => c.papel === "PRINCIPAL") || criados[0];
        if (b.sourceGuideId && principal) {
          await tx.guide.updateMany({
            where: { id: b.sourceGuideId, lancamentoId: b.id },
            data: { lancamentoId: principal.id },
          });
        }
        // Remove o agrupado só depois de recriar tudo (linhas caem por cascade).
        await tx.accountingEntryLine.deleteMany({ where: { entryId: b.id } });
        await tx.accountingEntry.delete({ where: { id: b.id } });
      });
    }

    if (!aplicar) {
      console.log(`\nSimulação — nada gravado. Rode com --aplicar para efetivar.`);
    } else {
      console.log(`\n✓ ${alvos.length} baixa(s) separada(s) em lançamentos independentes.`);
    }
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
