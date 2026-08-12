// A PROVISÃO DE ABERTURA E O `principalPerParcela` — medir antes de concluir.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum DDL.
//
// TRÊS PERGUNTAS, E ELAS SÃO INDEPENDENTES — não presuma causa comum:
//
//   1. DE ONDE VEIO a segunda linha de "principal" da provisão de abertura. Evidência exigida:
//      `loteImportacao`, `createdAt`, `tipoLinha`, `origem`, `subtipo`. Se as linhas do mesmo
//      contrato tiverem lotes ou instantes DIFERENTES, o defeito é de IDEMPOTÊNCIA (reingestão que
//      somou em vez de substituir) — outro conserto. Se forem do MESMO lote e do MESMO instante, a
//      provisão nasceu assim, de UMA escrita só, e a causa está em quem montou as linhas.
//
//   2. `principalPerParcela` guarda coisas DIFERENTES no V1 e no V2? A hipótese é que o V2 grava
//      `round2(parc.valorTotal)` — o valor CHEIO da prestação, com juros e multa — sob um nome que
//      promete principal. Aqui isso se mede comparando o campo com `principalTotal/numParcelas`
//      (o que o nome promete) e com `valorParcelaReferencia` (o valor cheio declarado).
//
//   3. O ALCANCE: quantos contratos, e quais números da TELA estão errados por causa disso.
//      `decorateParcelamento` faz `principalPago = parcelasPagas × principalPerParcela` e
//      `saldoRestante = max(0, totalValue − principalPago)`. Num contrato V2 isso amortiza o total
//      por valores que INCLUEM juros e multa.
//
// USO (produção, leitura):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-provisao-parcelamento.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";
import {
  quadroDasParcelas,
  SELECT_PARCELA_PARA_QUADRO,
} from "../src/application/accounting/parcelamento/recalculoParcelamento.js";

const brl = (v) => (v == null ? "     —     " : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12));
const num = (v) => (v == null ? null : Number(v));
const iso = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 23) : "—");
const linha = (c = "─") => console.log(c.repeat(100));

console.log("═".repeat(100));
console.log("PROVISÃO DE ABERTURA × principalPerParcela — medição");
console.log("═".repeat(100));

const parcelamentos = await prisma.parcelamento.findMany({
  orderBy: { createdAt: "asc" },
  include: {
    portalClient: { select: { razao: true, cnpj: true } },
    parcelasContratadas: { select: SELECT_PARCELA_PARA_QUADRO, orderBy: { numeroParcela: "asc" } },
  },
});

console.log(`\nContratos encontrados: ${parcelamentos.length}\n`);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1) A PROVISÃO DE ABERTURA, LANÇAMENTO A LANÇAMENTO, COM A PROCEDÊNCIA
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log("═".repeat(100));
console.log("1) A PROVISÃO DE ABERTURA — quem escreveu cada linha, e quando");
console.log("═".repeat(100));

const achados = [];

