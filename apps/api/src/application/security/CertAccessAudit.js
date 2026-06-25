// Q30 Fase 1 — trilha de auditoria de acesso aos certificados digitais (LGPD).
// BEST-EFFORT: uma falha de log NUNCA pode derrubar a operação fiscal (captura/transmissão).
import { prisma } from "../../infrastructure/db/prisma.js";

/**
 * Registra um acesso a certificado. Nunca lança.
 * @param {Object} o
 * @param {string|null} [o.portalClientId]  null = cert do escritório (SERPRO)
 * @param {"COMPANY_A1"|"OFFICE_SERPRO"} o.certKind
 * @param {"DECRYPT"|"UPLOAD"|"DELETE"} o.action
 * @param {string|null} [o.consumer]   quem acessou (CertResolver, SerproAuthService, upload, ...)
 * @param {string|null} [o.actorUserId] null nas automáticas (workers)
 * @param {string|null} [o.workerName]
 * @param {boolean} [o.success=true]
 * @param {string|null} [o.errorCode]
 */
export async function auditCertAccess({
  portalClientId = null, certKind, action,
  consumer = null, actorUserId = null, workerName = null,
  success = true, errorCode = null,
}) {
  try {
    await prisma.certAccessLog.create({
      data: { portalClientId, certKind, action, consumer, actorUserId, workerName, success, errorCode },
    });
  } catch {
    // best-effort — silencioso de propósito (não logar segredo, não quebrar a operação).
  }
}
