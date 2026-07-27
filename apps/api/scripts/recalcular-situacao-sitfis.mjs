// Reclassifica a situação fiscal a partir do TEXTO já salvo — SEM chamar o SERPRO.
//
// Por que existe: a heurística de leitura foi corrigida em 27/07/2026 (a linha limpa da PGFN é
// "Não foram DETECTADAS pendências...", e "detectad" não estava na guarda de negação — empresa
// limpa virava COM_PENDENCIA). Relatórios consultados ANTES dessa correção ficaram com a situação
// classificada pela regra antiga. Como o texto do relatório está salvo em CompanyFiscalStatus,
// dá pra reclassificar sem gastar cota do SERPRO (o limite AV02 é por contratante).
//
//   node scripts/recalcular-situacao-sitfis.mjs            → simulação (não grava)
//   node scripts/recalcular-situacao-sitfis.mjs --aplicar  → grava as mudanças
//
// Só mexe em `situacao`. Não toca em texto, PDF, protocolo nem nas datas — reconsultar continua
// sendo a única forma de atualizar o relatório em si.

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";
import { classificarTextoSitfis } from "../src/application/fiscal/serpro/sitfisSituacao.js";

const aplicar = process.argv.includes("--aplicar");

try {
  const registros = await prisma.companyFiscalStatus.findMany({
    where: { texto: { not: null } },
    select: {
      portalClientId: true, situacao: true, texto: true, checkedAt: true,
      portalClient: { select: { razao: true, cnpj: true } },
    },
  });

  const mudancas = [];
  for (const r of registros) {
    // PROCESSANDO não é classificação de relatório — é estado de consulta. Não mexer.
    if (r.situacao === "PROCESSANDO") continue;
    const nova = classificarTextoSitfis(r.texto);
    if (nova !== r.situacao) {
      mudancas.push({
        portalClientId: r.portalClientId,
        razao: r.portalClient?.razao || r.portalClientId,
        cnpj: r.portalClient?.cnpj || "",
        de: r.situacao || "—",
        para: nova,
        consultadoEm: r.checkedAt,
      });
    }
  }

  console.log(`\n=== Reclassificação SITFIS (texto salvo, sem chamar o SERPRO) ===`);
  console.log(`${registros.length} relatório(s) analisado(s) · ${mudancas.length} mudariam de situação\n`);

  for (const m of mudancas) {
    const quando = m.consultadoEm ? new Date(m.consultadoEm).toLocaleString("pt-BR") : "—";
    console.log(`  ${m.de.padEnd(16)} → ${m.para.padEnd(16)}  ${m.razao}  (relatório de ${quando})`);
  }

  if (!mudancas.length) {
    console.log("Nada a corrigir — as situações salvas já batem com a heurística atual.");
  } else if (!aplicar) {
    console.log(`\nSimulação — nada foi gravado. Rode com --aplicar para efetivar.`);
  } else {
    for (const m of mudancas) {
      await prisma.companyFiscalStatus.update({
        where: { portalClientId: m.portalClientId },
        data: { situacao: m.para },
      });
    }
    console.log(`\n✓ ${mudancas.length} situação(ões) atualizada(s).`);
  }
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
