// JUNHO CONTRA OS MESES VIZINHOS — o que a competência que não baixa tem de diferente.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhum DDL, nenhuma chamada externa, nenhum `--aplicar`.
//
// POR QUE ELE EXISTE
// O dono: "não conseguimos dar baixa na DAS da Lente no mês de junho, ESPECIFICAMENTE esse mês".
// "Especificamente" é a informação: o fluxo de baixa serve todos os meses igualmente, então a
// diferença está no DADO daquela competência. Os dois scripts irmãos
// (`diag-baixa-das-competencia.mjs` e `diag-baixa-das-detalhe.mjs`) varrem UMA competência em
// TODAS as empresas; este varre UMA empresa em VÁRIAS competências, que é a comparação que o
// relato pede.
//
// O que ele imprime, por competência:
//   1. TODAS as guias `tipo="SIMPLES"` (source, status, paymentStatus, parcelamentoId, valor,
//      valorOriginal, sourceFileId) — é aqui que "DAS do extrato + DAS de upload" ou uma parcela de
//      parcelamento (que também é `tipo:"SIMPLES"`; o que a separa é o `parcelamentoId`) apareceria;
//   2. a circular (dasTotal, acrescimos.DAS, fechamento contábil);
//   3. a provisão `DAS_SIMPLES` com o ΣD das linhas, o abatido e o SALDO;
//   4. as baixas já existentes;
//   5. as QUATRO recusas da rota `POST /entries/:id/baixa`, avaliadas com o número que o MODAL
//      proporia (comprovante > acréscimo da circular > saldo), e não com um número inventado.
//
// USO (Windows — `railway run ... bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-baixa-das-vizinhos.mjs LENTE 2026-04 2026-08'

import { prisma } from "../src/infrastructure/db/prisma.js";

const ALVO = String(process.argv[2] || "LENTE").toUpperCase();
const DE = String(process.argv[3] || "2026-04");
const ATE = String(process.argv[4] || "2026-08");

const money = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "—");
const r2 = (v) => Math.round(Number(v || 0) * 100) / 100;

// Mesmas contas de acréscimo da rota (`CONTAS_ACRESCIMO`): 501 juros / 506 multa não amortizam.
const CONTAS_ACRESCIMO = new Set(["501", "506"]);

function competencias(de, ate) {
  const out = [];
  let [a, m] = de.split("-").map(Number);
  const [af, mf] = ate.split("-").map(Number);
  while (a < af || (a === af && m <= mf)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; a += 1; }
  }
  return out;
}

const COMPS = competencias(DE, ATE);

const empresa = await prisma.portalClient.findFirst({
  where: { razao: { contains: ALVO, mode: "insensitive" } },
  select: { id: true, razao: true, cnpj: true },
});
if (!empresa) {
  console.log(`Nenhuma empresa cujo nome contenha "${ALVO}".`);
  await prisma.$disconnect();
  process.exit(0);
}

console.log("═".repeat(104));
console.log(`${empresa.razao} (${empresa.cnpj}) — competências ${DE} … ${ATE}`);
console.log("═".repeat(104));

const guias = await prisma.guide.findMany({
  where: { portalClientId: empresa.id, tipo: "SIMPLES", competencia: { in: COMPS } },
  select: {
    id: true, competencia: true, source: true, status: true, paymentStatus: true,
    parcelamentoId: true, numeroParcela: true, valor: true, valorOriginal: true,
    sourceFileId: true, vencimento: true, baixada: true, lancamentoId: true,
    extracted: true, createdAt: true,
  },
  orderBy: [{ competencia: "asc" }, { createdAt: "asc" }],
});

const circulares = await prisma.companyMonthlyCircular.findMany({
  where: { portalClientId: empresa.id, competencia: { in: COMPS } },
  select: { competencia: true, dasTotal: true, inssTotal: true, acrescimos: true, fechadoContabilEm: true },
});
const circPor = new Map(circulares.map((c) => [c.competencia, c]));

// Todos os fechamentos da empresa — a trava lê a competência da DATA DO PAGAMENTO, não a do mês.
const fechamentos = await prisma.companyMonthlyCircular.findMany({
  where: { portalClientId: empresa.id, fechadoContabilEm: { not: null } },
  select: { competencia: true, fechadoContabilEm: true },
});
const fechadoEm = new Map(fechamentos.map((f) => [f.competencia, f.fechadoContabilEm]));

const provisoes = await prisma.accountingEntry.findMany({
  where: { portalClientId: empresa.id, competencia: { in: COMPS }, tipo: "PROVISAO", eventType: "DAS_SIMPLES" },
  include: { lines: { orderBy: { ordem: "asc" } }, baixas: { include: { lines: true } } },
});
const provPor = new Map();
for (const p of provisoes) {
  if (!provPor.has(p.competencia)) provPor.set(p.competencia, []);
  provPor.get(p.competencia).push(p);
}

function saldoDaProvisao(p) {
  const principal = r2(
    p.lines.filter((l) => String(l.tipo).toUpperCase() === "D").reduce((s, l) => s + Number(l.valor || 0), 0),
  );
  let abatido = 0;
  for (const b of p.baixas || []) {
    abatido += b.lines
      .filter((l) => String(l.tipo).toUpperCase() === "D" && !CONTAS_ACRESCIMO.has(String(l.conta || "").trim()))
      .reduce((s, l) => s + Number(l.valor || 0), 0);
  }
  abatido = r2(abatido);
  return { principal, abatido, saldo: r2(principal - abatido) };
}