for (const p of parcelamentos) {
  const provisoes = await prisma.accountingEntry.findMany({
    where: { parcelamentoId: p.id, tipo: "PROVISAO" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { lines: { orderBy: { ordem: "asc" } } },
  });

  console.log(`\n▸ ${p.portalClient?.razao || "?"} — ${p.label}`);
  console.log(`  id=${p.id}  tipo=${p.tipo || "—"}  kind=${p.kind || "—"}  status=${p.status}  origem=${p.origem || "—"}`);
  console.log(`  criado em ${iso(p.createdAt)}   aberturaEntryId=${p.aberturaEntryId || "—"}`);
  console.log(`  cabeçalho: numParcelas=${p.numParcelas}  principalPerParcela=${brl(p.principalPerParcela)}  principalTotal=${brl(p.principalTotal)}`);
  console.log(`             jurosTotal=${brl(p.jurosTotal)}  valorMulta=${brl(p.valorMulta)}  totalValue=${brl(p.totalValue)}  valorParcelaRef=${brl(p.valorParcelaReferencia)}`);
  console.log(`             templateOpeningFunctionId=${p.templateOpeningFunctionId || "—"} (preenchido ⇒ criado pelo V1)`);

  if (!provisoes.length) {
    console.log("  ⚠ NENHUM lançamento de PROVISÃO com este parcelamentoId.");
    // ⚠ ENTRA NAS SEÇÕES SEGUINTES ASSIM MESMO. Uma versão anterior deste script usava `continue`
    // aqui e, com isso, os contratos SEM provisão ficavam fora da contagem de alcance — que é
    // exatamente a pergunta "quantos contratos estão errados".
    achados.push({ p, provisoes, contagemPapel: {}, duplicadoPrincipal: false, lotes: 0, semProvisao: true });
    continue;
  }

  // ⚠ A PROCEDÊNCIA SE MEDE PELO INTERVALO ENTRE AS ESCRITAS, NÃO PELO SEGUNDO DO RELÓGIO.
  // Uma primeira versão deste script agrupava por segundo civil e deu FALSO POSITIVO de
  // "reingestão" num lote cujas 3 escritas caíram sobre a virada do segundo (…52.997 / …53.008 /
  // …53.017): 20 ms de distância, uma transação só. O que distingue os dois casos é a DISTÂNCIA:
  // o laço de `criarLancamentosIndividuais` grava em dezenas de milissegundos; uma reingestão é
  // outro clique, outro request — segundos ou dias depois.
  const GAP_MESMA_ESCRITA_MS = 2000;
  const lotes = new Map();
  console.log(`\n  ${"tipoLinha".padEnd(12)} ${"D/C"} ${"valor".padStart(12)}  ${"conta".padEnd(10)} ${"lote".padEnd(24)} ${"criado em".padEnd(24)} origem/subtipo/comp`);
  linha();
  for (const e of provisoes) {
    const chave = `${e.loteImportacao || "(sem lote)"}`;
    const inst = new Date(e.createdAt).getTime();
    if (!lotes.has(chave)) lotes.set(chave, { ts: [], entries: 0 });
    lotes.get(chave).ts.push(inst);
    lotes.get(chave).entries += 1;
    for (const l of e.lines) {
      console.log(
        `  ${String(e.tipoLinha || l.tipoLinha || "—").padEnd(12)} ${l.tipo.padEnd(3)} ${brl(l.valor)}  ${String(l.conta || "(vazia)").padEnd(10)} ${String(e.loteImportacao || "—").padEnd(24)} ${iso(e.createdAt).padEnd(24)} ${e.origem}/${e.subtipo}/${e.competencia}`,
      );
      // ⚠ O `historico` é O QUE O CONTADOR LÊ NO RAZÃO — `criarLancamentosIndividuais` o compõe de
      // `LINHA_LABEL[tipoLinha]`. É a evidência de qual PAPEL a linha recebeu na hora da escrita,
      // e sobrevive mesmo onde a coluna `tipoLinha` ficou nula (lançamentos anteriores à
      // denormalização). Sem ele não dá para dizer "a tela mostra duas linhas de principal".
      console.log(`  ${" ".repeat(12)} historico: "${e.historico}"   entryId=${e.id}`);
    }
  }

  const somaD = provisoes.flatMap((e) => e.lines).filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
  const somaC = provisoes.flatMap((e) => e.lines).filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor), 0);
  const papeisD = provisoes.flatMap((e) => e.lines.filter((l) => l.tipo === "D").map((l) => e.tipoLinha || l.tipoLinha || "—"));
  const contagemPapel = papeisD.reduce((m, t) => ({ ...m, [t]: (m[t] || 0) + 1 }), {});

  console.log(`\n  Σ D = ${brl(somaD)}   Σ C = ${brl(somaC)}   ${Math.abs(somaD - somaC) < 0.01 ? "(balanceado)" : "⚠ DESBALANCEADO"}`);
  console.log(`  papéis dos débitos: ${JSON.stringify(contagemPapel)}`);
  console.log(`  lotes distintos: ${lotes.size}`);
  let maiorGap = 0;
  for (const [k, v] of lotes) {
    const ts = [...v.ts].sort((a, b) => a - b);
    const gaps = ts.slice(1).map((t, i) => t - ts[i]);
    const gap = gaps.length ? Math.max(...gaps) : 0;
    maiorGap = Math.max(maiorGap, gap);
    console.log(`    · ${k}  → ${v.entries} lançamento(s), maior intervalo entre escritas consecutivas: ${gap} ms`);
  }

  const duplicadoPrincipal = (contagemPapel.PRINCIPAL || 0) > 1;
  const semJuros = !papeisD.includes("JUROS");
  if (duplicadoPrincipal) {
    const separadas = lotes.size > 1 || maiorGap > GAP_MESMA_ESCRITA_MS;
    console.log(
      `  ⚠ DUAS OU MAIS LINHAS DE PRINCIPAL${semJuros ? ", NENHUMA DE JUROS" : ""}.\n` +
      `  Veredito de procedência: ${separadas
        ? "⚠ ESCRITAS SEPARADAS — investigar REINGESTÃO (idempotência), que é OUTRO conserto"
        : `UMA ESCRITA SÓ (mesmo lote, ${maiorGap} ms de intervalo) ⇒ a provisão NASCEU assim; a causa está em QUEM MONTOU AS LINHAS, não em reingestão`}`,
    );
  }

  achados.push({ p, provisoes, contagemPapel, duplicadoPrincipal, lotes: lotes.size });
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2) `principalPerParcela` — o campo guarda DUAS coisas?
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(100)}`);
console.log("2) `principalPerParcela` — o que o campo GUARDA de fato, contrato a contrato");
console.log("═".repeat(100));
console.log("\n   ppp        = principalPerParcela (o campo)");
console.log("   principal/N = principalTotal / numParcelas  ← o que o NOME promete");
console.log("   valorParcRef= valorParcelaReferencia        ← o valor CHEIO declarado da prestação");
console.log("   total/N     = totalValue / numParcelas\n");

console.log(`   ${"empresa/contrato".padEnd(38)} ${"ppp".padStart(12)} ${"principal/N".padStart(12)} ${"valorParcRef".padStart(12)} ${"total/N".padStart(12)}  veredito`);
linha();

let vN_ehValorCheio = 0;
let vN_ehPrincipal = 0;
let vN_indefinido = 0;

for (const { p } of achados) {
  const ppp = num(p.principalPerParcela);
  const pn = p.principalTotal != null && p.numParcelas ? Number(p.principalTotal) / p.numParcelas : null;
  const vpr = num(p.valorParcelaReferencia);
  const tn = p.totalValue != null && p.numParcelas ? Number(p.totalValue) / p.numParcelas : null;

  const perto = (a, b) => a != null && b != null && Math.abs(a - b) <= 0.02;
  let veredito;
  if (perto(ppp, vpr) && pn != null && !perto(ppp, pn)) { veredito = "⚠ VALOR CHEIO DA PARCELA (≠ principal)"; vN_ehValorCheio += 1; }
  else if (perto(ppp, pn)) { veredito = "principal por prestação (o nome bate)"; vN_ehPrincipal += 1; }
  else if (perto(ppp, vpr)) { veredito = "= valorParcelaReferencia (sem principalTotal p/ comparar)"; vN_indefinido += 1; }
  else { veredito = "não casa com nenhum dos dois"; vN_indefinido += 1; }

  const nome = `${(p.portalClient?.razao || "?").slice(0, 16)} · ${p.label.slice(0, 19)}`;
  console.log(`   ${nome.padEnd(38)} ${brl(ppp)} ${brl(pn)} ${brl(vpr)} ${brl(tn)}  ${veredito}`);
}
console.log(`\n   Totais: valor-cheio=${vN_ehValorCheio}  principal=${vN_ehPrincipal}  indefinido=${vN_indefinido}`);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 3) O ALCANCE — os números que a TELA mostra hoje
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(100)}`);
console.log("3) O ALCANCE — `principalPago` e `saldoRestante` como a tela os mostra HOJE");
console.log("═".repeat(100));
console.log("\n   hoje  = parcelasPagas × principalPerParcela           (decorateParcelamento)");
console.log("   certo = parcelasPagas × (principalTotal / numParcelas) (a amortização do PASSIVO, que nasce = principalTotal)\n");

