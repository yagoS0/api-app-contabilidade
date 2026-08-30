// ⚠⚠ SOMENTE LEITURA. ONDE O INSS É LANÇADO — a pergunta que decide se ele pode entrar no
// numerador da alíquota do painel (dono, 30/08/2026: *"não calcula o INSS junto"*).
//
// Ele NÃO decide nada: mede em que contas há movimento de INSS, por qual lado (D/C), para que a
// escolha seja feita sobre fato. Somar o SALDO de uma conta de PASSIVO dá zero quando a provisão e
// o pagamento caem na mesma competência — por isso D e C saem separados.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const COMPS = (process.argv[2] || "2026-04,2026-05,2026-06,2026-07").split(",");
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const clientes = await p.portalClient.findMany({ select: { id: true, razao: true } });
const contas = await p.chartOfAccount.findMany({
  select: { portalClientId: true, codigo: true, nome: true, codigoCompleto: true },
});
// ⚠ O nome é usado só para ACHAR as candidatas neste diagnóstico. A regra do produto nunca decide
// por nome — decide por `codigoCompleto`. Aqui o objetivo é justamente descobrir QUAIS códigos são.
const porCodigo = new Map();
for (const a of contas) if (a.portalClientId === null) porCodigo.set(String(a.codigo), a);
for (const a of contas) if (a.portalClientId !== null) porCodigo.set(String(a.codigo), a);

const mov = new Map(); // codigoCompleto|nome -> {d, c, empresas:Set}
for (const c of clientes) {
  const entries = await p.accountingEntry.findMany({
    where: { portalClientId: c.id, competencia: { in: COMPS } },
    select: { parcelamentoId: true, lines: { select: { conta: true, tipo: true, valor: true } } },
  });
  for (const e of entries) {
    if (e.parcelamentoId) continue;
    for (const l of e.lines || []) {
      const a = porCodigo.get(String(l.conta || "").trim());
      if (!a || !/INSS|PREVID|GPS|\bCPP\b/i.test(String(a.nome || ""))) continue;
      const k = `${a.codigoCompleto ?? "(nulo)"}|${a.codigo}|${a.nome}`;
      const at = mov.get(k) || { d: 0, c: 0, empresas: new Set() };
      if (l.tipo === "D") at.d += Number(l.valor || 0); else at.c += Number(l.valor || 0);
      at.empresas.add(c.razao);
      mov.set(k, at);
    }
  }
}
console.log(`MOVIMENTO DE INSS em ${COMPS.join(", ")} — ${clientes.length} empresas\n`);
console.log("codigoCompleto".padEnd(14), "cod".padEnd(5), "DÉBITO".padStart(14), "CRÉDITO".padStart(14), "emp", " nome");
for (const [k, v] of [...mov].sort((a, b) => (b[1].c + b[1].d) - (a[1].c + a[1].d))) {
  const [cc, cod, nome] = k.split("|");
  console.log(cc.padEnd(14), cod.padEnd(5), brl(v.d).padStart(14), brl(v.c).padStart(14), String(v.empresas.size).padStart(3), ` ${nome}`);
}
if (!mov.size) console.log("(nenhum movimento em conta com INSS no nome)");
await p.$disconnect();
