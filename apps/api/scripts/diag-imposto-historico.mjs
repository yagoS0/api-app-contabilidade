// ⚠⚠ SOMENTE LEITURA. Zero chamada externa. Nenhuma escrita.
//
// O que o dono descreveu (30/08/2026), e que este script mede a viabilidade de:
//   *"quando não temos DAS, vamos calcular o imposto baseado na porcentagem dos últimos meses (…)
//   não precisa de guia DAS para ser mostrado no fluxo, nem mesmo ter guia liberada (…) a DAS de
//   agosto é a da competência 07, que deveria ter pago dia 20 de agosto (…) a de setembro ainda não
//   sabemos, mas podemos calcular tirando a porcentagem da última apurada e baseado no histórico de
//   faturamento, que se não tem nota nova deve ser o mesmo do mês passado."*
//   *"o INSS também não aparece? (…) e ele é sempre o mesmo valor."*
//
// Uso: node scripts/diag-imposto-historico.mjs "<parte do nome>"

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const ALVO = (process.argv[2] || "ERISANGELA").toUpperCase();
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const mes = (d) => (d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : "—");
const dia = (d) => (d ? d.toISOString().slice(0, 10) : "—");

const empresas = await p.portalClient.findMany({ select: { id: true, razao: true, companyId: true } });
const alvo = empresas.find((e) => String(e.razao || "").toUpperCase().includes(ALVO));
if (!alvo) { console.log("nao achei"); await p.$disconnect(); process.exit(0); }
console.log(`EMPRESA: ${alvo.razao}\n`);

// ── TODAS AS GUIAS ────────────────────────────────────────────────────────────────────────────
const guias = await p.guide.findMany({
  where: { portalClientId: alvo.id },
  select: {
    tipo: true, competencia: true, valor: true, vencimento: true, paymentStatus: true,
    paymentConfirmedAt: true, liberadaCliente: true, parcelamentoId: true, numeroParcela: true,
  },
  orderBy: [{ vencimento: "asc" }],
});
console.log(`=== TODAS AS GUIAS (${guias.length}) ===`);
console.log("  tipo       comp     vence       pago em     status   liberada  parcela        valor");
for (const g of guias) {
  console.log(
    `  ${String(g.tipo).padEnd(10)} ${String(g.competencia || "—").padEnd(8)} `
    + `${dia(g.vencimento).padEnd(11)} ${dia(g.paymentConfirmedAt).padEnd(11)} `
    + `${String(g.paymentStatus).padEnd(8)} ${(g.liberadaCliente ? "sim" : "NAO").padEnd(9)} `
    + `${(g.parcelamentoId ? `#${g.numeroParcela ?? "?"}` : "-").padEnd(6)} ${brl(g.valor).padStart(13)}`,
  );
}

// ⚠ Quantas guias o CLIENTE enxerga hoje — é o recorte `liberadaCliente: true` do fluxo.
const liberadas = guias.filter((g) => g.liberadaCliente).length;
console.log(`\n  liberadas ao cliente: ${liberadas} de ${guias.length}`);
for (const t of [...new Set(guias.map((g) => g.tipo))]) {
  const doTipo = guias.filter((g) => g.tipo === t && !g.parcelamentoId);
  const vals = [...new Set(doTipo.map((g) => Number(g.valor)))];
  console.log(
    `  ${String(t).padEnd(10)} ${String(doTipo.length).padStart(3)} guias (sem parcela) · `
    + `${vals.length === 1 ? `SEMPRE ${brl(vals[0])}` : `${vals.length} valores distintos: ${vals.slice(0, 6).map(brl).join(" · ")}`}`,
  );
}

// ── A APURAÇÃO (a fonte da alíquota) ──────────────────────────────────────────────────────────
const snaps = await p.apuracaoSnapshot.findMany({
  where: { portalClientId: alvo.id },
  select: {
    competencia: true, estado: true, receitaInterna: true, receitaExterna: true,
    dasRetornadoSerpro: true, dasSimuladoSerpro: true, dasCalculadoLocal: true,
  },
  orderBy: { competencia: "desc" },
  take: 14,
});
console.log(`\n=== APURACOES (${snaps.length}) — a alíquota do fluxo sai daqui ===`);
if (!snaps.length) console.log("  (nenhuma) ⇒ `aliquotaEfetiva` devolve null ⇒ semImposto: sem_apuracao");
for (const s of snaps) {
  const rec = (Number(s.receitaInterna) || 0) + (Number(s.receitaExterna) || 0);
  const das = Number(s.dasRetornadoSerpro) || Number(s.dasSimuladoSerpro) || null;
  console.log(
    `  ${s.competencia}  ${String(s.estado).padEnd(12)} receita=${brl(rec).padStart(14)} `
    + `dasTransm=${brl(s.dasRetornadoSerpro).padStart(12)} dasSimul=${brl(s.dasSimuladoSerpro).padStart(12)} `
    + `${das && rec > 0 ? `⇒ ${((das / rec) * 100).toFixed(4)}%` : "⇒ (sem alíquota)"}`,
  );
}

// ── O EXTRATO DO PGDAS (a outra prova de DAS) ─────────────────────────────────────────────────
const circ = await p.companyMonthlyCircular.findMany({
  where: { portalClientId: alvo.id },
  select: { competencia: true, pgdasNumeroDeclaracao: true, pgdasValorDas: true, serproSyncStatus: true },
  orderBy: { competencia: "desc" },
  take: 14,
}).catch((e) => { console.log("  (circular: " + (e.message || "").slice(0, 60) + ")"); return []; });
console.log(`\n=== CIRCULAR / EXTRATO PGDAS (${circ.length}) ===`);
for (const c of circ) {
  console.log(
    `  ${c.competencia}  decl=${String(c.pgdasNumeroDeclaracao || "—").padEnd(20)} `
    + `das=${brl(c.pgdasValorDas).padStart(13)}  sync=${c.serproSyncStatus || "—"}`,
  );
}

// ── O FATURAMENTO (a base da projeção) ────────────────────────────────────────────────────────
const notas = await p.portalInvoice.findMany({
  where: { clientId: alvo.id, papel: "EMIT", statusEfetivo: "autorizada", competencia: { not: null } },
  select: { competencia: true, total: true },
});
const porMes = new Map();
for (const n of notas) {
  const k = mes(n.competencia);
  porMes.set(k, (porMes.get(k) || 0) + (Number(n.total) || 0));
}
console.log(`\n=== FATURAMENTO POR COMPETENCIA (${notas.length} notas) ===`);
for (const [k, v] of [...porMes.entries()].sort().slice(-14)) console.log(`  ${k}  ${brl(v).padStart(14)}`);

await p.$disconnect();
