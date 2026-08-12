// O RESÍDUO NO PASSIVO — quanto sobra em "Parcelamento a Pagar", por contrato, com a PROVISÃO NOVA
// e a BAIXA COMO ELA ESTÁ HOJE.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhum DDL, nenhuma chamada externa.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// POR QUE ESTE SCRIPT EXISTE
//
// A provisão da adesão passou a reconhecer o encargo (decisão do dono, 2026-08-12):
//
//     D principal · D juros · D multa · C parcelamento a pagar (= a soma)
//
// A BAIXA **não foi alterada junto** — o dono descreveu a provisão, não a baixa. E a baixa amortiza
// o passivo (papel `PARC`) **só pelo principal** (`linhasPagamento` / `linhasPagamentoDoComprovante`):
// multa e juros vão para despesa do mês do pagamento.
//
// Segue daí, por aritmética, que todo contrato criado pela regra nova termina QUITADO com saldo vivo
// no passivo, igual a `juros + multa` do contrato. Este script põe número nisso, contrato a
// contrato, para o dono decidir sobre a baixa. **Ele não propõe conserto nenhum.**
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// AS DUAS PROJEÇÕES, E POR QUE NÃO DÁ PARA ENTREGAR UMA SÓ
//
// "Quanto a baixa vai amortizar até o fim do contrato" depende de POR ONDE a baixa entra, e as duas
// vias existentes debitam `PARC` por números diferentes:
//
//   (A) via COMPROVANTE / composição — debita `PARC` pelo PRINCIPAL do documento. Somado ao longo do
//       contrato, tende a `principalTotal`. Resíduo = passivo − principalTotal.
//   (B) via DECLARAÇÃO (`gerarPagamentoParcelaManual`, débito automático) — debita `PARC` por
//       `parcelas.valorPrevisto`, que `parcelaSync` grava como
//       `valorParcelaReferencia ?? principalPerParcela`, ou seja o valor CHEIO da prestação.
//
// Escolher uma delas aqui seria supor por onde cada contrato vai ser baixado — e é justamente essa
// suposição que não cabe num número levado ao dono. As duas saem lado a lado.
//
// USO (produção, leitura):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-residuo-provisao-consolidada.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";
import { SELECT_PARCELA_PARA_QUADRO } from "../src/application/accounting/parcelamento/recalculoParcelamento.js";

const n = (v) => (v == null ? null : Number(v));
const brl = (v) => (v == null ? "        —   " : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12));
const reg = (c = "─", k = 104) => console.log(c.repeat(k));

console.log("═".repeat(104));
console.log("RESÍDUO NO PASSIVO — provisão CONSOLIDADA (regra nova) × baixa ATUAL (só o principal)");
console.log("⚠ SÓ LEITURA — nada é escrito, nada é proposto.");
console.log("═".repeat(104));

const contratos = await prisma.parcelamento.findMany({
  orderBy: { createdAt: "asc" },
  include: {
    portalClient: { select: { razao: true, cnpj: true } },
    parcelasContratadas: { select: SELECT_PARCELA_PARA_QUADRO, orderBy: { numeroParcela: "asc" } },
  },
});

console.log(`\nContratos: ${contratos.length}\n`);

let somaResiduoA = 0;
let somaResiduoB = 0;
const suspeitosRescisao = [];

