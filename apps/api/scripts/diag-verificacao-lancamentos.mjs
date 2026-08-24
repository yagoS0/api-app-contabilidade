// PRE-VERIFICACAO DE LANCAMENTOS -- "as provisoes estao nas contas certas?"
//
// SOMENTE LEITURA. Nao existe `--aplicar`: este script nao corrige nada, nao apaga memoria e nao
// chama servico externo. Ele responde a pergunta que o dono fez antes de importar no sistema
// contabil dele.
//
// Usa o MESMO motor da tela (`application/accounting/regras/`), nunca uma segunda regra -- duas
// leituras da mesma pergunta divergem na primeira correcao.
//
// Uso:
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-verificacao-lancamentos.mjs'
//   ... node apps/api/scripts/diag-verificacao-lancamentos.mjs --empresa <cnpj|razao> --competencia 2026-07

import { PrismaClient } from "@prisma/client";
import { carregarPlano } from "../src/application/accounting/AliquotaPorLancamentosService.js";
import { verificarLote } from "../src/application/accounting/regras/MotorRegras.js";
import { conferirAncorasDeFamilia, pontuarCodigoCompleto } from "../src/application/accounting/regras/familiaDaConta.js";

const prisma = new PrismaClient();
const arg = (nome) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const filtroEmpresa = arg("empresa");
const filtroComp = arg("competencia");
const so = (v) => String(v || "").replace(/\D+/g, "");

const linha = (c = "=") => console.log(c.repeat(96));

const clientes = await prisma.portalClient.findMany({ select: { id: true, cnpj: true, razao: true } });
const alvo = filtroEmpresa
  ? clientes.filter((c) => so(c.cnpj) === so(filtroEmpresa)
      || String(c.razao || "").toUpperCase().includes(String(filtroEmpresa).toUpperCase()))
  : clientes;

linha();
console.log(`PRE-VERIFICACAO DE LANCAMENTOS -- ${alvo.length} empresa(s)${filtroComp ? ` -- competencia ${filtroComp}` : ""}`);
console.log("SOMENTE LEITURA. Nada e corrigido por este script.");
linha();

// ── as ancoras do plano ainda batem? (tripwire, nao classificador) ───────────────────────────────
const planoGlobal = await prisma.chartOfAccount.findMany({
  where: { portalClientId: null },
  select: { codigo: true, nome: true, codigoCompleto: true },
});
const ancorasTortas = conferirAncorasDeFamilia(planoGlobal);
if (ancorasTortas.length) {
  console.log("\n*** ATENCAO: o plano de contas global mudou de forma. A classificacao pode estar errada. ***");
  for (const d of ancorasTortas) {
    console.log(`   ${d.ancora} (${d.codigoCompleto}): ${d.motivo}${d.nomeAtual ? ` -- esperado "${d.nomeMedido}", achado "${d.nomeAtual}"` : ""}`);
  }
} else {
  console.log("\nancoras do plano global: OK (33103 / 33101 / 33102 / 41103 / 21105)");
}

const totalGeral = { total: 0, ok: 0, viola: 0, conferir: 0, indeterminado: 0 };
const porRegraGeral = new Map();
const detalhe = [];

for (const c of alvo) {
  const where = { portalClientId: c.id, tipo: { in: ["PROVISAO", "BAIXA"] } };
  if (filtroComp) where.competencia = filtroComp;
  const entries = await prisma.accountingEntry.findMany({
    where,
    select: {
      id: true, tipo: true, eventType: true, subtipo: true, competencia: true,
      parcelamentoId: true, historico: true,
      lines: { select: { conta: true, tipo: true, valor: true } },
    },
    orderBy: [{ competencia: "desc" }],
  });
  if (!entries.length) continue;

  const plano = await carregarPlano(c.id, prisma);
  const resolverConta = (cod) => plano.get(String(cod)) || null;
  const r = verificarLote({ lancamentos: entries, resolverConta, empresaId: c.id });

  for (const k of Object.keys(totalGeral)) totalGeral[k] += r.resumo[k] || 0;
  for (const g of r.porRegra) {
    const a = porRegraGeral.get(g.regraId) || { regraId: g.regraId, n: 0, empresas: new Set(), exemplos: [] };
    a.n += g.n;
    a.empresas.add(c.razao);
    for (const e of g.exemplos) if (a.exemplos.length < 4 && !a.exemplos.includes(e)) a.exemplos.push(e);
    porRegraGeral.set(g.regraId, a);
  }

  const porId = new Map(entries.map((e) => [e.id, e]));
  for (const l of r.porLancamento) {
    if (!l.achados.length) continue;
    const e = porId.get(l.id);
    detalhe.push({ empresa: c.razao, competencia: e?.competencia, evento: e?.eventType || e?.subtipo, situacao: l.situacao, achados: l.achados });
  }
}

