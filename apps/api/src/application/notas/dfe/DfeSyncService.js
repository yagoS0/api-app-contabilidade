// Q12.B.4: orquestra o loop de captura DFe pra uma empresa.
//
// Fluxo:
//   1) Verifica backoff/lock em PortalSyncState (dfeBackoffUntil/lockUntil).
//   2) Resolve cert via CertResolver (procuracao escritório PREFERIDO, fallback A1 empresa).
//      Atenção: hoje o cert "escritório" não está implementado — se vier source=procuracao_escritorio
//      e não houver cert no env, caímos pro A1 da empresa.
//   3) Loop: lê dfeNsuCursor, chama fetchDistNSU, parseia, persiste docs, atualiza cursor.
//      Continua até cStat=137 (nada novo) OU ultNSU == maxNSU OU 10 iterações (safety).
//   4) Cada iteração: TRANSACTION upsert docs + UPDATE cursor (atômico).
//   5) Nota em competência fechada → vira PendenciaPosFechamento (não atualiza base).
//
// Idempotência: upsert por (clientId, chaveAcesso) — já existe @@unique no schema.
// Re-roda 2x mesmo input = 0 duplicatas.

import { prisma } from "../../../infrastructure/db/prisma.js";
import { DFE_NOTAS_WORKER_INTERVAL_MIN } from "../../../config.js";
import { resolveCertForCompany, SERVICOS } from "../CertResolver.js";
import { fetchDistNSU, DfeClientError } from "./DfeClient.js";
import { parseDistDFeResponse, parseDocZip } from "./DfeParser.js";
import { upsertNfeFromParsed } from "../ingestaoNfe.js";

const MAX_ITERATIONS = 10;
const BACKOFF_MINUTES_ON_ERROR = 15;

// ─── A JANELA DE 1 HORA DA SEFAZ (NT 2014.002 v1.10) ────────────────────────────────────────────
//
// ⚠ ELA MORA AQUI, DENTRO DE `syncDfeForCompany`, E NÃO NA ROTA. Havia TRÊS respostas para a mesma
// pergunta — worker (`workers/dfeNotasWorker.js`), lote (`captura/NotasCapturaService.js`) e o botão
// por empresa (`routes/firm/notas.js`, `POST /dfe/sync`) — e a terceira simplesmente não existia: a
// rota chamava esta função direto. UM clique bastava para levar `cStat=656` (Consumo Indevido) e
// BLOQUEAR o CNPJ por uma hora, mesmo sendo o primeiro clique do dia, porque:
//
//   • a espera de 1 h da NT é CONDICIONAL — vale *"caso não existam mais documentos a serem
//     pesquisados"*, ou seja, é disparada pelo cStat 137; e
//   • este laço itera JUSTAMENTE até receber 137. Toda execução bem-sucedida do worker fecha a
//     janela sozinha. O botão manual nunca teve como ganhar dele.
//
// E o 656 grava backoff de 60 min (mais abaixo), que derruba TAMBÉM o worker: clicar tirava a
// empresa do ar por uma hora.
//
// Quem chama herda — mesma disciplina de `fechamentoBlockers`, `guideContract` e
// `codigoServicoDaNota`. Worker e lote mantêm as guardas deles: dupla checagem é inofensiva,
// removê-las faria a proteção depender de uma camada só.
//
// ⚠ NÃO EXISTE ESCAPE (`?forcar=1`). A janela é regra EXTERNA: furá-la produz exatamente o bloqueio
// que a guarda evita. Diferente do teto do SERPRO (`podeForcarSerpro`), que é orçamento NOSSO.
//
// ⚠ O NÚMERO VEM DE `DFE_NOTAS_WORKER_INTERVAL_MIN` — a MESMA constante do worker, nunca um `60`
// escrito à mão. Duas janelas para a mesma regra dão no bloqueio que ambas tentam evitar.
export const DFE_INTERVALO_MIN = DFE_NOTAS_WORKER_INTERVAL_MIN || 60;

/**
 * A janela lida por "OLHEI", nunca por "RECEBI".
 *
 * ⚠ `dfeLastSyncAt` só se move quando CHEGA documento — usá-lo como relógio foi o defeito que custou
 * 29 dias no ADN e está escrito no comentário de `PortalSyncState` (`schema.prisma`). Quem responde
 * "quando foi a última vez que consultamos este CNPJ" é `dfeLastAttemptAt`, gravado em TODA
 * tentativa, com ou sem documento.
 *
 * ⚠ Empresa SEM `PortalSyncState` (nunca consultada) PASSA: sem linha não há `dfeLastAttemptAt`.
 *
 * @param {{dfeLastAttemptAt?: Date|string|null}|null} state
 * @returns {{podeConsultarAgora: boolean, ultimaConsultaEm: Date|null, proximaConsultaEm: Date|null,
 *            minutosDesdeUltima: number|null, minutosRestantes: number, intervaloMin: number}}
 */
