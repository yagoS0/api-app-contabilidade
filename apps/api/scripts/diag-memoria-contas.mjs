// A MEMÓRIA DE CONTAS por evento — SOMENTE LEITURA, não altera nada.
//
// Quando um lançamento automático nasce, a conta D/C vem de `AccountingHistorico`, procurada por
// `eventType` (`lookupAccountsFromHistorico`). É uma boa ideia com um efeito colateral: se um
// tributo foi classificado no evento ERRADO alguma vez, a conta daquele erro fica memorizada — e
// passa a ser sugerida, já preenchida, para todo lançamento seguinte daquele evento.
//
// Foi o que aconteceu com o IRRF (código 3208): sem entrada no mapa, ele caía em `DARF_OUTROS` e
// herdou a conta que outro tributo já tinha deixado ali — saiu debitando "240 INSS A PAGAR". O
// mapeamento já foi corrigido; este script existe para ver se a memória guardou outras associações
// do mesmo tipo, ANTES de sair limpando: apagar memória boa é tão ruim quanto manter memória ruim.
//
// ⚠ Campo sugerido é MUITO menos conferido que campo vazio. É por isso que uma sugestão errada
// atravessa meses sem ninguém notar.
//
// Uso:
//   node scripts/diag-memoria-contas.mjs                 # tudo, agrupado por empresa
//   node scripts/diag-memoria-contas.mjs DARF            # só eventos que contenham "DARF"
//   node scripts/diag-memoria-contas.mjs --global        # só a memória global (sem empresa)

import { prisma } from "../src/infrastructure/db/prisma.js";

const filtro = process.argv.find((a) => !a.startsWith("--") && !a.endsWith(".mjs") && !a.includes("node"));
const soGlobal = process.argv.includes("--global");

const memorias = await prisma.accountingHistorico.findMany({
  where: {
    eventType: { not: null },
    ...(soGlobal ? { companyPortalClientId: null } : {}),
    ...(filtro ? { eventType: { contains: filtro, mode: "insensitive" } } : {}),
    OR: [{ contaDebito: { not: null } }, { contaCredito: { not: null } }],
  },
  select: {
    companyPortalClientId: true, eventType: true,
    contaDebito: true, contaCredito: true, usageCount: true, updatedAt: true,
  },
  orderBy: [{ companyPortalClientId: "asc" }, { eventType: "asc" }, { usageCount: "desc" }],
});

if (!memorias.length) {
  console.log("Nenhuma memória de conta por eventType encontrada com esse filtro.");
  await prisma.$disconnect();
  process.exit(0);
}

const portalIds = [...new Set(memorias.map((m) => m.companyPortalClientId).filter(Boolean))];
const empresas = portalIds.length
  ? await prisma.portalClient.findMany({ where: { id: { in: portalIds } }, select: { id: true, razao: true } })
  : [];
const nomePorId = new Map(empresas.map((e) => [e.id, e.razao]));

// ⚠ Só é sugerida a memória com MAIOR `usageCount` de cada (empresa, evento) — as demais existem,
// mas não influenciam o lançamento novo. Marcar qual vence evita caçar fantasma.
const vencedora = new Set();
const vistos = new Set();
for (const m of memorias) {
  const chave = `${m.companyPortalClientId || "GLOBAL"}::${m.eventType}`;
  if (!vistos.has(chave)) { vistos.add(chave); vencedora.add(m); }
}

const linhas = memorias.map((m) => ({
  empresa: m.companyPortalClientId ? String(nomePorId.get(m.companyPortalClientId) || "?").slice(0, 26) : "(global)",
  evento: m.eventType,
  debito: m.contaDebito || "—",
  credito: m.contaCredito || "—",
  usos: m.usageCount,
  atualizada: m.updatedAt.toISOString().slice(0, 10),
  sugerida: vencedora.has(m) ? "SIM" : "",
}));

console.table(linhas);

console.log(`\n${memorias.length} memória(s) · ${vencedora.size} efetivamente em uso (a de maior "usos" de cada empresa+evento).`);
console.log("Nada foi alterado. Para revisar uma associação, edite a conta no próximo lançamento");
console.log("daquele evento — a memória aprende com o que o contador corrige.");

// O evento que virou lata de lixo merece destaque: é onde a contaminação se acumula.
const outros = linhas.filter((l) => l.evento === "DARF_OUTROS" && l.sugerida === "SIM");
if (outros.length) {
  console.log(`\n⚠ ${outros.length} empresa(s) com conta memorizada em DARF_OUTROS:`);
  for (const o of outros) console.log(`   ${o.empresa} → D ${o.debito} / C ${o.credito}`);
  console.log("   Confira se essas contas fazem sentido para 'outros tributos' de verdade — ou se");
  console.log("   ficaram de um tributo que hoje já tem evento próprio (IRRF, por exemplo).");
}

await prisma.$disconnect();
