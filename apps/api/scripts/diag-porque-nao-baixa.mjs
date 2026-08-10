// POR QUE ESTA PRESTAÇÃO NÃO PODE SER BAIXADA — uma linha por parcela, com o motivo nomeado.
//
// ⚠ SÓ LEITURA. Nenhuma escrita, nenhuma chamada externa, nenhum DDL.
//
// POR QUE ELE EXISTE
// O dono: "não consigo dar baixa em um parcelamento sem guia, mas foi exatamente isso que te disse".
// A baixa por declaração (F2.2) existe e a fila irmã existe — então o problema não é ausência de
// caminho, é alguma condição excluindo a prestação ANTES de ela chegar à tela. Há cinco, e a tela
// só explica DUAS delas: as outras três fazem a linha simplesmente não aparecer, e sumir da fila é
// indistinguível de "não há nada pendente".
//
// As cinco, em ordem de invisibilidade:
//
//   1. parcelamento RESCINDIDO      → `whereParcelaSemGuiaPendente` exclui o contrato inteiro.
//                                     ⚠ SOME SEM DIZER NADA. Se a rescisão foi indevida, todas as
//                                     prestações do acordo ficam não-baixáveis de uma vez.
//   2. vencimento NULL              → excluída. Nasce da sentinela `competenciaInicial='1970-01'`,
//                                     que faz o cronograma inteiro nascer sem datas. SOME.
//   3. vencimento > fim de hoje     → excluída por ser "ainda não devida". SOME (é correto, mas o
//                                     contador que quer adiantar não entende).
//   4. sem provisão de abertura     → APARECE, `podeBaixar:false`, `provisao_inexistente`.
//   5. valorPrevisto nulo ou zero   → APARECE, `podeBaixar:false`, `sem_valor_previsto`.
//
// ⚠ Só a 4 e a 5 chegam à tela com explicação. 1, 2 e 3 são ausência — e ausência nunca é resposta.
//
// USO:
//   railway run --service Postgres bash -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" node apps/api/scripts/diag-porque-nao-baixa.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";

const n = (v) => Number(v || 0).toLocaleString("pt-BR");
const money = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
const dia = (v) => (v ? new Date(v).toISOString().slice(0, 10) : "—");
const linha = () => console.log("─".repeat(96));

const agora = new Date();
const fimDeHoje = new Date(agora); fimDeHoje.setHours(23, 59, 59, 999);

console.log("═".repeat(96));
console.log("POR QUE A PRESTAÇÃO SEM GUIA NÃO PODE SER BAIXADA");
console.log(`(agora: ${agora.toISOString()} · fim de hoje: ${fimDeHoje.toISOString()})`);
console.log("═".repeat(96));

// ─── Todas as parcelas SEM GUIA e NÃO BAIXADAS, com o contrato junto ────────────────────────
const linhas = await prisma.$queryRaw`
  SELECT c.razao, c.cnpj,
         pp.id           AS parcelamento_id,
         pp.label, pp.tipo, pp.kind, pp.status, pp."numeroParcelamento",
         pp."competenciaInicial", pp."numParcelas", pp."aberturaEntryId", pp."formaPagamento",
         p.id            AS parcela_id,
         p."numeroParcela", p.competencia, p.vencimento, p."valorPrevisto", p."origemBaixa"
    FROM "parcelas" p
    JOIN "parcelamentos" pp ON pp.id = p."parcelamentoId"
    JOIN "PortalClient"  c  ON c.id  = p."portalClientId"
   WHERE p."guiaId" IS NULL
   ORDER BY c.razao, pp.id, p."numeroParcela"`;

console.log(`\nParcelas SEM GUIA na base: ${n(linhas.length)}\n`);

