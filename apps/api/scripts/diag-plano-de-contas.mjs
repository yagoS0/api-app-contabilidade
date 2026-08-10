// O PLANO DE CONTAS REAL — dá para derivar sintética × analítica do que já existe?
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum DDL.
//
// A PERGUNTA
// A ideia do dono é reimportar o plano trazendo o código COMPLETO (`1.1.01.001`) junto do reduzido,
// e o programa derivar o booleano `analitica` uma vez: uma conta é SINTÉTICA se o código completo de
// alguma outra COMEÇA com o dela. Antes de construir isso, uma pergunta mais barata:
//
//   **o código REDUZIDO que já está no banco já permite essa derivação?**
//
// Se permitir, não há reimportação nenhuma — é uma migration derivando do que existe. Se não
// permitir, a reimportação é o caminho, e este script já diz quantas contas terão de casar.
//
// ⚠ A SEGUNDA FONTE, E ELA É MAIS FORTE QUE QUALQUER HEURÍSTICA DE STRING: conta que JÁ RECEBEU
// lançamento é analítica por fato observado, não por convenção. `AccountingEntryLine.conta` guarda o
// código como TEXTO (não é FK) — é por isso que ele é a identidade que a reimportação NÃO pode
// mudar, sob pena de orfanar todo lançamento existente sem erro nenhum na tela.
//
// ⚠ ESTE SCRIPT NÃO DECIDE NADA DE CONTABILIDADE. Ele mede forma de código e uso observado; quais
// contas devem receber lançamento é do contador.
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-plano-de-contas.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const n = (v) => Number(v || 0).toLocaleString("pt-BR");
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const linha = () => console.log("─".repeat(90));

console.log("═".repeat(90));
console.log("PLANO DE CONTAS — a hierarquia é derivável do que já existe?");
console.log("═".repeat(90));

const contas = await prisma.$queryRaw`
  SELECT a.id, a.codigo, a.nome, a.tipo, a."portalClientId", c.razao
    FROM "chart_of_accounts" a
    LEFT JOIN "PortalClient" c ON c.id = a."portalClientId"
   ORDER BY a."portalClientId" NULLS FIRST, a.codigo`;

const globais = contas.filter((c) => !c.portalClientId);
const proprias = contas.filter((c) => c.portalClientId);
console.log(`\ncontas no total: ${n(contas.length)}`);
console.log(`   GLOBAIS (valem para todas as empresas): ${n(globais.length)}`);
console.log(`   próprias de alguma empresa: ${n(proprias.length)}`);

// ─── 1. A FORMA do código reduzido ───────────────────────────────────────────────────────────
linha();
console.log("\n1) A FORMA DO CÓDIGO REDUZIDO\n");
const comPonto = contas.filter((c) => String(c.codigo || "").includes("."));
const soDigitos = contas.filter((c) => /^\d+$/.test(String(c.codigo || "")));
console.log(`   com ponto (candidato a hierárquico): ${n(comPonto.length)}  (${pct(comPonto.length, contas.length)})`);
console.log(`   só dígitos, sem separador:            ${n(soDigitos.length)}  (${pct(soDigitos.length, contas.length)})`);
console.log(`\n   amostra (10 primeiros códigos globais):`);
for (const c of globais.slice(0, 10)) console.log(`      ${String(c.codigo).padEnd(12)} ${c.tipo?.padEnd(11) || ""} ${c.nome}`);

// ─── 2. A derivação por PREFIXO — funciona? ──────────────────────────────────────────────────
linha();
console.log("\n2) DERIVAÇÃO POR PREFIXO (é sintética quem é começo de outro código)\n");
console.log("   ⚠ Testada SÓ dentro do mesmo escopo (global com global, empresa com a própria):");
console.log("     comparar entre escopos afirmaria parentesco entre planos diferentes.\n");

function analisaEscopo(lista, rotulo) {
  const codigos = lista.map((c) => String(c.codigo || "")).filter(Boolean);
  const set = new Set(codigos);
  let sinteticas = 0;
  const exemplos = [];
  for (const cod of codigos) {
    // é sintética se ALGUM outro código começa com ela E é mais longo
    const filha = codigos.find((o) => o !== cod && o.length > cod.length && o.startsWith(cod));
    if (filha) {
      sinteticas += 1;
      if (exemplos.length < 4) exemplos.push(`${cod} → ${filha}`);
    }
  }
  const analiticas = codigos.length - sinteticas;
  console.log(`   ${rotulo}: ${n(codigos.length)} contas · ${n(sinteticas)} sintéticas · ${n(analiticas)} analíticas`);
  if (exemplos.length) console.log(`      pares detectados: ${exemplos.join(" · ")}`);
  else console.log(`      ⚠ NENHUM par pai→filha detectado — o reduzido NÃO é hierárquico neste escopo.`);
  // ⚠ Falso positivo do prefixo puro: "5" é prefixo de "50" sem ser pai dele.
  const prefixoBobo = codigos.filter((c) => /^\d+$/.test(c)).some((c) => set.has(c + "0"));
  if (prefixoBobo) console.log(`      ⚠ risco de FALSO POSITIVO: há código numérico que é prefixo de outro sem ser pai (ex.: "5" e "50").`);
  return { total: codigos.length, sinteticas, analiticas };
}

