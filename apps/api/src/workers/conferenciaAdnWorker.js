// Confere as NFS-e da competência que acabou contra o ADN nacional, no PRIMEIRO DIA do mês
// seguinte — antes do fechamento, que é o único momento em que dá pra corrigir de graça.
//
// POR QUE ESTE WORKER EXISTE
// A conferência (`ConferenciaAdnService`) já estava pronta e testada, o `salvarFechamento` já
// travava com `conferenciaStatus="divergente"`… e nada disso rodava: a rota era só sob demanda e
// NENHUMA tela a chamava. Na prática o faturamento nunca era conferido contra a autoridade.
//
// O QUE A CONFERÊNCIA PEGA
//  • nota que existe no ADN e não temos  → `faltantes` → trava o fechamento (o "28 vs 27");
//  • nota que o cliente CANCELOU no NFS-e Nacional e que aqui seguia "autorizada" → é marcada
//    cancelada e sai do faturamento (senão a apuração sai A MAIOR, sem nada indicar).
//
// QUEM × QUANDO: `CompanyRotina` (rotina "conferencia" ligada por empresa) × a agenda da rotina
// em `SerproRuntimeSettings.rotinas.conferencia` (default dia 1, 6h, com janela de retry — se o
// worker estiver fora do ar no dia 1, ele ainda pega nos dias seguintes).
//
// CUSTO: cada conferência é uma varredura por NSU no ADN. Roda uma empresa por vez, com pausa
// entre elas, e falha de uma NUNCA derruba o ciclo — a próxima continua. A janela de retry da
// agenda (dias 1-3) NÃO multiplica o custo: quem já foi conferido no mês é pulado.
//
// Opt-in, como todo worker do projeto: CONFERENCIA_ADN_WORKER_ENABLED=1.

import { log } from "../config.js";
import { prisma } from "../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../application/guides/GuideLockService.js";
import { getSerproRuntimeSettings } from "../application/fiscal/serpro/SerproRuntimeSettings.js";
import { idsComRotinaAtiva } from "../application/fiscal/serpro/CompanyRotinasService.js";
import { conferirCompetencia } from "../application/notas/apuracao/v2/ConferenciaAdnService.js";
import { matchesCron } from "./cronMatch.js";

