// Consumo das chamadas PAGAS ao SERPRO — SOMENTE LEITURA.
//
// É com este número que os tetos de `config.js` devem ser ajustados. Enquanto ninguém olhar o
// consumo real, qualquer teto é chute: alto demais não protege, baixo demais trava fechamento.
//
// Uso:
//   node scripts/diag-consumo-serpro.mjs [dias]        # padrão: 7
//   node scripts/diag-consumo-serpro.mjs 30

import { prisma } from "../src/infrastructure/db/prisma.js";
import { SERPRO_COOLDOWN_SEGUNDOS, SERPRO_TETO_DIARIO_EMPRESA, SERPRO_GUARDA_ATIVA } from "../src/config.js";
import { consumoDoMes } from "../src/application/fiscal/serpro/SerproCallGuard.js";

const dias = Number(process.argv[2]) || 7;
const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

const chamadas = await prisma.serproChamada.findMany({
  where: { createdAt: { gte: desde } },
  select: {
    cnpj: true, portalClientId: true, idServico: true, rota: true,
    status: true, erroCodigo: true, duracaoMs: true, origem: true, forcado: true, createdAt: true,
  },
  orderBy: { createdAt: "desc" },
});

console.log(`GUARDA: ${SERPRO_GUARDA_ATIVA ? "ativa" : "DESLIGADA"} · cooldown ${SERPRO_COOLDOWN_SEGUNDOS}s · teto ${SERPRO_TETO_DIARIO_EMPRESA}/empresa/dia`);

// O teto global é derivado da carteira, então mostrar a CONTA é mais útil que mostrar o número:
// quando ele apertar, é aqui que se vê se a carteira cresceu ou se o consumo por empresa subiu.
const mes = await consumoDoMes();
const barra = (f) => `[${"#".repeat(Math.min(20, Math.round(f * 20))).padEnd(20, "·")}]`;
console.log(`MÊS CORRENTE: ${mes.usadas} de ${mes.teto}  ${barra(mes.fracao)} ${Math.round(mes.fracao * 100)}%`);
console.log(`   teto = ${mes.empresasAtivas} empresas ativas × ${mes.orcamentoPorEmpresa} por empresa · restam ${mes.restantes}`);
if (mes.estourado) console.log("   ⚠ TETO ESTOURADO — chamadas novas estão sendo recusadas (ADMIN pode forçar com ?forcar=1)");
else if (mes.alerta) console.log("   ⚠ acima do limiar de alerta — reveja SERPRO_ORCAMENTO_MENSAL_POR_EMPRESA antes de estourar");
console.log(`\nJANELA: últimos ${dias} dia(s) — ${chamadas.length} registro(s)\n`);

if (!chamadas.length) {
  console.log("Nenhuma chamada registrada. Se isso surpreende, confira se o deploy já subiu com a guarda.");
  await prisma.$disconnect();
  process.exit(0);
}

// Só "ok" e "erro" foram COBRADAS; as recusadas são economia, não gasto.
const cobradas = chamadas.filter((c) => c.status === "ok" || c.status === "erro");
const recusadas = chamadas.filter((c) => String(c.status).startsWith("recusada"));

const razaoPorId = new Map();
const ids = [...new Set(cobradas.map((c) => c.portalClientId).filter(Boolean))];
if (ids.length) {
  const empresas = await prisma.portalClient.findMany({ where: { id: { in: ids } }, select: { id: true, razao: true } });
  for (const e of empresas) razaoPorId.set(e.id, e.razao);
}

console.log(`COBRADAS: ${cobradas.length}   (ok ${cobradas.filter((c) => c.status === "ok").length} · erro ${cobradas.filter((c) => c.status === "erro").length})`);
console.log(`EVITADAS PELA GUARDA: ${recusadas.length}   (cooldown ${recusadas.filter((c) => c.status === "recusada_cooldown").length} · teto ${recusadas.filter((c) => c.status === "recusada_teto").length})`);
const forcadas = cobradas.filter((c) => c.forcado).length;
if (forcadas) console.log(`FORÇADAS POR ADMIN: ${forcadas}`);
console.log("");

function agrupar(lista, chave) {
  const m = new Map();
  for (const c of lista) {
    const k = chave(c) || "(sem)";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

console.log("POR SERVIÇO");
for (const [servico, n] of agrupar(cobradas, (c) => c.idServico)) console.log(`  ${String(n).padStart(5)}  ${servico}`);

console.log("\nPOR ORIGEM (quem disparou)");
for (const [origem, n] of agrupar(cobradas, (c) => c.origem)) console.log(`  ${String(n).padStart(5)}  ${origem}`);

console.log("\nPOR EMPRESA (top 15)");
for (const [cnpj, n] of agrupar(cobradas, (c) => c.cnpj).slice(0, 15)) {
  const linha = cobradas.find((c) => c.cnpj === cnpj);
  const razao = razaoPorId.get(linha?.portalClientId) || "(não cadastrada)";
  console.log(`  ${String(n).padStart(5)}  ${cnpj || "(sem contribuinte)"}  ${razao}`);
}

// Pico por empresa/dia: é este número que diz se o teto está apertado ou folgado.
const porEmpresaDia = new Map();
for (const c of cobradas) {
  const dia = c.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const k = `${c.cnpj}|${dia}`;
  porEmpresaDia.set(k, (porEmpresaDia.get(k) || 0) + 1);
}
const picos = [...porEmpresaDia.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
console.log("\nPICO POR EMPRESA/DIA (top 10) — compare com o teto");
for (const [k, n] of picos) {
  const [cnpj, dia] = k.split("|");
  const alerta = n >= SERPRO_TETO_DIARIO_EMPRESA ? "  ⚠ NO TETO" : "";
  console.log(`  ${String(n).padStart(5)}  ${dia}  ${cnpj}${alerta}`);
}

const maiorPico = picos[0]?.[1] || 0;
console.log("");
if (maiorPico >= SERPRO_TETO_DIARIO_EMPRESA) {
  console.log(`⚠ O maior pico (${maiorPico}) já bate no teto (${SERPRO_TETO_DIARIO_EMPRESA}). Ou o teto está baixo, ou há laço repetindo chamada — confira POR ORIGEM acima.`);
} else {
  console.log(`Maior pico observado: ${maiorPico} · teto: ${SERPRO_TETO_DIARIO_EMPRESA}. Folga de ${SERPRO_TETO_DIARIO_EMPRESA - maiorPico}.`);
}

await prisma.$disconnect();
