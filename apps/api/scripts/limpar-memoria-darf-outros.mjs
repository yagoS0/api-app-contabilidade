// Apaga a memória de conta CONTAMINADA do evento DARF_OUTROS — dry-run por padrão.
//
// O QUE ACONTECEU
// O código de receita 3208 (IRRF) não existia no mapa e caía no fallback `DARF_OUTROS`. Como a
// conta contábil é memorizada POR eventType, a conta usada naquele lançamento errado ficou gravada
// e passou a ser sugerida — já preenchida — para todo "outros tributos" seguinte.
//
// O diagnóstico (`diag-memoria-contas.mjs`) mostrou que o estrago chegou na memória GLOBAL, que é o
// fallback de toda empresa sem memória própria: 12 usos de `D 240 (INSS A PAGAR) / C 5 (CAIXA)`.
//
// POR QUE ESTA COMBINAÇÃO E NÃO OUTRA
// As memórias saudáveis dos tributos seguem `D despesa (4xx) / C passivo (2xx)` — a forma de uma
// PROVISÃO, que é o que `generateProvisionsFromGuide` cria:
//     COFINS  D 420 / C 255      PIS  D 419 / C 254      ISS  D 418 / C 253
// `D 240 / C 5` é o inverso: débito em passivo, crédito em caixa — forma de PAGAMENTO. Num evento
// de provisão ela não tem como estar certa, e foi exatamente a que apareceu debitando INSS A PAGAR
// num IRRF.
//
// ⚠ APAGA SÓ ESSA COMBINAÇÃO, em DARF_OUTROS. Não toca em PIS/COFINS/ISS/IRPJ/CSLL, nem em outras
// contas de DARF_OUTROS que possam ser legítimas. Apagar memória boa é tão ruim quanto manter
// memória ruim — por isso o alvo é estreito e o dry-run é o padrão.
//
// Depois de apagar, "outros tributos" volta a nascer com conta EM BRANCO. É melhor: campo vazio é
// conferido, campo preenchido errado não.
//
// Uso:
//   node scripts/limpar-memoria-darf-outros.mjs              # mostra o que apagaria
//   node scripts/limpar-memoria-darf-outros.mjs --aplicar    # apaga

import { prisma } from "../src/infrastructure/db/prisma.js";

const aplicar = process.argv.includes("--aplicar");

const ALVO = { eventType: "DARF_OUTROS", contaDebito: "240", contaCredito: "5" };

const memorias = await prisma.accountingHistorico.findMany({
  where: ALVO,
  select: {
    id: true, companyPortalClientId: true, contaDebito: true, contaCredito: true,
    usageCount: true, updatedAt: true,
  },
  orderBy: { usageCount: "desc" },
});

if (!memorias.length) {
  console.log("Nenhuma memória DARF_OUTROS com D 240 / C 5. Nada a fazer.");
  await prisma.$disconnect();
  process.exit(0);
}

const portalIds = [...new Set(memorias.map((m) => m.companyPortalClientId).filter(Boolean))];
const empresas = portalIds.length
  ? await prisma.portalClient.findMany({ where: { id: { in: portalIds } }, select: { id: true, razao: true } })
  : [];
const nomePorId = new Map(empresas.map((e) => [e.id, e.razao]));

console.table(memorias.map((m) => ({
  empresa: m.companyPortalClientId ? String(nomePorId.get(m.companyPortalClientId) || "?").slice(0, 28) : "(global)",
  debito: m.contaDebito,
  credito: m.contaCredito,
  usos: m.usageCount,
  atualizada: m.updatedAt.toISOString().slice(0, 10),
})));

if (!aplicar) {
  console.log(`\n${memorias.length} memória(s) seriam apagadas. NADA foi alterado.`);
  console.log("Para aplicar:  node scripts/limpar-memoria-darf-outros.mjs --aplicar");
  console.log("\nDepois disso, o próximo lançamento de 'outros tributos' vem com as contas em");
  console.log("branco — preencha uma vez e o sistema volta a lembrar, agora do valor certo.");
} else {
  const r = await prisma.accountingHistorico.deleteMany({ where: ALVO });
  console.log(`\n${r.count} memória(s) apagada(s).`);
  console.log("O IRRF já não passa mais por DARF_OUTROS (código 3208 tem evento próprio), e não há");
  console.log("memória para DARF_IRRF — a primeira captura virá com contas em branco, como deve.");
}

await prisma.$disconnect();
