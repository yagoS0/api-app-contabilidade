// ⚠⚠ SOMENTE LEITURA. O impacto, na CARTEIRA INTEIRA, de a alíquota do painel passar a sair do
// LANÇADO (dono, 30/08/2026). Responde: quantos cards ganham número, quantos perdem, e quanto o
// número muda em quem já tinha.
import { PrismaClient } from "@prisma/client";
import { aliquotaEfetivaDeLancamentos } from "../src/application/accounting/lib/impostosSobreReceita.js";

const p = new PrismaClient();
const COMP = process.argv[2] || "2026-07";
const [y, m] = COMP.split("-").map(Number);

const clientes = await p.portalClient.findMany({ select: { id: true, razao: true, companyId: true } });
const contas = await p.chartOfAccount.findMany({
  where: { OR: [{ portalClientId: { in: clientes.map((c) => c.id) } }, { portalClientId: null }] },
  select: { portalClientId: true, codigo: true, nome: true, codigoCompleto: true },
});
let ganha = 0, perde = 0, muda = 0, igualzinho = 0, ambosSem = 0;
console.log(`COMPETENCIA ${COMP}\n`);
console.log("empresa".padEnd(34), "regime".padEnd(16), "HOJE(efetiva)".padStart(14), "LANCADO s/INSS".padStart(15), "LANCADO c/INSS".padStart(15), "situacao");
for (const c of clientes) {
  const plano = new Map();
  for (const a of contas) if (a.portalClientId === null) plano.set(String(a.codigo), a);
  for (const a of contas) if (a.portalClientId === c.id) plano.set(String(a.codigo), a);

  const entries = await p.accountingEntry.findMany({
    where: { portalClientId: c.id, competencia: COMP },
    select: { parcelamentoId: true, lines: { select: { conta: true, tipo: true, valor: true } } },
  });
  const linhas = [];
  for (const e of entries) for (const l of e.lines || []) {
    const cod = String(l.conta || "").trim();
    linhas.push({ conta: cod ? plano.get(cod) || null : null, contaCodigo: cod || null, tipo: l.tipo, valor: l.valor, parcelamentoId: e.parcelamentoId || null });
  }
  const r = aliquotaEfetivaDeLancamentos(linhas);

  const notas = await p.portalInvoice.aggregate({
    where: { clientId: c.id, papel: "EMIT", statusEfetivo: "autorizada", competencia: { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) } },
    _sum: { total: true },
  });
  const pagas = await p.guide.aggregate({ where: { portalClientId: c.id, competencia: COMP, paymentStatus: "PAID", parcelamentoId: null }, _sum: { valor: true } });
  const f = Number(notas._sum?.total || 0), pg = Number(pagas._sum?.valor || 0);
  const legacy = c.companyId ? await p.company.findUnique({ where: { id: c.companyId }, select: { regimeTributario: true } }) : null;
  const regime = legacy?.regimeTributario || "(sem)";
  // A leitura de HOJE do painel: Simples/desconhecido -> efetiva (com as guardas dos dois insumos).
  const hoje = regime === "LUCRO_PRESUMIDO" || regime === "LUCRO_REAL"
    ? (r.aliquota == null ? null : r.aliquota)
    : (f > 0 && pg > 0 ? (pg / f) * 100 : null);
  const novo = r.aliquotaComFolha;
  if (hoje == null && novo != null) ganha += 1;
  else if (hoje != null && novo == null) perde += 1;
  else if (hoje == null && novo == null) ambosSem += 1;
  else if (Math.abs(hoje - novo) > 0.01) muda += 1;
  else igualzinho += 1;
  const fmt = (v) => (v == null ? "—" : v.toFixed(2) + "%");
  console.log(
    String(c.razao || "").slice(0, 33).padEnd(34), String(regime).padEnd(16),
    fmt(hoje).padStart(14), fmt(r.aliquota).padStart(15), fmt(novo).padStart(15), r.situacao,
    r.naoClassificadas.length ? `(${r.naoClassificadas.length} sem conta)` : ""
  );
}
console.log(`\nganham numero: ${ganha} · perdem: ${perde} · mudam de valor: ${muda} · iguais: ${igualzinho} · seguem sem: ${ambosSem}`);
await p.$disconnect();
