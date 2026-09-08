import { prisma } from "../../../infrastructure/db/prisma.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproHttpClient } from "./SerproHttpClient.js";

const PROCURATION_PREFIX = "serpro_procuration_status:";

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function searchValueDeep(input, matcher) {
  if (input == null) return null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = searchValueDeep(item, matcher);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof input !== "object") return null;

  for (const [key, value] of Object.entries(input)) {
    if (matcher(key, value)) return value;
    const found = searchValueDeep(value, matcher);
    if (found != null) return found;
  }
  return null;
}

function parsePossibleDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{8}$/.test(raw)) {
    const iso = `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
    const date = new Date(`${iso}T23:59:59.999-03:00`);
    return Number.isNaN(date.getTime()) || new Date(`${iso}T00:00:00Z`).toISOString().slice(0,10) !== iso ? null : date;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return new Date(raw);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return new Date(`${br[3]}-${br[2]}-${br[1]}T00:00:00.000Z`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseJsonString(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function keyForPortalClient(portalClientId) {
  return `${PROCURATION_PREFIX}${String(portalClientId)}`;
}

// Contrato oficial OBTERPROCURACAO41: dados é array de {dtexpiracao: aaaammdd, nrsistemas, sistemas}.
// https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/solucoes/integra-procuracoes/procuracoes/servicos/obter_procuracao/
export function summarizeProcurationResponse(response) {
  const negado = (v) => v === false || ["REVOGADA", "REVOGADO", "INATIVA", "INATIVO", "CANCELADA", "CANCELADO", "AUSENTE", "EXPIRADA"].includes(String(v).toUpperCase());
  const positivo = (v) => v === true || ["ATIVA", "ATIVO", "ACTIVE", "VIGENTE"].includes(String(v).toUpperCase());
  const statusDe = (p) => p?.situacao ?? p?.ativo ?? (typeof p?.status === "string" || typeof p?.status === "boolean" ? p.status : undefined);
  const base = { status: "AUSENTE", validUntil: null, systems: [], rawPayload: response };
  if (negado(statusDe(response)) || (typeof response?.status === "number" && response.status !== 200)) return base;
  const parsed = typeof response?.dados === "string" ? parseJsonString(response.dados) : response?.dados;
  if (Array.isArray(parsed)) {
    const validas = parsed.filter((p) => {
      const expira = parsePossibleDate(p?.dtexpiracao);
      return !negado(statusDe(p)) && (statusDe(p) === undefined || positivo(statusDe(p))) && expira && expira.getTime() > Date.now() && Array.isArray(p.sistemas) && p.sistemas.every((v) => typeof v === "string");
    });
    if (!validas.length) return base;
    return { ...base, status: "ATIVA", validUntil: new Date(Math.min(...validas.map((p) => parsePossibleDate(p.dtexpiracao).getTime()))).toISOString(), systems: [...new Set(validas.flatMap((p) => p.sistemas))] };
  }
  // Formato não canônico só autoriza mediante status explícito; validade isolada nunca autoriza.
  const alvo = parsed && typeof parsed === "object" ? parsed : response;
  const ativo = statusDe(alvo);
  const expira = parsePossibleDate(alvo?.validUntil || alvo?.validade || alvo?.dtexpiracao);
  if (!positivo(ativo) || !expira || expira.getTime() <= Date.now()) return base;
  return { ...base, status: "ATIVA", validUntil: expira.toISOString(), systems: Array.isArray(alvo.sistemas) ? alvo.sistemas.filter((s) => typeof s === "string") : [] };
}

export async function getStoredProcurationStatus(portalClientId) {
  const setting = await prisma.appSetting.findUnique({ where: { key: keyForPortalClient(portalClientId) } });
  const value = setting?.value && typeof setting.value === "object" ? setting.value : {};
  return {
    companyId: String(portalClientId),
    status: value.status || "DESCONHECIDA",
    validUntil: value.validUntil || null,
    systems: Array.isArray(value.systems) ? value.systems : [],
    checkedAt: value.checkedAt || null,
    payload: value.payload || null,
  };
}

export class SerproProcurationService {
  constructor(options = {}) {
    this.client = options.client || new SerproHttpClient();
  }

  async checkCnpjProcuration({ cnpj, contratanteCnpj }) {
    const runtime = await getResolvedSerproCredentials();
    const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
    if (!procuradorCnpj || procuradorCnpj.length !== 14) {
      const err = new Error("serpro_procurador_cnpj_not_configured");
      err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
      throw err;
    }

    const contribuinteCnpj = onlyDigits(cnpj);
    if (contribuinteCnpj.length !== 14) throw Object.assign(new Error("CNPJ inválido"), { code: "CNPJ_INVALIDO" });
    const payload = {
      contratante: { numero: procuradorCnpj, tipo: 2 },
      autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
      contribuinte: { numero: contribuinteCnpj, tipo: 2 },
      pedidoDados: {
        idSistema: "PROCURACOES",
        idServico: "OBTERPROCURACAO41",
        versaoSistema: "1.0",
        dados: JSON.stringify({
          outorgante: contribuinteCnpj,
          tipoOutorgante: "2",
          outorgado: procuradorCnpj,
          tipoOutorgado: "2",
        }),
      },
    };

    const response = await this.client.post("/Consultar", payload);
    const summary = summarizeProcurationResponse(response);
    const checkedAt = new Date().toISOString();

    return { ...summary, procuradorCnpj, cnpj: contribuinteCnpj, checkedAt };
  }

  async checkCompanyProcuration({ portalClientId, contratanteCnpj }) {
    const company = await prisma.portalClient.findUnique({
      where: { id: String(portalClientId) },
      select: { id: true, cnpj: true, razao: true },
    });
    if (!company) {
      const err = new Error("portal_company_not_found");
      err.code = "PORTAL_COMPANY_NOT_FOUND";
      throw err;
    }

    const summary = await this.checkCnpjProcuration({ cnpj: company.cnpj, contratanteCnpj });
    const { procuradorCnpj, checkedAt } = summary;

    await prisma.appSetting.upsert({
      where: { key: keyForPortalClient(company.id) },
      create: {
        key: keyForPortalClient(company.id),
        value: {
          status: summary.status,
          validUntil: summary.validUntil,
          systems: summary.systems,
          checkedAt,
          payload: summary.rawPayload,
        },
      },
      update: {
        value: {
          status: summary.status,
          validUntil: summary.validUntil,
          systems: summary.systems,
          checkedAt,
          payload: summary.rawPayload,
        },
      },
    });

    return {
      company: {
        id: company.id,
        razao: company.razao,
        cnpj: company.cnpj,
      },
      procuradorCnpj,
      status: summary.status,
      validUntil: summary.validUntil,
      systems: summary.systems,
      checkedAt,
    };
  }
}
