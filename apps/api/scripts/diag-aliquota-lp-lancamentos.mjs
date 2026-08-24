// SOMENTE LEITURA. Mede se da para calcular a aliquota efetiva do LUCRO PRESUMIDO a partir dos
// LANCAMENTOS CONTABEIS (provisao de impostos / receita) em vez das guias pagas.
// Nao escreve nada, nao chama SERPRO/SEFAZ/ADN.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

const cs = await p.company.findMany({
  where: { regimeTributario: "LUCRO_PRESUMIDO" },
  select: { cnpj: true, razaoSocial: true },
});
const so = (v) => String(v || "").replace(/\D+/g, "");
const alvo = new Set(cs.map((c) => so(c.cnpj)).filter(Boolean));
const pcs = await p.portalClient.findMany({ select: { id: true, cnpj: true, razao: true } });
const lp = pcs.filter((x) => alvo.has(so(x.cnpj)));
const ids = lp.map((x) => x.id);
const nome = new Map(lp.map((x) => [x.id, x.razao]));
console.log(`empresas LUCRO_PRESUMIDO com PortalClient: ${ids.length}\n`);

// ---- 1. que TIPOS de lancamento existem nessas empresas
const porTipo = await p.accountingEntry.groupBy({
  by: ["tipo", "subtipo"], where: { portalClientId: { in: ids } }, _count: { _all: true },
});
console.log("--- LANCAMENTOS DAS EMPRESAS LP: tipo | subtipo | qtd");
for (const r of porTipo.sort((a, b) => String(a.tipo).localeCompare(String(b.tipo))))
  console.log(`  ${String(r.tipo).padEnd(10)} | ${String(r.subtipo ?? "(null)").padEnd(20)} | ${r._count._all}`);

// ---- 2. as PROVISOES, por competencia, com as CONTAS usadas
const prov = await p.accountingEntry.findMany({
  where: { portalClientId: { in: ids }, tipo: "PROVISAO" },
  select: { portalClientId: true, competencia: true, subtipo: true, eventType: true, historico: true, lines: { select: { conta: true, tipo: true, valor: true } } },
  orderBy: [{ competencia: "desc" }],
});
console.log(`\n--- PROVISOES: ${prov.length} lancamento(s)`);
let semConta = 0;
const contasD = new Map(), contasC = new Map();
for (const e of prov) {
  const d = e.lines.find((l) => l.tipo === "D"), c = e.lines.find((l) => l.tipo === "C");
  if (!String(d?.conta || "").trim() || !String(c?.conta || "").trim()) semConta++;
  contasD.set(d?.conta || "(vazia)", (contasD.get(d?.conta || "(vazia)") || 0) + 1);
  contasC.set(c?.conta || "(vazia)", (contasC.get(c?.conta || "(vazia)") || 0) + 1);
}
console.log(`  ⚠ com pelo menos uma perna SEM conta: ${semConta} de ${prov.length}`);
console.log("  contas a DEBITO :", [...contasD.entries()].map(([k, v]) => `${k}×${v}`).join("  "));
console.log("  contas a CREDITO:", [...contasC.entries()].map(([k, v]) => `${k}×${v}`).join("  "));

// ---- 3. RECEITA: de onde ela sairia
const rec = await p.accountingEntry.findMany({
  where: { portalClientId: { in: ids }, tipo: "RECEITA" },
  select: { competencia: true, lines: { select: { conta: true, tipo: true, valor: true } } },
});
console.log(`\n--- LANCAMENTOS tipo="RECEITA": ${rec.length}`);
const contasRec = new Map();
for (const e of rec) for (const l of e.lines) {
  const k = `${l.conta || "(vazia)"}/${l.tipo}`;
  contasRec.set(k, (contasRec.get(k) || 0) + 1);
}
console.log("  contas/perna:", [...contasRec.entries()].sort().map(([k, v]) => `${k}×${v}`).join("  ") || "(nenhum)");

// ---- 4. plano de contas: as de RECEITA dessas empresas
const plano = await p.chartOfAccount.findMany({
  where: { OR: [{ portalClientId: { in: ids } }, { portalClientId: null }], tipo: "RECEITA" },
  select: { codigo: true, nome: true, codigoCompleto: true, analitica: true, portalClientId: true },
  orderBy: [{ codigoCompleto: "asc" }],
});
console.log(`\n--- PLANO DE CONTAS, tipo="RECEITA": ${plano.length} conta(s)`);
for (const a of plano.slice(0, 40))
  console.log(`  ${String(a.codigoCompleto || "(sem completo)").padEnd(12)} red=${String(a.codigo).padEnd(5)} ${a.analitica === true ? "A" : a.analitica === false ? "S" : "?"} ${a.nome}${a.portalClientId ? "" : "  [GLOBAL]"}`);

// ---- 5. a conta por competencia, empresa a empresa (o que a aliquota leria)
console.log(`\n--- O QUE A CONTA DARIA HOJE, por empresa x competencia`);
console.log("empresa                     | comp    | provisao (R$) | receita lanc. (R$) | notas EMIT (R$)");
console.log("-".repeat(105));
const comps = [...new Set([...prov.map((e) => e.competencia), ...rec.map((e) => e.competencia)])].filter(Boolean).sort().reverse();
for (const cid of ids) {
  for (const comp of comps) {
    const pv = prov.filter((e) => e.portalClientId === cid && e.competencia === comp);
    if (!pv.length) continue;
    const somaProv = pv.reduce((n, e) => n + Number(e.lines.find((l) => l.tipo === "D")?.valor || 0), 0);
    const [y, m] = comp.split("-").map(Number);
    // ⚠ `PortalInvoice.competencia` e DateTime, nao string -- e a faixa, igual a rota /aliquota.
    const gte = new Date(Date.UTC(y, m - 1, 1));
    const lt = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
    const nf = await p.portalInvoice.aggregate({
      where: { clientId: cid, papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte, lt } },
      _sum: { total: true },
    });
    const recLanc = await p.accountingEntry.findMany({
      where: { portalClientId: cid, competencia: comp, tipo: "RECEITA" },
      select: { lines: { select: { conta: true, tipo: true, valor: true } } },
    });
    const somaRec = recLanc.reduce((n, e) => n + e.lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor), 0), 0);
    console.log(
      `${String(nome.get(cid) || "?").slice(0, 27).padEnd(27)} | ${comp} | ${somaProv.toFixed(2).padStart(13)} | ${somaRec.toFixed(2).padStart(18)} | ${Number(nf._sum.total || 0).toFixed(2).padStart(15)}`
    );
  }
}
console.log("-".repeat(105));
await p.$disconnect();
