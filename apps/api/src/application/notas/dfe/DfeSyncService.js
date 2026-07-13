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
import { resolveCertForCompany, SERVICOS } from "../CertResolver.js";
import { readStoredCompanyPfx } from "../../../infrastructure/storage/CertStorage.js";
import { decryptSecret, decryptBytes } from "../../../utils/crypto.js";
import { resolveCertificatePath } from "../../../infrastructure/storage/CertStorage.js";
import { getResolvedSerproCredentials } from "../../fiscal/serpro/SerproRuntimeSettings.js";
import fs from "node:fs";
import { fetchDistNSU, DfeClientError } from "./DfeClient.js";
import { parseDistDFeResponse, parseDocZip } from "./DfeParser.js";
import { ESTADOS } from "../CompetenciaStateMachine.js";

const MAX_ITERATIONS = 10;
const BACKOFF_MINUTES_ON_ERROR = 15;

export class DfeSyncError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Carrega o cert do escritório (mesmo usado pelo SERPRO via aba Configurações).
 * Reusa SerproRuntimeSettings.getResolvedSerproCredentials — não duplica config.
 *
 * Pré-requisito operacional: a empresa precisa ter PROCURAÇÃO e-CAC outorgando
 * NFe/DFe ao CNPJ do escritório (registrada presencialmente no e-CAC).
 * A SEFAZ valida o vínculo "procurador (cert) → outorgante (CNPJ no <CNPJ> do SOAP)".
 */
async function loadOfficeCert() {
  const creds = await getResolvedSerproCredentials().catch((err) => {
    throw new DfeSyncError("OFFICE_CERT_NOT_CONFIGURED",
      `Cert do escritório não está configurado em Configurações da Firma → SERPRO. (${err?.message || err})`);
  });

  if (!creds?.certificate?.hasCertificate || !creds?.certificate?.storageKey) {
    throw new DfeSyncError("OFFICE_CERT_NOT_CONFIGURED",
      "Cert do escritório não está configurado em Configurações da Firma → SERPRO.");
  }
  if (!creds.certificate.passwordConfigured) {
    throw new DfeSyncError("OFFICE_CERT_PASSWORD_MISSING",
      "Senha do cert do escritório não está configurada.");
  }

  // Caso 1: PFX salvo direto no banco (base64). Q30/Q35: decryptBytes decifra (local ou KMS; no-op se legado).
  if (creds.certificate.pfxBase64) {
    return {
      pfxBuffer: await decryptBytes(Buffer.from(creds.certificate.pfxBase64, "base64")),
      password: creds.certificate.password,
    };
  }

  // Caso 2: PFX salvo em disco (storageKey)
  const certPath = resolveCertificatePath(creds.certificate.storageKey);
  if (!certPath || !fs.existsSync(certPath)) {
    throw new DfeSyncError("OFFICE_CERT_FILE_NOT_FOUND",
      `Arquivo do cert do escritório não encontrado em ${certPath || "(path nulo)"}.`);
  }
  return { pfxBuffer: await decryptBytes(fs.readFileSync(certPath)), password: creds.certificate.password };
}

/**
 * Q12.B+++ FIX: SEFAZ exige que o CNPJ-base do cert apresentado bata com o
 * CNPJ consultado (cStat 593 rejeita). Cert do escritório NUNCA vai funcionar
 * pra empresa cliente (CNPJs-base diferentes). Por isso:
 *
 *   1) A1 da própria empresa (regra SEFAZ — preferido)
 *   2) Cert escritório (fallback útil SÓ se empresa for o próprio escritório)
 *   3) Erro NO_COMPANY_CERT com instrução clara
 */
