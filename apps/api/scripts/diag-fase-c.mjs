// O QUE A FASE C PODE SUGERIR HOJE — e a pergunta que decide o desenho.
//
// ⚠⚠ A PERGUNTA CENTRAL: `AccountingHistorico.contaDebito` guarda o REDUZIDO ou o codigoCompleto?
//
// A âncora desta casa é o `codigoCompleto` — *"eles são imutáveis enquanto os reduzidos mutáveis"* —
// e **518 contas têm o primeiro dígito do reduzido diferente do completo**. `RegraContabilizacao.
// contaDestino` exige codigoCompleto. Se a memória guarda o reduzido, a Fase C precisa TRADUZIR
// pelo plano DAQUELA empresa, e um registro GLOBAL (de outra empresa) não pode ser usado, porque o
// mesmo reduzido aponta para contas diferentes em empresas diferentes.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa.
//
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-fase-c.mjs'

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

function chave(texto) {
  return String(texto ?? "")
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

async function main() {
  console.log("=".repeat(96));
  console.log("1. `AccountingHistorico.contaDebito` — REDUZIDO ou codigoCompleto?");
  console.log("=".repeat(96));

  const memoria = await prisma.accountingHistorico.findMany({
    select: { companyPortalClientId: true, text: true, contaDebito: true, contaCredito: true, usageCount: true },
  });
  const comConta = memoria.filter((m) => m.contaDebito);

  // ⚠ O codigoCompleto tem 9 dígitos (máscara 1-1-1-2-4). O reduzido é curto.
  const noveDigitos = comConta.filter((m) => /^\d{9}$/.test(String(m.contaDebito).trim()));
  const curtos = comConta.filter((m) => !/^\d{9}$/.test(String(m.contaDebito).trim()));
  console.log(`\nregistros com contaDebito .......... ${comConta.length}`);
  console.log(`  com 9 dígitos (codigoCompleto?) .. ${noveDigitos.length} (${pct(noveDigitos.length, comConta.length)})`);
  console.log(`  ⚠ curtos (REDUZIDO?) ............. ${curtos.length} (${pct(curtos.length, comConta.length)})`);
  console.log(`  amostra: ${comConta.slice(0, 12).map((m) => m.contaDebito).join(", ")}`);

  // A prova: o valor bate com `codigo` (reduzido) ou com `codigoCompleto` do plano?
  const plano = await prisma.chartOfAccount.findMany({
    select: { portalClientId: true, codigo: true, codigoCompleto: true, nome: true },
  });
  const reduzidos = new Set(plano.map((c) => String(c.codigo)));
  const completos = new Set(plano.map((c) => String(c.codigoCompleto)));
  const bateReduzido = comConta.filter((m) => reduzidos.has(String(m.contaDebito).trim())).length;
  const bateCompleto = comConta.filter((m) => completos.has(String(m.contaDebito).trim())).length;
  console.log(`\n  ⚠⚠ casa com um REDUZIDO do plano ... ${bateReduzido} (${pct(bateReduzido, comConta.length)})`);
  console.log(`  ⚠⚠ casa com um codigoCompleto ...... ${bateCompleto} (${pct(bateCompleto, comConta.length)})`);
  console.log(`  → VEREDITO: ${bateReduzido > bateCompleto ? "a memória guarda o REDUZIDO" : "a memória guarda o codigoCompleto"}`);

  // ── 2. O REDUZIDO É AMBÍGUO ENTRE EMPRESAS? ────────────────────────────────────────────────
  console.log("\n" + "=".repeat(96));
  console.log("2. ⚠⚠ O MESMO REDUZIDO APONTA PARA CONTAS DIFERENTES EM EMPRESAS DIFERENTES?");
  console.log("=".repeat(96));
  const porReduzido = new Map();
  for (const c of plano) {
    const k = String(c.codigo);
    if (!porReduzido.has(k)) porReduzido.set(k, new Set());
    porReduzido.get(k).add(String(c.codigoCompleto));
  }
  const ambiguos = [...porReduzido.entries()].filter(([, s]) => s.size > 1);
  console.log(`\nreduzidos distintos ................ ${porReduzido.size}`);
  console.log(`  ⚠⚠ AMBÍGUOS (2+ completos) ....... ${ambiguos.length}`);
  for (const [k, s] of ambiguos.slice(0, 8)) console.log(`      reduzido ${k} → ${[...s].join(", ")}`);
  console.log(`\n  → Se houver ambíguos, um registro GLOBAL da memória NÃO pode virar regra:`);
  console.log(`    o mesmo reduzido é outra conta em outra empresa.`);

  // ── 3. OS GLOBAIS ──────────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(96));
  console.log("3. Os registros GLOBAIS da memória (companyPortalClientId nulo)");
  console.log("=".repeat(96));
  const globais = memoria.filter((m) => !m.companyPortalClientId && m.contaDebito);
  console.log(`\nglobais com conta .................. ${globais.length}`);
  const globalAmbiguo = globais.filter((m) => (porReduzido.get(String(m.contaDebito).trim())?.size || 0) > 1).length;
  console.log(`  ⚠⚠ cujo reduzido é AMBÍGUO ....... ${globalAmbiguo}`);

  // ── 4. QUANTO A FASE C SUGERIRIA ───────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(96));
  console.log("4. ⚠ QUANTAS NOTAS RECEBIDAS GANHARIAM SUGESTÃO — o valor real da Fase C");
  console.log("=".repeat(96));

  const notas = await prisma.portalInvoice.findMany({
    where: { papel: "DEST", statusEfetivo: "autorizada" },
    select: { clientId: true, emitenteNome: true, emitenteDoc: true, total: true },
    take: 5000,
  });
  console.log(`\nnotas recebidas autorizadas ........ ${notas.length}`);

  // memória por EMPRESA (ignorando o usuário — a pergunta é o que a EMPRESA sabe)
  const memPorEmpresa = new Map();
  for (const m of memoria) {
    if (!m.contaDebito || !m.companyPortalClientId) continue;
    const k = `${m.companyPortalClientId}|${chave(m.text)}`;
    if (!memPorEmpresa.has(k)) memPorEmpresa.set(k, new Set());
    memPorEmpresa.get(k).add(m.contaDebito);
  }

  let comSugestao = 0;
  let ambiguaNaMemoria = 0;
  const fornecedoresSem = new Map();
  for (const n of notas) {
    const k = `${n.clientId}|${chave(n.emitenteNome)}`;
    const achou = memPorEmpresa.get(k);
    if (!achou) {
      const nome = n.emitenteNome || "(sem nome)";
      fornecedoresSem.set(nome, (fornecedoresSem.get(nome) || 0) + 1);
      continue;
    }
    if (achou.size > 1) ambiguaNaMemoria += 1;
    else comSugestao += 1;
  }
  console.log(`  ⚠ ganhariam CONTA SUGERIDA ....... ${comSugestao} (${pct(comSugestao, notas.length)})`);
  console.log(`  ⚠⚠ memória DIVIDIDA (não sugere) . ${ambiguaNaMemoria}`);
  console.log(`  sem memória (entram sem sugestão) . ${notas.length - comSugestao - ambiguaNaMemoria}`);
  console.log(`\n  os 10 fornecedores sem memória que mais aparecem:`);
  for (const [nome, n] of [...fornecedoresSem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`      ${String(n).padStart(4)}×  ${nome.slice(0, 60)}`);
  }

  // ── 5. A ÂNCORA CNPJ ───────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(96));
  console.log("5. A âncora por CNPJ — quantos fornecedores se repetem por empresa?");
  console.log("=".repeat(96));
  const porCnpj = new Map();
  for (const n of notas) {
    if (!n.emitenteDoc) continue;
    const k = `${n.clientId}|${n.emitenteDoc}`;
    porCnpj.set(k, (porCnpj.get(k) || 0) + 1);
  }
  const repetidos = [...porCnpj.values()].filter((v) => v >= 2).length;
  console.log(`\npares empresa × CNPJ fornecedor .... ${porCnpj.size}`);
  console.log(`  ⚠ com 2+ notas (piso do aprendizado) ... ${repetidos} (${pct(repetidos, porCnpj.size)})`);
  console.log(`\n  → É este o alcance da regra APRENDIDA por CNPJ: confirmada 2×, a próxima entra sozinha.`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
