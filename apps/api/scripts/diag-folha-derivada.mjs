// Diagnóstico da CONFERÊNCIA de folha (Fator-R) — SOMENTE LEITURA, nenhum write.
//
// Existe porque o número que aparecia no modal estava errado e ninguém conseguia ver POR QUÊ: a
// tela mostrava só o total. Aqui sai o caminho inteiro — cada lançamento, cada linha, cada conta —
// com o que a regra ANTIGA somava e o que a NOVA soma, e o motivo de cada descarte.
//
// Uso:
//   node scripts/diag-folha-derivada.mjs <cnpj> <competencia>
//   node scripts/diag-folha-derivada.mjs 12345678000199 2026-07
//
// A competência é a do PERÍODO DE APURAÇÃO; a janela conferida são os 12 meses ANTERIORES a ela.

import { prisma } from "../src/infrastructure/db/prisma.js";
import { competenciasDe12Meses } from "../src/application/notas/apuracao/v2/FolhaDerivadaService.js";
import { resolverContasDespesaFolha } from "../src/application/accounting/payrollTemplate.js";

const brl = (n) => `R$ ${Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

const [cnpjArg, competencia] = process.argv.slice(2);
if (!cnpjArg || !/^\d{4}-\d{2}$/.test(String(competencia || ""))) {
  console.error("uso: node scripts/diag-folha-derivada.mjs <cnpj> <AAAA-MM>");
  process.exit(1);
}
const cnpjDigits = String(cnpjArg).replace(/\D+/g, "");

const empresa = await prisma.portalClient.findFirst({
  where: { cnpj: { contains: cnpjDigits } },
  select: { id: true, razao: true, cnpj: true },
});
if (!empresa) {
  console.error(`empresa com CNPJ ${cnpjArg} não encontrada`);
  await prisma.$disconnect();
  process.exit(1);
}

const competencias = competenciasDe12Meses(competencia);
const contasDespesa = await resolverContasDespesaFolha({ portalClientId: empresa.id });

console.log(`EMPRESA   ${empresa.razao}  (${empresa.cnpj})`);
console.log(`APURAÇÃO  ${competencia}`);
console.log(`JANELA    ${competencias[0]} … ${competencias[competencias.length - 1]}  (12 meses ANTERIORES ao PA)`);
console.log(`CONTAS DE DESPESA DE FOLHA: ${contasDespesa.size ? [...contasDespesa].join(", ") : "NENHUMA RESOLVIDA — cai na regra de forma (descarta entry com D e C)"}`);
if (contasDespesa.size) {
  const nomes = await prisma.chartOfAccount.findMany({
    where: { codigo: { in: [...contasDespesa] }, OR: [{ portalClientId: empresa.id }, { portalClientId: null }] },
    select: { codigo: true, nome: true },
  });
  for (const c of nomes) console.log(`   ${c.codigo}  ${c.nome}`);
}
console.log("");

const entries = await prisma.accountingEntry.findMany({
  where: { portalClientId: empresa.id, tipo: "FOLHA", competencia: { in: competencias } },
  select: {
    id: true, competencia: true, subtipo: true, historico: true, loteImportacao: true,
    lines: { select: { tipo: true, valor: true, conta: true } },
  },
  orderBy: [{ competencia: "asc" }, { createdAt: "asc" }],
});

let totalAntigo = 0;
let totalNovo = 0;
for (const comp of competencias) {
  const doMes = entries.filter((e) => e.competencia === comp);
  if (!doMes.length) { console.log(`${comp}  —  (sem lançamento de folha)`); continue; }

  let antigoMes = 0;
  let novoMes = 0;
  console.log(`${comp}  ${doMes.length} lançamento(s)`);
  for (const e of doMes) {
    const lines = e.lines || [];
    const debitos = lines.filter((l) => String(l.tipo).toUpperCase() === "D");
    const temCredito = lines.some((l) => String(l.tipo).toUpperCase() === "C");

    // Regra ANTIGA: todo débito, de qualquer conta.
    const antigo = debitos.reduce((s, l) => s + Number(l.valor || 0), 0);

    // Regra NOVA (espelha FolhaDerivadaService).
    let novo;
    let motivo;
    if (contasDespesa.size) {
      const casadas = debitos.filter((l) => contasDespesa.has(String(l.conta || "").trim()));
      novo = casadas.reduce((s, l) => s + Number(l.valor || 0), 0);
      motivo = casadas.length
        ? `débito em conta de despesa (${casadas.map((l) => l.conta).join(", ")})`
        : "nenhum débito em conta de despesa de folha → DESCARTADO";
    } else if (temCredito && lines.length === 2) {
      novo = 0;
      motivo = "tem D e C em 2 pernas → parece pagamento → DESCARTADO";
    } else {
      novo = antigo;
      motivo = "sem conta resolvida e não parece pagamento → soma o débito";
    }

    antigoMes += antigo;
    novoMes += novo;
    const marca = Math.abs(antigo - novo) > 0.01 ? "  ⚠" : "";
    console.log(`   [${e.subtipo || "?"}] ${e.historico || e.id}${marca}`);
    console.log(`      lote ${e.loteImportacao || "—"}`);
    for (const l of lines) console.log(`      ${l.tipo}  ${String(l.conta || "(sem conta)").padEnd(14)} ${brl(l.valor)}`);
    console.log(`      antigo ${brl(antigo)}  →  novo ${brl(novo)}   [${motivo}]`);
  }
  totalAntigo += antigoMes;
  totalNovo += novoMes;
  const marcaMes = Math.abs(antigoMes - novoMes) > 0.01 ? "  ⚠ MUDOU" : "";
  console.log(`   → mês: antigo ${brl(antigoMes)}  novo ${brl(novoMes)}${marcaMes}`);
}

console.log("");
console.log(`TOTAL 12 MESES   antigo ${brl(totalAntigo)}   →   novo ${brl(totalNovo)}`);
console.log("");
console.log("Confira o valor NOVO de cada mês contra a folha real. Nenhum número volta para a tela");
console.log("do fechamento antes dessa conferência.");

await prisma.$disconnect();
