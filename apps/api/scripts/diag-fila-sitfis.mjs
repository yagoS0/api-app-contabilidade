// Procura QUEM está ocupando a fila do SITFIS. Só LÊ o banco — nenhuma chamada ao SERPRO.
//
// A resposta crua do /Apoiar diz: "[Aviso-Sitfis-AV02] O limite de solicitações em processamento
// foi atingido. Aguarde o tempo informado no campo tempoEspera" — com `tempoEspera: 30000`, ou
// seja, 30 SEGUNDOS. Trinta segundos é janela de concorrência, não fila entupida para sempre.
//
// Se depois de horas ainda dá AV02, alguém está reocupando os lugares continuamente. Os suspeitos
// estão todos aqui: job de download em lote parado no meio, e protocolos órfãos.
//
//   node scripts/diag-fila-sitfis.mjs

import "dotenv/config";
import { prisma } from "../src/infrastructure/db/prisma.js";

const fmt = (d) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 19) : "—");
const horasAtras = (d) => (d ? ((Date.now() - new Date(d).getTime()) / 3600000).toFixed(1) : "—");

try {
  // ── 1) Job de download de situações fiscais parado no meio ────────────────────────────────
  // É o principal suspeito: ele consulta empresa por empresa e, se travou, pode ter deixado
  // solicitações abertas — ou continuar tentando em looping.
  // `.catch()` não protege aqui: se o delegate não existir, `undefined.findMany` lança TypeError
  // antes de virar promise. Por isso a checagem explícita.
  const jobs = !prisma.sitfisDownloadJob ? null : await prisma.sitfisDownloadJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true, status: true, totalEmpresas: true, processadas: true,
      createdAt: true, updatedAt: true, erroMensagem: true,
    },
  }).catch(() => null);

  console.log("═══ Downloads de situação fiscal em lote ═══\n");
  if (!jobs) {
    console.log("  (tabela indisponível neste client Prisma)");
  } else if (!jobs.length) {
    console.log("  Nenhum job registrado.");
  } else {
    for (const j of jobs) {
      const travado = j.status === "processando";
      console.log(`  ${travado ? "⚠" : " "} ${j.status.padEnd(12)} ${j.processadas}/${j.totalEmpresas}  criado ${fmt(j.createdAt)} (${horasAtras(j.createdAt)}h atrás)`);
      if (travado) {
        console.log(`     ⚠ AINDA "processando" — se parou de avançar, é candidato a estar segurando lugares.`);
        console.log(`       última atualização: ${fmt(j.updatedAt)} (${horasAtras(j.updatedAt)}h atrás)`);
      }
      if (j.erroMensagem) console.log(`     erro: ${String(j.erroMensagem).slice(0, 120)}`);
    }
  }

  // ── 2) Protocolos guardados ────────────────────────────────────────────────────────────────
  const status = await prisma.companyFiscalStatus.findMany({
    select: { portalClientId: true, protocolo: true, checkedAt: true, ultimoRelatorioEm: true, situacao: true },
  });
  const comProtocolo = status.filter((s) => s.protocolo);
  const semRelatorio = status.filter((s) => !s.ultimoRelatorioEm);

  console.log("\n═══ Protocolos e relatórios ═══\n");
  console.log(`  Empresas com registro de situação fiscal : ${status.length}`);
  console.log(`  Com protocolo guardado ..................: ${comProtocolo.length}`);
  console.log(`  NUNCA trouxeram relatório ...............: ${semRelatorio.length}`);

  // Tentativas recentes indicam que algo (tela ou script) segue batendo no SERPRO.
  const ultimasTentativas = status
    .filter((s) => s.checkedAt)
    .sort((a, b) => new Date(b.checkedAt) - new Date(a.checkedAt))
    .slice(0, 5);
  if (ultimasTentativas.length) {
    console.log("\n  Tentativas mais recentes:");
    for (const s of ultimasTentativas) {
      console.log(`    ${fmt(s.checkedAt)} (${horasAtras(s.checkedAt)}h atrás)  situação: ${s.situacao || "—"}`);
    }
  }

  console.log("\n" + "─".repeat(72));
  console.log("COMO LER");
  console.log("  • Job 'processando' parado há horas → provável causa. Marcá-lo como erro/expirado");
  console.log("    interrompe o ciclo; enquanto ele existir, pode seguir reabrindo solicitações.");
  console.log("  • Tentativa há poucos minutos, sem ninguém no sistema → algo automático está");
  console.log("    consultando. O tempoEspera é de 30s: qualquer laço mais rápido que isso mantém");
  console.log("    a fila permanentemente ocupada, e o AV02 nunca sai.");
  console.log("  • Nada rodando e AV02 persistindo por horas → aí sim são solicitações órfãs no");
  console.log("    SERPRO, e o caminho é o suporte deles.");
} catch (err) {
  console.error("Erro:", err?.message || err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