for (const p of contratos) {
  const nome = `${p.portalClient?.razao || "?"} — ${p.label}`;
  console.log(`\n▸ ${nome}`);
  console.log(`  contrato=${p.id}  tipo=${p.tipo || "—"}  status=${p.status}  parcelas=${p.numParcelas}`);

  const principal = n(p.principalTotal) ?? 0;
  const juros = n(p.jurosTotal) ?? 0;
  const multa = n(p.valorMulta) ?? 0;
  const total = n(p.totalValue);

  // ── O passivo COMO ESTÁ GRAVADO hoje (Σ C das provisões deste contrato) ────────────────────────
  const provisoes = await prisma.accountingEntry.findMany({
    where: { parcelamentoId: p.id, tipo: "PROVISAO" },
    include: { lines: true },
  });
  const passivoGravado = provisoes
    .flatMap((e) => e.lines.filter((l) => l.tipo === "C"))
    .reduce((s, l) => s + Number(l.valor), 0);
  const debitosPorPapel = {};
  for (const e of provisoes) {
    for (const l of e.lines.filter((x) => x.tipo === "D")) {
      const papel = String(e.tipoLinha || l.tipoLinha || "—");
      debitosPorPapel[papel] = Math.round(((debitosPorPapel[papel] || 0) + Number(l.valor)) * 100) / 100;
    }
  }

  // ── O passivo que a REGRA NOVA credita: principal + juros + multa ──────────────────────────────
  const passivoNovo = Math.round((principal + juros + multa) * 100) / 100;

  console.log(`  cabeçalho:   principal=${brl(principal)}  juros=${brl(juros)}  multa=${brl(multa)}  totalValue=${brl(total)}`);
  console.log(`  provisão gravada hoje: Σ C = ${brl(passivoGravado)}   débitos por papel = ${JSON.stringify(debitosPorPapel)}`);
  console.log(`  provisão pela REGRA NOVA (principal+juros+multa): C = ${brl(passivoNovo)}`);
  if (Math.abs(passivoGravado - passivoNovo) > 0.02) {
    console.log(`  ⚠ o passivo GRAVADO difere do que a regra nova creditaria: ${brl(passivoGravado - passivoNovo)}`);
    console.log("    (contrato criado antes da mudança — a regra nova vale para os PRÓXIMOS; dado gravado é ato do dono)");
  }

  // ── O que a baixa já amortizou de fato ─────────────────────────────────────────────────────────
  const baixas = await prisma.accountingEntry.findMany({
    where: { parcelamentoId: p.id, tipo: "BAIXA" },
    include: { lines: true },
  });
  const amortizado = baixas
    .flatMap((b) => b.lines.filter((l) => l.tipo === "D" && (b.tipoLinha === "PARC" || l.tipoLinha === "PARC")))
    .reduce((s, l) => s + Number(l.valor), 0);

  // ── As duas projeções do total que será amortizado ─────────────────────────────────────────────
  const amortA = principal;                                   // via comprovante: soma dos principais
  const vprs = p.parcelasContratadas.map((x) => n(x.valorPrevisto)).filter((v) => v != null);
  const amortB = vprs.length === p.parcelasContratadas.length && vprs.length
    ? Math.round(vprs.reduce((s, v) => s + v, 0) * 100) / 100
    : null;                                                   // via declaração: soma dos valorPrevisto

  const residuoA = Math.round((passivoNovo - amortA) * 100) / 100;
  const residuoB = amortB == null ? null : Math.round((passivoNovo - amortB) * 100) / 100;

  console.log(`  baixas já lançadas: ${baixas.length} lançamento(s), amortizaram ${brl(amortizado)} do passivo`);
  reg();
  console.log(`  PROJEÇÃO A — baixa pelo PRINCIPAL (via comprovante/composição)`);
  console.log(`     amortização total do contrato = ${brl(amortA)}   ⇒  RESÍDUO = ${brl(residuoA)}   (= juros + multa)`);
  console.log(`  PROJEÇÃO B — baixa por \`valorPrevisto\` (via declaração / débito automático)`);
  if (amortB == null) {
    console.log("     indisponível: nem todas as prestações têm `valorPrevisto` gravado (ou não há cronograma).");
  } else {
    console.log(`     amortização total do contrato = ${brl(amortB)}   ⇒  RESÍDUO = ${brl(residuoB)}${residuoB < 0 ? "  ⚠ PASSIVO NEGATIVO" : ""}`);
  }

  somaResiduoA += residuoA;
  if (residuoB != null) somaResiduoB += residuoB;

  // ── O MODAL DE RESCISÃO com o `configProvisao` deste contrato ──────────────────────────────────
  //
  // `ParcelamentoModals.ParcelamentoRescisaoModal` monta as linhas invertendo D↔C de cada linha do
  // `configProvisao` e atribuindo `valorPorPapel[tipoLinha]` — um mapa por PAPEL. Com o mesmo papel
  // repetido, o MESMO valor é pré-preenchido duas vezes.
  const cfg = Array.isArray(p.configProvisao) ? p.configProvisao : null;
  if (cfg && cfg.length) {
    const pagas = p.parcelasContratadas.filter((x) => x.origemBaixa != null).length;
    const abertas = Math.max(0, (p.numParcelas || 0) - pagas);
    // Réplica LITERAL da aritmética do modal (não é uma segunda regra — é a medição dela).
    // ⚠ `saldoRestante` NÃO É COLUNA: `decorateParcelamento` o deriva como
    // `max(0, totalValue − parcelasPagas × principalPerParcela)`, e é esse número que chega ao modal.
    const ppp = n(p.principalPerParcela) ?? 0;
    const principalRem = Math.max(0, (total ?? 0) - pagas * ppp);
    const jurosRem = p.numParcelas ? Math.round(juros * (abertas / p.numParcelas) * 100) / 100 : 0;
    const totalRem = Math.round((principalRem + jurosRem) * 100) / 100;
    const valorPorPapel = { PARC: totalRem, PRINCIPAL: principalRem, JUROS: jurosRem, MULTA: 0 };

    const linhas = cfg.map((l) => ({
      tipoLinha: l.tipoLinha,
      tipo: l.tipo === "C" ? "D" : "C",
      valor: valorPorPapel[l.tipoLinha] != null ? valorPorPapel[l.tipoLinha] : 0,
    }));
    const somaD = linhas.filter((l) => l.tipo === "D").reduce((s, l) => s + l.valor, 0);
    const somaC = linhas.filter((l) => l.tipo === "C").reduce((s, l) => s + l.valor, 0);
    const papeis = cfg.map((l) => l.tipoLinha);
    const repetidos = papeis.filter((x, i) => papeis.indexOf(x) !== i);

    console.log(`  configProvisao: ${JSON.stringify(cfg.map((l) => `${l.tipo} ${l.conta || "—"} ${l.tipoLinha}`))}`);
    console.log(`  modal de RESCISÃO pré-preencheria: ${JSON.stringify(linhas.map((l) => `${l.tipo} ${l.tipoLinha} ${l.valor}`))}`);
    console.log(`     Σ D = ${brl(somaD)}   Σ C = ${brl(somaC)}   ${Math.abs(somaD - somaC) < 0.01 ? "(balanceado)" : "⚠ Σ D ≠ Σ C — o modal BLOQUEIA e o contador tem de corrigir à mão"}`);
    if (repetidos.length) {
      console.log(`     ⚠ PAPEL REPETIDO no config: ${[...new Set(repetidos)].join(", ")} — o MESMO valor entra ${papeis.filter((x) => x === repetidos[0]).length}×`);
      suspeitosRescisao.push({ nome, repetidos: [...new Set(repetidos)], somaD, somaC });
    }
  } else {
    console.log("  configProvisao: (vazio) — o modal de rescisão cai nas 3 linhas padrão (PARC/PRINCIPAL/JUROS)");
  }
}

console.log(`\n${"═".repeat(104)}`);
console.log("RESUMO");
console.log("═".repeat(104));
console.log(`  Resíduo somado — PROJEÇÃO A (baixa pelo principal): ${brl(Math.round(somaResiduoA * 100) / 100)}`);
console.log(`  Resíduo somado — PROJEÇÃO B (baixa por valorPrevisto): ${brl(Math.round(somaResiduoB * 100) / 100)}`);
console.log(`\n  Contratos cujo \`configProvisao\` tem PAPEL REPETIDO (rescisão pré-preenche o mesmo valor 2×): ${suspeitosRescisao.length}`);
for (const s of suspeitosRescisao) {
  console.log(`    · ${s.nome} — papel(is) ${s.repetidos.join(", ")}; Σ D = ${brl(s.somaD)} Σ C = ${brl(s.somaC)}`);
}

console.log(`\n${"═".repeat(104)}`);
console.log("FIM — nada foi escrito.");
console.log("═".repeat(104));

await prisma.$disconnect();
