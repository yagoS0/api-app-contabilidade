// DIAGNÓSTICO: baixa DUPLICADA de guia (parcela de parcelamento e INSS).
//
// ⚠ SÓ LEITURA. Nenhum UPDATE, nenhum DELETE, nenhuma chamada externa. O que fazer com o dado
// encontrado é decisão do dono — e a limpeza correta de lançamento contábil é ESTORNO, não DELETE.
//
// POR QUE ELE EXISTE
// Até a reserva atômica da guia entrar, nada impedia duas baixas da mesma guia: o índice unique
// incluía `eventType`, que nasce NULL, e no Postgres NULLs são DISTINTOS em UNIQUE — as duas linhas
// passavam. A guarda de código era check-then-act fora da transação. Duplicata escrita naquele
// período continua no banco, distorcendo saldo, e a constraint nova (parcial) não a alcança de
// propósito: ela vale para o que for escrito daqui pra frente.
//
// COMO LER O RESULTADO
// A heurística é `loteImportacao`: uma baixa legítima são VÁRIOS lançamentos (principal, juros,
// multa, um por tributo) que compartilham UM lote. Guia com DOIS lotes de baixa é o sinal.
//
// ⚠ MAIS DE UM LOTE NÃO É PROVA. Baixa parcial e reprocessamento intencional caem aqui também.
// Por isso o script imprime as LINHAS COMPLETAS de cada guia sinalizada — a decisão se toma
// olhando os valores e as datas, não a contagem.
//
// USO (a URL do banco só existe dentro do ambiente Railway):
//   railway run node apps/api/scripts/diag-baixa-duplicada.mjs

import { prisma } from "../src/infrastructure/db/prisma.js";

const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

// 1) Agregado: guias com mais de um LOTE de baixa.
const suspeitas = await prisma.$queryRaw`
  SELECT "sourceGuideId",
         COUNT(DISTINCT "loteImportacao")::int AS lotes,
         COUNT(*)::int                         AS lancamentos
    FROM "accounting_entries"
   WHERE "tipo" = 'BAIXA' AND "sourceGuideId" IS NOT NULL
   GROUP BY "sourceGuideId"
  HAVING COUNT(DISTINCT "loteImportacao") > 1
   ORDER BY lancamentos DESC
`;

if (!suspeitas.length) {
  console.log("Nenhuma guia com mais de um lote de baixa. Nada a estornar.");
  await prisma.$disconnect();
  process.exit(0);
}

console.log(`⚠ ${suspeitas.length} guia(s) com mais de um lote de baixa:\n`);

// 2) Detalhe: as linhas completas de cada guia sinalizada, para separar duplicata de baixa
//    parcial legítima. Sem isto o agregado sozinho levaria a estornar lançamento correto.
for (const s of suspeitas) {
  const guia = await prisma.guide.findUnique({
    where: { id: s.sourceGuideId },
    select: {
      id: true, tipo: true, competencia: true, numeroDocumento: true, valor: true,
      baixada: true, dataBaixa: true, lancamentoId: true,
      parcelamentoId: true, numeroParcela: true,
      company: { select: { nome: true, cnpj: true } },
    },
  });

  const entries = await prisma.accountingEntry.findMany({
    where: { sourceGuideId: s.sourceGuideId, tipo: "BAIXA" },
    orderBy: [{ loteImportacao: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, loteImportacao: true, competencia: true, data: true, valor: true,
      historico: true, subtipo: true, createdAt: true, statusPagamento: true,
    },
  });

  const rotulo = guia?.parcelamentoId
    ? `parcela ${guia.numeroParcela ?? "?"} de parcelamento`
    : `guia ${guia?.tipo || "?"}`;

  console.log("─".repeat(100));
  console.log(`${guia?.company?.nome || "(empresa desconhecida)"} · ${guia?.company?.cnpj || ""}`);
  console.log(`${rotulo} · comp ${guia?.competencia || "?"} · doc ${guia?.numeroDocumento || "—"} · valor da guia ${brl(guia?.valor)}`);
  console.log(`guia.baixada=${guia?.baixada} · dataBaixa=${dia(guia?.dataBaixa)} · lancamentoId=${guia?.lancamentoId || "—"}`);
  console.log(`${s.lotes} lotes · ${s.lancamentos} lançamentos:`);

  let loteAtual = null;
  let somaLote = 0;
  for (const e of entries) {
    if (e.loteImportacao !== loteAtual) {
      if (loteAtual !== null) console.log(`      soma do lote: ${brl(somaLote)}`);
      loteAtual = e.loteImportacao;
      somaLote = 0;
      console.log(`  lote ${loteAtual || "(sem lote)"} — criado ${dia(entries.find((x) => x.loteImportacao === loteAtual)?.createdAt)}`);
    }
    somaLote += Number(e.valor || 0);
    console.log(`      ${dia(e.data)} · comp ${e.competencia} · ${brl(e.valor)} · ${e.subtipo || "—"} · ${e.historico || ""}`);
  }
  console.log(`      soma do lote: ${brl(somaLote)}`);

  // ⚠ O sinal mais forte não é a contagem: é a soma dos lotes passar do valor da guia.
  const somaTotal = entries.reduce((acc, e) => acc + Number(e.valor || 0), 0);
  const valorGuia = Number(guia?.valor || 0);
  if (valorGuia > 0 && somaTotal > valorGuia + 0.01) {
    console.log(`  ⚠ SOMA DAS BAIXAS (${brl(somaTotal)}) MAIOR QUE A GUIA (${brl(valorGuia)}) — duplicata provável.`);
  } else {
    console.log(`  soma das baixas ${brl(somaTotal)} ≤ valor da guia ${brl(valorGuia)} — compatível com baixa PARCIAL legítima.`);
  }
}

console.log("─".repeat(100));
console.log("\nNada foi alterado. Estorno de lançamento contábil é decisão do contador.");

await prisma.$disconnect();
