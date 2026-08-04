// Q12.A.3: resolve qual certificado usar para acessar um serviço externo
// (NFS-e/ADN, DFe/SEFAZ, eSocial, Integra-SN).
//
// Estratégia (Q12.A — só leitura da tabela Procuracao, sem trocar de cert ainda):
//   1) Procura Procuracao ATIVA e dentro da validade pra (portalClient, servico).
//      Se existir → indica que o ESCRITÓRIO atua via e-CAC com o cert do escritório.
//      (A resolução real do cert do escritório fica em Q12.B/.C, quando os clients DFe
//       e PgdasDeclarar passarem a usar este resolver.)
//   2) Senão → fallback pro cert A1 da empresa (Company.certPfxBytes) via CertStorage.
//
// Retorna SEMPRE { source, pfxBuffer?, password? } pra quem chamar montar o https.Agent.
// `source` indica de onde veio (procuração x cert empresa x nenhum) pra log/erro.

import { prisma } from "../../infrastructure/db/prisma.js";
import { readStoredCompanyPfx } from "../../infrastructure/storage/CertStorage.js";
import { auditCertAccess } from "../security/CertAccessAudit.js";
import { decryptSecret } from "../../utils/crypto.js";
// Mesmo inspetor que a rota de UPLOAD usa. Duas heurísticas para ler o CNPJ do certificado
// divergiriam, e aí o arquivo passaria numa porta e seria recusado na outra.
import { inspectPfx } from "../security/inspectPfx.js";
import { log } from "../../config.js";

export const SERVICOS = Object.freeze({
  NFSE: "NFSE",
  DFE: "DFE",
  ESOCIAL: "ESOCIAL",
  SN: "SN",
});

export class CertResolutionError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

async function findActiveProcuracao({ portalClientId, servico }) {
  const proc = await prisma.procuracao.findUnique({
    where: { portalClientId_servico: { portalClientId, servico } },
  });
  if (!proc || proc.status !== "ATIVA") return null;
  if (proc.validade && new Date(proc.validade) < new Date()) return null; // expirada
  return proc;
}

async function loadCompanyCert(portalClientId) {
  const portal = await prisma.portalClient.findUnique({
    where: { id: portalClientId },
    select: { companyId: true, cnpj: true },
  });
  if (!portal?.companyId) return null;

  const company = await prisma.company.findUnique({
    where: { id: portal.companyId },
    select: { certPfxBytes: true, certStorageKey: true, certPasswordEnc: true, certExpiresAt: true },
  });
  if (!company) return null;

  const pfxBuffer = await readStoredCompanyPfx(company);
  if (!pfxBuffer) return null;

  let password = null;
  if (company.certPasswordEnc) {
    try {
      password = await decryptSecret(company.certPasswordEnc);
    } catch (err) {
      throw new CertResolutionError("CERT_PASSWORD_DECRYPT_FAILED", "Falha ao descriptografar a senha do certificado", { cause: err });
    }
  }

  // ─── O certificado é MESMO desta empresa? ───────────────────────────────────────────────────
  //
  // Regra do dono: *"um A1 de outro CNPJ nunca deve ser usado em outra empresa"*. O upload já
  // recusa arquivo de CNPJ diferente (`inspectPfx` + `cert_cnpj_mismatch` na rota), mas essa
  // validação é RECENTE — todo certificado subido antes dela nunca passou por conferência nenhuma.
  //
  // Por isso a checagem também acontece na LEITURA, que é por onde todo consumidor passa (ADN,
  // SEFAZ, e o que vier depois). Uma guarda que mora só no upload protege o futuro e deixa o
  // passado como está; esta pega os dois.
  //
  // Mesma regra do upload (14 dígitos exatos), de propósito: duas definições de "o certificado é
  // desta empresa" acabariam divergindo, e aí o arquivo passaria numa porta e seria recusado na
  // outra.
  //
  // ⚠ Certificado cujo CNPJ não dá para ler (e-CPF, subject fora do padrão ICP-Brasil) NÃO é
  // bloqueado: ausência de dado não é prova de que o certificado é alheio, e recusar por falta de
  // informação derrubaria empresa legítima. Fica o aviso no log, e a guarda de ingestão do ADN
  // continua sendo o segundo cinto.
  const portalCnpj = String(portal.cnpj || "").replace(/\D+/g, "");
  if (portalCnpj) {
    let certCnpj = null;
    try {
      certCnpj = inspectPfx(pfxBuffer, password || "").cnpj;
    } catch (err) {
      log.warn({ portalClientId, code: err?.code }, "[CertResolver] não foi possível inspecionar o PFX da empresa");
    }
    if (certCnpj && certCnpj !== portalCnpj) {
      throw new CertResolutionError("CERT_CNPJ_MISMATCH",
        `O certificado cadastrado pertence ao CNPJ ${certCnpj}, mas esta empresa é ${portalCnpj}. `
        + "Um A1 de outro CNPJ não pode ser usado por esta empresa — suba o certificado correto em "
        + "Editar Cadastro → Certificado A1.",
        { portalClientId, certCnpj, portalCnpj });
    }
  }

  // Q30: trilha de auditoria (best-effort) — o PFX/senha da empresa foram descriptografados aqui.
  await auditCertAccess({ portalClientId, certKind: "COMPANY_A1", action: "DECRYPT", consumer: "CertResolver" });

  return {
    pfxBuffer,
    password,
    certExpiresAt: company.certExpiresAt || null,
  };
}