// ⚠ A ordem dos testes espelha a ordem real: o `where` da fila roda ANTES do `podeBaixar`.
function motivo(r) {
  if (r.origemBaixa) return { cod: "JA_BAIXADA", tela: "—", txt: `já baixada (origem ${r.origemBaixa})` };
  if (r.status === "RESCINDIDO") return { cod: "CONTRATO_RESCINDIDO", tela: "SOME", txt: "o parcelamento está RESCINDIDO — a fila exclui o contrato inteiro" };
  if (!r.vencimento) return { cod: "SEM_VENCIMENTO", tela: "SOME", txt: `sem data de vencimento (competenciaInicial=${r.competenciaInicial})` };
  if (new Date(r.vencimento) > fimDeHoje) return { cod: "AINDA_NAO_VENCE", tela: "SOME", txt: `vence em ${dia(r.vencimento)}, no futuro` };
  if (!r.aberturaEntryId) return { cod: "PROVISAO_INEXISTENTE", tela: "aparece bloqueada", txt: "o contrato não tem provisão de abertura" };
  const v = r.valorPrevisto == null ? null : Number(r.valorPrevisto);
  if (!(Number.isFinite(v) && v > 0)) return { cod: "SEM_VALOR_PREVISTO", tela: "aparece bloqueada", txt: `valorPrevisto = ${r.valorPrevisto == null ? "NULL" : v}` };
  return { cod: "OK", tela: "aparece e pode baixar", txt: "nada bloqueia" };
}

const porMotivo = new Map();
const porContrato = new Map();
for (const r of linhas) {
  const m = motivo(r);
  porMotivo.set(m.cod, (porMotivo.get(m.cod) || 0) + 1);
  const k = r.parcelamento_id;
  if (!porContrato.has(k)) porContrato.set(k, { r, motivos: new Map() });
  const c = porContrato.get(k);
  c.motivos.set(m.cod, (c.motivos.get(m.cod) || 0) + 1);
}

console.log("RESUMO — quantas prestações em cada situação:\n");
for (const [cod, qtd] of [...porMotivo].sort((a, b) => b[1] - a[1])) {
  const exemplo = linhas.find((r) => motivo(r).cod === cod);
  const m = motivo(exemplo);
  const marca = m.tela === "SOME" ? "⚠ SOME DA TELA " : "               ";
  console.log(`   ${marca}${String(cod).padEnd(22)} ${String(n(qtd)).padStart(5)}   (${m.tela})`);
}

// ─── Por contrato: é o que o contador enxerga ───────────────────────────────────────────────
linha();
console.log("\nPOR CONTRATO — o que o contador vê ao abrir cada parcelamento:\n");
for (const { r, motivos } of porContrato.values()) {
  const total = [...motivos.values()].reduce((s, x) => s + x, 0);
  const baixaveis = motivos.get("OK") || 0;
  console.log(`\n   • ${r.razao} (${r.cnpj})`);
  console.log(`     ${r.label}`);
  console.log(`     tipo=${r.tipo || r.kind || "—"} · nº ${r.numeroParcelamento || "—"} · status=${r.status} · forma=${r.formaPagamento || "(não declarada)"}`);
  console.log(`     ${r.numParcelas} contratadas · comp. inicial ${r.competenciaInicial}${r.competenciaInicial === "1970-01" ? "  ⚠ SENTINELA — cronograma sem datas" : ""}`);
  console.log(`     provisão de abertura: ${r.aberturaEntryId ? "sim" : "⚠ NÃO — toda baixa será recusada"}`);
  console.log(`     ${total} prestação(ões) sem guia · ${baixaveis} baixável(is) hoje`);
  for (const [cod, qtd] of [...motivos].sort((a, b) => b[1] - a[1])) {
    if (cod === "OK") continue;
    const ex = linhas.find((x) => x.parcelamento_id === r.parcelamento_id && motivo(x).cod === cod);
    console.log(`        ${String(qtd).padStart(3)} × ${cod} — ${motivo(ex).txt}`);
  }
  if (baixaveis === 0) console.log(`     ⚠ NENHUMA PRESTAÇÃO DESTE CONTRATO PODE SER BAIXADA HOJE.`);
}

// ─── A fila, exatamente como a rota a monta ─────────────────────────────────────────────────
linha();
console.log("\nA FILA REAL (o mesmo `where` de `whereParcelaSemGuiaPendente`):\n");
const naFila = await prisma.parcela.count({
  where: {
    guiaId: null,
    origemBaixa: null,
    vencimento: { not: null, lte: fimDeHoje },
    parcelamento: { is: { status: { not: "RESCINDIDO" } } },
  },
});
console.log(`   ${n(naFila)} prestação(ões) entram na fila /parcelas-sem-guia-pendentes`);
if (naFila === 0) {
  console.log(`   ⚠ FILA VAZIA. Na tela isso é indistinguível de "não há nada pendente" —`);
  console.log(`     e o resumo acima diz qual condição a esvaziou.`);
}

linha();
console.log("\nNada foi alterado.");
await prisma.$disconnect();
