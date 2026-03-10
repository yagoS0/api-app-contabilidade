const REGIMES = new Set(["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL"]);
const SIMPLES_ANEXOS = new Set(["I", "II", "III", "IV", "V"]);

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function asString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function parseIsoDateOrNull(value) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function normalizeRegimeTributario(value) {
  const raw = asString(value).toUpperCase().replace(/\s+/g, "_");
  const aliases = new Map([
    ["PRESUMIDO", "LUCRO_PRESUMIDO"],
    ["LUCRO_PRESUMIDO", "LUCRO_PRESUMIDO"],
    ["LUCRO-REAL", "LUCRO_REAL"],
    ["LUCRO_REAL", "LUCRO_REAL"],
    ["SIMPLES", "SIMPLES"],
  ]);
  return aliases.get(raw) || raw;
}

function normalizeEndereco(raw) {
  const endereco = raw && typeof raw === "object" ? raw : {};
  const normalized = {
    rua: asString(endereco.rua),
    numero: asString(endereco.numero),
    complemento: asString(endereco.complemento) || null,
    bairro: asString(endereco.bairro),
    cidade: asString(endereco.cidade),
    uf: asString(endereco.uf).toUpperCase(),
    cep: onlyDigits(endereco.cep),
  };

  const missing = [];
  if (!normalized.rua) missing.push("endereco.rua");
  if (!normalized.numero) missing.push("endereco.numero");
  if (!normalized.bairro) missing.push("endereco.bairro");
  if (!normalized.cidade) missing.push("endereco.cidade");
  if (!normalized.uf) missing.push("endereco.uf");
  if (!normalized.cep) missing.push("endereco.cep");
  if (missing.length) {
    return { ok: false, error: "company_endereco_required_fields_missing", details: missing };
  }
  if (normalized.uf.length !== 2) {
    return { ok: false, error: "company_endereco_uf_invalid" };
  }
  return { ok: true, data: normalized };
}

export function validateAndNormalizeCompanyProfile(input) {
  const company = input && typeof input === "object" ? input : {};
  const cnpj = onlyDigits(company.cnpj);
  const razaoSocial = asString(company.razaoSocial || company.razao);
  const nomeFantasia = asString(company.nomeFantasia) || null;
  const regimeTributario = normalizeRegimeTributario(company.regimeTributario);
  const cnaePrincipal = asString(company.cnaePrincipal);
  const cnaesSecundarios = Array.isArray(company.cnaesSecundarios)
    ? [...new Set(company.cnaesSecundarios.map((x) => asString(x)).filter(Boolean))]
    : [];

  if (!cnpj || cnpj.length !== 14) return { ok: false, error: "company_cnpj_invalid" };
  if (!razaoSocial) return { ok: false, error: "company_razao_social_required" };
  if (!REGIMES.has(regimeTributario)) {
    return { ok: false, error: "company_regime_tributario_invalid" };
  }
  if (!cnaePrincipal) return { ok: false, error: "company_cnae_principal_required" };

  const enderecoResult = normalizeEndereco(company.endereco);
  if (!enderecoResult.ok) return enderecoResult;

  let simples = null;
  if (regimeTributario === "SIMPLES") {
    const anexo = asString(company?.simples?.anexo).toUpperCase() || null;
    if (anexo && !SIMPLES_ANEXOS.has(anexo)) {
      return { ok: false, error: "company_simples_anexo_required_or_invalid" };
    }
    const dataOpcao = parseIsoDateOrNull(company?.simples?.dataOpcao);
    if (company?.simples?.dataOpcao && !dataOpcao) {
      return { ok: false, error: "company_simples_data_opcao_invalid" };
    }
    simples = { anexo, dataOpcao };
  } else if (company?.simples?.anexo) {
    return { ok: false, error: "company_simples_not_allowed_for_regime" };
  }

  return {
    ok: true,
    data: {
      cnpj,
      razaoSocial,
      nomeFantasia,
      regimeTributario,
      simples,
      cnaePrincipal,
      cnaesSecundarios,
      endereco: enderecoResult.data,
      email: asString(company.email).toLowerCase() || null,
      telefone: asString(company.telefone) || null,
    },
  };
}

export function enderecoToSingleLine(endereco) {
  if (!endereco) return null;
  const parts = [
    endereco.rua,
    endereco.numero,
    endereco.complemento,
    endereco.bairro,
    `${endereco.cidade}-${endereco.uf}`,
    `CEP ${endereco.cep}`,
  ].filter(Boolean);
  return parts.join(", ");
}

