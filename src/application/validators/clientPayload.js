import { onlyDigits, toNullableString, toBoolean } from "../../utils/normalizers.js";

const REQUIRED_CLIENT_FIELDS = ["name", "email", "password"];
const REQUIRED_COMPANY_FIELDS = [
  "razaoSocial",
  "cnpj",
  "inscricaoMunicipal",
  "codigoServicoNacional",
  "codigoServicoMunicipal",
  "rpsSerie",
];

export function validateClientPayload(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "payload_invalido" };
  }
  const { client, company } = body;
  if (!client || typeof client !== "object") {
    return { ok: false, error: "cliente_obrigatorio" };
  }
  if (!company || typeof company !== "object") {
    return { ok: false, error: "empresa_obrigatoria" };
  }

  for (const field of REQUIRED_CLIENT_FIELDS) {
    if (!hasValue(client[field])) {
      return { ok: false, error: `cliente.${field}_obrigatorio` };
    }
  }
  for (const field of REQUIRED_COMPANY_FIELDS) {
    if (!hasValue(company[field])) {
      return { ok: false, error: `empresa.${field}_obrigatorio` };
    }
  }

  const normalizedClient = {
    name: String(client.name).trim(),
    email: String(client.email).trim().toLowerCase(),
    login: String(client.email || client.login || client.username || client.user)
      .trim()
      .toLowerCase(),
    password: String(client.password || "").trim(),
    phone: toNullableString(client.phone),
    cpf: normalizeCpf(client.cpf),
  };

  if (!normalizedClient.password || normalizedClient.password.length < 8) {
    return { ok: false, error: "cliente.senha_fraca" };
  }

  const normalizedCompany = {
    razaoSocial: String(company.razaoSocial).trim(),
    cnpj: normalizeCnpj(company.cnpj),
    inscricaoMunicipal: toNullableString(company.inscricaoMunicipal),
    codigoServicoNacional: toNullableString(company.codigoServicoNacional),
    codigoServicoMunicipal: toNullableString(company.codigoServicoMunicipal),
    rpsSerie: toNullableString(company.rpsSerie),
    rpsNumero: toNullableString(company.rpsNumero),
    nomeFantasia: toNullableString(company.nomeFantasia),
    atividades: normalizeAtividades(company.atividades),
    porte: toNullableString(company.porte),
    tipoTributario: toNullableString(company.tipoTributario),
    anexoSimples: toNullableString(company.anexoSimples),
    endereco: toNullableString(company.endereco),
    email: toNullableString(company.email),
    telefone: toNullableString(company.telefone),
    capitalSocial: normalizeNumber(company.capitalSocial),
    dataAbertura: normalizeDate(company.dataAbertura),
    quantidadeSocios: normalizeInteger(company.quantidadeSocios),
    partners: normalizePartners(company.socios || company.partners),
  };

  if (!normalizedCompany.quantidadeSocios && normalizedCompany.partners.length) {
    normalizedCompany.quantidadeSocios = normalizedCompany.partners.length;
  }

  return {
    ok: true,
    data: {
      client: normalizedClient,
      company: normalizedCompany,
    },
  };
}

function hasValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

function normalizeCpf(cpf) {
  const digits = onlyDigits(cpf);
  return digits ? digits.padStart(11, "0") : null;
}

function normalizeCnpj(cnpj) {
  const digits = onlyDigits(cnpj);
  return digits ? digits.padStart(14, "0") : null;
}

function normalizeAtividades(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }
      if (item && typeof item === "object") {
        const code = toNullableString(item.codigo || item.code);
        const text = toNullableString(item.descricao || item.description || item.texto || item.text);
        if (code && text) return `${code} - ${text}`;
        return code || text || null;
      }
      return null;
    })
    .filter((item) => item && item.length > 0);
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = parseInt(value, 10);
  return Number.isFinite(num) ? num : null;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePartners(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((partner) => {
      if (!partner || typeof partner !== "object") return null;
      if (!hasValue(partner.nome || partner.name)) return null;
      const name = String(partner.nome || partner.name).trim();
      return {
        name,
        phone: toNullableString(partner.telefone || partner.phone),
        email: toNullableString(partner.email)?.toLowerCase() || null,
        participacao:
          partner.participacao === undefined ? null : normalizeNumber(partner.participacao),
        documento: toNullableString(partner.documento),
        representante: toBoolean(partner.representante),
      };
    })
    .filter(Boolean);
}

