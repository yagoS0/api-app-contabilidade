// Ensaio com schema real já migrado. Não lê .env nem chama provedores.
// node scripts/verify-dre-postgres.js --url "$DATABASE_URL"
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const arg = process.argv.indexOf("--url");
const url = new URL((arg >= 0 ? process.argv[arg + 1] : process.env.DATABASE_URL) || "invalid:");
if (!["postgresql:", "postgres:"].includes(url.protocol)
  || !["127.0.0.1", "localhost"].includes(url.hostname)
  || !/^\/[a-zA-Z0-9_]+_check$/.test(url.pathname)) {
  throw new Error("Use somente PostgreSQL descartável local com nome terminado em _check, via --url ou DATABASE_URL.");
}
process.env.DATABASE_URL = url.href;
globalThis.fetch = async () => { throw new Error("Provedores externos proibidos neste ensaio."); };
const { Prisma } = await import("@prisma/client");
const { prisma } = await import("../src/infrastructure/db/prisma.js");
const { montarDre } = await import("../src/application/dre/DreService.js");
const prefix = `dre-check-${randomUUID()}`;
const companyId = `${prefix}-empresa`, outraId = `${prefix}-outra`;
const conta = codigo => `${prefix}-${codigo}`;
const competencia = "2026-09";
let checks = 0;
const ok = nome => console.log(`PASS ${++checks}: ${nome}`);
const valorDe = (dre, chave) => dre.linhas.find(l => l.chave === chave).valor;
const perto = (valor, esperado) => assert.ok(Math.abs(valor - esperado) < 0.000001, `${valor} diferente de ${esperado}`);
const ler = () => montarDre({ portalClientId: companyId, competencia, client: prisma });
const criar = (nome, lines, extra = {}) => prisma.accountingEntry.create({ data: {
  id: `${prefix}-${nome}`, portalClientId: companyId, competencia,
  // Data em outro mês prova que a DRE segue competência, não caixa/data do pagamento.
  data: new Date("2026-10-05T12:00:00Z"), historico: `Fixture DRE ${nome}`, status: "CONFIRMADO",
  ...extra, lines: { create: lines.map(([codigo, tipo, valor]) => ({ conta: conta(codigo), tipo, valor })) },
} });

try {
  await prisma.portalClient.createMany({ data: [companyId, outraId].map(id => ({ id, cnpj: id, razao: "Empresa descartável DRE" })) });
  await prisma.chartOfAccount.createMany({ data: [
    ["receita", "311020001", "RECEITA"], ["despesa", "411020001", "DESPESA"],
    ["deducao", "331030009", "RECEITA"], ["caixa", "111010001", "ATIVO"],
    ["passivo", "211050001", "PASSIVO"], ["desconhecida", "413010001", "DESPESA"],
  ].map(([codigo, codigoCompleto, tipo]) => ({ portalClientId: companyId, codigo: conta(codigo), codigoCompleto, tipo, nome: `Fixture ${codigo}`, analitica: true })) });

  const vazio = await ler();
  assert.equal(vazio.semLancamento, true);
  assert.equal(vazio.qualidade.status, "SEM_LANCAMENTOS");
  ok("competência sem lançamentos é ausência nomeada");

  const receita = await criar("receita", [["receita", "C", "1000.35"], ["caixa", "D", "1000.35"]]);
  await criar("despesa", [["despesa", "D", "200.10"], ["caixa", "C", "200.10"]]);
  await criar("deducao", [["deducao", "D", "60.02"], ["passivo", "C", "60.02"]]);
  await criar("outro-mes", [["receita", "C", "90000.00"]], { competencia: "2026-08" });
  await criar("outra-empresa", [["receita", "C", "80000.00"]], { portalClientId: outraId });
  const raw = await prisma.accountingEntryLine.findFirst({ where: { entryId: receita.id } });
  assert.ok(Prisma.Decimal.isDecimal(raw.valor), "ensaio deve receber Decimal real do banco");
  const base = await ler();
  perto(valorDe(base, "receitaBruta"), 1000.35);
  perto(valorDe(base, "gerais"), -200.10);
  perto(valorDe(base, "deducoes"), -60.02);
  perto(valorDe(base, "resultadoDoPeriodo"), 740.23);
  assert.equal(base.qualidade.provisorio, false);
  assert.deepEqual(base.naoClassificado, []);
  ok("Decimal real, sinais, competência e empresa corretos; patrimoniais não geram aviso");

  await criar("estorno", [["receita", "D", "20.20"], ["caixa", "C", "20.20"]], { tipo: "ESTORNO", estornoDeEntryId: receita.id });
  const estornado = await ler();
  perto(valorDe(estornado, "receitaBruta"), 980.15);
  perto(valorDe(estornado, "resultadoDoPeriodo"), 720.03);
  ok("estorno entra com sinal inverso sem excluir lançamento original");

  await criar("sem-mapeamento", [["desconhecida", "D", "150.27"], ["caixa", "C", "150.27"]]);
  const parcial = await ler();
  perto(valorDe(parcial, "resultadoDoPeriodo"), 720.03);
  assert.equal(parcial.qualidade.status, "PROVISORIO");
  assert.equal(parcial.qualidade.linhasNaoClassificadas, 1);
  assert.equal(parcial.naoClassificado[0].causa, "resultado_sem_mapeamento");
  perto(parcial.naoClassificado[0].valor, 150.27);
  ok("ramo de resultado desconhecido é exposto, preservando totais reconhecidos");

  await criar("rascunho", [["receita", "C", "10.07"], ["caixa", "D", "10.07"]], { status: "RASCUNHO" });
  const final = JSON.parse(JSON.stringify(await ler()));
  perto(valorDe(final, "resultadoDoPeriodo"), 730.10);
  assert.equal(final.qualidade.lancamentosRascunho, 1);
  assert.ok(final.qualidade.motivos.includes("lancamento_rascunho"));
  assert.equal(final.qualidade.linhasInvalidas, 0);
  assert.equal(final.demonstracao, false);
  ok("rascunho válido integra soma e sinaliza resultado provisório no JSON público");
  console.log(`PASS: ${checks} cenários DRE em PostgreSQL real.`);
} finally {
  // Só as duas empresas UUID desta execução; relações removem apenas suas fixtures.
  try { await prisma.portalClient.deleteMany({ where: { id: { in: [companyId, outraId] } } }); }
  finally { await prisma.$disconnect(); }
}
