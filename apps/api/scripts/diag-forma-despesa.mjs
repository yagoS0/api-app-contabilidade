// A FORMA DO LANCAMENTO DE DESPESA -- "como esta casa ja lanca despesa?"
//
// SOMENTE LEITURA. Nao existe --aplicar. Este script nao escreve nada e nao chama servico externo.
//
// ## Por que ele existe, e por que ele vem ANTES do codigo
//
// O plano da conferencia de lancamentos faz a nota recebida virar lancamento. Um contador poderia
// esperar a forma classica -- D despesa / C fornecedor na competencia, D fornecedor / C caixa no
// pagamento. ESTE PLANO NAO PRESUME ISSO: mudar a forma do lancamento contabil sem pedido
// explicito do dono e proibido nesta casa.
//
// Entao a forma nao se desenha: MEDE-SE. O gerador reproduz o que este script encontrar.
//
// (!) E ha uma segunda pergunta, tao cara quanto: o indice UNIQUE PARCIAL
// (portalClientId, competencia, eventType, origem) WHERE tipo <> BAIXA esta vivo. Se os
// lancamentos de despesa existentes tem eventType NULO, duas notas na mesma competencia convivem
// (no Postgres NULLs sao distintos em UNIQUE). Se tiverem eventType preenchido, o gerador colide
// na SEGUNDA nota do mes -- e o erro apareceria como 500 em producao, nao em teste.
//
// Uso:
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-forma-despesa.mjs'

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const linha = (c = "=") => console.log(c.repeat(96));
const pct = (n, total) => (total ? `${((n / total) * 100).toFixed(1)}%` : "-");

const entries = await prisma.accountingEntry.findMany({
  where: { tipo: "DESPESA" },
  select: {
    id: true, competencia: true, historico: true, descricaoImportacao: true,
    eventType: true, subtipo: true, origem: true, status: true, statusPagamento: true,
    tipoLinha: true, codigoTributo: true, sourceGuideId: true, circularId: true,
    ruleId: true, parcelamentoId: true, loteImportacao: true, data: true, portalClientId: true,
    lines: { select: { conta: true, tipo: true, valor: true, ordem: true, historico: true, tipoLinha: true } },
  },
  orderBy: { data: "asc" },
});

linha();
console.log(`FORMA DO LANCAMENTO DE DESPESA -- ${entries.length} lancamento(s) tipo DESPESA`);
console.log("SOMENTE LEITURA. Nada e escrito por este script.");
linha();

if (!entries.length) {
  console.log("\nNenhum lancamento DESPESA na base. O gerador nao tem forma a reproduzir --");
  console.log("isso e uma pergunta para o dono, nao um caminho para inventar a forma.");
  await prisma.$disconnect();
  process.exit(0);
}

// ---------------------------------------------------------------- 1. quantas pernas
const porQtdLinhas = new Map();
for (const e of entries) porQtdLinhas.set(e.lines.length, (porQtdLinhas.get(e.lines.length) || 0) + 1);
console.log("\n## 1. QUANTAS PERNAS POR LANCAMENTO  <- decide se o gerador cria 1 ou 2 linhas\n");
for (const [n, q] of [...porQtdLinhas.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`   ${String(n).padStart(2)} linha(s): ${String(q).padStart(4)}  ${pct(q, entries.length)}`);
}

