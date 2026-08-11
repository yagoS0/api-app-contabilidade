// O PORTÃO DE ACEITE DA CONTA MÃE — nenhuma conta EM USO pode sair como sintética.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhum DDL, nenhuma chamada externa. Ele SIMULA o import do
// arquivo real contra o banco e responde três perguntas antes de qualquer coisa ser gravada:
//
//   1) das contas que já receberam lançamento, alguma sairia SINTÉTICA? (tem de ser ZERO)
//   2) quantas contas ficariam sem `codigoCompleto` depois de um import do arquivo real?
//   3) o que é o código VAZIO com lançamento — conta em branco legítima ou dado quebrado?
//
// ⚠ O TESTE MAIS FORTE É A CONTA `5`. Ela é `111010001 CAIXA - MATRIZ`, a mais usada do escritório,
// e é ANALÍTICA. Se ela sair sintética, as colunas do arquivo foram trocadas — "5" também existe
// como código COMPLETO (é a (-) IRPJ/CSLL, reduzida 590), e lido nessa coluna ele TEM filhas.
//
// ⚠ Ele usa o PARSER e a DERIVAÇÃO de produção (`chartOfAccountsImport` / `lib/derivacaoAnalitica`),
// não uma cópia: um portão que medisse outra regra não mediria nada.
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-conta-mae.mjs "G:\Meu Drive\Plano de Contas.csv"'

import fs from "node:fs";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { parseCsvBuffer } from "../src/application/accounting/chartOfAccountsImport.js";
import { derivarAnalitica, resumirDerivacao } from "../src/application/accounting/lib/derivacaoAnalitica.js";

const arquivo = process.argv[2] || "G:\\Meu Drive\\Plano de Contas.csv";
const n = (v) => Number(v || 0).toLocaleString("pt-BR");
const linha = () => console.log("─".repeat(92));

console.log("═".repeat(92));
console.log("CONTA MÃE — portão de aceite (simulação, nada é gravado)");
console.log("═".repeat(92));

if (!fs.existsSync(arquivo)) {
  console.log(`\n⚠ arquivo não encontrado: ${arquivo}`);
  console.log("   passe o caminho como 1º argumento.");
  process.exit(1);
}

const parsed = parseCsvBuffer(fs.readFileSync(arquivo));
const comCompleto = parsed.filter((a) => a.codigoCompleto);
console.log(`\narquivo: ${arquivo}`);
console.log(`   linhas lidas: ${n(parsed.length)} · com código completo: ${n(comCompleto.length)}`);
console.log(`   amostra: ${parsed.slice(0, 3).map((a) => `${a.codigo}=${a.codigoCompleto} ${a.nome}`).join(" · ")}`);

const doArquivo = new Map(parsed.map((a) => [String(a.codigo), a.codigoCompleto || null]));

// ─── o banco ─────────────────────────────────────────────────────────────────────────────────
// ⚠ `$queryRaw` de propósito: a migration das colunas novas pode ainda NÃO estar aplicada no banco
// que este script está lendo, e um `findMany` do client já regenerado pediria `codigoCompleto` na
// SELECT e estouraria. O portão precisa rodar ANTES do deploy — é esse o ponto dele.
const contas = (await prisma.$queryRaw`
  SELECT a.id, a.codigo, a.nome, a."portalClientId"
    FROM "chart_of_accounts" a`).map((c) => ({ ...c, codigoCompleto: null }));
const escopos = new Map();
for (const c of contas) {
  const chave = c.portalClientId ?? "__GLOBAL__";
  if (!escopos.has(chave)) escopos.set(chave, []);
  escopos.get(chave).push(c);
}
console.log(`\nbanco: ${n(contas.length)} contas em ${n(escopos.size)} escopo(s) (global + próprias das empresas)`);

// ─── a simulação: casa pelo REDUZIDO, acrescenta o completo, deriva por escopo ────────────────
linha();
console.log("\n1) SIMULAÇÃO DO IMPORT — casa pelo reduzido, acrescenta o completo, deriva por escopo\n");

const veredito = new Map(); // codigo reduzido -> { analitica, escopos:[] }
const resumoPorEscopo = [];
for (const [chave, lista] of escopos) {
  const comArquivo = lista.map((c) => ({
    ...c,
    codigoCompleto: doArquivo.get(String(c.codigo)) ?? c.codigoCompleto ?? null,
  }));
  const derivadas = derivarAnalitica(comArquivo);
  const r = resumirDerivacao(derivadas);
  resumoPorEscopo.push({ chave, ...r });
  for (const d of derivadas) {
    if (!veredito.has(String(d.codigo))) veredito.set(String(d.codigo), []);
    veredito.get(String(d.codigo)).push({ escopo: chave, analitica: d.analitica, nome: d.nome });
  }
}
const global = resumoPorEscopo.find((r) => r.chave === "__GLOBAL__");
console.log(`   GLOBAL: ${n(global.total)} contas · ${n(global.sinteticas)} sintéticas · ${n(global.analiticas)} analíticas · ${n(global.semResposta)} SEM RESPOSTA`);
const empresas = resumoPorEscopo.filter((r) => r.chave !== "__GLOBAL__");
const totEmp = empresas.reduce((s, r) => ({
  total: s.total + r.total, sinteticas: s.sinteticas + r.sinteticas,
  analiticas: s.analiticas + r.analiticas, semResposta: s.semResposta + r.semResposta,
}), { total: 0, sinteticas: 0, analiticas: 0, semResposta: 0 });
console.log(`   EMPRESAS (${n(empresas.length)} escopos): ${n(totEmp.total)} contas · ${n(totEmp.sinteticas)} sintéticas · ${n(totEmp.analiticas)} analíticas · ${n(totEmp.semResposta)} SEM RESPOSTA`);