async function resolveCertWithFallback(portalClientId) {
  // 1) A1 da empresa — único caminho válido pra SEFAZ DFe na maioria dos casos
  const r = await resolveCertForCompany({ portalClientId, servico: SERVICOS.DFE })
    .catch(() => ({ source: "none" }));
  if (r.source === "company_a1") {
    return { pfxBuffer: r.pfxBuffer, password: r.password, via: "company_a1" };
  }

  // 2) Fallback escritório (só vai funcionar se o escritório for a própria empresa)
  try {
    const office = await loadOfficeCert();
    return { pfxBuffer: office.pfxBuffer, password: office.password, via: "office_cert_fallback" };
  } catch {
    throw new DfeSyncError("NO_COMPANY_CERT",
      "Esta empresa não tem certificado A1 cadastrado. Vá em Editar Cadastro → 🔐 Certificado A1 e faça upload do PFX da empresa (a SEFAZ exige cert do próprio CNPJ — cert do escritório não funciona).");
  }
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

/**
 * Decide se a competência da nota está FECHADA. Se sim, não atualiza base —
 * cria PendenciaPosFechamento e marca a nota com competenciaPosFechamento=true.
 */
async function isCompetenciaFechada(tx, { portalClientId, competenciaDate }) {
  if (!competenciaDate) return false;
  const d = new Date(competenciaDate);
  const comp = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const row = await tx.companyMonthlyCircular.findFirst({
    where: { portalClientId, competencia: comp },
    select: { estado: true },
  });
  if (!row) return false;
  return [ESTADOS.FECHADO, ESTADOS.CALCULADO, ESTADOS.REVISADO, ESTADOS.TRANSMITIDO, ESTADOS.CONFIRMADO].includes(row.estado);
}

async function upsertNotaFromParsed(tx, { portalClientId, parsed, items }) {
  if (!parsed.chaveAcesso) return { skipped: true, reason: "no_chave" };

  // Confere competência fechada
  const fechada = await isCompetenciaFechada(tx, {
    portalClientId, competenciaDate: parsed.competencia,
  });

  // Preserva o cancelamento: o cancelamento de NF-e chega num EVENTO separado (applyEvent grava
  // statusEfetivo="cancelada"). O resumo/nota da NF-e traz statusEfetivo hardcoded "autorizada";
  // sem isso, uma re-captura da nota reverteria o cancelamento.
  const wKey = { clientId_chaveAcesso: { clientId: portalClientId, chaveAcesso: parsed.chaveAcesso } };
  const existente = await tx.portalInvoice.findUnique({ where: wKey, select: { statusEfetivo: true } }).catch(() => null);
  const statusEfetivo = existente?.statusEfetivo === "cancelada" ? "cancelada" : (parsed.statusEfetivo || null);

  const dataToWrite = {
    type: parsed.type,
    numero: parsed.numero || null,
    serie: parsed.serie || null,
    chaveAcesso: parsed.chaveAcesso,
    competencia: parsed.competencia,
    issueDate: parsed.issueDate,
    status: parsed.status,
    total: parsed.total,
    emitenteNome: parsed.emitenteNome || null,
    emitenteDoc: parsed.emitenteDoc || null,
    tomadorNome: parsed.tomadorNome || null,
    tomadorDoc: parsed.tomadorDoc || null,
    xmlRaw: parsed.xmlRaw || null,
    papel: parsed.papel || null,
    statusEfetivo,
    competenciaPosFechamento: fechada,
  };

  if (fechada) {
    // Não atualiza base — cria a nota mas só registra a pendência.
    const created = await tx.portalInvoice.upsert({
      where: wKey,
      create: { clientId: portalClientId, ...dataToWrite },
      update: { competenciaPosFechamento: true, statusEfetivo },
    });
    const comp = `${new Date(parsed.competencia).getUTCFullYear()}-${String(new Date(parsed.competencia).getUTCMonth() + 1).padStart(2, "0")}`;
    await tx.pendenciaPosFechamento.create({
      data: {
        portalClientId, competencia: comp,
        notaId: created.id, motivo: "nota_retroativa",
        observacoes: `Nota ${parsed.chaveAcesso} chegou para ${comp} (competência já fechada).`,
      },
    }).catch(() => null); // pode duplicar se rodar 2x; ignorar é OK
    return { created: created.id, status: "pendencia_criada" };
  }

  const nota = await tx.portalInvoice.upsert({
    where: wKey,
    create: { clientId: portalClientId, ...dataToWrite },
    update: dataToWrite,
  });

  // Substitui itens (full overwrite): mais simples + idempotente. Volume é pequeno.
  if (items && items.length > 0) {
    await tx.notaItem.deleteMany({ where: { notaId: nota.id } });
    await tx.notaItem.createMany({
      data: items.map((it) => ({
        notaId: nota.id,
        codigoServico: it.codigoServico || null,
        ncm: it.ncm || null,
        cfop: it.cfop || null,
        descricao: it.descricao || null,
        valor: it.valor || 0,
        flagST: it.flagST || false,
        flagMonofasico: it.flagMonofasico || false,
        flagExportacao: it.flagExportacao || false,
      })),
    });
  }
  return { created: nota.id, status: "upserted" };
}

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
          hint = " (outra aplicação consultando o mesmo CNPJ — aguarde 1h)";
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
            const r = await upsertNotaFromParsed(tx, {
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
