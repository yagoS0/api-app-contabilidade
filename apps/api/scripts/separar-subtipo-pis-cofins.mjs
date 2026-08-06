// Separa o subtipo `PIS_COFINS` em `PIS` e `COFINS` nos lançamentos já gravados.
//
// POR QUE PRECISA RODAR: a Circular é indexada por `subtipo__competencia`. Enquanto PIS e COFINS
// compartilhavam o subtipo `PIS_COFINS`, as DUAS provisões caíam na mesma célula e uma era
// DESCARTADA na exibição — a célula mostrava o valor de um tributo, o "Total em aberto" somava os
// dois, e dar baixa pela célula deixava a outra provisão aberta e invisível.
//
// Agora existem as linhas `PIS` e `COFINS`. ⚠ Lançamento que continuar com `PIS_COFINS` NÃO TEM
// MAIS LINHA na matriz e some da tela. Por isso este script roda ANTES do deploy do front.
//
//   node scripts/separar-subtipo-pis-cofins.mjs                 → simulação (não grava)
//   node scripts/separar-subtipo-pis-cofins.mjs --aplicar       → grava
//   node scripts/separar-subtipo-pis-cofins.mjs --cnpj=<cnpj>   → limita a uma empresa
//
// ⚠ A CONVERSÃO É DETERMINÍSTICA, NÃO É PALPITE. O `eventType` sempre distinguiu os dois
// (`DARF_PIS` / `DARF_COFINS`) — era só o `subtipo`, a chave da matriz, que os fundia. Então não há
// nada a inferir: o dado que separa já está gravado em cada lançamento.
//
// ⚠ SEM `eventType` RECONHECÍVEL, NÃO ADIVINHA. Lançamento manual antigo pode ter `subtipo:
// "PIS_COFINS"` sem `eventType` — não dá para saber se é PIS ou COFINS, e escolher um seria jogar
// um valor na conta errada. Esses são LISTADOS para o contador decidir, e ficam como estão.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const aplicar = process.argv.includes("--aplicar");
function arg(name) {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.split("=").slice(1).join("=") : null;
}
const cnpjFiltro = (arg("cnpj") || "").replace(/\D/g, "");

const DE_PARA = { DARF_PIS: "PIS", DARF_COFINS: "COFINS" };

async function main() {
  const where = { subtipo: "PIS_COFINS" };
  if (cnpjFiltro) {
    const empresa = await prisma.portalClient.findFirst({
      where: { cnpj: { contains: cnpjFiltro } },
      select: { id: true, razao: true },
    });
    if (!empresa) { console.log(`Nenhuma empresa com CNPJ ${cnpjFiltro}.`); return; }
    where.portalClientId = empresa.id;
    console.log(`Empresa: ${empresa.razao}\n`);
  }

  const entries = await prisma.accountingEntry.findMany({
    where,
    select: {
      id: true, competencia: true, eventType: true, historico: true,
      portalClientId: true, statusPagamento: true,
    },
    orderBy: [{ competencia: "asc" }],
  });

  if (!entries.length) {
    console.log("Nenhum lançamento com subtipo PIS_COFINS. Nada a fazer.");
    return;
  }

  const converter = [];
  const semEventType = [];
  for (const e of entries) {
    const destino = DE_PARA[e.eventType];
    if (destino) converter.push({ ...e, destino });
    else semEventType.push(e);
  }

  console.log(`${entries.length} lançamento(s) com subtipo PIS_COFINS.`);
  console.log(`  ${converter.length} com eventType reconhecível → convertem`);
  console.log(`  ${semEventType.length} SEM eventType → ficam como estão\n`);

  for (const e of converter) {
    console.log(`  ${e.competencia}  ${e.eventType.padEnd(12)} → ${e.destino.padEnd(7)}  ${e.historico || "(sem histórico)"}`);
  }

  if (semEventType.length) {
    // ⚠ Estes SOMEM da Circular até alguém decidir. Precisam aparecer aqui, com nome e competência,
    // senão o script "termina com sucesso" escondendo lançamento que deixou de ser exibido.
    console.log("\n⚠ SEM eventType — NÃO convertidos, e por isso vão SUMIR da Circular:");
    for (const e of semEventType) {
      console.log(`  ${e.competencia}  ${e.statusPagamento}  ${e.historico || "(sem histórico)"}  [id ${e.id}]`);
    }
    console.log("  → decida o tributo de cada um e corrija o subtipo à mão (PIS ou COFINS).");
  }

  if (!aplicar) {
    console.log(`\n(simulação — nada foi gravado. Rode com --aplicar para converter os ${converter.length}.)`);
    return;
  }

  let ok = 0;
  for (const e of converter) {
    await prisma.accountingEntry.update({ where: { id: e.id }, data: { subtipo: e.destino } });
    ok += 1;
  }
  console.log(`\n${ok} lançamento(s) convertido(s).`);
  if (semEventType.length) {
    console.log(`${semEventType.length} continuam como PIS_COFINS e precisam de decisão manual.`);
  }
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
