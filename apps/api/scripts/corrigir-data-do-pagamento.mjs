// ⚠⚠ ESTE SCRIPT ESCREVE. POR PADRÃO ELE NÃO ESCREVE NADA — só mostra o que faria.
//
// Ele conserta o PASSADO do defeito relatado pelo dono em 30/08/2026 (*"o pagamento foi posto no dia
// 30 de agosto mesmo não sendo verdade"*). O código já foi corrigido; isto é o histórico.
//
// ## O que ele faz, e só isso
//
// Onde a guia tem o comprovante do SERPRO guardado (`extracted.comprovante.dataArrecadacao`), grava
// `paymentConfirmedAt` = **a data da arrecadação**, que é o dia em que o dinheiro saiu. Nada mais é
// tocado: valor, status, procedência, baixa e lançamentos ficam como estão.
//
// ⚠⚠ POR QUE ISSO IMPORTA: `paymentConfirmedAt` é de onde `FluxoDeCaixaService.linhasDasGuias` tira
// o MÊS e o DIA da linha. Medido em 30/08/2026: das 20 guias com comprovante, **20** divergiam —
// e a LENTE tinha INSS de 04/2026 arrecadado em 16/07 gravado como 27/08, DOIS MESES adiante.
//
// ## ⚠⚠ As travas, e por que cada uma existe
//
//  1. **DRY-RUN por padrão.** Sem `--aplicar` ele lê, imprime o antes/depois e sai. Rodar por engano
//     não pode mudar nada — este projeto já tem um script morto (`backfill-envio-guia.mjs`) que
//     quebra o dashboard permanentemente, e a lição é essa.
//  2. **Só onde HÁ comprovante.** Guia sem `dataArrecadacao` não é tocada: não existe data medida
//     para pôr no lugar, e chutar seria repetir o defeito com outro carimbo.
//  3. **Nunca APAGA uma data.** Se a arrecadação não for legível, a linha é pulada e contada.
//  4. **Uma por vez, com `where` pelo id.** Sem `updateMany`, sem transação larga: se algo sair
//     errado, sai numa linha e o resto continua.
//
// Uso:  node scripts/corrigir-data-do-pagamento.mjs            (só mostra)
//       node scripts/corrigir-data-do-pagamento.mjs --aplicar  (grava)

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const APLICAR = process.argv.includes("--aplicar");
const dia = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "—");

/** ⚠ dd/mm/aaaa → Date em UTC, por PARTES. `new Date(string)` desloca por fuso. */
function daArrecadacao(br) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(br || "").trim());
  if (!m) return null;
  const [, d, mes, a] = m.map(Number);
  const dt = new Date(Date.UTC(a, mes - 1, d));
  const ok = dt.getUTCFullYear() === a && dt.getUTCMonth() === mes - 1 && dt.getUTCDate() === d;
  return ok ? dt : null;
}

const pagas = await p.guide.findMany({
  where: { paymentStatus: "PAID" },
  select: {
    id: true, competencia: true, tipo: true, valor: true, extracted: true,
    paymentConfirmedAt: true, portalClient: { select: { razao: true } },
  },
});

console.log(APLICAR ? "MODO: APLICANDO\n" : "MODO: só mostrando (use --aplicar para gravar)\n");
let corrigiveis = 0, jaCertas = 0, semComprovante = 0, ilegiveis = 0, gravadas = 0;

for (const g of pagas) {
  const br = g.extracted?.comprovante?.dataArrecadacao;
  if (!br) { semComprovante += 1; continue; }
  const real = daArrecadacao(br);
  if (!real) { ilegiveis += 1; console.log(`  (ilegível) ${g.portalClient?.razao} ${g.tipo} ${g.competencia}: "${br}"`); continue; }
  if (g.paymentConfirmedAt && dia(g.paymentConfirmedAt) === dia(real)) { jaCertas += 1; continue; }

  corrigiveis += 1;
  console.log(
    `  ${String(g.portalClient?.razao || "").slice(0, 26).padEnd(27)}`,
    String(g.tipo).padEnd(8), String(g.competencia).padEnd(8),
    `${dia(g.paymentConfirmedAt)} → ${dia(real)}`
  );
  if (APLICAR) {
    await p.guide.update({ where: { id: g.id }, data: { paymentConfirmedAt: real } });
    gravadas += 1;
  }
}

console.log(`\ncom data a corrigir: ${corrigiveis} · já certas: ${jaCertas} · sem comprovante: ${semComprovante} · ilegíveis: ${ilegiveis}`);
console.log(APLICAR ? `GRAVADAS: ${gravadas}` : "nada foi gravado.");
await p.$disconnect();
