const REGIMES = new Set(["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL"]);
const SIMPLES_ANEXOS = new Set(["I", "II", "III", "IV", "V"]);
// Histórico aceita MEI também: é regime que a empresa já teve, não o que o portal opera hoje.
const REGIMES_HISTORICO = new Set(["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL", "MEI"]);

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function asString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeOptionalNotificationEmail(value) {
  const raw = asString(value).toLowerCase();
  // Bug pré-existente: retornava `null` aqui, e o chamador fazia `guideEmailResult.ok`
  // direto → TypeError (500) ao cadastrar/editar empresa sem e-mail de notificação.
  // O campo é OPCIONAL: vazio agora vira {ok:true, data:null}, como o nome promete.
  if (!raw) return { ok: true, data: null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { ok: false, error: "company_guide_notification_email_invalid" };
  }
  return { ok: true, data: raw };
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

function asNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Sócios da ficha. Só `name` é obrigatório — o escritório às vezes cadastra o sócio antes
 * de ter RG/nascimento em mãos. Sócio que saiu NÃO é apagado: fica com `dataSaida`.
 */
function normalizeSocios(raw) {
  if (!Array.isArray(raw)) return { ok: true, data: null }; // ausente = não mexer
  const out = [];
  for (const item of raw) {
    const socio = item && typeof item === "object" ? item : {};
    const name = asString(socio.name || socio.nome);
    if (!name) continue; // linha vazia do form: ignora em vez de estourar
    const participacao = asNumberOrNull(socio.participacao ?? socio.percentual);
    if (participacao !== null && (participacao < 0 || participacao > 100)) {
      return { ok: false, error: "company_socio_participacao_invalid" };
    }
    const dataNascimento = parseIsoDateOrNull(socio.dataNascimento);
    if (socio.dataNascimento && !dataNascimento) {
      return { ok: false, error: "company_socio_data_nascimento_invalid" };
    }
    const dataSaida = parseIsoDateOrNull(socio.dataSaida);
    if (socio.dataSaida && !dataSaida) {
      return { ok: false, error: "company_socio_data_saida_invalid" };
    }
    out.push({
      name,
      documento: onlyDigits(socio.documento || socio.cpf) || null,
      participacao,
      rg: asString(socio.rg) || null,
      rgOrgaoEmissor: asString(socio.rgOrgaoEmissor) || null,
      dataNascimento,
      dataSaida,
      representante: socio.representante === true,
      email: asString(socio.email).toLowerCase() || null,
      phone: asString(socio.phone || socio.telefone) || null,
    });
  }
  return { ok: true, data: out };
}

/**
 * Histórico de regime com vigência. INFORMATIVO: nada aqui alimenta apuração/captura —
 * elas seguem usando Company.regimeTributario (o regime atual).
 */
function normalizeRegimeHistorico(raw) {
  if (!Array.isArray(raw)) return { ok: true, data: null }; // ausente = não mexer
  const out = [];
  for (const item of raw) {
    const linha = item && typeof item === "object" ? item : {};
    const regime = normalizeRegimeTributario(linha.regime);
    if (!regime) continue;
    if (!REGIMES_HISTORICO.has(regime)) {
      return { ok: false, error: "company_regime_historico_invalid" };
    }
    const vigenciaInicio = parseIsoDateOrNull(linha.vigenciaInicio);
    if (!vigenciaInicio) return { ok: false, error: "company_regime_historico_vigencia_inicio_required" };
    const vigenciaFim = parseIsoDateOrNull(linha.vigenciaFim);
    if (linha.vigenciaFim && !vigenciaFim) {
      return { ok: false, error: "company_regime_historico_vigencia_fim_invalid" };
    }
    if (vigenciaFim && vigenciaFim < vigenciaInicio) {
      return { ok: false, error: "company_regime_historico_vigencia_invertida" };
    }
    out.push({
      regime,
      vigenciaInicio,
      vigenciaFim,
      impostos: Array.isArray(linha.impostos)
        ? [...new Set(linha.impostos.map((x) => asString(x).toUpperCase()).filter(Boolean))]
        : [],
      desoneracao: linha.desoneracao === true,
      observacao: asString(linha.observacao) || null,
    });
  }
  out.sort((a, b) => a.vigenciaInicio - b.vigenciaInicio);
  return { ok: true, data: out };
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

  const guideEmailResult = normalizeOptionalNotificationEmail(company.guideNotificationEmail);
  if (!guideEmailResult.ok) return guideEmailResult;

  const sociosResult = normalizeSocios(company.socios);
  if (!sociosResult.ok) return sociosResult;

  const historicoResult = normalizeRegimeHistorico(company.regimeHistorico);
  if (!historicoResult.ok) return historicoResult;

  // Datas da ficha: se veio algo e não parseou, é erro do usuário — não engolir.
  const dataAbertura = parseIsoDateOrNull(company.dataAbertura);
  if (company.dataAbertura && !dataAbertura) return { ok: false, error: "company_data_abertura_invalid" };
  const inscricaoMunicipalData = parseIsoDateOrNull(company.inscricaoMunicipalData);
  if (company.inscricaoMunicipalData && !inscricaoMunicipalData) {
    return { ok: false, error: "company_inscricao_municipal_data_invalid" };
  }
  const inscricaoEstadualData = parseIsoDateOrNull(company.inscricaoEstadualData);
  if (company.inscricaoEstadualData && !inscricaoEstadualData) {
    return { ok: false, error: "company_inscricao_estadual_data_invalid" };
  }
  const alteracaoData = parseIsoDateOrNull(company.alteracaoData);
  if (company.alteracaoData && !alteracaoData) return { ok: false, error: "company_alteracao_data_invalid" };

  const capitalSocial = asNumberOrNull(company.capitalSocial);
  if (capitalSocial !== null && capitalSocial < 0) return { ok: false, error: "company_capital_social_invalid" };

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
      guideNotificationEmail: guideEmailResult.data,
      telefone: asString(company.telefone) || null,
      // ── Ficha de cadastro ──
      inscricaoMunicipal: asString(company.inscricaoMunicipal) || null,
      inscricaoMunicipalData,
      inscricaoEstadual: asString(company.inscricaoEstadual) || null,
      inscricaoEstadualData,
      porte: asString(company.porte) || null,
      naturezaJuridica: asString(company.naturezaJuridica) || null,
      capitalSocial,
      dataAbertura,
      abriuCom: asString(company.abriuCom) || null,
      numeroRegistro: asString(company.numeroRegistro) || null,
      tipoRegistro: asString(company.tipoRegistro) || null,
      diarioNumero: asString(company.diarioNumero) || null,
      desoneracao: company.desoneracao === true,
      alteracaoNumero: asString(company.alteracaoNumero) || null,
      alteracaoData,
      // null = não veio no payload (não mexer); array = substituir
      socios: sociosResult.data,
      regimeHistorico: historicoResult.data,
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

