// CONSULTA DE NOTAS EM LOTE — a captura de verdade, para a carteira inteira.
//
// POR QUE ISTO EXISTE
// A rotina automática (`workers/dfeNotasWorker.js`) parou de trazer notas e ninguém percebeu; foi
// preciso abrir empresa por empresa e clicar "Buscar" na mão. Duas coisas conspiraram:
//
//   1. A aba "Download de notas" NÃO consulta nada. Ela lê `PortalInvoice.xmlRaw` que já está no
//      banco e zipa. Empresa sem captura gera pasta vazia e o job termina CONCLUÍDO com zero notas
//      — a tela dizia "deu certo" justamente quando não tinha dado.
//   2. O worker descarta empresa sem certificado dentro de um `filter` e empresa dentro do
//      intervalo com um `skipped` que só existe em memória. Quem olha o log vê "N elegíveis" e não
//      vê as que sequer foram tentadas.
//
// Por isso a regra desta tela: **toda empresa selecionada vira uma linha**, inclusive — e
// principalmente — a que foi pulada, com o motivo escrito. Silêncio é o que quebrou.
//
// NENHUMA LÓGICA DE CAPTURA NOVA: chama `syncAdnNotasForCompany` / `syncDfeForCompany`, as mesmas
// dos botões por empresa e do worker. Duplicar a varredura de NSU seria criar uma terceira verdade
// sobre o cursor.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { tryAcquireGuideLock, releaseGuideLock } from "../../guides/GuideLockService.js";
import { syncAdnNotasForCompany } from "../adn/AdnNotasService.js";
import { syncDfeForCompany } from "../dfe/DfeSyncService.js";
import { checkCertAvailability, SERVICOS } from "../CertResolver.js";
import { log } from "../../../config.js";

const LOCK_ID = "notas_captura_lock";
const LOCK_TTL_MS = 30 * 60 * 1000;

export const ALVOS = Object.freeze(["NFSE", "NFE"]);

// ⚠ NT 2014.002: a SEFAZ proíbe consultar o MESMO CNPJ mais de 1× por hora. Estourar devolve
// "Consumo Indevido" (cStat 656) e BLOQUEIA aquele CNPJ por uma hora — o oposto do que o lote quer.
// Mesmo número do worker (`DFE_NOTAS_WORKER_INTERVAL_MIN`), de propósito: duas janelas diferentes
// para a mesma regra externa dariam no bloqueio que ambas tentam evitar.
// O ADN não tem regra equivalente — lá o espaçamento de 1,1s entre chamadas já é a proteção.
const INTERVALO_NFE_MIN = 60;

// Espaço entre empresas. O ADN já espaça 1,1s internamente; isto é para não emendar uma empresa na
// outra sem respiro.
const PAUSA_ENTRE_EMPRESAS_MS = 400;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function minutosDesde(data) {
  if (!data) return Infinity;
  return Math.floor((Date.now() - new Date(data).getTime()) / 60000);
}