/**
 * Resolve qual cert usar pra acessar `servico` em nome de `portalClientId`.
 * NÃO retorna o cert do escritório AINDA (Q12.A é só foundation) — quando há
 * procuração ativa, devolve { source: "procuracao_escritorio", procuracaoId }
 * pra o caller decidir (na Q12.B/.C, o caller carrega o cert global do escritório).
 *
 * Throw CertResolutionError quando não há fallback viável.
 */
export async function resolveCertForCompany({ portalClientId, servico }) {
  if (!portalClientId) throw new CertResolutionError("PORTAL_CLIENT_REQUIRED", "portalClientId obrigatório");
  if (!Object.values(SERVICOS).includes(servico)) {
    throw new CertResolutionError("INVALID_SERVICO", `Serviço inválido: ${servico}. Esperado um de ${Object.values(SERVICOS).join("|")}`);
  }

  const proc = await findActiveProcuracao({ portalClientId, servico });
  if (proc) {
    // Q12.A: marca origem. Caller decide se carrega cert global (Q12.B+) ou cai pro fallback.
    return {
      source: "procuracao_escritorio",
      procuracaoId: proc.id,
      procuracaoValidade: proc.validade || null,
    };
  }

  const companyCert = await loadCompanyCert(portalClientId);
  if (!companyCert) {
    throw new CertResolutionError("NO_CERT_AVAILABLE",
      `Sem certificado pra empresa ${portalClientId} no serviço ${servico}. ` +
      `Cadastre uma procuração ativa OU faça upload do A1 da empresa.`,
      { portalClientId, servico });
  }

  return {
    source: "company_a1",
    pfxBuffer: companyCert.pfxBuffer,
    password: companyCert.password,
    certExpiresAt: companyCert.certExpiresAt,
  };
}

/**
 * Versão "soft" — não throwa, retorna { ok, source } pra UI/listagens.
 * Útil pra montar a aba de Procurações mostrando "ATIVA" / "FALTA CERT" por linha.
 */
export async function checkCertAvailability({ portalClientId, servico }) {
  try {
    const r = await resolveCertForCompany({ portalClientId, servico });
    return { ok: true, source: r.source };
  } catch (err) {
    return { ok: false, code: err.code || "UNKNOWN", message: err.message };
  }
}
