// QUEM TEM PARCELAMENTO COM PARCELA PAGA — para escolher o CNPJ antes de gastar chamada paga.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa.
//
// POR QUE ELE EXISTE
// O `probe-pagamentos71.mjs` custa uma chamada paga por execução. Rodá-lo num CNPJ que não teve
// pagamento de parcelamento no período devolve uma resposta legítima e inútil — foi o que
// aconteceu com a LENTE (Simples, sem nenhum TJLP na janela 2026-05 a 2026-08).
//
// A pergunta que falta responder é: **quais são os códigos de receita do parcelamento do SIMPLES
// (PARCSN)?** `CODIGOS_TJLP_PARCELAMENTO` só conhece os de DARF (IRPJ/PIS/CSLL/COFINS) e o do IRRF.
// Sem os do PARCSN, uma parcela do Simples é classificada como recolhimento em atraso.
//
// Este script lista os candidatos com o que se sabe: parcelamento ativo, e a data de pagamento da
// parcela mais recente — que é o intervalo a passar em `--de`/`--ate`.
//
// USO:
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node apps/api/scripts/diag-parcelamentos-ativos.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
/** O número do documento mora dentro do `extracted`, não numa coluna. */
const doc = (g) => g?.extracted?.numeroDocumento || null;
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const parcelamentos = await prisma.parcelamento.findMany({
  select: {
    id: true, tipo: true, numeroParcelamento: true, status: true, numParcelas: true,
    portalClient: { select: { id: true, razao: true, cnpj: true } },
  },
  orderBy: { createdAt: "desc" },
});

if (!parcelamentos.length) {
  console.log("Nenhum parcelamento cadastrado.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`${parcelamentos.length} parcelamento(s). Os úteis para o probe são os que têm parcela PAGA:\n`);

const linhas = [];
for (const p of parcelamentos) {
  // A parcela é uma Guide com `parcelamentoId`. Paga = tem data de baixa ou paymentStatus PAID.
  const guias = await prisma.guide.findMany({
    where: { parcelamentoId: p.id },
    // ⚠ `numeroDocumento` NÃO é coluna da Guide — ele mora dentro de `extracted` (Json). Pedi-lo
    // no `select` derruba a query. Isso importa além deste script: casar o pagamento do
    // PAGAMENTOS71 com a nossa guia significa ler JSON, não comparar coluna.
    select: {
      numeroParcela: true, competencia: true, valor: true, paymentStatus: true,
      dataBaixa: true, vencimento: true, extracted: true,
    },
    orderBy: { numeroParcela: "asc" },
  });

  const pagas = guias.filter((g) => g.paymentStatus === "PAID" || g.dataBaixa);
  const comDoc = guias.filter((g) => doc(g));
  linhas.push({ p, guias, pagas, comDoc });
}

// Primeiro os que servem ao probe: têm parcela paga.
linhas.sort((a, b) => b.pagas.length - a.pagas.length);

for (const { p, guias, pagas, comDoc } of linhas) {
  const e = p.portalClient;
  const marca = pagas.length ? "✔" : "·";
  console.log("─".repeat(96));
  // ⚠ `regimeTributario` NÃO é campo de `PortalClient` — o regime mora no cadastro fiscal. Pedi-lo
  // aqui derrubava a query inteira com erro de validação do Prisma.
  console.log(`${marca} ${e?.razao || "(sem empresa)"} · ${e?.cnpj || "?"}`);
  console.log(`   ${p.tipo || "(modalidade não gravada)"} nº ${p.numeroParcelamento || "—"} · ${p.status} · ${p.numParcelas || "?"} parcelas contratadas`);
  console.log(`   guias: ${guias.length} · com numeroDocumento: ${comDoc.length} · PAGAS: ${pagas.length}`);

  if (pagas.length) {
    const datas = pagas.map((g) => g.dataBaixa).filter(Boolean).sort();
    const de = datas.length ? dia(datas[0]) : "?";
    const ate = datas.length ? dia(datas[datas.length - 1]) : "?";
    for (const g of pagas.slice(-4)) {
      console.log(`      parcela ${g.numeroParcela ?? "?"} · comp ${g.competencia} · ${brl(g.valor)} · baixa ${dia(g.dataBaixa)} · doc ${doc(g) || "—"}`);
    }
    console.log(`   → probe: --cnpj=${e?.cnpj || "?"} --de=${de} --ate=${ate}`);
  } else {
    console.log("   (nenhuma parcela paga — o probe não teria o que mostrar de parcelamento)");
  }
}

console.log("─".repeat(96));
console.log("\n⚠ Interesse maior: empresa do SIMPLES com parcela paga — é dela que sairiam os códigos");
console.log("  de TJLP do PARCSN, que ainda não conhecemos.");
console.log("\nNada foi alterado.");

await prisma.$disconnect();
