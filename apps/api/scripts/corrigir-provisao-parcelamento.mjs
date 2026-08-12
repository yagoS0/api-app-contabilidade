// ⚠⚠ PROPOSTA DE CORREÇÃO DE DADO GRAVADO — **DRY-RUN POR PADRÃO, E NÃO EXECUTADO POR NINGUÉM
// ALÉM DO DONO.**
//
// Corrigir lançamento contábil já gravado é ATO CONTÁBIL. Este script existe para MOSTRAR o
// antes/depois de cada alternativa, com o efeito de cada uma no razão — não para escolher.
// Sem `--aplicar` ele não escreve absolutamente nada. Com `--aplicar` ele ainda exige
// `--contrato=<id>` e `--opcao=A|B`, para que não exista "rodar em tudo".
//
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// O QUE ESTE SCRIPT NÃO DECIDE, E POR QUE
//
// A provisão de abertura da SINTROPIA (`OUTRO nº 0211.00012.0056912479.26-88`) nasceu com DUAS
// linhas de papel `PRINCIPAL` — 31.003,42 na conta 265 (principal) e 7.034,32 na conta **501**, que
// é a conta de JUROS. Ela nasceu assim de UMA escrita só (mesmo `loteImportacao`, 11 ms entre as
// três linhas): não é reingestão.
//
// Só que existem DUAS formas coerentes de deixá-la certa, e elas discordam sobre quanto vale o
// PASSIVO. ⚠ **A REGRA VIGENTE MUDOU EM 2026-08-12** — as duas continuam descritas abaixo porque
// dado GRAVADO é ato do dono e o histórico não se apaga, mas hoje o alvo é a OPÇÃO B:
//
//   OPÇÃO A — A REGRA ANTIGA, ATÉ 2026-08-12 (`linhasProvisao` reconhecia SÓ O PRINCIPAL)
//     O passivo (588) passa a valer 31.003,42 e a linha de juros SAI da provisão: juros seria
//     despesa do mês do PAGAMENTO, e nenhum teria sido reconhecido na adesão.
//     ⚠ Custo: um lançamento gravado deixa de existir (deleção em mês aberto, ou ESTORNO em mês
//     fechado — nunca deleção em mês fechado).
//     ⚠ ELA NÃO É MAIS A REGRA DO CÓDIGO. Aplicá-la deixaria este contrato numa forma que nenhum
//     parcelamento novo terá.
//
//   OPÇÃO B — ⚠ **A REGRA VIGENTE** (provisão CONSOLIDADA: `D principal · D juros · D multa / C soma`)
//     Palavras do dono (2026-08-12): *"o juros da provisão precisa ser escrito"*, *"o parcelamento
//     deve ter valor principal, juros, e valor juros + principal fechando a contrapartida"*.
//     O passivo segue 38.037,74 e a linha de 7.034,32 apenas TROCA DE PAPEL (PRINCIPAL → JUROS).
//     Valor, conta e lado (D) ficam idênticos; muda o papel e o texto do histórico. É a forma em que
//     a ERISANGELA já está, e a que `linhasProvisao` passou a produzir.
//     ⚠ Custo, medido e levado ao dono: a BAIXA **não foi alterada junto** e amortiza o passivo só
//     pelo principal, então sobra resíduo permanente igual a `juros + multa` — 7.034,32 aqui, e
//     2.754,81 na ERISANGELA (medição em `scripts/diag-residuo-provisao-consolidada.mjs`,
//     2026-08-12). Isso é decisão PENDENTE sobre a baixa, não defeito desta correção.
//
// ⚠ AS DUAS MEXEM NA FORMA DO LANÇAMENTO. Por isso nenhuma roda sem o dono.
//
// USO (leitura, o padrão):
//   railway run --service Postgres pwsh -NoProfile -Command '$env:DATABASE_URL=$env:DATABASE_PUBLIC_URL; node apps/api/scripts/corrigir-provisao-parcelamento.mjs'

import { prisma } from "../src/infrastructure/db/prisma.js";
import { CONTA_JUROS, CONTA_MULTA, CONTAS_ACRESCIMO } from "../src/application/accounting/contasAcrescimo.js";

const argv = process.argv.slice(2);
const APLICAR = argv.includes("--aplicar");
const CONTRATO = (argv.find((a) => a.startsWith("--contrato=")) || "").split("=")[1] || null;
const OPCAO = ((argv.find((a) => a.startsWith("--opcao=")) || "").split("=")[1] || "").toUpperCase() || null;