export function avaliarJanelaDfe(state, agora = new Date()) {
  const intervaloMin = DFE_INTERVALO_MIN;
  const ultima = state?.dfeLastAttemptAt ? new Date(state.dfeLastAttemptAt) : null;
  if (!ultima || Number.isNaN(ultima.getTime())) {
    return {
      podeConsultarAgora: true,
      ultimaConsultaEm: null,
      proximaConsultaEm: null,
      minutosDesdeUltima: null,
      minutosRestantes: 0,
      intervaloMin,
    };
  }
  const proxima = new Date(ultima.getTime() + intervaloMin * 60 * 1000);
  const minutosDesdeUltima = Math.floor((agora.getTime() - ultima.getTime()) / 60000);
  const podeConsultarAgora = proxima.getTime() <= agora.getTime();
  return {
    podeConsultarAgora,
    ultimaConsultaEm: ultima,
    proximaConsultaEm: proxima,
    minutosDesdeUltima,
    minutosRestantes: podeConsultarAgora ? 0 : Math.max(1, Math.ceil((proxima.getTime() - agora.getTime()) / 60000)),
    intervaloMin,
  };
}

function horaCurta(d) {
  try {
    return new Date(d).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

/**
 * O 656 diz o FATO, não o palpite.
 *
 * A mensagem antiga afirmava *"outra aplicação consultando o mesmo CNPJ"* — hipótese apontando para
 * fora, que mandou o dono caçar culpado externo quando a outra aplicação era o nosso próprio worker.
 * A regra agora: se a NOSSA última tentativa é recente, o fato é nosso e é dito como fato. Só quando
 * ela for mais velha que a janela é que a outra aplicação vira hipótese — e aí é dita COMO hipótese.
 *
 * @param {Date|string|null|undefined} ultimaTentativaNossa
 */
export function explicar656(ultimaTentativaNossa) {
  const j = avaliarJanelaDfe({ dfeLastAttemptAt: ultimaTentativaNossa });
  if (!j.ultimaConsultaEm) {
    return ` (não há registro de consulta nossa a este CNPJ; pode ser outra aplicação usando o mesmo `
      + `CNPJ na distribuição DFe — a SEFAZ libera em 1 hora)`;
  }
  if (!j.podeConsultarAgora) {
    return ` (este sistema consultou este CNPJ há ${j.minutosDesdeUltima} min; a SEFAZ exige `
      + `${j.intervaloMin} min entre consultas do mesmo CNPJ — a próxima sai às `
      + `${horaCurta(j.proximaConsultaEm)})`;
  }
  return ` (a nossa última consulta a este CNPJ foi há ${j.minutosDesdeUltima} min, já fora da janela `
    + `de ${j.intervaloMin} min; então PODE ser outra aplicação consultando o mesmo CNPJ — a SEFAZ `
    + `libera em 1 hora)`;
}

export class DfeSyncError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

// ⚠ `loadOfficeCert` foi REMOVIDO daqui, junto com o fallback que o usava.
//
// Ele carregava o certificado do ESCRITÓRIO para consultar notas de empresa CLIENTE — exatamente o
// que o dono proibiu: *"o A1 do escritório nunca deve consultar notas"*. A configuração do cert do
// escritório continua existindo em `SerproRuntimeSettings`, e continua certa para o SERPRO (Integra
// Contador), que É um serviço prestado pelo escritório com o certificado dele. Notas, não: ali quem
// fala é o contribuinte.

/**
 * A1 DA PRÓPRIA EMPRESA — e nada mais.
 *
 * ⚠ AQUI EXISTIA UM FALLBACK PARA O CERT DO ESCRITÓRIO, e ele foi REMOVIDO por decisão do dono:
 * *"o A1 do escritório nunca deve consultar notas, e um A1 de outro CNPJ nunca deve ser usado em
 * outra empresa"*.
 *
 * O mesmo fallback já tinha causado estrago do lado do ADN: lá o escritório É cadastrado no
 * gov.br/nfse, então a consulta voltava com as notas DELE, gravadas debaixo da empresa cliente. Na
 * SEFAZ o desfecho é diferente — cStat 593 (`CERT_CNPJ_MISMATCH`) rejeita porque o CNPJ-base do
 * cert não bate — mas o defeito é o mesmo: o sistema tenta consultar em nome de quem não é o
 * contribuinte. Manter o caminho aberto só produzia erro tardio e confuso onde cabia uma recusa
 * clara e imediata.
 *
 * Procuração e-CAC também NÃO reabre isso para notas: ela permite ao escritório agir no e-CAC, não
 * torna o certificado dele o certificado do cliente perante o ADN.
 */
async function resolveCertWithFallback(portalClientId) {
  const r = await resolveCertForCompany({ portalClientId, servico: SERVICOS.DFE })
    .catch((err) => {
      // Mismatch é diferente de ausência: o certificado EXISTE, mas é de outro CNPJ. Propaga com o
      // código próprio para a tela dizer o que fazer (trocar o arquivo, não "cadastrar um").
      if (err?.code === "CERT_CNPJ_MISMATCH") throw new DfeSyncError("CERT_CNPJ_MISMATCH", err.message);
      return { source: "none" };
    });
  if (r.source === "company_a1") {
    return { pfxBuffer: r.pfxBuffer, password: r.password, via: "company_a1" };
  }

  throw new DfeSyncError("NO_COMPANY_CERT",
    "Esta empresa não tem certificado A1 próprio cadastrado. A SEFAZ exige o certificado do próprio "
    + "CNPJ (cStat 593) — o do escritório não vale e não é usado. Vá em Editar Cadastro → 🔐 "
    + "Certificado A1 e faça upload do PFX da empresa.");
}

function deriveUF(portalClient) {
  return String(portalClient?.uf || "RJ").toUpperCase();
}

/**
 * Atualiza cursor + lastSyncAt atomicamente (chamada DEPOIS de persistir os docs).
 */
async function persistCursorTx(tx, { clientId, newCursor, errorMsg = null }) {
  await tx.portalSyncState.upsert({
    where: { clientId },
    create: {
      clientId,
      dfeNsuCursor: newCursor,
      dfeLastSyncAt: new Date(),
      dfeLastError: errorMsg,
    },
    update: {
      dfeNsuCursor: newCursor,
      dfeLastSyncAt: new Date(),
      dfeLastError: errorMsg,
    },
  });
}

async function setBackoff({ clientId, errorMsg, minutes }) {
  const mins = Number.isFinite(minutes) ? minutes : BACKOFF_MINUTES_ON_ERROR;
  const backoffUntil = new Date(Date.now() + mins * 60 * 1000);
  await prisma.portalSyncState.upsert({
    where: { clientId },
    create: { clientId, dfeBackoffUntil: backoffUntil, dfeLastError: errorMsg },
    update: { dfeBackoffUntil: backoffUntil, dfeLastError: errorMsg },
  }).catch(() => null);
}

// ⚠ A PERSISTÊNCIA DA NF-e MORA EM `../ingestaoNfe.js` — NÃO A REESCREVA AQUI.
//
// `isCompetenciaFechada` e `upsertNotaFromParsed` moravam neste arquivo. Foram EXTRAÍDAS (mesmo
// corpo, mesmos status de retorno) quando o import de arquivo do Fisco Fácil passou a gravar NF-e:
// duas implementações da mesma gravação foi exatamente o defeito que somou faturamento em dobro na
// NFS-e (`apps/api/CLAUDE.md`, "UMA ingestão só"). Aqui ficou só o que é da CAPTURA.

/**
 * Aplica evento (cancelamento etc) atualizando statusEfetivo da nota correspondente.
 * Se a nota não existe ainda (chegou só o evento), apenas registra em PortalInvoiceEvent.
 */
async function applyEvent(tx, { portalClientId, ev }) {
  if (!ev.chaveAcesso) return { skipped: true };
  const nota = await tx.portalInvoice.findFirst({
    where: { clientId: portalClientId, chaveAcesso: ev.chaveAcesso },
    select: { id: true },
  });
  if (nota) {
    let newStatus = null;
    if (ev.action === "CANCELAMENTO") newStatus = "cancelada";
    if (ev.action === "MANIFESTACAO") newStatus = "autorizada";
    if (newStatus) {
      await tx.portalInvoice.update({
        where: { id: nota.id },
        data: { statusEfetivo: newStatus },
      });
    }
    await tx.portalInvoiceEvent.create({
      data: {
        clientId: portalClientId,
        invoiceId: nota.id,
        type: ev.action,
        date: new Date(),
        payloadRaw: { tpEvento: ev.tpEvento },
      },
    }).catch(() => null);
  }
  return { applied: ev.action };
}

/**
 * Captura DFe pra UMA empresa. Retorna sumário { ok, totalDocs, byType, newCursor, iterations }.
 *
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @param {"prod"|"hom"} [opts.env="prod"]
 */
export async function syncDfeForCompany({ portalClientId, env = "prod" }) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { id: true, razao: true, cnpj: true, uf: true, status: true },
  });
  if (!portal) throw new DfeSyncError("PORTAL_CLIENT_NOT_FOUND", "Empresa não encontrada");
  if (portal.status === "SUSPENSA") throw new DfeSyncError("COMPANY_SUSPENDED", "Empresa está suspensa");

  // Backoff check
  const state = await prisma.portalSyncState.findUnique({ where: { clientId: portalClientId } });
  if (state?.dfeBackoffUntil && new Date(state.dfeBackoffUntil) > new Date()) {
    return {
      ok: false, reason: "backoff_active",
      backoffUntil: state.dfeBackoffUntil,
    };
  }

  // ⚠ A JANELA DE 1 HORA — recusa NOSSA e NOMEADA, ANTES DE QUALQUER I/O. Nada sai para a SEFAZ.
  // Ver o bloco `DFE_INTERVALO_MIN` no topo do arquivo para o porquê de a regra morar aqui.
  //
  // Não grava backoff nem `dfeLastAttemptAt`: não houve tentativa, e escrever backoff aqui
  // derrubaria o worker junto — que é exatamente o estrago que esta guarda existe para impedir.
  const janela = avaliarJanelaDfe(state);
  if (!janela.podeConsultarAgora) {
    return {
      ok: false,
      reason: "DFE_INTERVALO_NAO_CUMPRIDO",
      message:
        `Este sistema já consultou a SEFAZ para este CNPJ há ${janela.minutosDesdeUltima} min. `
        + `A SEFAZ permite 1 consulta por CNPJ a cada ${janela.intervaloMin} min (NT 2014.002) — insistir `
        + "devolveria Consumo Indevido (cStat 656) e bloquearia a empresa por 1 hora. "
        + `A captura automática roda de hora em hora; a próxima consulta sai às ${horaCurta(janela.proximaConsultaEm)}.`,
      ultimaConsultaEm: janela.ultimaConsultaEm,
      proximaConsultaEm: janela.proximaConsultaEm,
      minutosDesdeUltima: janela.minutosDesdeUltima,
      minutosRestantes: janela.minutosRestantes,
      intervaloMin: janela.intervaloMin,
    };
  }

  // Cert
  let cert;
  try {
    cert = await resolveCertWithFallback(portalClientId);
  } catch (err) {
    return { ok: false, reason: err.code || "cert_error", message: err.message };
  }

  const uf = deriveUF(portal);
  let ultNSU = BigInt(state?.dfeNsuCursor ?? 0);
  const byType = { nfe_summary: 0, nfe_full: 0, event: 0, unknown: 0, error: 0, pendencias: 0 };
  let totalDocs = 0;
  let iterations = 0;
  let lastMaxNSU = 0n;

  // Mesma razão do lado do ADN: "olhei" precisa ser gravado separado de "recebi", senão empresa
  // quieta e captura quebrada ficam idênticas no diagnóstico. Best-effort.
  await prisma.portalSyncState.upsert({
    where: { clientId: portalClientId },
    create: { clientId: portalClientId, dfeLastAttemptAt: new Date() },
    update: { dfeLastAttemptAt: new Date() },
  }).catch(() => null);

  try {
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const { status, xml } = await fetchDistNSU({
        cnpj: portal.cnpj,
        ultNSU,
        pfxBuffer: cert.pfxBuffer,
        password: cert.password,
        env,
        uf,
      });
      if (status >= 500) {
        throw new DfeClientError("HTTP_5XX", `SEFAZ retornou HTTP ${status}`);
      }

      const ret = parseDistDFeResponse(xml);
      lastMaxNSU = ret.maxNSU;

      // cStat 137 = nada novo; cStat 138 = tem docs
      if (ret.error) {
        // Mapeia cStats comuns pra mensagens acionáveis
        let code = "DIST_ERROR";
        let hint = "";
        if (ret.cStat === "593") {
          code = "CERT_CNPJ_MISMATCH";
          hint = ` (o A1 cadastrado pertence a outro CNPJ — precisa ser o cert da própria empresa ${portal.cnpj})`;
        } else if (ret.cStat === "656") {
          code = "CONSUMO_INDEVIDO";
          // ⚠ AQUI SE DIZIA *"outra aplicação consultando o mesmo CNPJ — aguarde 1h"*: uma HIPÓTESE
          // escrita como fato, e apontando para FORA. Mandou o dono procurar culpado externo quando
          // a outra aplicação éramos NÓS (o worker, de hora em hora). Agora o texto sai do relógio:
          // `state` é a leitura ANTERIOR ao `dfeLastAttemptAt` desta execução, então é mesmo a
          // penúltima tentativa — a nossa última antes desta.
          hint = explicar656(state?.dfeLastAttemptAt);
        } else if (ret.cStat === "137") {
          // 137 nunca chega aqui (já tratado como sucesso)
        } else if (ret.cStat === "108" || ret.cStat === "109") {
          hint = " (serviço SEFAZ temporariamente indisponível — tente em alguns minutos)";
        }
        throw new DfeClientError(code, `cStat=${ret.cStat}: ${ret.xMotivo}${hint}`);
      }

      // Q12.B+++.8: coleta chaves DEST de resNFe pra enfileirar Manifestação
      // (após o commit — não vai pro tx). procNFe (XML completo) NÃO precisa
      // — já veio com tudo.
      const chavesPraManifestar = [];

      // Persiste docs + atualiza cursor numa transação
      const newCursor = ret.ultNSU > ultNSU ? ret.ultNSU : ultNSU;
      await prisma.$transaction(async (tx) => {
        for (const docZip of ret.docs) {
          const parsed = parseDocZip(docZip, { companyCnpj: portal.cnpj });
          byType[parsed.type] = (byType[parsed.type] || 0) + 1;
          totalDocs++;

          if (parsed.type === "nfe_summary" || parsed.type === "nfe_full") {
            const r = await upsertNfeFromParsed(tx, {
              portalClientId, parsed: parsed.parsed, items: parsed.items,
            });
            if (r.status === "pendencia_criada") byType.pendencias++;
            // Marca pra manifestação se DEST + só resumo (procNFe já veio completo)
            if (parsed.type === "nfe_summary" && parsed.papel === "DEST" && parsed.chaveAcesso) {
              chavesPraManifestar.push(parsed.chaveAcesso);
            }
          } else if (parsed.type === "event") {
            await applyEvent(tx, { portalClientId, ev: parsed });
          }
        }
        await persistCursorTx(tx, { clientId: portalClientId, newCursor });
      });

      // Enfileira manifestações (fora da tx — operação independente, best-effort)
      if (chavesPraManifestar.length > 0) {
        try {
          const { enqueueManifestacao } = await import("./NfeManifestacaoService.js");
          for (const chave of chavesPraManifestar) {
            await enqueueManifestacao({
              portalClientId, chaveAcesso: chave, tpEvento: "210210",
            }).catch(() => null); // idempotente; ignora falha individual
          }
        } catch {
          // não bloqueia o sync principal
        }
      }

      ultNSU = newCursor;
      if (ret.cStat === "137") break;            // nada novo
      if (ret.docs.length === 0) break;          // safety
      if (ultNSU >= lastMaxNSU && ret.docs.length === 0) break;
    }

    return {
      ok: true,
      env,
      uf,
      cnpj: portal.cnpj,
      certVia: cert.via,
      iterations,
      totalDocs,
      byType,
      newCursor: ultNSU.toString(),
      maxNSU: lastMaxNSU.toString(),
    };
  } catch (err) {
    const code = err?.code || "SYNC_FAILED";
    const msg = err?.message || String(err);
    // Q12.B+++.10: "Consumo Indevido" exige backoff de 1h obrigatório (NT 2014.002).
    // CERT_CNPJ_MISMATCH não precisa backoff longo (problema permanente até trocar cert).
    const backoffMinutes =
      code === "CONSUMO_INDEVIDO" ? 60 :
      code === "CERT_CNPJ_MISMATCH" ? 5 : // curto — pra dar tempo do usuário corrigir
      15;
    await setBackoff({ clientId: portalClientId, errorMsg: `[${code}] ${msg}`.slice(0, 500), minutes: backoffMinutes });
    return { ok: false, reason: code, message: msg, iterations, totalDocs };
  }
}