// ─── 2) quantas ficariam sem codigoCompleto ──────────────────────────────────────────────────
linha();
console.log("\n2) QUANTAS CONTAS FICARIAM SEM `codigoCompleto`\n");
const semResposta = totEmp.semResposta + global.semResposta;
console.log(`   total no banco: ${n(contas.length)}`);
console.log(`   sem código completo depois do import: ${n(semResposta)}`);
const semRespostaGlobal = escopos.get("__GLOBAL__").filter((c) => !doArquivo.has(String(c.codigo)) && !c.codigoCompleto);
if (semRespostaGlobal.length) {
  console.log(`   ⚠ globais sem resposta (${n(semRespostaGlobal.length)}): ${semRespostaGlobal.slice(0, 15).map((c) => `${c.codigo} ${c.nome}`).join(" · ")}`);
}
for (const [chave, lista] of escopos) {
  if (chave === "__GLOBAL__") continue;
  const orfas = lista.filter((c) => !doArquivo.has(String(c.codigo)));
  if (!orfas.length) continue;
  console.log(`   ⚠ escopo ${chave}: ${n(orfas.length)} conta(s) PRÓPRIA(S) fora do arquivo → ficam com \`codigoCompleto\` NULO`);
  console.log(`      ${orfas.map((c) => `${c.codigo} ${c.nome}`).join(" · ")}`);
}
// contas do ARQUIVO que não existem no banco (escopo global)
const codigosGlobais = new Set(escopos.get("__GLOBAL__").map((c) => String(c.codigo)));
const novasNoArquivo = parsed.filter((a) => !codigosGlobais.has(String(a.codigo)));
console.log(`   contas no ARQUIVO que não existem no plano global: ${n(novasNoArquivo.length)}`);
if (novasNoArquivo.length) console.log(`      ${novasNoArquivo.slice(0, 15).map((a) => `${a.codigo} ${a.nome}`).join(" · ")}`);
// contas no BANCO que não estão no arquivo → MANTIDAS
const mantidas = escopos.get("__GLOBAL__").filter((c) => !doArquivo.has(String(c.codigo)));
console.log(`   contas GLOBAIS no banco que NÃO estão no arquivo (serão MANTIDAS como estão): ${n(mantidas.length)}`);
if (mantidas.length) console.log(`      ${mantidas.slice(0, 15).map((c) => `${c.codigo} ${c.nome}`).join(" · ")}`);

// ─── 3) O PORTÃO ─────────────────────────────────────────────────────────────────────────────
linha();
console.log("\n3) ⚠ O PORTÃO — nenhuma conta EM USO pode sair como sintética\n");
const usadas = await prisma.$queryRaw`
  SELECT l.conta, count(*)::int AS lancamentos
    FROM "accounting_entry_lines" l
   GROUP BY l.conta
   ORDER BY lancamentos DESC`;
console.log(`   códigos distintos com lançamento: ${n(usadas.length)}`);

const reprovadas = [];
const semPlano = [];
for (const u of usadas) {
  const cod = String(u.conta ?? "").trim();
  if (cod === "") continue; // tratado no bloco 4
  const linhas = veredito.get(cod);
  if (!linhas) { semPlano.push({ cod, lanc: u.lancamentos }); continue; }
  const sinteticaEm = linhas.filter((l) => l.analitica === false);
  if (sinteticaEm.length) reprovadas.push({ cod, lanc: u.lancamentos, nome: sinteticaEm[0].nome, escopos: sinteticaEm.map((l) => l.escopo) });
}

