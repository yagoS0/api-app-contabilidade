// ⚠⚠ SOMENTE LEITURA. Zero escrita, zero chamada externa.
//
// Ordem do dono (30/08/2026): *"use sempre o que foi lançada, ou seja, veio do extrato do simples
// nacional, ou veio do presumido, para cálculo a alíquota"* — e, no mesmo dia, o defeito:
// *"a porcentagem do imposto líquido sumiu, não calcula o INSS junto"*.
//
// Este script NÃO decide nada. Ele responde três perguntas de fato, para que a decisão seja tomada
// sobre número medido e não sobre suposição:
//   1. em que CONTAS o imposto de uma empresa do SIMPLES é lançado (com o `codigoCompleto`)?
//   2. onde cai o INSS — dentro de `33103` (sobre receita) ou no ramo 4 (sobre folha)?
//   3. o que a regra de hoje (`aliquotaEfetivaDeLancamentos`) responderia para essas competências?
//
// Uso: node scripts/diag-aliquota-lancada.mjs "<parte do nome>" [AAAA-MM] [quantos meses]

import { PrismaClient } from "@prisma/client";
import { aliquotaEfetivaDeLancamentos, classificarConta } from "../src/application/accounting/lib/impostosSobreReceita.js";

const p = new PrismaClient();
const ALVO = (process.argv[2] || "ERISANGELA").toUpperCase();
const ATE = process.argv[3] || "2026-07";
const QUANTOS = Number(process.argv[4] || 6);
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const empresas = await p.portalClient.findMany({ select: { id: true, razao: true, companyId: true } });
const alvo = empresas.find((e) => String(e.razao || "").toUpperCase().includes(ALVO));
if (!alvo) { console.log("nao achei"); await p.$disconnect(); process.exit(0); }

const legacy = alvo.companyId
  ? await p.company.findUnique({ where: { id: alvo.companyId }, select: { regimeTributario: true } })
  : null;
console.log(`EMPRESA: ${alvo.razao}   regime: ${legacy?.regimeTributario ?? "(sem)"}\n`);

const comps = [];
{
  let [y, m] = ATE.split("-").map(Number);
  for (let i = 0; i < QUANTOS; i += 1) {
    comps.unshift(`${y}-${String(m).padStart(2, "0")}`);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
  }
}

const contas = await p.chartOfAccount.findMany({
  where: { OR: [{ portalClientId: alvo.id }, { portalClientId: null }] },
  select: { portalClientId: true, codigo: true, nome: true, codigoCompleto: true, analitica: true },
});
const plano = new Map();
for (const c of contas) if (c.portalClientId === null) plano.set(String(c.codigo), c);
for (const c of contas) if (c.portalClientId !== null) plano.set(String(c.codigo), c);

console.log("=== 1. CONTAS COM 'INSS' NO NOME, NO PLANO DESTA EMPRESA ===");
for (const c of contas.filter((x) => /INSS|PREVID|GPS|CPP/i.test(String(x.nome || ""))))
  console.log(`  ${String(c.codigo).padEnd(6)} cc=${String(c.codigoCompleto ?? "(nulo)").padEnd(12)} ${c.nome}`);

for (const competencia of comps) {
  const entries = await p.accountingEntry.findMany({
    where: { portalClientId: alvo.id, competencia },
    select: { tipo: true, parcelamentoId: true, historico: true, lines: { select: { conta: true, tipo: true, valor: true } } },
  });
  const linhas = [];
  for (const e of entries) for (const l of e.lines || []) {
    const codigo = String(l.conta || "").trim();
    linhas.push({ conta: codigo ? plano.get(codigo) || null : null, contaCodigo: codigo || null, tipo: l.tipo, valor: l.valor, parcelamentoId: e.parcelamentoId || null });
  }
  const r = aliquotaEfetivaDeLancamentos(linhas);
  console.log(`\n=== ${competencia} — ${entries.length} lançamentos, ${linhas.length} linhas ===`);
  console.log(`  receita ${brl(r.receitaBruta)} · impostos ${brl(r.impostos)} · situacao ${r.situacao} · aliquota ${r.aliquota == null ? "null" : r.aliquota.toFixed(2) + "%"}`);
  for (const i of r.impostosPorConta) console.log(`    [numerador] ${String(i.codigo).padEnd(6)} ${brl(i.total).padStart(14)}  ${i.nome ?? ""}`);
  // ⚠ O QUE FICOU DE FORA e não é receita: é aqui que o INSS sobre folha aparece, se aparecer.
  const fora = new Map();
  for (const l of linhas) {
    if (l.parcelamentoId) continue;
    const g = l.conta ? classificarConta(l.conta) : "INDETERMINADO";
    if (g !== "FORA_DA_CONTA") continue;
    const k = `${l.conta.codigo}|${l.conta.codigoCompleto}|${l.conta.nome}`;
    fora.set(k, (fora.get(k) || 0) + (l.tipo === "D" ? 1 : -1) * Number(l.valor || 0));
  }
  for (const [k, v] of [...fora].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const [cod, cc, nome] = k.split("|");
    console.log(`    (fora) ${String(cod).padEnd(6)} cc=${String(cc).padEnd(12)} ${brl(v).padStart(14)}  ${nome}`);
  }
  for (const nc of r.naoClassificadas) console.log(`    (SEM CONTA) ${brl(nc.valor)} ${nc.tipo} — ${nc.motivo}`);
}

// A conta que o painel usa HOJE para o Simples, para comparar.
console.log("\n=== O QUE O PAINEL MOSTRA HOJE (Simples: guias PAGAS ÷ notas) ===");
for (const competencia of comps) {
  const [y, m] = competencia.split("-").map(Number);
  const notas = await p.portalInvoice.aggregate({
    where: { clientId: alvo.id, papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } },
    _sum: { total: true },
  });
  const pagas = await p.guide.aggregate({ where: { portalClientId: alvo.id, competencia, paymentStatus: "PAID", parcelamentoId: null }, _sum: { valor: true } });
  const circ = await p.companyMonthlyCircular.findFirst({ where: { portalClientId: alvo.id, competencia }, select: { dasTotal: true } });
  const f = Number(notas._sum?.total || 0), pg = Number(pagas._sum?.valor || 0), das = Number(circ?.dasTotal || 0);
  console.log(`  ${competencia}  notas ${brl(f).padStart(14)}  pagas ${brl(pg).padStart(13)}  extratoDAS ${brl(das).padStart(13)}  efetiva ${f > 0 ? ((pg / f) * 100).toFixed(2) : "—"}%  deReceita ${f > 0 ? ((das / f) * 100).toFixed(2) : "—"}%`);
}

await p.$disconnect();