console.log(`   ${"empresa/contrato".padEnd(34)} ${"pagas/total".padStart(11)} ${"princPago HOJE".padStart(14)} ${"princPago CERTO".padStart(15)} ${"saldo HOJE".padStart(12)} ${"saldo CERTO".padStart(12)}`);
linha();

let contratosErrados = 0;
for (const { p } of achados) {
  const quadro = quadroDasParcelas(p.parcelasContratadas, { status: p.status });
  const ppp = Number(p.principalPerParcela) || 0;
  const principalPagoHoje = quadro.parcelasPagas * ppp;
  const totalValue = Number(p.totalValue) || 0;
  const saldoHoje = Math.max(0, totalValue - principalPagoHoje);

  const pTotal = p.principalTotal != null ? Number(p.principalTotal) : null;
  const pPorParcela = pTotal != null && p.numParcelas ? pTotal / p.numParcelas : null;
  const principalPagoCerto = pPorParcela != null ? quadro.parcelasPagas * pPorParcela : null;
  // O passivo nasce valendo principalTotal (linhasProvisao reconhece SÓ o principal),
  // então o saldo do passivo é principalTotal − principal amortizado.
  const saldoCerto = pTotal != null && principalPagoCerto != null ? Math.max(0, pTotal - principalPagoCerto) : null;

  const difere = principalPagoCerto != null && Math.abs(principalPagoHoje - principalPagoCerto) > 0.02;
  if (difere) contratosErrados += 1;

  const nome = `${(p.portalClient?.razao || "?").slice(0, 14)} · ${p.label.slice(0, 17)}`;
  console.log(
    `   ${nome.padEnd(34)} ${String(`${quadro.parcelasPagas}/${quadro.parcelasTotal}`).padStart(11)} ${brl(principalPagoHoje)} ${brl(principalPagoCerto)} ${brl(saldoHoje)} ${brl(saldoCerto)} ${difere ? " ⚠ DIVERGE" : ""}`,
  );
}
console.log(`\n   Contratos cujo principalPago/saldoRestante da TELA está errado: ${contratosErrados} de ${achados.length}`);
console.log("   (com 0 parcelas pagas a divergência é 0 hoje, mas o erro é LATENTE: aparece na 1ª baixa.)");

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 4) OS OUTROS LEITORES do campo — o alcance não é só a tela do card
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(100)}`);
console.log("4) OS OUTROS LEITORES — `parcelas.valorPrevisto` (cronograma) e a rescisão");
console.log("═".repeat(100));
console.log("\n   `parcelaSync` grava valorPrevisto = valorParcelaReferencia ?? principalPerParcela.");
console.log("   `gerarPagamentoParcelaManual` usa valorPrevisto como PRINCIPAL da baixa (D PARC).\n");

for (const { p } of achados) {
  const vprs = p.parcelasContratadas.map((x) => (x.valorPrevisto == null ? null : Number(x.valorPrevisto)));
  const distintos = [...new Set(vprs.map((v) => (v == null ? "null" : v.toFixed(2))))];
  const pPorParcela = p.principalTotal != null && p.numParcelas ? Number(p.principalTotal) / p.numParcelas : null;
  const nome = `${(p.portalClient?.razao || "?").slice(0, 16)} · ${p.label.slice(0, 22)}`;
  console.log(`   ${nome.padEnd(42)} valorPrevisto=${distintos.join("|").padEnd(14)} principal/N=${brl(pPorParcela)}`);
  if (pPorParcela != null && distintos.length === 1 && distintos[0] !== "null" && Math.abs(Number(distintos[0]) - pPorParcela) > 0.02) {
    console.log("     ⚠ a baixa por DECLARAÇÃO debitaria o passivo por este valor — que NÃO é o principal.");
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 5) BAIXAS JÁ LANÇADAS — o passivo está sendo amortizado por quanto?
// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(100)}`);
console.log("5) AS BAIXAS JÁ LANÇADAS — o que de fato debitou o passivo (tipoLinha=PARC)");
console.log("═".repeat(100));