// ── O RELATORIO, AGRUPADO POR REGRA ──────────────────────────────────────────────────────────────
// E assim que ele serve: o contador nao quer 134 linhas, quer "6 provisoes de IRPJ/CSLL no ramo 5"
// e corrigir as seis de uma vez.
console.log("");
linha();
console.log("RESUMO");
linha();
console.log(`  lancamentos conferidos (PROVISAO + BAIXA) . ${totalGeral.total}`);
console.log(`  OK ....................................... ${totalGeral.ok}`);
console.log(`  ACUSADOS (viola) ......................... ${totalGeral.viola}`);
console.log(`  A CONFERIR ............................... ${totalGeral.conferir}`);
console.log(`  nao avaliaveis (sem conta no plano) ...... ${totalGeral.indeterminado}`);

console.log("");
linha();
console.log("POR REGRA -- e por aqui que se corrige em lote");
linha();
if (!porRegraGeral.size) console.log("  nenhum achado.");
for (const g of [...porRegraGeral.values()].sort((a, b) => b.n - a.n)) {
  console.log(`\n  ${g.regraId} -- ${g.n} lancamento(s), em ${g.empresas.size} empresa(s)`);
  for (const ex of g.exemplos) console.log(`      . ${ex}`);
}

console.log("");
linha();
console.log("DETALHE");
linha();
if (!detalhe.length) console.log("  nenhum achado.");
for (const d of detalhe.slice(0, 60)) {
  console.log(`\n  ${String(d.empresa).slice(0, 34).padEnd(35)} ${d.competencia || "-"}  ${String(d.evento || "-").padEnd(14)} [${d.situacao}]`);
  for (const a of d.achados) console.log(`      ${a.regraId}  ${a.mensagem}`);
}
if (detalhe.length > 60) console.log(`\n  ... e mais ${detalhe.length - 60} lancamento(s).`);

// ── O AVISO QUE EVITA A LEITURA ERRADA DO PRIMEIRO RELATORIO ─────────────────────────────────────
console.log("");
linha();
console.log("COMO LER ESTE RELATORIO");
linha();
console.log(`
  * IRPJ e CSLL vao acusar 100% ate alguem lancar uma vez nas contas certas.
    Hoje eles debitam ${pontuarCodigoCompleto("511010001")} / ${pontuarCodigoCompleto("511010002")} (o ramo 5), e o balancete do sistema
    de destino traz esse grupo ZERADO -- ele usa ${pontuarCodigoCompleto("411030006")} (IRPJ) e
    ${pontuarCodigoCompleto("411030005")} (CONTRIBUICAO SOCIAL, para a CSLL). Nao e defeito do motor:
    e exatamente o de-para errado que ele existe para pegar antes da importacao.

  * "nao avaliaveis" sao lancamentos cuja perna esta sem conta contabil, ou com conta
    fora do plano. Eles NAO sao acusados -- nao ha criterio para acusar. Aparecem aqui
    so para voce saber o tamanho do que a verificacao nao alcanca.

  * As provisoes de INSS e de DAS-de-upload que a Circular monta sao SINTETICAS: existem
    so em memoria, com contas ficticias "INSS" e "DAS" que nao estao no plano. Elas nem
    chegam aqui -- nao ha AccountingEntry para conferir.

  * "A CONFERIR" nao e erro. E o lancamento que move divida entre passivos, que costuma
    ser inclusao em parcelamento -- ato legitimo com forma de provisao.
`);

await prisma.$disconnect();