const rGlobal = analisaEscopo(globais, "GLOBAL");
const porEmpresa = new Map();
for (const c of proprias) {
  if (!porEmpresa.has(c.portalClientId)) porEmpresa.set(c.portalClientId, { razao: c.razao, contas: [] });
  porEmpresa.get(c.portalClientId).contas.push(c);
}
let empresasHierarquicas = 0;
for (const { razao, contas: lista } of porEmpresa.values()) {
  const r = analisaEscopo(lista, razao);
  if (r.sinteticas > 0) empresasHierarquicas += 1;
}

// ─── 3. O USO OBSERVADO — a fonte mais forte ─────────────────────────────────────────────────
linha();
console.log("\n3) ⚠ USO OBSERVADO — conta que JÁ recebeu lançamento é analítica de fato\n");
const usadas = await prisma.$queryRaw`
  SELECT l.conta, count(*)::int AS lancamentos
    FROM "accounting_entry_lines" l
   GROUP BY l.conta
   ORDER BY lancamentos DESC`;
const codigosUsados = new Set(usadas.map((u) => String(u.conta)));
console.log(`   códigos distintos que já receberam lançamento: ${n(usadas.length)}`);
console.log(`   de um plano de ${n(contas.length)} contas → ${pct(usadas.length, contas.length)} do plano é usado`);
console.log(`\n   top 10 mais usados:`);
for (const u of usadas.slice(0, 10)) console.log(`      ${String(u.conta).padEnd(12)} ${n(u.lancamentos)} lançamento(s)`);

// ⚠ O cruzamento que importa: alguma conta USADA seria classificada como sintética pelo prefixo?
const todosCodigos = contas.map((c) => String(c.codigo || "")).filter(Boolean);
const usadasQueSeriamSinteticas = [...codigosUsados].filter((cod) =>
  todosCodigos.some((o) => o !== cod && o.length > cod.length && o.startsWith(cod)));
console.log(`\n   ⚠ contas USADAS que o prefixo chamaria de SINTÉTICA: ${n(usadasQueSeriamSinteticas.length)}`);
if (usadasQueSeriamSinteticas.length) {
  console.log(`      ${usadasQueSeriamSinteticas.slice(0, 15).join(" · ")}`);
  console.log(`      Ou a heurística de prefixo erra aqui, ou já se lançou em conta de agregação.`);
  console.log(`      Nos dois casos, filtrar por prefixo SEM revisão tiraria da lista contas em uso.`);
} else {
  console.log(`      nenhuma — a heurística não conflita com o uso real.`);
}

// ⚠ Código usado que NEM EXISTE no plano: a reimportação precisa saber o que fazer com ele.
const orfaos = [...codigosUsados].filter((cod) => !todosCodigos.includes(cod));
console.log(`\n   ⚠ códigos com lançamento que NÃO existem no plano: ${n(orfaos.length)}`);
if (orfaos.length) console.log(`      ${orfaos.slice(0, 15).join(" · ")}`);

// ─── 4. O veredito ───────────────────────────────────────────────────────────────────────────
linha();
console.log("\n4) VEREDITO\n");
if (rGlobal.sinteticas === 0 && empresasHierarquicas === 0) {
  console.log("   ⚠ O CÓDIGO REDUZIDO NÃO CARREGA HIERARQUIA. Não dá para derivar sintética × analítica");
  console.log("     do que já está no banco — a reimportação com o código COMPLETO é o caminho, e é");
  console.log("     a ideia do dono. O reduzido continua sendo a IDENTIDADE (os lançamentos apontam");
  console.log("     para ele em texto), então o import deve CASAR por ele e só ACRESCENTAR.");
} else {
  console.log("   Há hierarquia detectável no reduzido em pelo menos um escopo — vale conferir os");
  console.log("   pares acima antes de decidir: prefixo puro produz falso positivo ('5' × '50').");
}

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