for (const { p } of achados) {
  const baixas = await prisma.accountingEntry.findMany({
    where: { parcelamentoId: p.id, tipo: { in: ["BAIXA", "ESTORNO"] } },
    orderBy: { createdAt: "asc" },
    include: { lines: true },
  });
  const nome = `${(p.portalClient?.razao || "?").slice(0, 16)} · ${p.label.slice(0, 22)}`;
  if (!baixas.length) { console.log(`\n   ${nome} — nenhuma baixa lançada.`); continue; }
  console.log(`\n   ${nome} — ${baixas.length} lançamento(s) de baixa/estorno:`);
  for (const b of baixas) {
    for (const l of b.lines) {
      console.log(`     ${b.tipo.padEnd(7)} ${String(b.tipoLinha || l.tipoLinha || "—").padEnd(10)} ${l.tipo} ${brl(l.valor)} conta=${String(l.conta || "(vazia)").padEnd(8)} comp=${b.competencia} parc#${b.numeroParcela ?? "—"} ${iso(b.createdAt)}`);
    }
  }
  const amortizado = baixas
    .filter((b) => b.tipo === "BAIXA")
    .flatMap((b) => b.lines.filter((l) => l.tipo === "D" && (b.tipoLinha === "PARC" || l.tipoLinha === "PARC")))
    .reduce((s, l) => s + Number(l.valor), 0);
  const provisionado = Number(p.principalTotal ?? 0);
  console.log(`     → passivo provisionado (principalTotal) = ${brl(provisionado)} · amortizado até aqui = ${brl(amortizado)} · resta = ${brl(provisionado - amortizado)}`);
}

console.log(`\n${"═".repeat(100)}`);
console.log("FIM — nada foi escrito.");
console.log("═".repeat(100));

await prisma.$disconnect();