const LOCK_ID = "conferencia_adn_lock";
const LOCK_TTL_MS = 60 * 60 * 1000; // varredura do ADN é lenta; TTL folgado
const LOOP_INTERVAL_MS = 60 * 1000;
const PAUSA_ENTRE_EMPRESAS_MS = Number(process.env.ADN_DELAY_MS) || 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Competência a conferir = o mês ANTERIOR ao da execução. Rodando em 01/08 confere 2026-07, que é
// o mês prestes a ser fechado. Aritmética pura de ano/mês (sem Date) pra não escorregar em fuso.
export function competenciaAnterior(ref = new Date()) {
  const y = ref.getUTCFullYear();
  const m = ref.getUTCMonth() + 1; // 1..12
  const ano = m === 1 ? y - 1 : y;
  const mes = m === 1 ? 12 : m - 1;
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

export async function runConferenciaAdnWorkerOnce({ competencia: competenciaForcada, forcar = false } = {}) {
  const competencia = competenciaForcada || competenciaAnterior();
  const alvos = await idsComRotinaAtiva("conferencia");
  if (!alvos.size) {
    log.info({ competencia }, "Conferência ADN: nenhuma empresa com a rotina ligada");
    return { competencia, empresas: 0, ok: 0, divergentes: 0, naoConferiveis: 0, falhas: 0 };
  }

  const resumo = { competencia, empresas: alvos.size, ok: 0, divergentes: 0, naoConferiveis: 0, falhas: 0, marcadasCanceladas: 0, pulados: 0 };

  // A agenda tem janela de retry (dias 1 a 3): se o worker estiver fora do ar no dia 1, ele ainda
  // pega. Sem este corte, porém, a janela viraria TRÊS varreduras completas do ADN por empresa
  // todo mês — as outras rotinas se auto-limitam porque pulam o que já capturaram; a conferência
  // não tinha esse freio. Só reconfere se ainda não foi conferida nesta rodada mensal.
  // `forcar` (--force) reconfere mesmo o que já foi conferido: é o modo de investigar um número
  // que não bate, quando reler o ADN é justamente o que se quer.
  const inicioDoMes = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const jaConferidas = forcar ? new Set() : new Set(
    (await prisma.apuracaoSnapshot.findMany({
      where: {
        portalClientId: { in: [...alvos] },
        competencia,
        conferidaEm: { gte: inicioDoMes },
        conferenciaStatus: { not: null },
      },
      select: { portalClientId: true },
    })).map((r) => r.portalClientId),
  );

  for (const portalClientId of alvos) {
    if (jaConferidas.has(portalClientId)) { resumo.pulados += 1; continue; }
    try {
      // eslint-disable-next-line no-await-in-loop
      const r = await conferirCompetencia({ portalClientId, competencia });
      if (r.status === "ok") resumo.ok += 1;
      else if (r.status === "divergente") resumo.divergentes += 1;
      else resumo.naoConferiveis += 1;

      const marcadas = Number(r.resultado?.marcadasCanceladas || 0);
      resumo.marcadasCanceladas += marcadas;
      if (marcadas > 0) {
        // Vale um log próprio: significa que o faturamento MUDOU sozinho, e o contador precisa
        // saber por quê antes de olhar um número diferente do que viu ontem.
        log.warn(
          { portalClientId, competencia, marcadas, chaves: r.resultado?.canceladasNoAdn },
          "Conferência ADN: notas canceladas no nacional saíram do faturamento",
        );
      }
      if (r.status === "divergente") {
        log.warn(
          { portalClientId, competencia, faltantes: r.resultado?.faltantes?.length },
          "Conferência ADN: divergência — fechamento vai travar até resolver",
        );
      }
    } catch (err) {
      resumo.falhas += 1;
      log.error({ err: err?.message || err, portalClientId, competencia }, "Conferência ADN falhou nesta empresa");
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(PAUSA_ENTRE_EMPRESAS_MS);
  }

  return resumo;
}

export async function runConferenciaAdnWorkerLoop() {
  let lastTickKey = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const settings = await getSerproRuntimeSettings();
      const now = new Date();
      const tickKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      const cfg = settings.rotinas?.conferencia;
      const bateu = Boolean(cfg && cfg.enabled !== false && matchesCron(cfg.cron, now));

      if (bateu && tickKey !== lastTickKey) {
        lastTickKey = tickKey;
        // Lock: a varredura é longa e cara; duas instâncias conferindo a mesma competência só
        // gastariam o dobro de chamadas ao ADN pelo mesmo resultado.
        const gotLock = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
        if (!gotLock) {
          log.info({ tickKey }, "Conferência ADN: outra instância já está rodando");
        } else {
          try {
            const resumo = await runConferenciaAdnWorkerOnce();
            log.info({ resumo, tickKey }, "Ciclo do conferenciaAdnWorker concluído");
          } finally {
            await releaseGuideLock(LOCK_ID);
          }
        }
      }
    } catch (err) {
      log.error({ err: err?.message || err }, "Erro no ciclo do conferenciaAdnWorker");
    }

    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
  }
}

if (process.argv[1] && process.argv[1].endsWith("conferenciaAdnWorker.js")) {
  // `--once` roda agora, ignorando a agenda (útil pra exercer em produção sem esperar o dia 1).
  // `--competencia=YYYY-MM` confere um mês específico. `--force` reconfere quem já foi conferido
  // neste mês (sem ele, o --once respeita o mesmo corte de custo do ciclo automático).
  if (process.argv.includes("--once")) {
    const arg = process.argv.find((a) => a.startsWith("--competencia="));
    runConferenciaAdnWorkerOnce({
      competencia: arg ? arg.split("=")[1] : undefined,
      forcar: process.argv.includes("--force"),
    })
      .then((resumo) => {
        log.info({ resumo }, "Conferência ADN (--once) concluída");
        process.exit(0);
      })
      .catch((err) => {
        log.error({ err: err?.message || err }, "Conferência ADN (--once) falhou");
        process.exit(1);
      });
  } else {
    runConferenciaAdnWorkerLoop();
  }
}
