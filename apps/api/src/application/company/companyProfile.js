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

// `pTotTribFed` → `p_tot_trib_fed`, para que o código de erro tenha o mesmo formato dos demais
// (`company_rps_serie_invalid`) e o contador leia o nome do campo que ele preencheu.
function snakeCasePercentual(campo) {
  return campo.replace(/([A-Z])/g, "_$1").toLowerCase();
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

/**
 * OS CAMPOS DA EMISSÃO DE NFS-e — a normalização, num lugar só.
 *
 * ⚠ POR QUE ISTO É UMA FUNÇÃO (19/08/2026). Este bloco vivia INLINE dentro de
 * `validateAndNormalizeCompanyProfile`, e passou a ter DOIS chamadores: o `PATCH` do cadastro da
 * empresa (que continua exigindo a empresa inteira e recusando payload parcial com 400) e a rota
 * nova `PATCH /firm/companies/:id/emissao-nfse`, que salva SÓ estes campos a partir da aba própria
 * de emissão. A extração é pura: mesmas recusas, mesmos códigos de erro, mesma ordem — se as duas
 * portas normalizassem por conta própria, o mesmo valor seria aceito por uma e recusado pela outra.
 *
 * ⚠ `undefined` VIAJA. `codigosServicoNacional` e os três percentuais saem `undefined` quando o
 * payload não os trouxe ("não mexer") e `null`/`[]` quando o contador apagou ("apagar"). Quem grava
 * usa `!== undefined` para manter as duas intenções distintas até a última linha.
 */
export function normalizeCamposEmissaoNfse(company = {}) {
  // ── OS TRÊS CAMPOS QUE FALTAVAM PARA A EMISSÃO — e por que a FORMA é tudo o que se valida ──
  //
  // `buildMissingFields` (`application/nfse/NfseService.js`) recusa a emissão quando faltar
  // `cnpj`, `inscricaoMunicipal`, `codigoServicoNacional`, `codigoServicoMunicipal` ou `rpsSerie`.
  // Os três últimos existiam no model e na API e **não tinham campo em tela nenhuma**: a emissão
  // recusava por eles e não havia por onde preenchê-los. Estes normalizadores são a porta.
  //
  // ⚠ VALIDA-SE FORMA, NUNCA CONTEÚDO. A lista de serviços da LC 116 e a lista de códigos do
  // município **não estão neste repositório**, e escrevê-las de memória é o que a regra 1 proíbe.
  // Então: nenhum de-para, nenhuma sugestão, nenhum default. O que o contador digitar é o que fica.

  // `cTribNac` — 6 dígitos numéricos.
  // Fonte, dentro do projeto: `docs/nfse-preenchimento.md` §5 ("cTribNac: código nacional (6
  // dígitos numéricos). Ex.: 171201"), §11 e o exemplo §12 da única emissão que voltou `issued`.
  //
  // ⚠ A PARTIR DE 16/08/2026 ESTA COLUNA DEIXOU DE SER O CADASTRO. Quem guarda os serviços que a
  // empresa presta é `codigosServicoNacional` (a LISTA, logo abaixo); esta continua sendo **o
  // código que a DPS leva** — uma nota declara UM serviço, e é ela que `buildMissingFields` exige e
  // que `buildDpsXml` escreve no XML. As duas colunas existem porque respondem a perguntas
  // diferentes ("o que a empresa pode emitir" × "o que ESTA nota declara").
  const codigoServicoNacionalBruto = asString(company.codigoServicoNacional);
  const codigoServicoNacional = onlyDigits(codigoServicoNacionalBruto);
  if (codigoServicoNacionalBruto && codigoServicoNacional.length !== 6) {
    return { ok: false, error: "company_codigo_servico_nacional_invalid" };
  }

  // ── A LISTA DE CÓDIGOS DE SERVIÇO — decisão do dono, 16/08/2026 ────────────────────────────
  //
  // > *"ao cadastrar podemos ter mais de um código, a empresa pode usar mais de uma atividade e na
  // > hora da emissão ela deve escolher (…) existe uma lista da LC116 com texto vs o código,
  // > devemos mostrar o texto para que facilite a escolha."*
  //
  // ⚠ AGORA HÁ LISTA OFICIAL NO PROJETO, e é isso que autoriza a mudança de campo digitado para
  // ESCOLHA. O Anexo B do portal `gov.br/nfse` está versionado em `docs/lista-servico-nacional/`
  // com URL, data, contagem e SHA-256; o front escolhe dentro dele
  // (`apps/web/src/lib/servicosNacionais/`). Continua NÃO havendo de-para CNAE → serviço, nem
  // sugestão, nem default.
  //
  // ⚠ AQUI SE VALIDA A FORMA, não a pertinência: o backend não carrega a lista de 335 códigos.
  // Conferir o conteúdo nos dois lados exigiria a tabela duplicada em JS de servidor, livre para
  // divergir da do front na primeira atualização do Anexo B — e a divergência apareceria como
  // "salvei e o servidor recusou um código que a tela ofereceu".
  //
  // ⚠ `undefined` = o campo não veio no payload ⇒ NÃO MEXER. Array vazio = "apague a lista", que é
  // uma intenção legítima e diferente. Confundir as duas apagaria o cadastro de toda tela que
  // salvasse a empresa sem enviar este campo — que é o que a aba de certificado, por exemplo, faz.
  let codigosServicoNacional;
  if (company.codigosServicoNacional !== undefined) {
    const entrada = Array.isArray(company.codigosServicoNacional)
      ? company.codigosServicoNacional
      : company.codigosServicoNacional == null
        ? []
        : [company.codigosServicoNacional];
    codigosServicoNacional = [];
    for (const item of entrada) {
      const bruto = asString(item);
      if (!bruto) continue;
      const digitos = onlyDigits(bruto);
      if (digitos.length !== 6) {
        return { ok: false, error: "company_codigo_servico_nacional_invalid" };
      }
      // Deduplica preservando a ORDEM em que o contador escolheu — ela é a ordem da tela.
      if (!codigosServicoNacional.includes(digitos)) codigosServicoNacional.push(digitos);
    }
  }

  // `cTribMun` — SÓ DÍGITOS, e **sem exigência de comprimento**.
  //
  // ⚠ O que a fonte prova e o que ela NÃO prova. `docs/nfse-preenchimento.md` §5 diz "cTribMun:
  // código municipal (últimos 3 dígitos). Ex.: 001" — isso descreve o que vai no XML (e
  // `buildDpsXml` faz literalmente `.replace(/\D+/g,"").slice(-3)`), não o comprimento do código
  // que a prefeitura publica. Exigir exatamente 3 aqui seria inventar uma máscara e recusaria um
  // código municipal legítimo mais longo. A tela mostra ao contador quais 3 dígitos irão para a
  // DPS, para que o corte não seja surpresa.
  const codigoServicoMunicipalBruto = asString(company.codigoServicoMunicipal);
  const codigoServicoMunicipal = onlyDigits(codigoServicoMunicipalBruto);
  if (codigoServicoMunicipalBruto && !codigoServicoMunicipal) {
    return { ok: false, error: "company_codigo_servico_municipal_invalid" };
  }

  // `rpsSerie` — numérica, na faixa 1–49999 (RN **E0010**, emissor por APLICATIVO PRÓPRIO).
  //
  // ⚠ A AUTORIDADE DA FAIXA É `application/nfse/nfseNumeracao.js` (`SERIE_MIN`/`SERIE_MAX`), e ela
  // NÃO é importada aqui de propósito: aquele módulo carrega o Prisma client no topo, e este é um
  // validador puro. A duplicação de dois inteiros está amarrada por teste
  // (`routes/firm/__tests__/companyCamposNfse.test.js` compara os limites com os exportados de lá):
  // se um lado mudar sem o outro, o teste cai.
  //
  // ⚠ Grava-se com padding de 5 dígitos, a MESMA forma que `normalizarSerie` devolve para o XML —
  // "1" e "00001" são a mesma série, e guardar as duas escritas faria a mesma empresa parecer ter
  // duas. Isso é normalização, não default: campo vazio continua gravando NULL.
  const rpsSerieBruta = asString(company.rpsSerie);
  let rpsSerie = null;
  if (rpsSerieBruta) {
    if (!/^\d+$/.test(rpsSerieBruta)) return { ok: false, error: "company_rps_serie_invalid" };
    const n = Number(rpsSerieBruta);
    if (!Number.isInteger(n) || n < 1 || n > 49999) {
      return { ok: false, error: "company_rps_serie_invalid" };
    }
    rpsSerie = String(n).padStart(5, "0");
  }

  // ── CARGA TRIBUTÁRIA APROXIMADA da empresa NÃO OPTANTE (Lei 12.741/2012) ────────────────────
  //
  // Pedido do dono (18/08/2026): *"as alíquotas efetivas do presumido não precisam ser calculadas
  // (…) mas deve ser configurado do lado do contador, no portal do contador."*
  //
  // São os três percentuais de `totTrib/pTotTrib` da DPS. ⚠ NADA É CALCULADO AQUI: não há de-para
  // CNAE→presunção neste repositório, e o número vai IMPRESSO ao tomador. O contador digita.
  //
  // ⚠ TRÊS RESPOSTAS, como na lista de serviços: `undefined` = não veio no payload (NÃO MEXER),
  // `null` = o contador apagou, número = grava. Achatar "ausente" em `null` faria qualquer rota
  // que salve a empresa sem este bloco APAGAR a configuração — e o desfecho seria a empresa parar
  // de emitir com o contador convicto de que a configurou.
  //
  // ⚠ `asNumberOrNull` NÃO SERVE AQUI: ele faz `.replace(/\./g, "")` para tratar ponto como
  // separador de MILHAR, e "11.33" viraria 1133. Percentual de 0 a 100 não tem milhar — então
  // ponto e vírgula são a MESMA coisa (separador decimal), e qualquer outra forma é recusa.
  const percentuais = {};
  for (const campo of ["pTotTribFed", "pTotTribEst", "pTotTribMun"]) {
    if (company[campo] === undefined) continue; // não veio: não mexer
    const bruto = asString(company[campo]);
    if (!bruto) {
      percentuais[campo] = null; // apagado de propósito — e NULL é o que a emissão recusa com motivo
      continue;
    }
    const texto = bruto.replace(",", ".");
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(texto)) {
      return { ok: false, error: `company_${snakeCasePercentual(campo)}_invalid` };
    }
    const n = Number(texto);
    // É PERCENTUAL. Fora de 0–100 não é "um número grande", é outra unidade — provavelmente o
    // valor em reais no lugar da alíquota. Mesma checagem de `validateNfsePayload`.
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return { ok: false, error: `company_${snakeCasePercentual(campo)}_invalid` };
    }
    percentuais[campo] = n;
  }

  // ── COERÊNCIA ENTRE A LISTA E O CÓDIGO QUE A DPS LEVA ──────────────────────────────────────
  //
  // ⚠ ESTE BLOCO EXISTE PORQUE A ESCOLHA POR EMISSÃO AINDA NÃO CHEGA AO XML. `buildDpsXml` monta o
  // `cTribNac` a partir de `company.codigoServicoNacional` e de mais nada (`NfseService.js:540`) —
  // não há campo de serviço no payload da emissão. Enquanto for assim, a empresa com N códigos
  // precisa de UM deles marcado como "o que a nota leva", senão o cadastro descreve uma coisa e a
  // nota declara outra. A pendência está nomeada no relatório: é UMA linha em `buildDpsXml`.
  //
  // As três respostas, e por que nenhuma delas é "escolher o primeiro":
  //   • lista com UM código      → o singular é ele. Não há escolha a fazer, então adotá-lo não é
  //                                escolher por ninguém — é a mesma informação em dois lugares.
  //   • lista com N e o singular entre eles → fica como está.
  //   • lista com N e o singular fora dela (ou vazio) → RECUSA NOMEADA. Eleger "o primeiro da
  //     lista" seria o sistema decidindo qual serviço a empresa declara ao fisco. Serviço errado na
  //     nota é silencioso: ninguém percebe até o DANFSe sair com a descrição de outra atividade.
  let codigoServicoNacionalFinal = codigoServicoNacional || null;
  if (codigosServicoNacional && codigosServicoNacional.length) {
    if (codigosServicoNacional.length === 1) {
      codigoServicoNacionalFinal = codigosServicoNacional[0];
    } else if (!codigoServicoNacionalFinal || !codigosServicoNacional.includes(codigoServicoNacionalFinal)) {
      return { ok: false, error: "company_codigo_servico_nacional_fora_da_lista" };
    }
  }
  return {
    ok: true,
    data: {
      // O nome mantém o "Final" de propósito: este é o código que a DPS leva DEPOIS da conferência
      // de coerência com a lista, não o que veio cru no payload.
      codigoServicoNacionalFinal,
      codigosServicoNacional,
      codigoServicoMunicipal,
      rpsSerie,
      percentuais,
    },
  };
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

  // ⚠ CÓDIGO IBGE DO MUNICÍPIO EMISSOR — 7 dígitos, ou nada.
  //
  // É o `cLocEmi` da DPS, e entra no `Id` do documento; o banco tem CHECK `^[0-9]{7}$` na coluna
  // (migration `20260814120000_add_nfse_emissao_fase1`). A guarda vive AQUI, e não só no CHECK,
  // porque uma violação de constraint sobe como erro 500 sem nome — o contador veria "erro
  // interno" ao salvar o cadastro, sem saber qual campo recusou.
  //
  // ⚠ NÃO É DERIVADO DE `endereco.cidade`, nem quando ele está preenchido. O de-para nome→IBGE
  // erra em homônimo (há cinco "Bom Jesus" no país) e o erro só apareceria como nota emitida no
  // município errado. Quem escolhe é o contador, na lista oficial do IBGE embarcada no front.
  //
  // Valor em branco grava NULL de propósito: desfazer uma escolha errada tem de ser possível, e
  // NULL é o estado que a emissão recusa com motivo (`NFSE_MUNICIPIO_NAO_CONFIGURADO`) em vez de
  // fabricar `"0000000"`.
  const codigoMunicipioIbgeBruto = asString(company.codigoMunicipioIbge);
  const codigoMunicipioIbge = onlyDigits(codigoMunicipioIbgeBruto);
  if (codigoMunicipioIbgeBruto && codigoMunicipioIbge.length !== 7) {
    return { ok: false, error: "company_codigo_municipio_ibge_invalid" };
  }

  // ── Configuração da emissão de NFS-e ──
  // ⚠ A NORMALIZAÇÃO SAIU DAQUI e virou `normalizeCamposEmissaoNfse` (acima): a aba própria de
  // emissão salva os mesmos campos por uma rota própria, e duas normalizações dos mesmos campos
  // divergiriam na primeira correção. Nada mudou de comportamento — recusas, códigos de erro e
  // ordem são os mesmos, e é o que a suíte `routes/firm/__tests__/companyCamposNfse.test.js` prova.
  const emissaoNfse = normalizeCamposEmissaoNfse(company);
  if (!emissaoNfse.ok) return emissaoNfse;
  const {
    codigoServicoNacionalFinal,
    codigosServicoNacional,
    codigoServicoMunicipal,
    rpsSerie,
    percentuais,
  } = emissaoNfse.data;

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
      codigoMunicipioIbge: codigoMunicipioIbge || null,
      // ── Configuração da emissão de NFS-e (o que `buildMissingFields` exige) ──
      // ⚠ Sem estas três linhas o valor chega no corpo, passa pelo Zod e é DESCARTADO EM SILÊNCIO
      // pela lista de colunas do `tx.company.update` — 200 na resposta e campo vazio na recarga.
      codigoServicoNacional: codigoServicoNacionalFinal,
      // ⚠ `undefined` VIAJA DE PROPÓSITO: quem grava (a rota e o provisionamento) usa
      // `!== undefined` para decidir entre "atualizar a lista" e "não tocar nela". Trocar por `[]`
      // faria toda tela que salva a empresa sem enviar este campo APAGAR o cadastro de serviços.
      codigosServicoNacional,
      codigoServicoMunicipal: codigoServicoMunicipal || null,
      rpsSerie,
      // ⚠ `undefined` VIAJA DE PROPÓSITO (mesma razão de `codigosServicoNacional`): quem grava usa
      // `!== undefined` para separar "não mexer" de "apagar". Um `?? null` aqui apagaria a carga
      // tributária em toda rota que salva a empresa sem enviar o bloco.
      pTotTribFed: percentuais.pTotTribFed,
      pTotTribEst: percentuais.pTotTribEst,
      pTotTribMun: percentuais.pTotTribMun,
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

