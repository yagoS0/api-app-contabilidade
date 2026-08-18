// A BAIXA QUE COLIDE COM OUTRA BAIXA DA MESMA EMPRESA NO MESMO MÊS DE PAGAMENTO.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhum DDL, nenhuma chamada externa, nenhum `--aplicar`.
//
// POR QUE ELE EXISTE
// O dono, sobre a ALESSANDRO NIGRO: "não conseguimos dar baixa no mês de junho, mas nos outros
// meses funciona". Diferente da LENTE, aqui a provisão BATE com a circular, a competência está
// ABERTA, não há parcelamento nem guia duplicada — as quatro portas conhecidas de
// `POST /entries/:id/baixa` (`lancamento_nao_esta_aberto`, `baixa_excede_saldo`, `MES_FECHADO`,
// "sem provisão") deixam passar. Existe uma QUINTA, e ela não é uma recusa nomeada: é o
// **@@unique([portalClientId, competencia, eventType, origem])** de `accounting_entries`.
//
// O MECANISMO
// A rota grava o lançamento do PRINCIPAL com:
//     competencia = a competência da DATA DO PAGAMENTO (não a da provisão!)
//     eventType   = deriveBaixaEventType(provisão)  → "BAIXA_DAS_SIMPLES"
//     origem      = "MANUAL"
// Nada nessa tupla diz QUAL provisão está sendo quitada. Então DUAS baixas de DAS da mesma empresa
// que caiam no MESMO mês de pagamento colidem — a segunda estoura P2002 dentro do `$transaction`,
// cai no `catch` genérico e volta como **500 `internal_error`**, sem motivo nomeado na tela.
//
// ⚠ E é assimétrico entre os meses por um detalhe de DADO: quando a guia TEM comprovante do SERPRO,
// o modal usa a `dataArrecadacao` (cada mês cai na sua competência); quando NÃO tem, ele usa **HOJE**
// — e todas as baixas pendentes desembocam na competência corrente, uma em cima da outra.
//
// ⚠ O `schema.prisma` afirma que este unique "não morde as BAIXAS" (porque elas nasceriam com
// `eventType` NULL). Isso vale para `InssPagamentoService` e para o parcelamento; **não vale para
// esta rota**, que preenche o `eventType` no lançamento do principal de propósito.
//
// USO (Windows — `railway run ... bash -c` NÃO funciona nesta máquina):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-baixa-colisao-competencia.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const money = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "—");

const hoje = new Date();
const COMP_HOJE = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;

console.log("═".repeat(104));
console.log(`COLISÃO DE BAIXAS NA MESMA COMPETÊNCIA DE PAGAMENTO (hoje: ${COMP_HOJE})`);
console.log("@@unique([portalClientId, competencia, eventType, origem]) — accounting_entries");
console.log("═".repeat(104));

// ─── As tuplas JÁ OCUPADAS por lançamentos de baixa ────────────────────────────────────────
const baixas = await prisma.accountingEntry.findMany({
  where: { tipo: "BAIXA", eventType: { not: null } },
  select: {
    id: true, portalClientId: true, competencia: true, eventType: true, origem: true,
    data: true, historico: true, openEntryId: true,
  },
  orderBy: [{ competencia: "asc" }],
});
const ocupada = new Map(); // "cliente|comp|event|origem" -> lançamento
for (const b of baixas) ocupada.set(`${b.portalClientId}|${b.competencia}|${b.eventType}|${b.origem}`, b);

console.log(`\nLançamentos tipo=BAIXA com eventType preenchido: ${baixas.length}`);

// ─── As provisões de DAS ainda ABERTAS/PARCIAIS — as que o contador tentaria baixar ────────
const provisoes = await prisma.accountingEntry.findMany({
  where: { tipo: "PROVISAO", eventType: "DAS_SIMPLES", statusPagamento: { in: ["ABERTO", "PARCIAL"] } },
  select: { id: true, portalClientId: true, competencia: true, statusPagamento: true },
  orderBy: [{ competencia: "asc" }],
});

const clientes = await prisma.portalClient.findMany({
  where: { id: { in: [...new Set(provisoes.map((p) => p.portalClientId))] } },
  select: { id: true, razao: true },
});
const nome = new Map(clientes.map((c) => [c.id, c.razao]));

// O comprovante manda na DATA — e portanto na competência que a baixa vai gravar.
const guias = await prisma.guide.findMany({
  where: {
    tipo: "SIMPLES", status: "PROCESSED", parcelamentoId: null,
    portalClientId: { in: [...new Set(provisoes.map((p) => p.portalClientId))] },
  },
  select: { portalClientId: true, competencia: true, extracted: true },
});
const guiaPor = new Map(guias.map((g) => [`${g.portalClientId}|${g.competencia}`, g]));

function competenciaDoPagamento(prov) {
  const g = guiaPor.get(`${prov.portalClientId}|${prov.competencia}`);
  const c = g?.extracted && typeof g.extracted === "object" ? g.extracted.comprovante : null;
  if (c && c.confiavel && c.dataArrecadacao) {
    const m = String(c.dataArrecadacao).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return { comp: `${m[3]}-${m[2]}`, fonte: `comprovante ${c.dataArrecadacao}` };
  }
  return { comp: COMP_HOJE, fonte: "HOJE (sem comprovante)" };
}

console.log(`Provisões de DAS abertas/parciais: ${provisoes.length}\n`);
console.log("─".repeat(104));

const colidem = [];
const porCompetenciaAlvo = new Map();

for (const p of provisoes) {
  const { comp, fonte } = competenciaDoPagamento(p);
  const chave = `${p.portalClientId}|${comp}|BAIXA_DAS_SIMPLES|MANUAL`;
  const dono = ocupada.get(chave);

  // Duas provisões DIFERENTES da mesma empresa mirando a MESMA competência também colidem entre si.
  const alvo = `${p.portalClientId}|${comp}`;
  if (!porCompetenciaAlvo.has(alvo)) porCompetenciaAlvo.set(alvo, []);
  porCompetenciaAlvo.get(alvo).push(p);

  if (dono) {
    colidem.push({ p, comp, fonte, dono });
    console.log(
      `⛔ ${nome.get(p.portalClientId)} — provisão de ${p.competencia} (${p.statusPagamento})\n`
      + `     a baixa gravaria competencia=${comp} (${fonte}) · eventType=BAIXA_DAS_SIMPLES · origem=MANUAL\n`
      + `     TUPLA JÁ OCUPADA pela baixa ${dono.id.slice(0, 8)}… de ${dia(dono.data)} — "${dono.historico}"\n`
      + `     → P2002 dentro do $transaction → catch genérico → 500 internal_error`,
    );
  }
}

console.log("─".repeat(104));
console.log(`\nProvisões abertas que COLIDIRIAM com uma baixa já gravada: ${colidem.length}`);

const empatadas = [...porCompetenciaAlvo.entries()].filter(([, lista]) => lista.length > 1);
console.log(`Empresas com DUAS OU MAIS provisões abertas mirando a MESMA competência: ${empatadas.length}`);
for (const [alvo, lista] of empatadas) {
  const [cli, comp] = alvo.split("|");
  console.log(
    `   ⚠ ${nome.get(cli)} → competência ${comp}: provisões de ${lista.map((x) => x.competencia).join(", ")}`
    + " — a PRIMEIRA passa, as demais estouram",
  );
}

console.log("\nNada foi alterado.");
await prisma.$disconnect();