console.log(`\n   ⚠ contas EM USO que sairiam SINTÉTICAS: ${n(reprovadas.length)}`);
if (reprovadas.length) {
  console.log("      ⚠ ATENÇÃO — leia o quadro abaixo ANTES de concluir que a regra errou.");
  console.log("        Há DOIS desfechos possíveis e eles se parecem na contagem:");
  console.log("          (a) as colunas trocaram → a conta \"5\" sai SINTÉTICA (ver a prova nomeada);");
  console.log("          (b) a regra está certa e já se lançou em conta de AGREGAÇÃO — decisão do dono.");
  const doArq = new Map(parsed.map((a) => [String(a.codigo), a]));
  for (const r of reprovadas.slice(0, 30)) {
    const arq = doArq.get(String(r.cod));
    const completo = arq?.codigoCompleto || "—";
    const filhas = parsed.filter((a) => a.codigoCompleto && a.codigoCompleto.length > completo.length && a.codigoCompleto.startsWith(completo));
    console.log(`\n         ${String(r.cod).padEnd(6)} ${n(r.lanc).padStart(4)} lanç.  completo=${completo} (nível ${completo.length})  ${r.nome || ""}`);
    console.log(`                filhas no arquivo: ${n(filhas.length)} — ${filhas.slice(0, 4).map((f) => `${f.codigoCompleto} ${f.nome}`).join(" · ")}`);
    const lancs = await prisma.$queryRaw`
      SELECT e.competencia, e.tipo, e.origem, e.historico, l.tipo AS dc, l.valor
        FROM "accounting_entry_lines" l
        JOIN "accounting_entries" e ON e.id = l."entryId"
       WHERE l.conta = ${String(r.cod)}
       ORDER BY e.competencia`;
    for (const x of lancs) {
      console.log(`                ${x.competencia}  ${x.dc}  ${String(x.valor).padStart(10)}  ${x.tipo}/${x.origem}  ${String(x.historico || "").slice(0, 50)}`);
    }
  }
} else {
  console.log("      ✅ PORTÃO APROVADO — nenhuma conta em uso saiu como sintética.");
}

// a prova mais forte, nomeada
const conta5 = veredito.get("5") || [];
const uso5 = usadas.find((u) => String(u.conta) === "5");
console.log(`\n   a prova nomeada — conta "5" (${n(uso5?.lancamentos || 0)} lançamentos):`);
for (const l of conta5) {
  const rot = l.analitica === true ? "ANALÍTICA ✅" : l.analitica === false ? "SINTÉTICA ❌" : "sem resposta";
  console.log(`      [${l.escopo}] ${l.nome} → ${rot}  (completo do arquivo: ${doArquivo.get("5") ?? "—"})`);
}

console.log(`\n   códigos com lançamento que NÃO existem em nenhum plano: ${n(semPlano.length)}`);
if (semPlano.length) console.log(`      ${semPlano.slice(0, 15).map((s) => `${s.cod} (${n(s.lanc)})`).join(" · ")}`);

// ─── 4) O CÓDIGO VAZIO ───────────────────────────────────────────────────────────────────────
linha();
console.log("\n4) ⚠ O CÓDIGO VAZIO COM LANÇAMENTO — conta em branco legítima ou dado quebrado?\n");
const vazias = await prisma.$queryRaw`
  SELECT count(*)::int AS linhas,
         count(DISTINCT l."entryId")::int AS lancamentos,
         count(*) FILTER (WHERE l.conta IS NULL)::int AS conta_null,
         count(*) FILTER (WHERE l.conta = '')::int AS conta_vazia
    FROM "accounting_entry_lines" l
   WHERE l.conta IS NULL OR btrim(l.conta) = ''`;
console.log(`   linhas com conta vazia: ${n(vazias[0].linhas)} (NULL: ${n(vazias[0].conta_null)} · string vazia: ${n(vazias[0].conta_vazia)})`);
console.log(`   lançamentos distintos afetados: ${n(vazias[0].lancamentos)}`);

const detalhe = await prisma.$queryRaw`
  SELECT e.tipo, e.origem, e.status, e."eventType", e.competencia, count(*)::int AS linhas
    FROM "accounting_entry_lines" l
    JOIN "accounting_entries" e ON e.id = l."entryId"
   WHERE l.conta IS NULL OR btrim(l.conta) = ''
   GROUP BY e.tipo, e.origem, e.status, e."eventType", e.competencia
   ORDER BY linhas DESC
   LIMIT 20`;
console.log(`\n   por tipo/origem/status/evento/competência:`);
for (const d of detalhe) {
  console.log(`      ${String(d.tipo).padEnd(10)} ${String(d.origem).padEnd(9)} ${String(d.status).padEnd(11)} ${String(d.eventType || "—").padEnd(22)} ${d.competencia}  → ${n(d.linhas)} linha(s)`);
}
const amostra = await prisma.$queryRaw`
  SELECT e.competencia, e.historico, l.tipo AS dc, l.valor
    FROM "accounting_entry_lines" l
    JOIN "accounting_entries" e ON e.id = l."entryId"
   WHERE l.conta IS NULL OR btrim(l.conta) = ''
   ORDER BY e.competencia DESC
   LIMIT 10`;
console.log(`\n   amostra (10 linhas):`);
for (const a of amostra) {
  console.log(`      ${a.competencia}  ${a.dc}  ${String(a.valor)}  ${String(a.historico || "").slice(0, 60)}`);
}
console.log(`\n   ⚠ O PROJETO DOCUMENTA que contas nascem em branco e são aprendidas na 1ª vez`);
console.log(`     (memória de D/C em AccountingHistorico). Se o quadro acima for PROVISAO/BAIXA com`);
console.log(`     origem SERPRO/TEMPLATE e eventType preenchido, é o caminho legítimo. A decisão é do dono.`);

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
