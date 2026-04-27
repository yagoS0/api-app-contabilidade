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

function summarizeProcurationResponse(response) {
  const parsedDados = parseJsonString(response?.dados);
  const procuracoes = Array.isArray(parsedDados) ? parsedDados : [];
  const firstProcuracao = procuracoes[0] || null;
  const explicitSystems = Array.isArray(firstProcuracao?.sistemas) ? firstProcuracao.sistemas : [];
  const explicitExpiry = parsePossibleDate(firstProcuracao?.dtexpiracao);

  if (procuracoes.length > 0) {
    return {
      status: "ATIVA",
      validUntil: explicitExpiry ? explicitExpiry.toISOString() : null,
      systems: explicitSystems.filter(Boolean),
      rawPayload: response,
    };
  }

  const expiresAt = parsePossibleDate(
    searchValueDeep(response, (key, value) => /expir|validade|vigencia.*fim|datafim/.test(String(key || "").toLowerCase()) && typeof value === "string")
  );
  const systems = searchValueDeep(response, (key, value) => /sistemas|servicos/.test(String(key || "").toLowerCase()) && Array.isArray(value));
  const activeFlag = searchValueDeep(response, (key, value) => /situacao|status|ativo/.test(String(key || "").toLowerCase()) && (typeof value === "string" || typeof value === "boolean"));
  const normalizedStatus = String(activeFlag || "").trim().toUpperCase();
  const isActive =
    activeFlag === true ||
    ["ATIVA", "ATIVO", "ACTIVE", "VIGENTE"].includes(normalizedStatus) ||
    Boolean(expiresAt && expiresAt.getTime() >= Date.now());

  return {
    status: isActive ? "ATIVA" : "AUSENTE",
    validUntil: expiresAt ? expiresAt.toISOString() : null,
    systems: Array.isArray(systems)
      ? systems
          .map((item) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object") return String(item.nome || item.idSistema || item.codigo || "").trim();
            return "";
          })
          .filter(Boolean)
      : [],
    rawPayload: response,
  };
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

    const runtime = await getResolvedSerproCredentials();
    const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
    if (!procuradorCnpj || procuradorCnpj.length !== 14) {
      const err = new Error("serpro_procurador_cnpj_not_configured");
      err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
      throw err;
    }

    const contribuinteCnpj = onlyDigits(company.cnpj);
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
