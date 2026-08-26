// ⚠ COMPLEMENTO do `diag-classificacao-cobertura.mjs`. Ele mediu que o classificador acertou
// 1.315 de 1.315 itens que tocou (zero RECEITA_NAO_CLASSIFICADA, zero pendência). Isso só é
// evidência de que o de-para FUNCIONA se os 1.315 forem VARIADOS — se forem as notas repetidas de
// uma empresa só, 100% de acerto não prova quase nada sobre os 16.476 restantes.
//
// ⚠ SÓ LEITURA. Zero escrita, zero chamada externa.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const n = (v) => Number(v || 0).toLocaleString("pt-BR");

async function main() {
  console.log("\n═══ OS 1.315 CLASSIFICADOS SÃO VARIADOS? ═══\n");

  const porTipo = await prisma.notaItem.groupBy({
    by: ["tipoReceita"], _count: { _all: true },
    where: { tipoReceita: { not: null } },
  });
  console.log("por TIPO DE RECEITA:");
  for (const r of porTipo.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`   ${String(r.tipoReceita).padEnd(26)} ${String(n(r._count._all)).padStart(8)}`);
  }

  // ⚠ O ESPALHAMENTO POR EMPRESA FOI REMOVIDO, e o motivo fica registrado: o `join` com
  // `PortalInvoice` falhou por nome de coluna (42703), e a pergunta que ele responderia — "os
  // classificados são variados?" — passou a ser respondida melhor, e sem join, por
  // `diag-classificacao-55.mjs`, que conta CÓDIGOS DE SERVIÇO DISTINTOS em vez de itens. É o
  // número certo: o de-para cobre códigos, não notas.

  const naoClass = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT i."codigoServico")::int AS codigos, COUNT(*)::int AS itens
    FROM "nota_itens" i WHERE i."tipoReceita" IS NULL
  `.catch(() => null);
  if (naoClass?.[0]) {
    console.log(`\nos NÃO tocados: ${n(naoClass[0].itens)} itens, ${n(naoClass[0].codigos)} códigos de serviço distintos`);
    console.log("   ⚠ É este número de CÓDIGOS — não o de itens — que o de-para precisa cobrir.");
  }

  console.log("\n═══ fim — nada foi escrito ═══\n");
}
main().catch((e) => { console.error("⚠", e?.message || e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
