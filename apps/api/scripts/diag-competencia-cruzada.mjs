// LANÇAMENTO GRAVADO NUMA COMPETÊNCIA E FALANDO DE OUTRA.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa.
//
// POR QUE ELE EXISTE
// Ao investigar o "em aberto" errado da LENTE (2026-07), apareceu isto:
//
//   BAIXA · INSS · competencia=2026-07 · statusPagamento=PAGO · histórico "PAGO INSS - 02/2026"
//
// Um lançamento de FEVEREIRO gravado em JULHO. Ele entra nos totais de julho — e foi metade do
// número errado que o dono viu na tela (18.347,28 do DAS + 495,00 deste INSS = 18.842,28).
//
// ⚠ A pergunta é se aquilo era um caso ou uma classe. Este script varre TODAS as empresas.
//
// COMO SE DETECTA, e por que é confiável: o histórico do projeto carrega a competência POR
// CONVENÇÃO, no fim, em `MM/AAAA` ou `AAAA-MM` (ver `historicoCompetencia.js`, que normaliza isso
// para `{{competencia}}` na memória de D/C). Quando o mês escrito no histórico difere do campo
// `competencia` da linha, ou o lançamento está no mês errado, ou o texto está mentindo — e as duas
// coisas importam.
//
// ⚠ FALSO POSITIVO CONHECIDO, e por isso ele é SEPARADO no relatório: histórico que cita competência
// de referência legítima — "13º SALÁRIO", rescisão, provisão de férias, e o parcelamento, cujo
// histórico nomeia a prestação e não o mês. Esses saem numa lista à parte, não misturados.
//
// USO (⚠ `bash -c` NÃO funciona nesta máquina — WSL corrompida):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/diag-competencia-cruzada.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const money = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const linha = () => console.log("─".repeat(96));

console.log("═".repeat(96));
console.log("COMPETÊNCIA CRUZADA — o lançamento está num mês e fala de outro");
console.log("═".repeat(96));

// ⚠ Sem `where`: `historico` é NOT NULL no schema, então filtrar por `not: null` é inválido —
// o Prisma recusa. Todo lançamento tem histórico; quem filtra é a regex abaixo.
const entries = await prisma.accountingEntry.findMany({
  select: {
    id: true, competencia: true, historico: true, tipo: true, subtipo: true, origem: true,
    eventType: true, statusPagamento: true, portalClientId: true, createdAt: true,
    lines: { select: { valor: true, tipo: true } },
  },
});

const clientes = await prisma.portalClient.findMany({ select: { id: true, razao: true } });
const nomeDe = new Map(clientes.map((c) => [c.id, c.razao]));

// ⚠ Duas formas, porque o projeto usa as duas: "07/2026" e "2026-07".
const RE_BARRA = /(\d{2})\/(\d{4})/;
const RE_TRACO = /(\d{4})-(\d{2})/;

// ⚠ Termos que tornam a citação de OUTRO mês legítima — 13º, férias e rescisão referenciam período
// de propósito, e o parcelamento nomeia a prestação.
const LEGITIMO = /13|d[ée]cimo|f[ée]rias|rescis|parcela|parcelamento|provis[ãa]o de|acerto/i;

function competenciaNoTexto(txt) {
  const t = String(txt || "");
  const b = t.match(RE_BARRA);
  if (b) return `${b[2]}-${b[1]}`;
  const c = t.match(RE_TRACO);
  if (c) return `${c[1]}-${c[2]}`;
  return null;
}

const cruzados = [];
const legitimos = [];
for (const e of entries) {
  const noTexto = competenciaNoTexto(e.historico);
  if (!noTexto || noTexto === e.competencia) continue;
  const somaD = e.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor), 0);
  const reg = { ...e, noTexto, somaD, razao: nomeDe.get(e.portalClientId) || "(?)" };
  (LEGITIMO.test(e.historico) ? legitimos : cruzados).push(reg);
}

console.log(`\nlançamentos com histórico datado: ${entries.filter((e) => competenciaNoTexto(e.historico)).length}`);
console.log(`   ⚠ com competência DIVERGENTE, sem justificativa aparente: ${cruzados.length}`);
console.log(`   com divergência mas termo que a justifica (13º/férias/rescisão/parcela): ${legitimos.length}`);

// ─── Os que importam ────────────────────────────────────────────────────────────────────────
linha();
console.log("\n⚠ COMPETÊNCIA CRUZADA SEM JUSTIFICATIVA\n");
if (!cruzados.length) console.log("   (nenhum)");
cruzados.sort((a, b) => (a.razao + a.competencia).localeCompare(b.razao + b.competencia));
for (const e of cruzados) {
  console.log(`   ${e.razao}`);
  console.log(`      gravado em ${e.competencia} · o texto diz ${e.noTexto} · ${e.tipo}/${e.origem}` +
    ` · pag=${e.statusPagamento || "—"} · ΣD ${money(e.somaD)}`);
  console.log(`      "${String(e.historico).slice(0, 72)}"`);
}

// ⚠ O impacto: quanto cada competência RECEBE de valor que fala de outro mês.
if (cruzados.length) {
  linha();
  console.log("\nQUANTO CADA COMPETÊNCIA RECEBE DE VALOR ALHEIO\n");
  const porComp = new Map();
  for (const e of cruzados) {
    const k = `${e.razao} · ${e.competencia}`;
    porComp.set(k, (porComp.get(k) || 0) + e.somaD);
  }
  for (const [k, v] of [...porComp].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(52)} R$ ${money(v)}`);
  }
}

// ─── Os legítimos, para conferência ─────────────────────────────────────────────────────────
linha();
console.log("\nCOM TERMO QUE JUSTIFICA (conferir, não corrigir):\n");
if (!legitimos.length) console.log("   (nenhum)");
for (const e of legitimos.slice(0, 12)) {
  console.log(`   ${e.razao} · ${e.competencia} ← texto ${e.noTexto} · "${String(e.historico).slice(0, 52)}"`);
}
if (legitimos.length > 12) console.log(`   … e mais ${legitimos.length - 12}`);

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