// ---------------------------------------------------------------- 2. lados presentes
const porLados = new Map();
for (const e of entries) {
  const d = e.lines.filter((l) => l.tipo === "D").length;
  const c = e.lines.filter((l) => l.tipo === "C").length;
  const k = `${d}D / ${c}C`;
  porLados.set(k, (porLados.get(k) || 0) + 1);
}
console.log("\n## 2. LADOS PRESENTES  <- perna unica ou partida dobrada?\n");
for (const [k, q] of [...porLados.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${k.padEnd(12)} ${String(q).padStart(4)}  ${pct(q, entries.length)}`);
}

// ---------------------------------------------------------------- 3. contas usadas
const contaD = new Map();
const contaC = new Map();
for (const e of entries) {
  for (const l of e.lines) {
    const alvo = l.tipo === "D" ? contaD : contaC;
    const k = String(l.conta || "(vazia)");
    alvo.set(k, (alvo.get(k) || 0) + 1);
  }
}
const plano = await prisma.chartOfAccount.findMany({
  select: { portalClientId: true, codigo: true, codigoCompleto: true, nome: true, tipo: true },
});
// (!) GLOBAIS PRIMEIRO, EMPRESA SO SE NAO HOUVER GLOBAL -- este script agrega a carteira inteira,
// entao ele NAO pode afirmar a resolucao por empresa. O rotulo aqui e orientacao de leitura, e o
// codigo reduzido cru continua sendo o dado.
const nomeDaConta = new Map();
for (const c of plano.filter((c) => !c.portalClientId)) nomeDaConta.set(c.codigo, c);
for (const c of plano.filter((c) => c.portalClientId)) if (!nomeDaConta.has(c.codigo)) nomeDaConta.set(c.codigo, c);
const rotulo = (cod) => {
  const c = nomeDaConta.get(cod);
  return c ? `${c.nome} [${c.tipo}] ${c.codigoCompleto || "sem codigo completo"}` : "(fora do plano)";
};

console.log("\n## 3a. CONTAS A DEBITO  <- a despesa\n");
for (const [k, q] of [...contaD.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`   ${k.padEnd(8)} ${String(q).padStart(4)}  ${rotulo(k)}`);
}
console.log("\n## 3b. CONTAS A CREDITO  <- (!!) A PERGUNTA CENTRAL: caixa, ou fornecedor?\n");
if (!contaC.size) {
  console.log("   NENHUMA. Todo lancamento de despesa desta casa e de PERNA UNICA (so debito).");
} else {
  for (const [k, q] of [...contaC.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`   ${k.padEnd(8)} ${String(q).padStart(4)}  ${rotulo(k)}`);
  }
}

// ---------------------------------------------------------------- 4. colunas do cabecalho
const dist = (campo, fn) => {
  const m = new Map();
  for (const e of entries) {
    const k = fn ? fn(e) : e[campo];
    const kk = k === null || k === undefined ? "(null)" : String(k);
    m.set(kk, (m.get(kk) || 0) + 1);
  }
  const partes = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, q]) => `${k}=${q}`);
  console.log(`   ${campo.padEnd(22)} ${partes.join("  ")}`);
};
console.log("\n## 4. COLUNAS DO CABECALHO  <- o que o gerador precisa preencher\n");
for (const c of ["eventType", "subtipo", "origem", "status", "statusPagamento", "tipoLinha", "codigoTributo"]) dist(c);
dist("sourceGuideId", (e) => (e.sourceGuideId ? "preenchido" : "(null)"));
dist("circularId", (e) => (e.circularId ? "preenchido" : "(null)"));
dist("ruleId", (e) => (e.ruleId ? "preenchido" : "(null)"));
dist("parcelamentoId", (e) => (e.parcelamentoId ? "preenchido" : "(null)"));
dist("descricaoImportacao", (e) => (e.descricaoImportacao ? "preenchido" : "(null)"));
dist("loteImportacao", (e) => (e.loteImportacao ? "preenchido" : "(null)"));

// ---------------------------------------------------------------- 5. o UNIQUE parcial
console.log("\n## 5. (!!) O UNIQUE PARCIAL (portalClientId, competencia, eventType, origem) WHERE tipo<>BAIXA\n");
const comEvento = entries.filter((e) => e.eventType != null);
console.log(`   DESPESA com eventType preenchido: ${comEvento.length} de ${entries.length}`);
if (!comEvento.length) {
  console.log("   => LIVRE. Com eventType NULO o Postgres trata cada linha como distinta,");
  console.log("      entao N notas na mesma competencia convivem. O gerador DEVE gravar eventType: null.");
} else {
  console.log("   => (!) ATENCAO: ha DESPESA com eventType. O gerador colidiria na 2a nota do mes.");
  const chaves = new Map();
  for (const e of comEvento) {
    const k = `${e.portalClientId}|${e.competencia}|${e.eventType}|${e.origem}`;
    chaves.set(k, (chaves.get(k) || 0) + 1);
  }
  for (const [k, q] of [...chaves.entries()].filter(([, q]) => q > 1)) console.log(`      colisao viva: ${k} x${q}`);
}

// ---------------------------------------------------------------- 6. historico
console.log("\n## 6. HISTORICO -- as 15 primeiras, cruas  <- o formato que o gerador imita\n");
for (const e of entries.slice(0, 15)) {
  const d = e.lines.find((l) => l.tipo === "D");
  const c = e.lines.find((l) => l.tipo === "C");
  console.log(`   ${e.competencia}  ${String(e.origem).padEnd(7)} D:${String(d?.conta || "-").padEnd(6)} C:${String(c?.conta || "-").padEnd(6)} ${JSON.stringify(e.historico)}`);
}
const comPago = entries.filter((e) => /^pago\b/i.test(String(e.historico || ""))).length;
console.log(`\n   comecam com o token PAGO: ${comPago} de ${entries.length}  ${pct(comPago, entries.length)}`);

// ---------------------------------------------------------------- 7. o que impediria gerar
console.log("\n## 7. O QUE O GERADOR TERIA DE RECUSAR (medido nos existentes)\n");
const semConta = entries.filter((e) => e.lines.some((l) => !String(l.conta || "").trim())).length;
const semLinha = entries.filter((e) => !e.lines.length).length;
console.log(`   lancamento sem NENHUMA linha: ${semLinha}`);
console.log(`   lancamento com linha de conta VAZIA: ${semConta}`);

// ---------------------------------------------------------------- 8. por empresa
const nomes = new Map((await prisma.portalClient.findMany({ select: { id: true, razao: true } })).map((c) => [c.id, c.razao]));
const porEmpresa = new Map();
for (const e of entries) porEmpresa.set(e.portalClientId, (porEmpresa.get(e.portalClientId) || 0) + 1);
console.log(`\n## 8. POR EMPRESA -- ${porEmpresa.size} empresa(s) tem despesa lancada\n`);
for (const [id, q] of [...porEmpresa.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(q).padStart(4)}  ${nomes.get(id) || id}`);
}

linha();
await prisma.$disconnect();