const brl = (v) => (v == null ? "—" : Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const linha = () => console.log("─".repeat(96));

console.log("═".repeat(96));
console.log(`PROVISÃO DE ABERTURA — proposta de correção   [${APLICAR ? "⚠ MODO ESCRITA" : "DRY-RUN (nada será escrito)"}]`);
console.log("═".repeat(96));
console.log(`\ncontas de acréscimo (fonte única, contasAcrescimo.js): juros=${CONTA_JUROS} multa=${CONTA_MULTA}`);

const contratos = await prisma.parcelamento.findMany({
  where: { ...(CONTRATO ? { id: CONTRATO } : {}) },
  orderBy: { createdAt: "asc" },
  include: { portalClient: { select: { razao: true } } },
});

let algumSuspeito = false;

for (const p of contratos) {
  const provisoes = await prisma.accountingEntry.findMany({
    where: { parcelamentoId: p.id, tipo: "PROVISAO" },
    orderBy: [{ createdAt: "asc" }],
    include: { lines: { orderBy: { ordem: "asc" } } },
  });
  if (!provisoes.length) continue;

  // Suspeita = mais de um DÉBITO com papel PRINCIPAL na mesma provisão. O passivo tem UM principal.
  const debitosPrincipal = provisoes.filter((e) => {
    const l = e.lines[0];
    return l && l.tipo === "D" && String(e.tipoLinha || l.tipoLinha || "") === "PRINCIPAL";
  });
  if (debitosPrincipal.length <= 1) continue;
  algumSuspeito = true;

  console.log(`\n▸ ${p.portalClient?.razao} — ${p.label}`);
  console.log(`  contrato=${p.id}`);
  linha();

  console.log("  ANTES (como está gravado hoje):");
  for (const e of provisoes) {
    const l = e.lines[0];
    console.log(`    ${String(e.tipoLinha || l?.tipoLinha || "—").padEnd(10)} ${l?.tipo}  ${brl(l?.valor).padStart(12)}  conta ${String(l?.conta || "—").padEnd(6)}  "${e.historico}"`);
  }
  console.log(`    cabeçalho: principalTotal=${brl(p.principalTotal)}  jurosTotal=${brl(p.jurosTotal)}  totalValue=${brl(p.totalValue)}`);

  // ── Qual das linhas de PRINCIPAL é, na verdade, o acréscimo? A que está na CONTA DE JUROS/MULTA.
  //
  // ⚠ `contasAcrescimo.js` avisa, com todas as letras, que a conta **NÃO é o critério** para dizer
  // o que é juros e o que é multa — o critério é o PAPEL marcado, porque o contador pode trocar a
  // conta. Aqui a conta é usada assim mesmo, e o motivo é estreito: o papel gravado é EXATAMENTE o
  // dado que está corrompido, então ele não pode ser a pista. Por isso isto é uma PROPOSTA que o
  // dono confere linha a linha, e não uma conversão automática.
  //
  // Se nenhuma (ou mais de uma) linha estiver numa conta de acréscimo, o script NÃO ADIVINHA:
  // recusa e devolve o caso.
  const suspeitas = debitosPrincipal.filter((e) => CONTAS_ACRESCIMO.has(String(e.lines[0]?.conta || "")));

  if (suspeitas.length !== 1) {
    console.log(`\n  ⚠ NÃO PROPONHO NADA AQUI: ${suspeitas.length} linha(s) de PRINCIPAL em conta de acréscimo (esperado exatamente 1).`);
    console.log("    Qual linha é o acréscimo é decisão do dono — a conta é a única pista, e ela não fechou.");
    continue;
  }

  const alvo = suspeitas[0];
  const valorAcrescimo = Number(alvo.lines[0].valor);
  const principalReal = Number(p.principalTotal ?? 0) - valorAcrescimo;
  const papelSugerido = String(alvo.lines[0].conta) === String(CONTA_MULTA) ? "MULTA" : "JUROS";

  console.log(`\n  A linha em questão: ${brl(valorAcrescimo)} na conta ${alvo.lines[0].conta} (conta de ${papelSugerido.toLowerCase()}), hoje marcada PRINCIPAL.`);

  console.log(`\n  ── OPÇÃO A — ⚠ A REGRA ANTIGA (até 2026-08-12: a provisão reconhecia SÓ o principal)`);
  console.log(`     · o lançamento de ${brl(valorAcrescimo)} SAI da provisão (deleção em mês aberto / ESTORNO em mês fechado)`);
  console.log(`     · o passivo (crédito) passa de ${brl(p.totalValue)} para ${brl(principalReal)}`);
  console.log(`     · cabeçalho: principalTotal ${brl(p.principalTotal)} → ${brl(principalReal)} · jurosTotal ${brl(p.jurosTotal)} → ${brl(valorAcrescimo)}`);
  console.log(`     · efeito: a soma das amortizações ZERA o passivo. ${papelSugerido.toLowerCase()} vira despesa no mês do pagamento.`);
  console.log("     ⚠ NÃO É MAIS A REGRA DO CÓDIGO — deixaria este contrato numa forma que nenhum parcelamento novo terá.");

  console.log(`\n  ── OPÇÃO B — ⚠ **A REGRA VIGENTE** (provisão consolidada: D principal · D juros · D multa / C soma)`);
  console.log(`     · a linha só TROCA DE PAPEL: PRINCIPAL → ${papelSugerido} (valor, conta e lado intactos)`);
  console.log(`     · histórico: "${alvo.historico}" → "${alvo.historico.replace(/— principal$/, `— ${papelSugerido.toLowerCase()}`)}"`);
  console.log(`     · o passivo SEGUE ${brl(p.totalValue)}`);
  console.log(`     · cabeçalho: principalTotal ${brl(p.principalTotal)} → ${brl(principalReal)} · jurosTotal ${brl(p.jurosTotal)} → ${brl(valorAcrescimo)}`);
  console.log(`     ⚠ efeito: resíduo PERMANENTE de ${brl(valorAcrescimo)} no passivo — a BAIXA não foi alterada e amortiza só`);
  console.log("       o principal. Decisão pendente do dono sobre a baixa; medição em `diag-residuo-provisao-consolidada.mjs`.");

  if (!APLICAR) {
    console.log(`\n  (dry-run — nada escrito. Para aplicar: --aplicar --contrato=${p.id} --opcao=A|B, com decisão do dono.)`);
    continue;
  }

  // ── ESCRITA — só com contrato e opção explícitos. ────────────────────────────────────────────
  if (!CONTRATO || !OPCAO) {
    console.log("\n  ⚠ RECUSADO: `--aplicar` exige `--contrato=<id>` E `--opcao=A|B`. Nada foi escrito.");
    continue;
  }
  if (OPCAO === "B") {
    // A troca de papel NÃO mexe em valor, conta nem lado — só no papel e no texto.
    await prisma.$transaction(async (tx) => {
      await tx.accountingEntry.update({
        where: { id: alvo.id },
        data: { tipoLinha: papelSugerido, historico: alvo.historico.replace(/— principal$/, `— ${papelSugerido.toLowerCase()}`) },
      });
      await tx.accountingEntryLine.update({ where: { id: alvo.lines[0].id }, data: { tipoLinha: papelSugerido } });
      await tx.parcelamento.update({
        where: { id: p.id },
        data: { principalTotal: principalReal, jurosTotal: valorAcrescimo },
      });
    });
    console.log(`\n  ✓ OPÇÃO B aplicada em ${p.id}.`);
  } else {
    // ⚠ A opção A APAGA/ESTORNA um lançamento. Ela NÃO é implementada aqui de propósito: o caminho
    // certo já existe e é auditado — `POST /entries/:entryId/estorno`, que exige MOTIVO, grava
    // `EstornoBaixa` e escolhe deleção × contra-lançamento pela competência. Reimplementá-lo num
    // script seria criar uma segunda porta sem motivo e sem auditoria, para o ato mais destrutivo
    // dos dois.
    console.log("\n  ⚠ OPÇÃO A não é aplicada por script. Use a rota de ESTORNO (com motivo e auditoria)");
    console.log("    e depois corrija o cabeçalho. Nada foi escrito.");
  }
}

if (!algumSuspeito) console.log("\nNenhuma provisão com mais de uma linha de PRINCIPAL. Nada a propor.");

console.log(`\n${"═".repeat(96)}`);
console.log(APLICAR ? "FIM." : "FIM — DRY-RUN, nada foi escrito.");
console.log("═".repeat(96));

await prisma.$disconnect();