const hoje = new Date();
const compHoje = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;

for (const comp of COMPS) {
  console.log("\n" + "─".repeat(104));
  console.log(`### ${comp}`);
  console.log("─".repeat(104));

  const c = circPor.get(comp);
  console.log(
    `circular: dasTotal=${money(c?.dasTotal)} · inssTotal=${money(c?.inssTotal)} · `
    + `acrescimos.DAS=${c?.acrescimos?.DAS ? JSON.stringify(c.acrescimos.DAS) : "—"} · `
    + `fechamento contábil: ${c?.fechadoContabilEm ? "🔒 " + dia(c.fechadoContabilEm) : "aberto"}`,
  );

  const daComp = guias.filter((g) => g.competencia === comp);
  console.log(`\nguias tipo="SIMPLES": ${daComp.length}`);
  for (const g of daComp) {
    const parc = g.parcelamentoId ? `PARCELA(${g.parcelamentoId.slice(0, 8)}…#${g.numeroParcela ?? "?"})` : "DAS do mês";
    console.log(
      `  · ${g.id.slice(0, 8)}… ${parc} · source=${g.source ?? "—"} · status=${g.status} · pgto=${g.paymentStatus ?? "—"}`,
    );
    console.log(
      `      valor=${money(g.valor)} · valorOriginal=${money(g.valorOriginal)} · venc=${dia(g.vencimento)} · `
      + `sourceFileId=${g.sourceFileId ?? "—"} · baixada=${g.baixada} · lancamentoId=${g.lancamentoId ? g.lancamentoId.slice(0, 8) + "…" : "—"}`,
    );
    const comprov = g.extracted?.comprovante;
    if (comprov) console.log(`      comprovante=${JSON.stringify(comprov)}`);
  }

  const provs = provPor.get(comp) || [];
  console.log(`\nprovisões DAS_SIMPLES: ${provs.length}`);
  for (const p of provs) {
    const s = saldoDaProvisao(p);
    console.log(
      `  · entry ${p.id.slice(0, 8)}… status=${p.statusPagamento} · origem=${p.origem} · `
      + `ΣD=${money(s.principal)} · abatido=${money(s.abatido)} · SALDO=${money(s.saldo)} · baixas=${(p.baixas || []).length}`,
    );
    if (p.recalculatedFromValor != null || p.recalculatedToValor != null) {
      console.log(
        `      carimbo de recálculo: de ${money(p.recalculatedFromValor)} para ${money(p.recalculatedToValor)} `
        + `em ${dia(p.recalculatedAt)}`,
      );
    }
    for (const l of p.lines) console.log(`      ${l.tipo} ${l.conta || "(em branco)"} ${money(l.valor)}`);
    for (const b of p.baixas || []) {
      console.log(`      baixa ${b.id.slice(0, 8)}… ${dia(b.data)} comp=${b.competencia} tipoLinha=${b.tipoLinha ?? "—"}`);
    }

    // ─── As quatro portas da rota, com o número que o MODAL proporia ────────────────────────
    const guiaDoMes = daComp.find((g) => !g.parcelamentoId && g.status === "PROCESSED") || daComp[0];
    const comprov = guiaDoMes?.extracted?.comprovante;
    const acr = c?.acrescimos?.DAS;
    let principalProposto = s.saldo;
    let fonte = "saldo da provisão";
    let dataProposta = null;
    if (comprov && comprov.confiavel && comprov.principal != null) {
      principalProposto = Number(comprov.principal);
      fonte = "comprovante do SERPRO";
      if (comprov.dataArrecadacao) {
        const [d, m, a] = String(comprov.dataArrecadacao).split("/");
        if (a) dataProposta = `${a}-${m}`;
      }
    } else if (acr && acr.principal != null) {
      principalProposto = Number(acr.principal);
      fonte = "acrescimos.DAS da circular";
    }
    const compPagto = dataProposta || compHoje;

    const motivos = [];
    if (!["ABERTO", "PARCIAL"].includes(p.statusPagamento)) motivos.push(`400 lancamento_nao_esta_aberto (${p.statusPagamento})`);
    if (r2(principalProposto) - s.saldo > 0.01) {
      motivos.push(
        `400 baixa_excede_saldo — principal ${money(principalProposto)} (${fonte}) > saldo ${money(s.saldo)} `
        + `· excedente ${money(r2(principalProposto - s.saldo))}`,
      );
    }
    if (fechadoEm.has(compPagto)) motivos.push(`409 MES_FECHADO — competência do pagamento ${compPagto} fechada em ${dia(fechadoEm.get(compPagto))}`);
    console.log(`      → competência do pagamento: ${compPagto} · ${motivos.length ? motivos.join(" | ") : "nada bloqueia"}`);
  }
  if (!provs.length) console.log("  (nenhuma — não há o que baixar por esta rota)");
}

console.log("\nNada foi alterado.");
await prisma.$disconnect();