function formatarData(d) {
  try {
    return new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

/**
 * As pré-condições, resolvidas ANTES de gastar a chamada — e devolvendo o motivo em português,
 * porque é ele que vai para a tela. Devolver `null` = pode consultar.
 */
async function motivoParaPular({ alvo, portal, legacy, syncState }) {
  if (portal.status === "SUSPENSA") {
    return { status: "pulada", motivo: "empresa suspensa" };
  }

  if (alvo === "NFSE") {
    // ⚠ O ADN identifica o contribuinte pelo CERTIFICADO — não há CNPJ no path. Sem o A1 DA
    // EMPRESA não se consulta: usar o do escritório traria as notas do escritório gravadas debaixo
    // do cliente (foi o que aconteceu, e por isso o fallback foi removido).
    const cert = await checkCertAvailability({ portalClientId: portal.id, servico: SERVICOS.NFSE });
    if (!cert.ok) return { status: "pulada", motivo: "sem certificado A1 da empresa" };
    if (legacy?.certExpiresAt && new Date(legacy.certExpiresAt) < new Date()) {
      return { status: "pulada", motivo: `certificado A1 vencido em ${new Date(legacy.certExpiresAt).toLocaleDateString("pt-BR")}` };
    }
    if (syncState?.adnBackoffUntil && new Date(syncState.adnBackoffUntil) > new Date()) {
      return { status: "aguardando", motivo: `em espera após erro — libera às ${formatarData(syncState.adnBackoffUntil)}` };
    }
    return null;
  }

  // NF-e / SEFAZ
  if (!legacy?.inscricaoEstadual) {
    // A janela de NF-e nem aparece na tela da empresa sem inscrição estadual — e a rota nunca
    // validou isso. Aqui vira motivo visível em vez de uma consulta que não faz sentido.
    return { status: "pulada", motivo: "sem inscrição estadual (não emite NF-e)" };
  }
  if (syncState?.dfeBackoffUntil && new Date(syncState.dfeBackoffUntil) > new Date()) {
    return { status: "aguardando", motivo: `em espera após erro — libera às ${formatarData(syncState.dfeBackoffUntil)}` };
  }
  const desde = minutosDesde(syncState?.dfeLastSyncAt);
  if (desde < INTERVALO_NFE_MIN) {
    return { status: "aguardando", motivo: `consultada há ${desde} min — a SEFAZ só permite 1×/hora (faltam ${INTERVALO_NFE_MIN - desde} min)` };
  }
  return null;
}

/** Traduz o retorno do serviço de captura na linha que a tela mostra. */
function itemDoResultado(alvo, r, cursorAntes) {
  if (!r?.ok) {
    if (r?.reason === "backoff_active") {
      return { status: "aguardando", motivo: `em espera após erro — libera às ${formatarData(r.backoffUntil)}` };
    }
    return {
      status: "erro",
      motivo: `${r?.reason || "falha"}${r?.message ? `: ${String(r.message).slice(0, 180)}` : ""}`,
    };
  }
  const totalDocs = Number(r.totalDocs || 0);
  const novos = alvo === "NFSE"
    ? Number(r.byStatus?.upserted || 0) + Number(r.byStatus?.pendencia_criada || 0)
    : Number(r.byType?.nfe_summary || 0) + Number(r.byType?.nfe_full || 0) + Number(r.byType?.pendencias || 0);
  // Documentos que CHEGARAM e foram descartados pela guarda de CNPJ. É o desfecho que precisava
  // deixar de ser invisível: sem ele, "o ADN devolveu 8 notas e recusamos as 8" aparecia na tela
  // exatamente como "não havia nota nenhuma".
  const recusadas = Number(r.byStatus?.rejeitada_outro_cnpj || 0);

  if (recusadas > 0 && novos === 0) {
    return {
      status: "recusado",
      motivo: `${recusadas} documento(s) recusado(s): nem prestador nem tomador é o CNPJ desta empresa. `
        + "Confira o CNPJ do cadastro (matriz × filial, CPF) — ou são notas de outro contribuinte.",
      totalDocs, novos, recusadas,
      cursorAntes: cursorAntes || null,
      cursorDepois: r.newCursor || null,
    };
  }

  const avisos = [];
  if (r.warning) avisos.push(`parcial — ${String(r.warning).slice(0, 180)}`);
  if (recusadas > 0) avisos.push(`${recusadas} documento(s) recusado(s) por CNPJ divergente`);

  return {
    // "nada novo" NÃO é falha: o cursor pode simplesmente já estar em dia. Mas precisa aparecer
    // diferente de "capturou", senão o contador não sabe se a busca funcionou ou não achou nada.
    status: totalDocs > 0 ? "capturou" : "nada_novo",
    motivo: avisos.length ? avisos.join(" · ") : null,
    totalDocs,
    novos,
    recusadas,
    cursorAntes: cursorAntes || null,
    cursorDepois: r.newCursor || null,
  };
}

/**
 * Cria o job e dispara o processamento em segundo plano (fire-and-forget, mesmo padrão do
 * NotasDownloadService). O `portalClientIds` já vem VALIDADO contra a carteira do escritório pela
 * rota — isolamento multi-tenant não se resolve aqui dentro.
 */
export async function criarNotasCapturaJob({ portalClientIds, alvos, triggeredBy = null }) {
  const ids = [...new Set((portalClientIds || []).filter(Boolean))];
  if (!ids.length) {
    const err = new Error("Selecione ao menos uma empresa.");
    err.code = "NO_COMPANIES";
    throw err;
  }
  const alvosValidos = (alvos || []).map((a) => String(a).toUpperCase()).filter((a) => ALVOS.includes(a));
  if (!alvosValidos.length) {
    const err = new Error("Escolha ao menos um tipo: NFS-e ou NF-e.");
    err.code = "NO_TARGETS";
    throw err;
  }

  const job = await prisma.notasCapturaJob.create({
    data: {
      alvos: alvosValidos,
      companyIds: ids,
      totalEmpresas: ids.length,
      triggeredBy,
    },
  });

  processarNotasCapturaJob(job.id).catch((err) => {
    log.error({ err: err?.message, jobId: job.id }, "[NotasCaptura] falha não tratada no processamento");
  });

  return jobToResponse(await prisma.notasCapturaJob.findUnique({ where: { id: job.id }, include: { itens: true } }));
}

export async function processarNotasCapturaJob(jobId) {
  const job = await prisma.notasCapturaJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "processando") return;

  // Um lote por vez: duas varreduras concorrentes no mesmo cursor NSU se atropelariam.
  const locked = await tryAcquireGuideLock(LOCK_ID, LOCK_TTL_MS);
  if (!locked) {
    await prisma.notasCapturaJob.update({
      where: { id: jobId },
      data: { status: "erro", erroMensagem: "Outra consulta em lote já está em andamento. Aguarde ela terminar." },
    });
    return;
  }

  const ids = Array.isArray(job.companyIds) ? job.companyIds : [];
  const alvos = Array.isArray(job.alvos) ? job.alvos : [];
  let totalNotas = 0;

  try {
    for (const portalClientId of ids) {
      // eslint-disable-next-line no-await-in-loop
      const portal = await prisma.portalClient.findUnique({
        where: { id: portalClientId },
        select: { id: true, razao: true, cnpj: true, status: true, companyId: true },
      });
      // eslint-disable-next-line no-await-in-loop
      const legacy = portal?.companyId
        ? await prisma.company.findUnique({
          where: { id: portal.companyId },
          select: { certExpiresAt: true, certStorageKey: true, inscricaoEstadual: true },
        })
        : null;
      // eslint-disable-next-line no-await-in-loop
      const syncState = await prisma.portalSyncState.findUnique({ where: { clientId: portalClientId } });

      for (const alvo of alvos) {
        const base = {
          jobId, portalClientId, alvo,
          razao: portal?.razao || null, cnpj: portal?.cnpj || null,
        };

        if (!portal) {
          // eslint-disable-next-line no-await-in-loop
          await prisma.notasCapturaItem.create({ data: { ...base, status: "erro", motivo: "empresa não encontrada" } });
          continue;
        }

        // eslint-disable-next-line no-await-in-loop
        const pular = await motivoParaPular({ alvo, portal, legacy, syncState });
        if (pular) {
          // eslint-disable-next-line no-await-in-loop
          await prisma.notasCapturaItem.create({ data: { ...base, ...pular } });
          continue;
        }

        const cursorAntes = alvo === "NFSE"
          ? (syncState?.adnNsuCursor != null ? String(syncState.adnNsuCursor) : null)
          : (syncState?.dfeNsuCursor != null ? String(syncState.dfeNsuCursor) : null);

        let resultado;
        try {
          // eslint-disable-next-line no-await-in-loop
          const r = alvo === "NFSE"
            ? await syncAdnNotasForCompany({ portalClientId, env: "prod" })
            : await syncDfeForCompany({ portalClientId, env: "prod" });
          resultado = itemDoResultado(alvo, r, cursorAntes);
        } catch (err) {
          // Erro de uma empresa NÃO derruba o lote: a próxima ainda precisa ser tentada, e a
          // falha desta precisa ficar visível na linha dela.
          resultado = { status: "erro", motivo: String(err?.message || err).slice(0, 200) };
        }

        totalNotas += Number(resultado.totalDocs || 0);
        // eslint-disable-next-line no-await-in-loop
        await prisma.notasCapturaItem.create({ data: { ...base, ...resultado } });
        // eslint-disable-next-line no-await-in-loop
        await sleep(PAUSA_ENTRE_EMPRESAS_MS);
      }

      // eslint-disable-next-line no-await-in-loop
      await prisma.notasCapturaJob.update({
        where: { id: jobId },
        data: { processadas: { increment: 1 }, totalNotas },
      });
    }

    await prisma.notasCapturaJob.update({ where: { id: jobId }, data: { status: "concluido", totalNotas } });
  } catch (err) {
    log.error({ err: err?.message, jobId }, "[NotasCaptura] job interrompido");
    await prisma.notasCapturaJob
      .update({ where: { id: jobId }, data: { status: "erro", erroMensagem: String(err?.message || err).slice(0, 500) } })
      .catch(() => null);
  } finally {
    await releaseGuideLock(LOCK_ID).catch(() => null);
  }
}

export function jobToResponse(job) {
  if (!job) return null;
  return {
    jobId: job.id,
    status: job.status,
    origem: job.origem || "manual",
    alvos: Array.isArray(job.alvos) ? job.alvos : [],
    // ⚠ O ESCOPO DO JOB VIAJA NA RESPOSTA porque quem decide se ele pode ser LIDO é a rota, e a
    // rota não tem outra forma de saber de quem é o lote: a listagem não carrega `itens`. Sem este
    // campo, `GET /firm/notas-captura` voltaria a listar os jobs de toda a base.
    companyIds: Array.isArray(job.companyIds) ? job.companyIds.map(String) : [],
    totalEmpresas: job.totalEmpresas,
    processadas: job.processadas,
    totalNotas: job.totalNotas,
    erroMensagem: job.erroMensagem || null,
    criadoEm: job.createdAt,
    atualizadoEm: job.updatedAt,
    itens: (job.itens || []).map((i) => ({
      portalClientId: i.portalClientId,
      razao: i.razao,
      cnpj: i.cnpj,
      alvo: i.alvo,
      status: i.status,
      motivo: i.motivo,
      totalDocs: i.totalDocs,
      novos: i.novos,
      recusadas: i.recusadas,
      cursorAntes: i.cursorAntes,
      cursorDepois: i.cursorDepois,
    })),
  };
}

export async function getNotasCapturaJob(jobId) {
  return jobToResponse(await prisma.notasCapturaJob.findUnique({
    where: { id: String(jobId) },
    include: { itens: { orderBy: { createdAt: "asc" } } },
  }));
}

export async function listNotasCapturaJobs(take = 10) {
  const jobs = await prisma.notasCapturaJob.findMany({
    orderBy: { createdAt: "desc" },
    take,
  });
  return jobs.map((j) => jobToResponse(j));
}
