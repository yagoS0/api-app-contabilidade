import { mensagemDoErroDeCadastro } from "@contabilidade/shared/erros-cadastro-empresa";
function getApiBaseUrl() {
  return String(import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

// ⚠ EXPORTADA SÓ PARA SER TESTÁVEL — é pura (payload → texto) e não tem outro chamador fora deste
// módulo. Sem isso, a única forma de amarrar a tradução de um código de erro seria por grep no
// arquivo, que passa a valer nada no dia em que alguém trocar o texto por outro igualmente mudo.
export function mapKnownError(payload, status) {
  const code = String(payload?.error || "").trim().toUpperCase();
  const reason = String(payload?.reason || "").trim();

  if (code === "SERPRO_PGDASD_DECLARATION_NOT_TRANSMITTED") {
    return "A declaração do PGDAS-D ainda não foi transmitida para esta competência.";
  }
  if (code === "SERPRO_PGDASD_NO_AMOUNT_DUE") {
    return "Não há valor devido nesta competência, então o SERPRO não gerou DAS.";
  }
  if (code === "SERPRO_PGDASD_NO_DEBTS_FOUND") {
    return "Não há débito em cobrança para esta competência no SERPRO.";
  }
  if (code === "SERPRO_PGDASD_PDF_NOT_FOUND") {
    return "O SERPRO respondeu, mas não devolveu um PDF de guia para esta consulta.";
  }
  if (code === "SERPRO_PGDASD_PDF_INVALID") {
    return "O SERPRO retornou um PDF inválido para esta consulta.";
  }
  if (code === "SERPRO_DCTFWEB_PDF_NOT_FOUND") {
    return "O SERPRO respondeu, mas não devolveu um PDF da guia DCTFWeb.";
  }
  if (code === "SERPRO_DCTFWEB_PDF_INVALID") {
    return "O SERPRO retornou um PDF inválido da guia DCTFWeb.";
  }
  if (code === "SERPRO_DCTFWEB_SYNC_FAILED") {
    return "Falha ao sincronizar o INSS via DCTFWeb.";
  }
  if (code === "SERPRO_PGDASD_SYNC_FAILED") {
    return "Falha ao sincronizar o extrato PGDAS-D.";
  }
  if (code === "SERPRO_PGDASD_DADOS_NOT_FOUND") {
    return "O SERPRO não retornou os dados esperados da declaração PGDAS-D.";
  }
  if (code === "SERPRO_PGDASD_DADOS_INVALID") {
    return "O retorno do SERPRO veio em formato inválido para leitura da declaração PGDAS-D.";
  }
  if (code === "SERPRO_INVALID_NUMERO_DAS") {
    return "O número do DAS informado é inválido.";
  }
  if (code === "SERPRO_AUTH_ERROR") {
    return "Falha de autenticação no SERPRO. Verifique certificado, credenciais e autorização.";
  }
  if (code === "SERPRO_SERVICE_UNAVAILABLE" || code === "SERPRO_TIMEOUT") {
    return "O SERPRO está indisponível no momento. Tente novamente em instantes.";
  }
  if (code === "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED") {
    return "O CNPJ do procurador não está configurado corretamente no certificado SERPRO.";
  }
  if (code === "SERPRO_CERTIFICATE_NOT_CONFIGURED") {
    return "Nenhum certificado SERPRO foi configurado para esta integração.";
  }
  if (code === "SERPRO_INVALID_COMPETENCIA") {
    return "A competência informada é inválida para a consulta do SERPRO.";
  }
  if (code === "GUIDE_RECALCULATION_NOT_AVAILABLE") {
    return "O recálculo só está disponível para guias do Simples (SERPRO) ainda não pagas.";
  }
  if (code === "CIRCULAR_NAO_ENCONTRADA") {
    return "Nenhuma Circular foi encontrada para esta competência.";
  }
  if (code === "COMPETENCIA_REQUIRED") {
    return "A competência é obrigatória.";
  }
  if (code === "ACCOUNTING_GENERATION_FAILED") {
    return "A circular foi salva, mas a geração dos lançamentos falhou.";
  }
  // ⚠ SEM ESTAS DUAS, O CÓDIGO VOLTA CRU PARA A TELA. O backend passou a recusar a baixa com 409
  // nomeado no lugar do 500 `internal_error` — mas o fallback lá embaixo mostra `payload.message`,
  // e a mensagem do servidor já traz o conserto por extenso. Elas existem para que a tradução seja
  // DELIBERADA e não dependa de o backend continuar mandando `message`.
  if (code === "BAIXA_DUPLICADA_NA_COMPETENCIA") {
    const comp = String(payload?.competencia || "").trim();
    const trib = String(payload?.tributo || "").trim();
    return (
      `Já existe uma baixa${trib ? ` de ${trib}` : ""} desta empresa lançada${comp ? ` na competência ${comp}` : ""}. `
      + "Informe a data de pagamento real desta parcela — sem comprovante o modal usa a data de hoje, "
      + "e todas as provisões em atraso acabam caindo no mês corrente."
    );
  }
  if (code === "BAIXA_CONFLITO_UNICIDADE") {
    return String(payload?.message || "").trim()
      || "Esta baixa conflita com uma já gravada. Confira se ela não foi lançada antes.";
  }
  // Erro de negócio do SERPRO: a mensagem REAL vem em payload.message (ex.: "PA já declarado",
  // atividade inválida, cadastro incompleto) — mostrar ela, não o código seco.
  if (code === "SERPRO_BUSINESS_ERROR") {
    return String(payload?.message || "").trim() || "O SERPRO rejeitou a operação (erro de negócio).";
  }

  // ⚠ VALIDAÇÃO REJEITADA: o backend diz EXATAMENTE qual campo e por quê, em `payload.issues`
  // (`companySchemas.validateCompanyInput`). Este fallback devolvia só o código seco —
  // "validation_failed" — e o detalhe ia para o lixo. Do lado de fora era indistinguível de um erro
  // sem causa: o contador via um código, não sabia qual campo corrigir, e o cadastro ficava travado
  // sem pista nenhuma. Mesma família do `feedback={feedback}` que já custou uma semana aqui.
  if (Array.isArray(payload?.issues) && payload.issues.length) {
    const detalhes = payload.issues
      .slice(0, 4)
      .map((i) => (i?.path ? `${i.path}: ${i.message}` : i?.message))
      .filter(Boolean)
      .join(" · ");
    const resto = payload.issues.length > 4 ? ` (+${payload.issues.length - 4})` : "";
    return `Não foi possível salvar — ${detalhes}${resto}`;
  }

  // ⚠⚠ O DICIONÁRIO DO CADASTRO DE EMPRESA — 48 códigos que chegavam à tela em `snake_case`.
  // Foi o defeito relatado pelo dono ("avisos que não aparecem"): `mapKnownError` não tinha um
  // único `company_*`, o fallback abaixo devolvia `payload.error` cru, e `Feedback.jsx` imprimia
  // a string. Foi também por aqui que o 409 do responsável ficou ilegível.
  //
  // ⚠ A PRECEDÊNCIA É **dicionário > `message` do servidor > código**, e a ordem importa: o
  // dicionário é texto escrito para o contador, com o que FAZER; o `message` do servidor é
  // técnico e existe em poucos casos (`cnpj_imutavel`). Invertida, a frase pior venceria a melhor
  // exatamente nos casos em que alguém se deu ao trabalho de escrever as duas.
  //
  // ⚠⚠ DELEGA, não copia. O texto mora em `packages/shared` porque espelhá-lo aqui divergiria na
  // primeira correção — precedente medido na lista do IBGE.
  const doCadastro = mensagemDoErroDeCadastro(payload?.error, payload);
  if (doCadastro) return doCadastro;

  // Fallback: prefere a mensagem humana do backend ({error, message}) antes do código cru.
  return reason || String(payload?.message || "").trim() || payload?.error || `request_failed_${status}`;
}

function normalizeError(payload, status) {
  return mapKnownError(payload, status);
}

function txt(value) {
  return String(value || "").trim() || null;
}

// "" → undefined: campo ausente no payload significa "não mexer" (sócios/histórico) ou
// simplesmente não enviar. Já `null` apagaria o valor no banco.
function omitIfEmpty(value) {
  const v = String(value || "").trim();
  return v || undefined;
}

function buildCompanyPayload(input) {
  return {
    // ⚠ Campo em branco vira `undefined`, NUNCA `""`. Mandar string vazia dizia ao backend "o
    // e-mail do dono é esta string", e `""` não é e-mail: o PATCH inteiro voltava
    // `validation_failed` em toda empresa, mesmo sem ninguém ter tocado nesse campo. Ausente
    // significa "não mexer" — que é o que um campo vazio quer dizer numa edição.
    // Na CRIAÇÃO o schema exige o campo, então ausente vira um erro claro e específico.
    ownerEmail: omitIfEmpty(String(input.ownerEmail || "").toLowerCase()),
    ownerName: String(input.ownerName || "").trim() || null,
    ownerPassword: String(input.ownerPassword || ""),
    hasProlabore: Boolean(input.hasProlabore),
    temFolha: Boolean(input.temFolha),
    empresaZerada: Boolean(input.empresaZerada),
    // ⚠⚠ FORA de `company`, e de proposito: a rota le `body.atividadesDescritas`, e `company`
    //   passa pelo Zod (`companySchemas`) — campo desconhecido ali e descartado ou recusado.
    //   Ele tambem NAO e campo do perfil: e o texto que a consulta ao CNPJ trouxe AGORA, usado so
    //   para acrescentar descricao a codigos que `cnaePrincipal`/`cnaesSecundarios` ja escolheram.
    atividadesDescritas: Array.isArray(input.atividadesDescritas) ? input.atividadesDescritas : [],
    company: {
      cnpj: String(input.cnpj || "").trim(),
      razaoSocial: String(input.razaoSocial || "").trim(),
      nomeFantasia: txt(input.nomeFantasia),
      email: String(input.email || "").trim().toLowerCase() || null,
      guideNotificationEmail: String(input.guideNotificationEmail || "").trim().toLowerCase() || null,
      telefone: txt(input.telefone),
      regimeTributario: String(input.regimeTributario || "SIMPLES"),
      // ⚠⚠ O BLOCO `simples` SO VIAJA QUANDO O REGIME E SIMPLES. Mandado sempre, ele apagaria o
      //   anexo de toda empresa do Presumido a cada salvar — e o backend recusa
      //   (`company_simples_not_allowed_for_regime`) se vier com anexo fora do Simples.
      // ⚠ E quando viaja, viaja INTEIRO: e a presenca da chave `simples` que autoriza a rota a
      //   escrever as tres colunas (spread condicional). Omitir = "nao mexer".
      ...(String(input.regimeTributario || "SIMPLES") === "SIMPLES"
        ? {
            simples: {
              anexo: String(input.simplesAnexo || "").trim() || null,
              dataOpcao: String(input.simplesDataOpcao || "").trim() || null,
            },
          }
        : {}),
      cnaePrincipal: String(input.cnaePrincipal || "").trim(),
      // Antes era `[]` fixo: os CNAEs secundários NUNCA eram enviados, mesmo vindo da
      // BrasilAPI. Aceita array ou string separada por vírgula (o form usa string).
      cnaesSecundarios: Array.isArray(input.cnaesSecundarios)
        ? input.cnaesSecundarios.map((c) => String(c).replace(/\D+/g, "")).filter(Boolean)
        : String(input.cnaesSecundarios || "")
            .split(",")
            .map((c) => c.replace(/\D+/g, ""))
            .filter(Boolean),
      endereco: {
        rua: String(input.enderecoRua || "").trim(),
        numero: String(input.enderecoNumero || "").trim(),
        bairro: String(input.enderecoBairro || "").trim(),
        cidade: String(input.enderecoCidade || "").trim(),
        uf: String(input.enderecoUf || "").trim().toUpperCase(),
        cep: String(input.enderecoCep || "").replace(/\D+/g, ""),
        complemento: txt(input.enderecoComplemento),
      },
      // ── Ficha de cadastro ──
      // A inscrição municipal já era ACEITA pela API, mas o form nunca mandava:
      // em produção ela é sempre null.
      inscricaoMunicipal: txt(input.inscricaoMunicipal),
      inscricaoMunicipalData: omitIfEmpty(input.inscricaoMunicipalData),
      // Município EMISSOR da NFS-e (`cLocEmi`). Vai como `null` quando em branco — "não escolhido"
      // precisa poder voltar a ser gravado, senão limpar uma escolha errada seria impossível pela
      // tela. Quem recusa formato inválido é o normalizador do backend (e o CHECK do banco).
      codigoMunicipioIbge: txt(input.codigoMunicipioIbge),
      // ── Configuração da emissão de NFS-e ──
      // ⚠ Estes três já existiam na coluna e já voltavam na leitura, mas NENHUM formulário os
      // mandava: o campo não existia em tela nenhuma. `buildMissingFields` recusava a emissão por
      // eles e não havia por onde preenchê-los. Vão como `null` quando em branco, pelo mesmo motivo
      // do município: desfazer uma configuração errada tem de ser possível pela tela.
      codigoServicoNacional: txt(input.codigoServicoNacional),
      // ⚠ A LISTA de códigos (decisão do dono, 16/08/2026). Só vai quando o formulário TEM o campo:
      // `undefined` diz ao backend "não mexa na lista", e `[]` diz "apague a lista". Mandar `[]`
      // incondicionalmente apagaria o cadastro de serviços em qualquer tela que salve a empresa sem
      // este bloco — o mesmo defeito que o `omitIfEmpty` do e-mail do dono existe para impedir.
      codigosServicoNacional: Array.isArray(input.codigosServicoNacional)
        ? input.codigosServicoNacional.map((c) => String(c).replace(/\D+/g, "")).filter(Boolean)
        : undefined,
      codigoServicoMunicipal: txt(input.codigoServicoMunicipal),
      rpsSerie: txt(input.rpsSerie),
      // ── Carga tributária aproximada do não optante (Lei 12.741/2012), dono 18/08/2026 ──────
      // ⚠ `txt` devolve `null` no vazio, e é o que se quer: NULL é o estado que a emissão RECUSA
      // com motivo. Desfazer uma configuração errada tem de ser possível pela tela — e é o
      // oposto de gravar 0,00, que AFIRMARIA carga zero ao tomador.
      // ⚠ O texto vai CRU ("11,33"): quem normaliza vírgula/ponto é o backend, num lugar só.
      // Converter aqui criaria uma segunda regra que divergiria da primeira correção.
      pTotTribFed: txt(input.pTotTribFed),
      pTotTribEst: txt(input.pTotTribEst),
      pTotTribMun: txt(input.pTotTribMun),
      // ── Benefício municipal do ISSQN (grupo `BM` da DPS), dono 20/08/2026 ────────────────
      // ⚠ Mesma regra dos de cima: o texto vai CRU (o número com a máscara do ofício, o percentual
      // com vírgula) e quem normaliza é o backend, num lugar só. `txt` devolve `null` no vazio —
      // apagar um benefício mal cadastrado tem de ser possível pela tela, e apagar o NÚMERO apaga
      // o grupo inteiro no servidor (senão sobraria um tipo apontando para benefício nenhum).
      beneficioMunicipalNumero: txt(input.beneficioMunicipalNumero),
      beneficioMunicipalTipoReducao: txt(input.beneficioMunicipalTipoReducao),
      beneficioMunicipalPRedBC: txt(input.beneficioMunicipalPRedBC),
      inscricaoEstadual: txt(input.inscricaoEstadual),
      inscricaoEstadualData: omitIfEmpty(input.inscricaoEstadualData),
      porte: txt(input.porte),
      naturezaJuridica: txt(input.naturezaJuridica),
      capitalSocial: omitIfEmpty(input.capitalSocial),
      dataAbertura: omitIfEmpty(input.dataAbertura),
      abriuCom: txt(input.abriuCom),
      numeroRegistro: txt(input.numeroRegistro),
      tipoRegistro: txt(input.tipoRegistro),
      diarioNumero: txt(input.diarioNumero),
      desoneracao: Boolean(input.desoneracao),
      alteracaoNumero: txt(input.alteracaoNumero),
      alteracaoData: omitIfEmpty(input.alteracaoData),
      // Só manda se o form editou: ausente = backend não mexe na lista.
      // Linhas sem nome/regime são descartadas aqui (o form deixa linha vazia enquanto digita).
      ...(Array.isArray(input.socios)
        ? {
            socios: input.socios
              .filter((s) => String(s?.name || "").trim())
              .map((s) => ({
                name: String(s.name).trim(),
                documento: String(s.documento || "").replace(/\D+/g, "") || null,
                participacao: String(s.participacao || "").trim() || null,
                rg: String(s.rg || "").trim() || null,
                rgOrgaoEmissor: String(s.rgOrgaoEmissor || "").trim() || null,
                dataNascimento: String(s.dataNascimento || "").trim() || null,
                dataSaida: String(s.dataSaida || "").trim() || null,
                representante: Boolean(s.representante),
              })),
          }
        : {}),
      ...(Array.isArray(input.regimeHistorico)
        ? {
            regimeHistorico: input.regimeHistorico
              .filter((r) => String(r?.regime || "").trim() && String(r?.vigenciaInicio || "").trim())
              .map((r) => ({
                regime: String(r.regime).trim(),
                vigenciaInicio: String(r.vigenciaInicio).trim(),
                vigenciaFim: String(r.vigenciaFim || "").trim() || null,
                // O form guarda "ISS/PIS/COFINS" (como a ficha escreve); a API quer array.
                impostos: Array.isArray(r.impostos)
                  ? r.impostos
                  : String(r.impostos || "")
                      .split(/[/,]/)
                      .map((x) => x.trim().toUpperCase())
                      .filter(Boolean),
                desoneracao: Boolean(r.desoneracao),
              })),
          }
        : {}),
    },
  };
}

// Q17: chave do token logado (mesma de App.jsx). Instâncias criadas por componentes
// (ex.: painéis que fazem `createApiClient()` direto) caem aqui quando não receberam
// `setAccessToken` — senão suas requisições saem sem Authorization (401 unauthorized).
const TOKEN_STORAGE_KEY = "portal_firm_access_token";
// Q27.D: refresh token guardado pra renovar a sessão silenciosamente (sem relogin a cada 1h).
const REFRESH_TOKEN_STORAGE_KEY = "portal_firm_refresh_token";
function readStored(key) {
  try {
    if (typeof localStorage !== "undefined") {
      return String(localStorage.getItem(key) || "").trim();
    }
  } catch { /* ignore */ }
  return "";
}
function writeStored(key, value) {
  try {
    if (typeof localStorage !== "undefined") {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    }
  } catch { /* ignore */ }
}
function readStoredToken() { return readStored(TOKEN_STORAGE_KEY); }

export function createRealApi() {
  let accessToken = String(import.meta.env.VITE_API_TOKEN || "").trim();
  let unauthorizedHandler = null;
  let refreshPromise = null; // single-flight: uma renovação concorrente só

  // Q27.D: tenta renovar o accessToken via /auth/refresh usando o refresh guardado.
  // Usa fetch direto (não `request`) pra não recursar no 401. Atualiza memória + localStorage.
  async function doRefresh() {
    const refreshToken = readStored(REFRESH_TOKEN_STORAGE_KEY);
    if (!refreshToken) return false;
    if (!refreshPromise) {
      const baseUrl = getApiBaseUrl();
      refreshPromise = (async () => {
        try {
          const res = await fetch(`${baseUrl}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refreshToken }),
          });
          if (!res.ok) return false;
          const data = await res.json().catch(() => ({}));
          const newAccess = String(data?.accessToken || "").trim();
          const newRefresh = String(data?.refreshToken || "").trim();
          if (!newAccess) return false;
          accessToken = newAccess;
          writeStored(TOKEN_STORAGE_KEY, newAccess);
          if (newRefresh) writeStored(REFRESH_TOKEN_STORAGE_KEY, newRefresh);
          return true;
        } catch {
          return false;
        } finally {
          // libera o single-flight no próximo tick
          setTimeout(() => { refreshPromise = null; }, 0);
        }
      })();
    }
    return refreshPromise;
  }

  async function request(path, options = {}, _retried = false) {
    const baseUrl = getApiBaseUrl();
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    const headers = {
      ...(options.headers || {}),
    };
    if (!isFormData) {
      headers["Content-Type"] = "application/json";
    }
    const tok = accessToken || readStoredToken();
    if (tok) {
      headers.Authorization = `Bearer ${tok}`;
    }
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Q27.D: 401 → tenta renovar UMA vez e repete a requisição original. Não tenta no /auth/*.
      if (response.status === 401 && !_retried && !path.startsWith("/auth/")) {
        const refreshed = await doRefresh();
        if (refreshed) return request(path, options, true);
      }
      if (response.status === 401 && typeof unauthorizedHandler === "function") {
        unauthorizedHandler({ path, payload, status: response.status });
      }
      // ⚠ O CÓDIGO DA RECUSA SOBE JUNTO DA MENSAGEM.
      // `throw new Error(mensagem)` descartava `payload.error`, e há tela que precisa AGIR por
      // código, não só exibir texto: o estorno da baixa distingue motivo curto (400
      // MOTIVO_OBRIGATORIO, que se corrige no próprio campo), total divergente (409
      // CONFERENCIA_DIVERGENTE, que exige recarregar a prévia) e mês corrente fechado (409
      // MES_CORRENTE_FECHADO, que só se resolve reabrindo a competência) — três recusas com três
      // saídas diferentes, indistinguíveis por uma string.
      // São campos ACRESCENTADOS, não uma troca: quem só lê `err.message` continua igual.
      const err = new Error(normalizeError(payload, response.status));
      err.code = String(payload?.error || "").trim() || null;
      err.status = response.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  return {
    setUnauthorizedHandler(handler) {
      unauthorizedHandler = typeof handler === "function" ? handler : null;
    },
    setAccessToken(token) {
      accessToken = String(token || "").trim();
    },
    getAccessToken() {
      return accessToken;
    },
    clearSession() {
      accessToken = "";
      writeStored(REFRESH_TOKEN_STORAGE_KEY, ""); // Q27.D: limpa o refresh no logout
    },
    async login({ identifier, password }) {
      const payload = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      accessToken = String(payload?.accessToken || "").trim();
      // Q27.D: guarda o refresh token pra renovar a sessão silenciosamente.
      writeStored(REFRESH_TOKEN_STORAGE_KEY, String(payload?.refreshToken || "").trim());
      return payload;
    },
    async me() {
      return request("/auth/me");
    },
    async listCompanies(competencia) {
      const suffix = competencia ? `?competencia=${encodeURIComponent(competencia)}` : "";
      const payload = await request(`/firm/companies${suffix}`);
      return Array.isArray(payload?.data) ? payload.data : [];
    },
    async createCompany(input) {
      return request("/firm/companies", {
        method: "POST",
        body: JSON.stringify(buildCompanyPayload(input)),
      });
    },
    // ⚠ `confirmarNovoAcesso` é o SEGUNDO envio do MESMO formulário, depois de o contador ter lido
    // o aviso de que aquele e-mail responde por N empresas. Ele não é campo do formulário e não
    // entra em `buildCompanyPayload`: é uma decisão daquele clique, e guardá-la no `form` faria a
    // confirmação sobreviver ao próximo salvar, autorizando em silêncio um ato futuro.
    async updateCompany(companyId, input, { confirmarNovoAcesso = false } = {}) {
      return request(`/firm/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...buildCompanyPayload(input),
          ...(confirmarNovoAcesso === true ? { confirmarNovoAcesso: true } : {}),
        }),
      });
    },
    // Quais empresas este e-mail de responsável já atende. Só leitura — alimenta o AVISO ao digitar.
    // ⚠ Nunca proíbe nada: quem recusa (e só no caso da conta compartilhada, com confirmação) é o
    // PATCH, no servidor.
    async empresasDoResponsavel(email) {
      const alvo = String(email || "").trim().toLowerCase();
      if (!alvo) return [];
      const payload = await request(`/firm/responsavel/empresas?email=${encodeURIComponent(alvo)}`);
      return Array.isArray(payload?.empresas) ? payload.empresas : [];
    },
    async getCompanyGuides(companyId) {
      const payload = await request(`/firm/companies/${companyId}/guides?page=1&limit=50`);
      return Array.isArray(payload?.data) ? payload.data : [];
    },
    async uploadCompanyGuide(companyId, file, metadata) {
      const formData = new FormData();
      formData.append("file", file);
      if (metadata) formData.append("metadata", JSON.stringify(metadata));
      return request(`/firm/companies/${companyId}/guides/upload`, { method: "POST", body: formData });
    },
    // Baixa o PDF de uma guia já existente como Blob (com auth Bearer).
    // Iframes não enviam Authorization header, então buscamos via fetch e criamos blob URL.
    async fetchGuidePdfBlob(companyId, guideId) {
      const baseUrl = getApiBaseUrl();
      const headers = {};
      const tok = accessToken || readStoredToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(`${baseUrl}/firm/companies/${companyId}/guides/${guideId}/file`, {
        method: "GET",
        headers,
      });
      if (!res.ok) {
        const err = new Error(`Falha ao baixar PDF da guia (HTTP ${res.status})`);
        err.code = "GUIDE_FILE_FETCH_FAILED";
        throw err;
      }
      return res.blob();
    },
    // Identifica/completa metadados de uma guia já no banco (status ERROR ou incompleta).
    async identifyGuide(companyId, guideId, metadata) {
      return request(`/firm/companies/${companyId}/guides/${guideId}/identify`, {
        method: "POST",
        body: JSON.stringify(metadata || {}),
      });
    },
    async deleteGuide(guideId) {
      return request(`/firm/guides/${guideId}`, { method: "DELETE" });
    },
    async resendGuideEmail(guideId) {
      return request(`/firm/guides/${guideId}/resend-email`, { method: "POST" });
    },
    async confirmGuidePayment(guideId) {
      return request(`/firm/guides/${guideId}/confirm-payment`, { method: "POST" });
    },
    async recalculateGuide(guideId) {
      return request(`/firm/guides/${guideId}/recalculate`, { method: "POST" });
    },
    // Portal Cliente: libera SÓ a guia selecionada ao cliente e envia SÓ ela por e-mail
    // (página da empresa). O empacotamento DAS+INSS fica no envio em lote da página principal.
    async liberarGuiaCliente(guideId) {
      return request(`/firm/guides/${guideId}/liberar-cliente`, { method: "POST" });
    },
    // Q17: guias esperadas da competência + estado (present/vazio/missing)
    async getExpectedGuides(companyId, competencia) {
      const suffix = competencia ? `?competencia=${encodeURIComponent(competencia)}` : "";
      return request(`/firm/companies/${companyId}/guides/expected${suffix}`);
    },
    // Marcar "não houve movimento neste mês" (Vazio). É declaração fiscal: grava quem/quando no
    // servidor e é RECUSADA (409) se houver nota emitida na competência. `motivo` é opcional.
    // ⚠ `confirmado` NÃO tem default `true`. Com faturamento na competência o backend recusa o
    // primeiro POST de propósito, para que a evidência chegue à tela ANTES da afirmação fiscal —
    // quem confirma é o contador, não o cliente de API.
    async markGuideVazio(portalClientId, tipo, competencia, motivo, { confirmado = false } = {}) {
      return request("/firm/guides/vazio", {
        method: "POST",
        body: JSON.stringify({
          portalClientId, tipo, competencia,
          motivo: motivo || undefined,
          ...(confirmado ? { confirmado: true } : {}),
        }),
      });
    },
    async undoGuideVazio(portalClientId, tipo, competencia) {
      return request("/firm/guides/vazio", {
        method: "DELETE",
        body: JSON.stringify({ portalClientId, tipo, competencia }),
      });
    },
    // Q17: fechamento CONTÁBIL do mês
    // A PRE-VERIFICACAO dos lancamentos: "as provisoes estao nas contas certas?"
    // ⚠ SO LEITURA. A regra vive no backend (`application/accounting/regras/`), e o que volta e
    // agrupado por REGRA -- e o agrupamento que serve a correcao em lote antes de importar.
    async getVerificacaoLancamentos(companyId, competencia) {
      const qs = competencia ? `?competencia=${encodeURIComponent(competencia)}` : "";
      return request(`/firm/companies/${companyId}/lancamentos/verificacao${qs}`);
    },
    async getFechamentoContabil(companyId, competencia) {
      return request(`/firm/companies/${companyId}/fechamento-contabil/${competencia}`);
    },
    async fecharFechamentoContabil(companyId, competencia) {
      return request(`/firm/companies/${companyId}/fechamento-contabil/${competencia}/fechar`, { method: "POST" });
    },
    async reabrirFechamentoContabil(companyId, competencia) {
      return request(`/firm/companies/${companyId}/fechamento-contabil/${competencia}/reabrir`, { method: "POST" });
    },
    // Q47: marca/desmarca "Folha/Pró-labore lançada" (pré-requisito do fechamento).
    async setFolhaProlabore(companyId, competencia, ok) {
      return request(`/firm/companies/${companyId}/fechamento-contabil/${competencia}/folha-prolabore`, {
        method: "POST",
        body: JSON.stringify({ ok: Boolean(ok) }),
      });
    },
    // Checklist de conferência do mês. `item`: folhaProlabore | despesas | receitas | provisoes | pagamentos.
    // Parcelas com pagamento marcado e ainda sem lançamento (painel da aba Parcelamento).
    async listParcelasPendentesBaixa(companyId) {
      return request(`/firm/companies/${companyId}/parcelamentos/parcelas-pendentes-baixa`);
    },
    // ⚠ O SEGUNDO ARGUMENTO É OPCIONAL E É A SAÍDA DO `sem_composicao`.
    //
    // Guia de parcela vinda de UPLOAD chega SEM `TributoParcela` e sem principal/multa/juros no
    // `extracted` — a fila recusava com `sem_composicao` e não havia caminho nenhum (a baixa por
    // declaração, `/baixa-manual`, recusa toda prestação que TEM guia). Com `composicaoDeclarada`
    // o contador informa a decomposição lendo o DAS, e ela sobe pela MESMA rota da baixa normal:
    // mesma guia, mesma reserva atômica, mesma forma de lançamento.
    //
    // ⚠ `totalConferido` é OBRIGATÓRIO quando há composição declarada — o servidor refaz
    // `principal + juros + multa` e recusa com 409 `CONFERENCIA_DIVERGENTE` se não bater. Ele NÃO
    // deriva o acréscimo por subtração.
    //
    // ⚠ SEM O SEGUNDO ARGUMENTO, O BODY NÃO VAI — o caminho normal continua idêntico ao que era, e
    // `dataPagamento` só é aceita pelo servidor junto da composição (com comprovante, a data dele
    // manda sempre).
    async lancarBaixaParcela(companyId, guideId, body = null) {
      return request(`/firm/companies/${companyId}/parcelamentos/parcelas/${guideId}/baixa`, {
        method: "POST",
        ...(body?.composicaoDeclarada
          ? {
            body: JSON.stringify({
              composicaoDeclarada: {
                principal: body.composicaoDeclarada.principal,
                juros: body.composicaoDeclarada.juros ?? 0,
                multa: body.composicaoDeclarada.multa ?? 0,
                totalConferido: body.composicaoDeclarada.totalConferido,
              },
              dataPagamento: body.dataPagamento ?? null,
            }),
          }
          : {}),
      });
    },
    // ⚠ A OUTRA FILA — prestação SEM guia, vencida e sem baixa. Ela responde outra pergunta: aqui
    // não há `paymentStatus` do SERPRO dizendo que foi pago, porque não há documento nenhum
    // (débito automático). É a única porta de onde sai o `parcelaId` da baixa por declaração.
    async listParcelasSemGuiaPendentes(companyId) {
      return request(`/firm/companies/${companyId}/parcelamentos/parcelas-sem-guia-pendentes`);
    },
    // ⚠ `totalConferido` é OBRIGATÓRIO — o servidor recalcula `principal + juros + multa` e recusa
    // com 409 `CONFERENCIA_DIVERGENTE` se não bater. Ele NÃO deriva o acréscimo por subtração.
    async lancarBaixaManualParcela(companyId, parcelaId, body = {}) {
      return request(`/firm/companies/${companyId}/parcelamentos/parcelas/${parcelaId}/baixa-manual`, {
        method: "POST",
        body: JSON.stringify({
          dataPagamento: body.dataPagamento ?? null,
          valorJuros: body.valorJuros ?? 0,
          valorMulta: body.valorMulta ?? 0,
          totalConferido: body.totalConferido,
        }),
      });
    },
    // ⚠ O VALOR **CONTRATADO** DA PRESTAÇÃO — não o pago. Ele é `parcelas.valorPrevisto` (o que o
    // acordo diz que a prestação vale, e o que a baixa amortiza do passivo); o PAGO continua sendo
    // `principal + juros + multa` da baixa. São chamadas separadas porque são fatos separados: a
    // diferença entre os dois é informação (juros, atraso), e colapsá-los num campo só a apagaria.
    //
    // ⚠ `valorAnteriorConferido` é OBRIGATÓRIO e vai SEMPRE — inclusive `null`, que significa "o
    // contrato não tinha valor". A chave ausente é recusada com 400 `CONFERENCIA_OBRIGATORIA`:
    // alterar o contrato é ato de consequência, e a confirmação repete o que era e o que passa a ser.
    async corrigirValorPrevistoParcela(companyId, parcelaId, body = {}) {
      return request(`/firm/companies/${companyId}/parcelamentos/parcelas/${parcelaId}/valor-previsto`, {
        method: "PATCH",
        body: JSON.stringify({
          valorPrevisto: body.valorPrevisto,
          valorAnteriorConferido: body.valorAnteriorConferido ?? null,
        }),
      });
    },
    // Busca o comprovante no SERPRO e só REGISTRA (não lança) — a baixa segue sendo do contador.
    async buscarPagamentoGuia(guideId) {
      return request(`/firm/guides/${guideId}/buscar-pagamento`, { method: "POST" });
    },
    // Afirma que a competência não teve faturamento. O backend RECUSA (409) se houver nota EMIT
    // autorizada no mês — é confirmação do que ele já vê, não declaração contra a evidência.
    async setSemFaturamento(companyId, competencia, ok) {
      return request(`/firm/companies/${companyId}/fechamento-contabil/${competencia}/sem-faturamento`, {
        method: "POST",
        body: JSON.stringify({ ok: Boolean(ok) }),
      });
    },
    async setChecklistFechamento(companyId, competencia, item, ok) {
      return request(`/firm/companies/${companyId}/fechamento-contabil/${competencia}/checklist/${item}`, {
        method: "POST",
        body: JSON.stringify({ ok: Boolean(ok) }),
      });
    },
    async getGuideSettings() {
      return request("/firm/guides/settings");
    },
    async updateGuideSettings(input) {
      return request("/firm/guides/settings", {
        method: "PATCH",
        body: JSON.stringify(input || {}),
      });
    },
    async getSerproSettings() {
      return request("/firm/serpro/settings");
    },
    async getSerproStatus() {
      return request("/firm/serpro/status");
    },
    async updateSerproSettings(input) {
      return request("/firm/serpro/settings", {
        method: "PATCH",
        body: JSON.stringify(input || {}),
      });
    },
    async uploadSerproCertificate({ file, password }) {
      const formData = new FormData();
      if (file) formData.append("file", file);
      formData.append("password", String(password || ""));
      return request("/firm/serpro/settings/certificate", {
        method: "POST",
        body: formData,
      });
    },
    async deleteSerproCertificate() {
      return request("/firm/serpro/settings/certificate", {
        method: "DELETE",
      });
    },
    async getSerproCompanyProcuration(companyId) {
      return request(`/firm/companies/${companyId}/serpro/procuration`);
    },
    async checkSerproCompanyProcuration(companyId, input = {}) {
      return request(`/firm/companies/${companyId}/serpro/procuration/check`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async captureSerproPgdasd(companyId, input = {}) {
      return request(`/firm/companies/${companyId}/serpro/pgdasd/capture`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async syncSerproInss(companyId, input = {}) {
      return request(`/firm/companies/${companyId}/serpro/inss/sync`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    // Módulo Fiscal M2 — captura Lucro Presumido (DCTFWeb → provisão por tributo + split na circular).
    async captureSerproLp(companyId, input = {}) {
      return request(`/firm/companies/${companyId}/serpro/lp/capture`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    // Q36: captura manual de parcelamento (itera as parcelas geráveis internamente; sem competência).
    async captureSerproParcelamento(companyId) {
      return request(`/firm/companies/${companyId}/serpro/parcelamento/capture`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    // Rotinas: tabela empresa × rotina + agenda global por rotina.
    async getRotinas() {
      return request(`/firm/rotinas`);
    },
    async saveRotinas(input = {}) {
      return request(`/firm/rotinas`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    // Q40: confirmação de pagamento (PAGTOWEB) por empresa — consulta comprovante das guias OPEN.
    async confirmarPagamentoSerpro(companyId, input = {}) {
      return request(`/firm/companies/${companyId}/serpro/payment-confirmation`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    // Q40: relatório de situação fiscal (SITFIS) por empresa.
    async getSitfis(companyId) {
      return request(`/firm/companies/${companyId}/serpro/sitfis/relatorio`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    // Q41: última situação fiscal gravada (sem chamar o SERPRO).
    async getStoredSitfis(companyId) {
      return request(`/firm/companies/${companyId}/serpro/sitfis`);
    },
    // Q41: lista de empresas com a última situação fiscal (página Pendências).
    async listFiscalPendencias() {
      return request(`/firm/pendencias/fiscal`);
    },
    // Q43.4: baixa o PDF do relatório SITFIS como Blob (auth Bearer; iframe não manda header).
    // ── Calendário fiscal (do escritório; companyId é filtro opcional) ─────────────────────
    async getCalendario(mes, companyId) {
      const q = new URLSearchParams({ mes });
      if (companyId) q.set("companyId", companyId);
      return request(`/firm/calendario?${q.toString()}`);
    },
    async listMarcosFiscais() {
      return request(`/firm/marcos-fiscais`);
    },
    async createMarcoFiscal({ titulo, data, descricao, importancia, companyId }) {
      return request(`/firm/marcos-fiscais`, {
        method: "POST",
        body: JSON.stringify({ titulo, data, descricao, importancia, companyId: companyId || undefined }),
      });
    },
    async updateMarcoFiscal(marcoId, patch) {
      return request(`/firm/marcos-fiscais/${marcoId}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    async deleteMarcoFiscal(marcoId) {
      return request(`/firm/marcos-fiscais/${marcoId}`, { method: "DELETE" });
    },
    // ── Obrigações (do escritório; companyId é filtro opcional, como o calendário) ──────────
    async listObrigacoes({ companyId, incluirInativas } = {}) {
      const q = new URLSearchParams();
      if (companyId) q.set("companyId", companyId);
      if (incluirInativas) q.set("incluirInativas", "1");
      const qs = q.toString();
      return request(`/firm/obrigacoes${qs ? `?${qs}` : ""}`);
    },
    async createObrigacao(companyId, dados) {
      return request(`/firm/companies/${companyId}/obrigacoes`, {
        method: "POST",
        body: JSON.stringify(dados),
      });
    },
    async updateObrigacao(obrigacaoId, patch) {
      return request(`/firm/obrigacoes/${obrigacaoId}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    async deleteObrigacao(obrigacaoId) {
      return request(`/firm/obrigacoes/${obrigacaoId}`, { method: "DELETE" });
    },
    async concluirOcorrencia(ocorrenciaId) {
      return request(`/firm/ocorrencias/${ocorrenciaId}/concluir`, { method: "POST" });
    },
    async reabrirOcorrencia(ocorrenciaId) {
      return request(`/firm/ocorrencias/${ocorrenciaId}/reabrir`, { method: "POST" });
    },
    // ── Regras do escritório (uma obrigação aplicada a várias empresas) ────────────────────
    async listRegrasObrigacao() {
      return request(`/firm/regras-obrigacao`);
    },
    async previewEscopoRegra({ escopo, filtros }) {
      return request(`/firm/regras-obrigacao/previa`, {
        method: "POST",
        body: JSON.stringify({ escopo, filtros }),
      });
    },
    async createRegraObrigacao(dados) {
      return request(`/firm/regras-obrigacao`, { method: "POST", body: JSON.stringify(dados) });
    },
    async updateRegraObrigacao(regraId, patch) {
      return request(`/firm/regras-obrigacao/${regraId}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    // `modo` é obrigatório: remover apaga as obrigações nas empresas, desvincular as mantém.
    async deleteRegraObrigacao(regraId, modo) {
      return request(`/firm/regras-obrigacao/${regraId}?modo=${encodeURIComponent(modo)}`, { method: "DELETE" });
    },
    async addExcecaoRegra(regraId, companyId, motivo) {
      return request(`/firm/regras-obrigacao/${regraId}/excecoes`, {
        method: "POST",
        body: JSON.stringify({ companyId, motivo }),
      });
    },
    async removeExcecaoRegra(regraId, companyId) {
      return request(`/firm/regras-obrigacao/${regraId}/excecoes/${companyId}`, { method: "DELETE" });
    },
    // ── Documentos da empresa (contrato social, cartão CNPJ, inscrições…) ──────────────────
    async listCompanyDocuments(companyId) {
      return request(`/firm/companies/${companyId}/documentos`);
    },
    async uploadCompanyDocument(companyId, { arquivo, tipo, nome, validade }) {
      const formData = new FormData();
      formData.append("arquivo", arquivo);
      formData.append("tipo", tipo || "OUTRO");
      if (nome) formData.append("nome", nome);
      if (validade) formData.append("validade", validade);
      return request(`/firm/companies/${companyId}/documentos`, { method: "POST", body: formData });
    },
    // Blob com auth Bearer — mesmo padrão do fetchSitfisPdfBlob (o <a href> não leva o token).
    async fetchCompanyDocumentBlob(companyId, documentId) {
      const baseUrl = getApiBaseUrl();
      const headers = {};
      const tok = accessToken || readStoredToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(`${baseUrl}/firm/companies/${companyId}/documentos/${documentId}/download`, { method: "GET", headers });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const err = new Error(payload?.message || `Falha ao baixar o documento (HTTP ${res.status})`);
        err.code = payload?.error || "COMPANY_DOCUMENT_FETCH_FAILED";
        throw err;
      }
      return res.blob();
    },
    async deleteCompanyDocument(companyId, documentId) {
      return request(`/firm/companies/${companyId}/documentos/${documentId}`, { method: "DELETE" });
    },
    async sendCompanyDocuments(companyId, documentIds, destinatario) {
      return request(`/firm/companies/${companyId}/documentos/enviar`, {
        method: "POST",
        body: JSON.stringify({ documentIds, destinatario: destinatario || undefined }),
      });
    },
    // ── Anotações da empresa ───────────────────────────────────────────────────────────────
    async listCompanyNotes(companyId, ordenarPor = "data") {
      return request(`/firm/companies/${companyId}/anotacoes?ordenarPor=${encodeURIComponent(ordenarPor)}`);
    },
    async createCompanyNote(companyId, { texto, importancia, fixada }) {
      return request(`/firm/companies/${companyId}/anotacoes`, {
        method: "POST",
        body: JSON.stringify({ texto, importancia, fixada: Boolean(fixada) }),
      });
    },
    async updateCompanyNote(companyId, noteId, patch) {
      return request(`/firm/companies/${companyId}/anotacoes/${noteId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    async deleteCompanyNote(companyId, noteId) {
      return request(`/firm/companies/${companyId}/anotacoes/${noteId}`, { method: "DELETE" });
    },
    // ── Cofre de senhas da empresa ─────────────────────────────────────────────────────────
    // ⚠ A listagem NÃO traz senha nenhuma (nem cifrada) — ver `CompanyCredentialsService.listar`.
    // Ela traz `temSenha` e o estado do cofre, que é o que a tela precisa para dizer a verdade
    // sobre o nível de proteção.
    async listCompanyCredentials(companyId) {
      return request(`/firm/companies/${companyId}/credenciais`);
    },
    async createCompanyCredential(companyId, { rotulo, login, senha, observacao }) {
      return request(`/firm/companies/${companyId}/credenciais`, {
        method: "POST",
        body: JSON.stringify({ rotulo, login, senha, observacao }),
      });
    },
    // ⚠ `patch` é repassado CRU. `senha` ausente = não mexer; `senha: ""` = apagar. Normalizar aqui
    // (um `senha: senha || undefined`) colapsaria os dois casos e tornaria "apagar a senha"
    // inalcançável pela tela.
    async updateCompanyCredential(companyId, credentialId, patch) {
      return request(`/firm/companies/${companyId}/credenciais/${credentialId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    async deleteCompanyCredential(companyId, credentialId) {
      return request(`/firm/companies/${companyId}/credenciais/${credentialId}`, { method: "DELETE" });
    },
    // ⚠ A ÚNICA chamada que devolve senha. POST de propósito: ela escreve a linha de auditoria, e um
    // GET seria repetido de graça por refresh/prefetch, envenenando o próprio registro de leituras.
    // `confirmado` viaja explícito — o servidor recusa sem ele (400 CONFIRMACAO_OBRIGATORIA).
    async revealCompanyCredential(companyId, credentialId, { confirmado, motivo } = {}) {
      return request(`/firm/companies/${companyId}/credenciais/${credentialId}/revelar`, {
        method: "POST",
        body: JSON.stringify({ confirmado: confirmado === true, motivo: motivo || undefined }),
      });
    },
    // ── Acesso do CLIENTE ao portal — a senha dele ─────────────────────────────────────────
    //
    // ⚠⚠ NÃO É O COFRE ACIMA, e a diferença é a razão de existirem duas. O cofre guarda senha de
    // TERCEIRO de forma recuperável, de propósito; esta é `bcrypt` em `User.passwordHash` e NÃO tem
    // volta. Não existe "ver a senha do cliente": o contador DEFINE uma nova.
    //
    // A listagem traz quem são os usuários do portal e QUANDO a senha de cada um foi trocada pela
    // última vez, por qual caminho. Nenhuma senha, nem máscara, nem tamanho — não há o que mascarar.
    async getPortalAccessUsers(companyId) {
      return request(`/firm/companies/${companyId}/acesso-portal`);
    },
    // ── CONTATOS DE WHATSAPP — quem recebe guia pelo canal, e o canal padrão da empresa ────────
    // Contrato LIDO de `routes/firm/index.js` (`/companies/:id/contatos-whatsapp`, `/canal-envio`).
    // ⚠ Nenhuma destas envia mensagem: são cadastro. Quem envia é `enviarGuiaWhatsapp` e o lote.
    async listarContatosWhatsapp(companyId) {
      return request(`/firm/companies/${companyId}/contatos-whatsapp`);
    },
    // Cria ou atualiza (com `id`). O servidor normaliza o telefone para E.164 e valida o `userId`
    // contra os membros ATIVOS da empresa — o corpo nunca escolhe a empresa (o path vence).
    async salvarContatoWhatsapp(companyId, input) {
      return request(`/firm/companies/${companyId}/contatos-whatsapp`, {
        method: "POST",
        body: JSON.stringify(input || {}),
      });
    },
    async removerContatoWhatsapp(companyId, contatoId) {
      return request(`/firm/companies/${companyId}/contatos-whatsapp/${contatoId}`, { method: "DELETE" });
    },
    // EMAIL | WHATSAPP | PERGUNTAR — `ContatoWhatsappService.CANAL_PADRAO`; fora disso o servidor
    // responde 400 `canal_invalido`.
    async definirCanalEnvio(companyId, canalPadraoEnvio) {
      return request(`/firm/companies/${companyId}/canal-envio`, {
        method: "PATCH",
        body: JSON.stringify({ canalPadraoEnvio }),
      });
    },
    // ── AS CONVERSAS DE WHATSAPP (F5) — contrato LIDO de `routes/firm/whatsappConversas.js` ──────
    async listarConversasWhatsapp(filtro = "todas") {
      return request(`/firm/whatsapp/conversas?filtro=${encodeURIComponent(filtro)}`);
    },
    async getMensagensWhatsapp(conversaId) {
      return request(`/firm/whatsapp/conversas/${conversaId}/mensagens`);
    },
    async assumirConversaWhatsapp(conversaId) {
      return request(`/firm/whatsapp/conversas/${conversaId}/assumir`, { method: "POST" });
    },
    async devolverConversaWhatsapp(conversaId) {
      return request(`/firm/whatsapp/conversas/${conversaId}/devolver`, { method: "POST" });
    },
    // ⚠ Fora da janela de 24h o servidor responde 409 FORA_DA_JANELA — chega como erro com `code`
    // e `payload.message`; a tela mostra o motivo, nunca "falhou".
    async responderConversaWhatsapp(conversaId, texto) {
      return request(`/firm/whatsapp/conversas/${conversaId}/responder`, { method: "POST", body: JSON.stringify({ texto }) });
    },
    async vincularConversaWhatsapp(conversaId, body) {
      return request(`/firm/whatsapp/conversas/${conversaId}/vincular`, { method: "POST", body: JSON.stringify(body || {}) });
    },
    async getConsumoIa() {
      return request(`/firm/ia/consumo`);
    },
    // ⚠ A ÚNICA chamada deste par que devolve senha, e ela é uma senha NOVA — o servidor a GERA.
    // POST de propósito: escreve a linha de auditoria, revoga as sessões do usuário, e um verbo
    // repetível seria repetido de graça por refresh/"abrir em nova aba" — cada repetição sendo
    // outra senha, invalidando a que o contador acabou de ditar ao cliente.
    //
    // ⚠ `userId` na URL e OBRIGATÓRIO: a senha é DE UM USUÁRIO, e o servidor nunca escolhe sozinho.
    // ⚠ `confirmado` viaja explícito — o servidor recusa sem ele (400 `confirmacao_obrigatoria`).
    async resetPortalUserPassword(companyId, userId, { confirmado } = {}) {
      return request(`/firm/companies/${companyId}/acesso-portal/${userId}/senha`, {
        method: "POST",
        body: JSON.stringify({ confirmado: confirmado === true }),
      });
    },
    async listCompanyCredentialAccesses(companyId, limite) {
      const q = limite ? `?limite=${encodeURIComponent(limite)}` : "";
      return request(`/firm/companies/${companyId}/credenciais/acessos${q}`);
    },
    // ── "Outras informações" da empresa — NÃO cifradas ─────────────────────────────────────
    async listCompanyInfos(companyId) {
      return request(`/firm/companies/${companyId}/informacoes`);
    },
    async createCompanyInfo(companyId, { rotulo, valor }) {
      return request(`/firm/companies/${companyId}/informacoes`, {
        method: "POST",
        body: JSON.stringify({ rotulo, valor }),
      });
    },
    async updateCompanyInfo(companyId, infoId, patch) {
      return request(`/firm/companies/${companyId}/informacoes/${infoId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    async deleteCompanyInfo(companyId, infoId) {
      return request(`/firm/companies/${companyId}/informacoes/${infoId}`, { method: "DELETE" });
    },
    // O extrato do Simples (declaração/recibo do PGDAS-D). Mesmo padrão do SITFIS: o `<a href>`
    // não carrega o token, então o PDF vem como blob autenticado.
    async fetchPgdasPdfBlob(companyId, competencia, tipo = "declaracao") {
      const baseUrl = getApiBaseUrl();
      const headers = {};
      const tok = accessToken || readStoredToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(
        `${baseUrl}/firm/companies/${companyId}/pgdas/${encodeURIComponent(competencia)}/pdf?tipo=${encodeURIComponent(tipo)}`,
        { method: "GET", headers },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const err = new Error(payload?.message || "O arquivo não está mais no armazenamento.");
        err.code = payload?.error || "PGDAS_PDF_FETCH_FAILED";
        throw err;
      }
      return res.blob();
    },
    async fetchSitfisPdfBlob(companyId) {
      const baseUrl = getApiBaseUrl();
      const headers = {};
      const tok = accessToken || readStoredToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(`${baseUrl}/firm/companies/${companyId}/serpro/sitfis/pdf`, { method: "GET", headers });
      if (!res.ok) {
        const err = new Error(`Falha ao baixar o PDF da situação fiscal (HTTP ${res.status})`);
        err.code = "SITFIS_PDF_FETCH_FAILED";
        throw err;
      }
      return res.blob();
    },
    // Q40: dispara o cron de confirmação de pagamento para todas as guias OPEN.
    async runSerproPaymentConfirmation(input = {}) {
      return request(`/firm/serpro/payment-confirmation/run-now`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    // Dispara manualmente o cron do SERPRO (DAS + INSS) para todas as empresas elegíveis.
    async runSerproCron(input = {}) {
      return request(`/firm/serpro/cron/run`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async uploadGuides(files) {
      const formData = new FormData();
      for (const file of Array.isArray(files) ? files : []) {
        formData.append("files", file);
      }
      return request("/firm/guides/upload", {
        method: "POST",
        body: formData,
      });
    },
    async getUnidentifiedGuides(params = {}) {
      const query = new URLSearchParams();
      if (params.page) query.set("page", String(params.page));
      if (params.limit) query.set("limit", String(params.limit));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const payload = await request(`/firm/guides/unidentified${suffix}`);
      return {
        data: Array.isArray(payload?.data) ? payload.data : [],
        page: Number(payload?.page || 1),
        limit: Number(payload?.limit || 25),
        total: Number(payload?.total || 0),
      };
    },
    async getPendingGuidesReport(params = {}) {
      const query = new URLSearchParams();
      if (params.companyId) query.set("companyId", String(params.companyId));
      if (params.competencia) query.set("competencia", String(params.competencia));
      if (params.emailStatus) query.set("emailStatus", String(params.emailStatus));
      if (params.page) query.set("page", String(params.page));
      if (params.limit) query.set("limit", String(params.limit));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const payload = await request(`/firm/guides/pending-report${suffix}`);
      return {
        data: Array.isArray(payload?.data) ? payload.data : [],
        page: Number(payload?.page || 1),
        limit: Number(payload?.limit || 25),
        total: Number(payload?.total || 0),
      };
    },
    async sendSelectedPendingEmails(guideIds) {
      return request("/firm/guides/emails/send-selected", {
        method: "POST",
        body: JSON.stringify({
          guideIds: Array.isArray(guideIds) ? guideIds : [],
        }),
      });
    },

    // ── Plano de Contas ────────────────────────────────────────────────────
    async getChartOfAccounts(companyId) {
      const payload = await request(`/firm/companies/${companyId}/chart-of-accounts`);
      return Array.isArray(payload?.data) ? payload.data : [];
    },
    async createChartOfAccount(companyId, input) {
      return request(`/firm/companies/${companyId}/chart-of-accounts`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async updateChartOfAccount(companyId, codigo, input) {
      return request(`/firm/companies/${companyId}/chart-of-accounts/${encodeURIComponent(codigo)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async deleteChartOfAccount(companyId, codigo) {
      return request(`/firm/companies/${companyId}/chart-of-accounts/${encodeURIComponent(codigo)}`, {
        method: "DELETE",
      });
    },
    async importChartOfAccountsFile(companyId, file) {
      const formData = new FormData();
      formData.append("file", file);
      return request(`/firm/companies/${companyId}/chart-of-accounts/import`, {
        method: "POST",
        body: formData,
      });
    },

    // ── Plano de Contas Global ─────────────────────────────────────────────
    async getGlobalChartOfAccounts() {
      const payload = await request(`/firm/chart-of-accounts/global`);
      return Array.isArray(payload?.data) ? payload.data : [];
    },
    // Indica se o plano global tem cobertura mínima (5 tipos básicos) — pré-requisito para criar empresas.
    async getGlobalChartStatus() {
      return request(`/firm/chart-of-accounts/global/status`);
    },

    // ── Q6: Funções de Lançamento (templates reutilizáveis) ───────────────
    async listAccountingFunctions(companyId) {
      const payload = await request(`/firm/companies/${companyId}/accounting-functions`);
      return Array.isArray(payload?.data) ? payload.data : [];
    },
    async createAccountingFunction(companyId, body) {
      return request(`/firm/companies/${companyId}/accounting-functions`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    async updateAccountingFunction(companyId, functionId, body) {
      return request(`/firm/companies/${companyId}/accounting-functions/${functionId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    async deleteAccountingFunction(companyId, functionId) {
      return request(`/firm/companies/${companyId}/accounting-functions/${functionId}`, {
        method: "DELETE",
      });
    },
    async applyAccountingFunction(companyId, functionId, { competencia, entryValores }) {
      return request(`/firm/companies/${companyId}/accounting-functions/${functionId}/apply`, {
        method: "POST",
        body: JSON.stringify({ competencia, entryValores }),
      });
    },

    // ── Q9: Parcelamentos (Simples, INSS, DARF, OUTRO) ───────────────────
    async listParcelamentos(companyId, params = {}) {
      const q = new URLSearchParams();
      if (params.status) q.set("status", params.status);
      const suffix = q.toString() ? `?${q}` : "";
      const payload = await request(`/firm/companies/${companyId}/parcelamentos${suffix}`);
      return Array.isArray(payload?.data) ? payload.data : [];
    },
    // ⚠ `getParcelamento` FOI REMOVIDA (F2.3), com a rota `GET /parcelamentos/:parcId`. Ela devolvia
    // o MESMO objeto decorado que `listParcelamentos` já devolve para a lista inteira e não tinha um
    // chamador sequer — enquanto existia, era o curinga que engolia as rotas literais de
    // `/parcelamentos/` registradas depois dela.
    async createParcelamento(companyId, body) {
      return request(`/firm/companies/${companyId}/parcelamentos`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    // Q21/Q23: sobe guia manual como 1ª parcela → cria/anexa + provisão (≥3 linhas). Sem pagamento.
    async ingestParcelamento(companyId, body) {
      return request(`/firm/companies/${companyId}/parcelamentos/ingestao`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    // Q23: contas memorizadas das linhas-padrão da provisão (pré-preenche o modal).
    async getContasProvisao(companyId, tipo) {
      return request(`/firm/companies/${companyId}/parcelamentos/contas-provisao?tipo=${encodeURIComponent(tipo)}`);
    },
    // Q28 Fase 1: consulta um parcelamento no SERPRO por código (OBTERPARC164) p/ pré-preencher o modal.
    async consultarParcelamentoSerpro(companyId, { tipo, numeroParcelamento }) {
      return request(`/firm/companies/${companyId}/parcelamentos/consultar-serpro`, {
        method: "POST",
        body: JSON.stringify({ tipo, numeroParcelamento }),
      });
    },
    // Q28 Fase 2: ver/editar a config de lançamento (provisão + pagamento) de um parcelamento.
    async getParcelamentoConfig(companyId, parcId) {
      return request(`/firm/companies/${companyId}/parcelamentos/${parcId}/config`);
    },
    async saveParcelamentoConfig(companyId, parcId, body) {
      return request(`/firm/companies/${companyId}/parcelamentos/${parcId}/config`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    },
    // Q28 Fase 3: fila de conferência de parcelas (pagas a conferir / divergentes).
    async getConferenciaParcelas(companyId) {
      return request(`/firm/companies/${companyId}/parcelas/conferencia`);
    },
    async aprovarConferenciaParcelas(companyId, guideIds) {
      return request(`/firm/companies/${companyId}/parcelas/conferencia/aprovar`, {
        method: "POST",
        body: JSON.stringify({ guideIds }),
      });
    },
    // ⚠ `linkGuideToParcelamento` E `payParcela` FORAM REMOVIDAS (F2.3), com as rotas
    // `POST /parcelamentos/:parcId/link-guide` e `POST /parcelamentos/:parcId/parcelas/:num/pagar`.
    // As duas operavam sobre as linhas leves `tipo="PARCELA"` que só o V1 cria; produção não tem um
    // parcelamento V1 e nenhuma tela as chamava. Vincular guia hoje é `ingestParcelamento` com
    // `guideId`; a baixa é `lancarBaixaParcela`.
    async rescindirParcelamento(companyId, parcId, { dataRescisao, observacoes, rescisaoLines } = {}) {
      return request(`/firm/companies/${companyId}/parcelamentos/${parcId}/rescindir`, {
        method: "POST",
        body: JSON.stringify({ dataRescisao, observacoes, rescisaoLines }),
      });
    },
    // ── OS ATOS DO CONTRATO: excluir, e desfazer a rescisão ─────────────────
    //
    // ⚠ CADA UM TEM PREVIEW PRÓPRIO, e o preview NÃO ESCREVE NADA. A confirmação precisa dos
    // números de AGORA (quantas prestações, quantas guias, quantos lançamentos, quanto somam, quais
    // competências estão fechadas) — só o servidor sabe. Um "tem certeza?" sem esses números pede a
    // decisão e sonega o que a sustenta, que é o oposto de dar autonomia ao contador.
    async previewExclusaoParcelamento(companyId, parcId) {
      const payload = await request(`/firm/companies/${companyId}/parcelamentos/${parcId}/exclusao/preview`);
      return payload?.preview || null;
    },
    // ⚠ `totalConferido` é o número que o contador VIU. O servidor recompara e recusa com 409
    // `CONFERENCIA_DIVERGENTE` se o contrato mudou entre a tela e o clique (o worker trouxe mais uma
    // guia, outra sessão lançou uma baixa). Sem mandá-lo, essa guarda não existe.
    async excluirParcelamento(companyId, parcId, { motivo, totalConferido } = {}) {
      return request(`/firm/companies/${companyId}/parcelamentos/${parcId}/exclusao`, {
        method: "POST",
        body: JSON.stringify({ motivo, totalConferido: totalConferido ?? null }),
      });
    },
    async previewDesfazerRescisao(companyId, parcId) {
      const payload = await request(`/firm/companies/${companyId}/parcelamentos/${parcId}/desfazer-rescisao/preview`);
      return payload?.preview || null;
    },
    async desfazerRescisaoParcelamento(companyId, parcId, { motivo } = {}) {
      return request(`/firm/companies/${companyId}/parcelamentos/${parcId}/desfazer-rescisao`, {
        method: "POST",
        body: JSON.stringify({ motivo }),
      });
    },
    // Q31 Parte D: vincula/desvincula uma provisão (competência aberta) a um parcelamento (só marca).
    async vincularEntryParcelamento(companyId, entryId, parcelamentoId) {
      return request(`/firm/companies/${companyId}/entries/${entryId}/vincular-parcelamento`, {
        method: "POST",
        body: JSON.stringify({ parcelamentoId: parcelamentoId || null }),
      });
    },

    // ── O PORTÃO DA EMISSÃO PELO CLIENTE (18/08/2026) ──────────────────────
    // Liga/desliga, por empresa, quem do LADO DO CLIENTE pode emitir e cancelar NFS-e. Quem lê a
    // chave é o portão dos dois atos fiscais no backend (`routes/middlewares/emissaoNfseGate.js`);
    // o `companyId` aqui é o `PortalClient.id`, como em todas as rotas `/firm/companies/:id/*`.
    async setEmissaoClienteNfse(companyId, liberada) {
      return request(`/firm/companies/${companyId}/emissao-cliente`, {
        method: "PATCH",
        body: JSON.stringify({ liberada: Boolean(liberada) }),
      });
    },

    // ── O SALVAR PRÓPRIO DA ABA DE EMISSÃO DE NFS-e (dono, 19/08/2026) ─────────────────────────
    //
    // ⚠ NÃO É `updateCompany`, e a diferença é o ponto inteiro. `buildCompanyPayload` monta a
    // empresa INTEIRA (`String(input.x || "")` em ~30 campos): usá-lo aqui mandaria razão social,
    // endereço e CNAE em branco a partir de um formulário que não tem esses campos. A rota do
    // cadastro recusaria com 400 — e, nos campos que ela aceita, o que não fosse enviado seria
    // zerado. Por isso a aba tem rota própria, que aceita SÓ estes sete campos.
    //
    // ⚠ MANDA APENAS O QUE A ABA TEM, e nada é preenchido "por garantia": o backend usa a presença
    // da CHAVE para separar "não mexer" (ausente) de "apagar" (`""`/`[]`). Acrescentar uma chave
    // com `undefined` aqui é inofensivo (o `JSON.stringify` a descarta), mas mandar `""` no lugar
    // de omitir apagaria a configuração que a tela não estava editando.
    async updateEmissaoNfse(companyId, campos) {
      return request(`/firm/companies/${companyId}/emissao-nfse`, {
        method: "PATCH",
        body: JSON.stringify(campos || {}),
      });
    },

    // ── Q11.1: Suspender / Reativar / Excluir empresa ──────────────────────
    async suspendCompany(companyId, reason) {
      return request(`/firm/companies/${companyId}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    async resumeCompany(companyId) {
      return request(`/firm/companies/${companyId}/resume`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    async deleteCompany(companyId, { confirmCnpj }) {
      return request(`/firm/companies/${companyId}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmCnpj }),
      });
    },
    async createGlobalChartOfAccount(input) {
      return request(`/firm/chart-of-accounts/global`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async updateGlobalChartOfAccount(codigo, input) {
      return request(`/firm/chart-of-accounts/global/${encodeURIComponent(codigo)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async deleteGlobalChartOfAccount(codigo) {
      return request(`/firm/chart-of-accounts/global/${encodeURIComponent(codigo)}`, {
        method: "DELETE",
      });
    },
    async importGlobalChartOfAccountsFile(file) {
      const formData = new FormData();
      formData.append("file", file);
      return request(`/firm/chart-of-accounts/global/import`, {
        method: "POST",
        body: formData,
      });
    },

    // ── Lançamentos ────────────────────────────────────────────────────────
    async getAccountingEntries(companyId, params = {}) {
      const query = new URLSearchParams();
      if (params.competencia) query.set("competencia", params.competencia);
      if (params.tipo) query.set("tipo", params.tipo);
      if (params.origem) query.set("origem", params.origem);
      if (params.status) query.set("status", params.status);
      if (params.page) query.set("page", String(params.page));
      if (params.limit) query.set("limit", String(params.limit));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const payload = await request(`/firm/companies/${companyId}/entries${suffix}`);
      return {
        data: Array.isArray(payload?.data) ? payload.data : [],
        total: Number(payload?.total || 0),
        page: Number(payload?.page || 1),
        limit: Number(payload?.limit || 50),
      };
    },
    async createAccountingEntry(companyId, input) {
      return request(`/firm/companies/${companyId}/entries`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    // Q52: folha/pró-labore — cada linha do modal vira um lançamento individual (1 lote por competência).
    async createFolhaEntries(companyId, payload) {
      return request(`/firm/companies/${companyId}/entries/folha`, {
        method: "POST",
        body: JSON.stringify(payload || {}),
      });
    },
    async getPayrollTemplate(companyId, kind, competencia) {
      const qs = new URLSearchParams({ kind: String(kind), competencia: String(competencia) }).toString();
      return request(`/firm/companies/${companyId}/payroll/template?${qs}`);
    },

    async getBaixaTemplate(companyId, entryId) {
      return request(`/firm/companies/${companyId}/entries/${entryId}/baixa-template`);
    },
    async updateAccountingEntry(companyId, entryId, input) {
      return request(`/firm/companies/${companyId}/entries/${entryId}`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },
    async deleteAccountingEntry(companyId, entryId) {
      return request(`/firm/companies/${companyId}/entries/${entryId}`, {
        method: "DELETE",
      });
    },
    // ═══════════════════════════════════════════════════════════════════════════════════════
    // ESTORNO DA BAIXA — a porta nova (o DELETE acima recusa a baixa com 409 `USE_ESTORNO`)
    // ═══════════════════════════════════════════════════════════════════════════════════════
    //
    // Desfazer uma baixa nunca foi "excluir um lançamento": some um pagamento do razão, um passivo
    // volta a existir e uma parcela volta para a fila. Enquanto isso era EFEITO do DELETE não havia
    // onde exigir o motivo nem onde gravar quem desfez; hoje o backend recusa o verbo antigo de
    // propósito, senão a exigência do motivo seria contornável por ele.
    //
    // As DUAS chamadas são necessárias. O preview não é conveniência de tela: é o que o contador
    // CONFERE antes de confirmar, e o `totalEstornado` que ele devolve volta no POST como
    // `totalConferido` — se a baixa mudou entre a tela e o clique (outra sessão, ou o worker de
    // confirmação de pagamento acrescentando o juros ao lote), o servidor recusa com 409 em vez de
    // desfazer algo diferente do que foi confirmado.
    async previewEstornoBaixa(companyId, entryId) {
      return request(`/firm/companies/${companyId}/entries/${entryId}/estorno/preview`);
    },
    async estornarBaixa(companyId, entryId, { motivo, totalConferido } = {}) {
      return request(`/firm/companies/${companyId}/entries/${entryId}/estorno`, {
        method: "POST",
        // `totalConferido` só viaja quando existe: a rota o trata como OPCIONAL (um script de
        // remediação não tem tela para conferir), e mandar `null` seria dizer "conferi zero".
        body: JSON.stringify({
          motivo,
          ...(totalConferido != null ? { totalConferido: Number(totalConferido) } : {}),
        }),
      });
    },
    async createBaixa(companyId, entryId, input) {
      return request(`/firm/companies/${companyId}/entries/${entryId}/baixa`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    // Q47: baixa do INSS (guia sintética na Circular) — roteada pela guia, não por entryId.
    async getInssBaixaTemplate(companyId, guideId) {
      return request(`/firm/companies/${companyId}/guides/${guideId}/inss-baixa-template`);
    },
    async saveInssBaixa(companyId, guideId, input) {
      return request(`/firm/companies/${companyId}/guides/${guideId}/inss-baixa`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    // ⚠ `createParcelamentoSimples` FOI REMOVIDA (F2.3). Ela chamava
    // `POST /firm/companies/:id/entries/parcelamento`, uma rota que **não existe mais** no backend —
    // o botão que a acionava ("Lançamentos → Funções → + Parcelamento Simples") dava 404. Ela criava
    // N provisões com `subtipo: "PARC_DAS"`, e produção tem ZERO lançamentos com esse subtipo: a
    // rota nunca foi usada. Parcelamento hoje é CONTRATO, criado por `ingestParcelamento`.
    // Matriz "empresa × tipo de guia" para a página de envio em lote.
    async getBatchEmailReport(competencia) {
      const q = competencia ? `?competencia=${encodeURIComponent(competencia)}` : "";
      return request(`/firm/guides/batch-report${q}`);
    },
    // Envia 1 e-mail por empresa selecionada (com todas as guias da competência anexadas).
    async sendBatchEmails(items) {
      return request(`/firm/guides/batch-send`, {
        method: "POST",
        body: JSON.stringify({ items: Array.isArray(items) ? items : [] }),
      });
    },
    // ── ENVIO DE GUIAS POR WHATSAPP — contrato LIDO de `routes/firm/whatsappGuias.js` ────────────
    // O estado do canal: flag ligada? template aprovado? A tela pergunta ANTES de oferecer o botão.
    async getCanalWhatsapp() {
      return request(`/firm/guides/whatsapp/canal`);
    },
    // UMA guia, por WhatsApp. 422 com motivo NOMEADO (SEM_CONTATO, SEM_OPT_IN, TEMPLATE_NAO_APROVADO,
    // GUIA_JA_ENVIADA…) chega como erro com `code`; quem chama trata a recusa como desfecho.
    async enviarGuiaWhatsapp(companyId, guideId) {
      return request(`/firm/companies/${companyId}/guides/${guideId}/enviar-whatsapp`, { method: "POST" });
    },
    // A PRÉVIA do lote — não envia nada. Body: { competencia, portalClientIds?, guideIds? }.
    async preverLoteWhatsapp(body) {
      return request(`/firm/guides/whatsapp/lote/previa`, { method: "POST", body: JSON.stringify(body || {}) });
    },
    // O LOTE. Exige `conferencia` repetindo os números da prévia (409 CONFERENCIA_DIVERGENTE senão).
    async executarLoteWhatsapp(body) {
      return request(`/firm/guides/whatsapp/lote`, { method: "POST", body: JSON.stringify(body || {}) });
    },
    async getCircular(companyId, { year } = {}) {
      const q = year ? `?year=${year}` : "";
      return request(`/firm/companies/${companyId}/entries/circular${q}`);
    },
    async getCircularAccountingEntries(companyId, competencia) {
      return request(`/firm/companies/${companyId}/circular/${encodeURIComponent(competencia)}/accounting-entries`);
    },
    async updateCircular(companyId, competencia, input = {}) {
      return request(`/firm/companies/${companyId}/circular/${encodeURIComponent(competencia)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async syncPgdasCircular(companyId, competencia, input = {}) {
      return request(`/firm/companies/${companyId}/circular/${encodeURIComponent(competencia)}/sync-pgdas`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async approveAccountingEntry(companyId, entryId) {
      return request(`/firm/companies/${companyId}/entries/${entryId}/approve`, {
        method: "PATCH",
      });
    },
    async previewOFX(companyId, file) {
      const formData = new FormData();
      formData.append("file", file);
      return request(`/firm/companies/${companyId}/entries/import/ofx?preview=1`, {
        method: "POST",
        body: formData,
      });
    },
    async importOFX(companyId, { transactions }) {
      return request(`/firm/companies/${companyId}/entries/import/ofx`, {
        method: "POST",
        body: JSON.stringify({ transactions }),
      });
    },
    async previewExcelImport(companyId, file) {
      const formData = new FormData();
      formData.append("file", file);
      return request(`/firm/companies/${companyId}/entries/import/excel?preview=1`, {
        method: "POST",
        body: formData,
      });
    },
    async commitExcelImport(companyId, transactions) {
      return request(`/firm/companies/${companyId}/entries/import/excel`, {
        method: "POST",
        body: JSON.stringify({ transactions }),
      });
    },
    async searchHistoricos(companyId, q) {
      const query = new URLSearchParams();
      if (q) query.set("q", q);
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const payload = await request(`/firm/companies/${companyId}/historicos${suffix}`);
      return Array.isArray(payload) ? payload : [];
    },
    async getAllHistoricos(companyId) {
      const payload = await request(`/firm/companies/${companyId}/historicos?limit=200`);
      return Array.isArray(payload) ? payload : [];
    },
    async updateHistorico(companyId, id, input) {
      return request(`/firm/companies/${companyId}/historicos/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      });
    },
    async getHistoricosByCode(companyId, codigo) {
      const payload = await request(`/firm/companies/${companyId}/historicos/by-code/${encodeURIComponent(codigo)}`);
      return Array.isArray(payload) ? payload : [];
    },
    async deleteHistorico(companyId, id) {
      return request(`/firm/companies/${companyId}/historicos/${id}`, { method: "DELETE" });
    },

    getEntriesExportCsvUrl(companyId, params = {}) {
      const baseUrl = getApiBaseUrl();
      const query = new URLSearchParams();
      if (params.competencia) query.set("competencia", params.competencia);
      if (params.competenciaInicio) query.set("competenciaInicio", params.competenciaInicio);
      if (params.competenciaFim) query.set("competenciaFim", params.competenciaFim);
      if (params.tipo) query.set("tipo", params.tipo);
      if (params.status) query.set("status", params.status);
      const suffix = query.toString() ? `?${query.toString()}` : "";
      return `${baseUrl}/firm/companies/${companyId}/entries/export/csv${suffix}`;
    },

    /**
     * Emite uma NFS-e. O corpo é EXATAMENTE o que `validators/nfsePayload.js` aceita — quem monta
     * é o wizard, e o preview obrigatório é a última porta antes desta chamada.
     * ⚠ Ato fiscal irreversível: não chamar sem confirmação explícita do contador.
     */
    async emitirNfse(payload) {
      return request("/nfse/issue", { method: "POST", body: JSON.stringify(payload) });
    },

    // ── Onboarding (funil pré-cadastro) ───────────────────────────────────
    // ⚠ Estas rotas NÃO ficam sob `/firm/companies/:id` — a ficha existe justamente porque a
    // empresa ainda não existe.
    async criarOnboarding(origem) {
      return request("/firm/onboardings", { method: "POST", body: JSON.stringify({ origem }) });
    },
    async listarOnboardings({ origem, status, q, incluirRascunhos } = {}) {
      const qs = new URLSearchParams();
      if (origem) qs.set("origem", origem);
      if (status) qs.set("status", status);
      if (q) qs.set("q", q);
      if (incluirRascunhos) qs.set("incluirRascunhos", "1");
      const sufixo = qs.toString();
      return request(`/firm/onboardings${sufixo ? `?${sufixo}` : ""}`);
    },
    async getOnboarding(id) {
      return request(`/firm/onboardings/${id}`);
    },
    async salvarOnboarding(id, patch) {
      return request(`/firm/onboardings/${id}`, { method: "PATCH", body: JSON.stringify(patch || {}) });
    },
    async salvarEtapaOnboarding(id, etapaId, patch) {
      return request(`/firm/onboardings/${id}/etapas/${etapaId}`, {
        method: "PATCH", body: JSON.stringify(patch || {}),
      });
    },
    /**
     * ⚠ Recebe o MESMO payload de `createCompany` (ou `{ vincularPortalClientId }` na recuperação).
     * ⚠ NÃO exercer em `real_with_mock_fallback`: o Proxy de `api/client.js` cai no mock em
     * QUALQUER throw, e um 409 legítimo (CNPJ já na carteira) viraria sucesso falso.
     */
    async converterOnboarding(id, payload) {
      return request(`/firm/onboardings/${id}/convert`, {
        method: "POST", body: JSON.stringify(payload || {}),
      });
    },
    async desistirOnboarding(id, motivo) {
      return request(`/firm/onboardings/${id}/desistir`, {
        method: "POST", body: JSON.stringify({ motivo: motivo || "" }),
      });
    },
    async descartarOnboarding(id) {
      return request(`/firm/onboardings/${id}`, { method: "DELETE" });
    },

    // ── Entrega por arquivo (EFD-Contribuições, ECD, ECF) ─────────────────
    // ⚠ Não geram nem transmitem arquivo nenhum: guardam o RASTRO da entrega feita no PVA.
    async getEntregasObrigacao(companyId, tipo) {
      return request(`/firm/companies/${companyId}/entregas/${tipo}`);
    },
    async salvarEntregaObrigacao(companyId, tipo, competencia, patch) {
      return request(`/firm/companies/${companyId}/entregas/${tipo}/${competencia}`, {
        method: "PUT",
        body: JSON.stringify(patch || {}),
      });
    },

    /** Receitas e despesas por competência num intervalo — a base dos relatórios. */
    async getRelatorioResumo(companyId, de, ate) {
      return request(`/firm/companies/${companyId}/relatorios/resumo?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`);
    },

    /** O que o ERP recusaria nesta competência — consultado ANTES de baixar o arquivo. */
    async getExportPreflight(companyId, competencia) {
      return request(`/firm/companies/${companyId}/entries/export/preflight?competencia=${encodeURIComponent(competencia)}`);
    },

    /** Marca a competência como exportada — chamado DEPOIS do download dar certo. */
    async confirmarExportacao(companyId, body) {
      return request(`/firm/companies/${companyId}/entries/export/confirmar`, { method: "POST", body: JSON.stringify(body) });
    },
    /** Desfaz a marca de exportado (o "Reabrir" da exportação). */
    async reabrirExportacao(companyId, body) {
      return request(`/firm/companies/${companyId}/entries/export/reabrir`, { method: "POST", body: JSON.stringify(body) });
    },

    async runCompanyFiscalAction(companyId, input) {
      return request(`/firm/companies/${companyId}/fiscal/run`, {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    async getFiscalExecutions(companyId, params = {}) {
      const query = new URLSearchParams();
      if (params.competencia) query.set("competencia", params.competencia);
      if (params.action) query.set("action", params.action);
      if (params.limit) query.set("limit", String(params.limit));
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const payload = await request(`/firm/companies/${companyId}/fiscal/executions${suffix}`);
      return Array.isArray(payload?.data) ? payload.data : [];
    },

    // ─── Q12.A: módulo Notas Fiscais ────────────────────────────────────────
    async listProcuracoes(companyId) {
      const payload = await request(`/firm/companies/${companyId}/procuracoes`);
      return Array.isArray(payload?.procuracoes) ? payload.procuracoes : [];
    },
    async createProcuracao(companyId, body) {
      return request(`/firm/companies/${companyId}/procuracoes`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    },
    async revogarProcuracao(companyId, procId) {
      return request(`/firm/companies/${companyId}/procuracoes/${procId}`, { method: "DELETE" });
    },
    async listCompetenciasNotas(companyId, ano) {
      const query = ano ? `?ano=${ano}` : "";
      const payload = await request(`/firm/companies/${companyId}/competencias${query}`);
      return {
        ano: payload?.ano || null,
        competencias: Array.isArray(payload?.competencias) ? payload.competencias : [],
      };
    },
    async getCompetenciaNotas(companyId, competencia) {
      const payload = await request(`/firm/companies/${companyId}/competencias/${competencia}`);
      return payload?.competencia || null;
    },
    async fecharCompetencia(companyId, competencia) {
      return request(`/firm/companies/${companyId}/competencias/${competencia}/fechar`, { method: "POST" });
    },
    async reabrirCompetencia(companyId, competencia, reason) {
      return request(`/firm/companies/${companyId}/competencias/${competencia}/reabrir`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
    },
    async listPendenciasPosFechamento(companyId, { onlyOpen = true } = {}) {
      const payload = await request(`/firm/companies/${companyId}/pendencias-pos-fechamento?onlyOpen=${onlyOpen}`);
      return Array.isArray(payload?.pendencias) ? payload.pendencias : [];
    },
    async resolverPendencia(companyId, pendId) {
      return request(`/firm/companies/${companyId}/pendencias-pos-fechamento/${pendId}/resolver`, { method: "POST" });
    },

    // ─── Q12.B: captura DFe ─────────────────────────────────────────────────
    async syncDfe(companyId, { env = "prod" } = {}) {
      return request(`/firm/companies/${companyId}/dfe/sync?env=${env}`, { method: "POST" });
    },
    async getDfeState(companyId) {
      const payload = await request(`/firm/companies/${companyId}/dfe/state`);
      return payload?.state || null;
    },
    async clearDfeError(companyId) {
      return request(`/firm/companies/${companyId}/dfe/clear-error`, { method: "POST" });
    },
    // Q12.B+: NFS-e via ADN
    async syncAdn(companyId, { env = "prod" } = {}) {
      return request(`/firm/companies/${companyId}/adn/sync?env=${env}`, { method: "POST" });
    },
    async getAdnState(companyId) {
      const payload = await request(`/firm/companies/${companyId}/adn/state`);
      return payload?.state || null;
    },
    async clearAdnError(companyId) {
      return request(`/firm/companies/${companyId}/adn/clear-error`, { method: "POST" });
    },
    // Q56: import MANUAL de notas (XML) — pra quando a captura automática não trouxe as notas.
    async importInvoicesXml(companyId, files) {
      const formData = new FormData();
      const list = Array.isArray(files) ? files : (files ? [files] : []);
      for (const f of list) { if (f) formData.append("files", f); }
      return request(`/clients/${companyId}/invoices/import/xml`, { method: "POST", body: formData });
    },
    // Q48: download de notas em lote (job em segundo plano + zip)
    async createNotasDownload(payload) {
      return request(`/firm/notas-download`, { method: "POST", body: JSON.stringify(payload || {}) });
    },
    async listNotasDownloads() {
      return request(`/firm/notas-download`);
    },
    // CONSULTA de notas em lote — captura no ADN/SEFAZ. ⚠ Não confundir com o download acima, que
    // só zipa XML já capturado e conclui "com sucesso" mesmo quando não há nada no banco.
    async createNotasCaptura(payload) {
      return request(`/firm/notas-captura`, { method: "POST", body: JSON.stringify(payload || {}) });
    },
    async listNotasCapturas() {
      return request(`/firm/notas-captura`);
    },
    async getNotasCaptura(jobId) {
      return request(`/firm/notas-captura/${jobId}`);
    },
    // C9: contagem dos processos em segundo plano (downloads de notas / situações fiscais).
    async getJobsAtivos() {
      return request(`/firm/jobs/ativos`);
    },
    // C8: visão anual — 12 meses × empresas (fechamento contábil + apuração por célula).
    async getCompaniesAnnual(ano) {
      return request(`/firm/companies/annual?ano=${encodeURIComponent(ano)}`);
    },
    // F2: o que trava a carteira numa competência — por empresa, o mesmo cálculo do cadeado.
    async getCarteiraFechamento(competencia) {
      return request(`/firm/companies/fechamento?competencia=${encodeURIComponent(competencia)}`);
    },
    async getNotasDownload(jobId) {
      return request(`/firm/notas-download/${jobId}`);
    },
    // Baixa o ZIP pronto como Blob (com auth Bearer) — mesmo padrão do fetchSitfisPdfBlob.
    async fetchNotasDownloadBlob(jobId) {
      const baseUrl = getApiBaseUrl();
      const headers = {};
      const tok = accessToken || readStoredToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(`${baseUrl}/firm/notas-download/${jobId}/arquivo`, { method: "GET", headers });
      if (!res.ok) {
        const err = new Error(`Falha ao baixar o ZIP de notas (HTTP ${res.status})`);
        err.code = "NOTAS_DOWNLOAD_FETCH_FAILED";
        throw err;
      }
      return res.blob();
    },
    // Q62: download em lote das situações fiscais (SITFIS) — job + zip dos PDFs armazenados.
    async createSitfisDownload(companyIds) {
      return request(`/firm/sitfis-download`, { method: "POST", body: JSON.stringify({ companyIds: companyIds || [] }) });
    },
    async getSitfisDownload(jobId) {
      return request(`/firm/sitfis-download/${jobId}`);
    },
    async fetchSitfisDownloadBlob(jobId) {
      const baseUrl = getApiBaseUrl();
      const headers = {};
      const tok = accessToken || readStoredToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(`${baseUrl}/firm/sitfis-download/${jobId}/arquivo`, { method: "GET", headers });
      if (!res.ok) {
        const err = new Error(`Falha ao baixar o ZIP de situações fiscais (HTTP ${res.status})`);
        err.code = "SITFIS_DOWNLOAD_FETCH_FAILED";
        throw err;
      }
      return res.blob();
    },
    // Q12.C.1: listagem de notas + resumo
    async listNotas(companyId, filters = {}) {
      const q = new URLSearchParams();
      ["papel", "type", "competencia", "search", "cfop", "servico", "incluirCanceladas", "limit", "offset"].forEach((k) => {
        if (filters[k] != null && filters[k] !== "") q.set(k, String(filters[k]));
      });
      const suffix = q.toString() ? `?${q.toString()}` : "";
      return request(`/firm/companies/${companyId}/notas${suffix}`);
    },
    async getNotasSummary(companyId, anoOrFilters) {
      // Backward-compat: aceita Number (ano) ou Object com filtros completos
      const q = new URLSearchParams();
      if (typeof anoOrFilters === "number") {
        q.set("ano", String(anoOrFilters));
      } else if (anoOrFilters && typeof anoOrFilters === "object") {
        const { ano, papel, type, competencia, search, cfop, servico } = anoOrFilters;
        if (ano) q.set("ano", String(ano));
        if (papel) q.set("papel", String(papel));
        if (type) q.set("type", String(type));
        if (competencia) q.set("competencia", String(competencia));
        if (search) q.set("search", String(search));
        if (cfop) q.set("cfop", String(cfop));
        if (servico) q.set("servico", String(servico));
      }
      const suffix = q.toString() ? `?${q.toString()}` : "";
      return request(`/firm/companies/${companyId}/notas/summary${suffix}`);
    },
    // A AUDITORIA PRÉ-APURAÇÃO da competência — SÓ LEITURA (não marca nota, não altera apuração,
    // não fala com ADN/SEFAZ/SERPRO). A rota é LITERAL e registrada antes de `/notas/:notaId`.
    // ── CONFERÊNCIA DE LANÇAMENTOS ──────────────────────────────────────────────────────────
    //
    // A nota recebida vira despesa, o débito do extrato vira o pagamento dela, e o contador
    // confirma. Regra e invariantes: `apps/api/src/application/declarados/CLAUDE.md`.
    //
    // ⚠ Só o TRANSPORTE mora aqui. Nenhuma decisão sobre estado, data ou conta: quem decide é o
    // servidor, e a tela lê `conferencia/lib/conferenciaTela.js` para saber o que OFERECER.
    /**
     * ⚠⚠ A CONTAGEM DAS PENDÊNCIAS — o número do BOTÃO que substituiu a aba (29/08/2026).
     *
     * ⚠ Ela existe SEPARADA de `getConferenciaFila` de propósito: a barra de Lançamentos pede este
     * número a cada abertura da aba, e a fila é a consulta CARA (pagina, serializa e traz o
     * casamento). Contar com `fila.total` obrigaria a trazer a fila para desenhar um selo.
     *
     * ⚠⚠ **O TOTAL SOMA TRÊS FILAS** — declarados pendentes + séries `PENDENTE` + saídas avulsas
     * `PENDENTE`. Um número que conte só a primeira faria o contador **nunca ver o que o cliente
     * digitou**, que é justamente o que o botão existe para resolver.
     */
    /**
     * ⚠⚠ AS SAÍDAS QUE O CLIENTE ESCREVEU — a fila que entrou nesta tela em 29/08/2026.
     *
     * > Dono: *"essas saídas que o cliente digitar aparecem para o contador na aba de conferência"*.
     *
     * ⚠ Ela é uma consulta À PARTE da fila dos declarados, e não um filtro dela: são tabelas
     * diferentes, com vocabulários de estado diferentes. Misturá-las numa lista só faria a coluna
     * "estado" significar duas coisas.
     */
    async getConferenciaSaidasDoCliente(companyId) {
      return request(`/firm/companies/${companyId}/conferencia/saidas-do-cliente`);
    },

    /**
     * ⚠⚠ CONFIRMAR NÃO LANÇA NADA — o que se decide é se a PREVISÃO do cliente fica no fluxo dele.
     * ⚠ `estado` é `CONFIRMADA` | `RECUSADA`, e **recusar exige motivo** (o servidor recusa sem
     * ele): ausência nunca é resposta, e o cliente precisa saber por que a linha dele saiu.
     */
    async postConferenciaSaidaDecidir(companyId, saidaId, corpo = {}) {
      return request(`/firm/companies/${companyId}/conferencia/saidas-do-cliente/${saidaId}/decidir`, {
        method: "POST",
        body: JSON.stringify(corpo || {}),
      });
    },

    /**
     * ⚠⚠ O QUE O CLIENTE MEXEU NAS SAÍDAS QUE ELE NÃO CRIOU — a quarta fila (31/08/2026).
     *
     * > Dono: *"pode ser excluído uma saída pelo usuário. ou alterado a data"* e *"planeje e pense,
     * > como isso vai ser mostrado ao contador."*
     *
     * ⚠⚠ A linha que ele mexeu pode ter entrado no fluxo SOZINHA (a regra dos 10%). Se ele a exclui
     * e ela só some, o escritório continua achando que a projeção existe — e o fluxo que os dois
     * olham deixa de ser o mesmo fluxo.
     * ⚠ Ela NÃO entra na contagem âmbar do botão "A lançar": as outras três filas pedem uma
     * DECISÃO, esta é CIÊNCIA. Âmbar permanente treina o olho a ignorar a cor.
     */
    async getConferenciaMexidasDoCliente(companyId) {
      return request(`/firm/companies/${companyId}/conferencia/mexidas-do-cliente`);
    },

    /** ⚠ O desfazer: a série volta ao fluxo do cliente. Sem ele, a exclusão é definitiva na prática. */
    async postConferenciaMexidaDesfazer(companyId, serieId) {
      return request(`/firm/companies/${companyId}/conferencia/mexidas-do-cliente/${serieId}/desfazer`, {
        method: "POST",
      });
    },

    /**
     * ⚠ `competencia` é OPCIONAL, e quem a passa é a TELA, não o botão.
     *
     * O selo da barra de Lançamentos chama SEM ela de propósito — a fila é o que espera alguém em
     * qualquer mês. A tela abre filtrada, e passa a competência para poder dizer quantos ficaram
     * fora do mês aberto. Sem isso os dois números divergem e se leem como defeito.
     */
    async getConferenciaPendencias(companyId, { competencia } = {}) {
      const q = new URLSearchParams();
      if (competencia) q.set("competencia", competencia);
      const qs = q.toString();
      return request(`/firm/companies/${companyId}/conferencia/pendencias${qs ? `?${qs}` : ""}`);
    },
    async getConferenciaFila(companyId, { competencia, estado, pagina, porPagina } = {}) {
      const q = new URLSearchParams();
      // ⚠⚠ `competencia` pode ser o literal `sem-competencia` — o RECORTE das notas que chegaram
      // sem competência. Ele não é um mês, e sem ele essas notas ficam invisíveis para sempre
      // (`where.competencia = "2026-07"` não casa com NULL em SQL).
      if (competencia) q.set("competencia", String(competencia));
      // ⚠ Sem `estado`, o servidor devolve o padrão (o que espera alguém). Não mandamos uma lista
      // default daqui: duas definições de "a fila" divergiriam na primeira mudança.
      if (estado) q.set("estado", String(estado));
      if (pagina) q.set("pagina", String(pagina));
      if (porPagina) q.set("porPagina", String(porPagina));
      const qs = q.toString();
      return request(`/firm/companies/${companyId}/conferencia${qs ? `?${qs}` : ""}`);
    },
    // ⚠ `acao` é o segmento da rota (`confirmar`, `ajustar`, `recusar`, `reabrir`, `desfazer`,
    // `informar-pagamento`) — a MESMA chave do vocabulário `ACAO` da tela.
    async postConferenciaAcao(companyId, declaradoId, acao, corpo = {}) {
      return request(`/firm/companies/${companyId}/conferencia/${declaradoId}/${acao}`, {
        method: "POST",
        body: JSON.stringify(corpo || {}),
      });
    },
    /** ⚠ A saída do cliente virando lançamento contábil. A conta é escolha de quem clica. */
    async postConferenciaSaidaLancar(companyId, saidaId, { contaDespesa } = {}) {
      return request(`/firm/companies/${companyId}/conferencia/saidas-do-cliente/${saidaId}/lancar`, {
        method: "POST",
        body: JSON.stringify({ contaDespesa }),
      });
    },
    // As sugestões de casamento débito × nota. ⚠ DERIVADAS NA LEITURA — não há coluna de sugestão.
    async getConferenciaCasamentos(companyId) {
      return request(`/firm/companies/${companyId}/conferencia/casamentos`);
    },
    // ─── AS RECORRÊNCIAS ──────────────────────────────────────────────────────────────────────
    //
    // ⚠⚠ O `GET` NÃO ESCREVE NADA: a observação é DERIVADA na leitura, nunca coluna. E `indisponivel`
    // vem no corpo — sem ele, "esta empresa não tem recorrência" e "a tabela não existe neste banco"
    // ficariam idênticos na tela, e o primeiro é uma AFIRMAÇÃO sobre a empresa.
    //
    // ⚠ `cicloAtual` é o "agora" INJETADO. Ele viaja explícito porque a leitura inteira (quantos
    // ciclos desde a última observação, se sugere saída) se apoia nele.
    async getRecorrencias(companyId, cicloAtual) {
      const q = new URLSearchParams();
      if (cicloAtual) q.set("cicloAtual", String(cicloAtual));
      const qs = q.toString();
      return request(`/firm/companies/${companyId}/recorrencia${qs ? `?${qs}` : ""}`);
    },
    /**
     * ⚠⚠ A MARCAÇÃO — é ela, e só ela, que põe a linha no fluxo de caixa.
     *
     * ⚠ `baseDaObservacao` viaja: é a EVIDÊNCIA que o contador VIU no instante da decisão. O servidor
     * não a recalcula, de propósito — recalculada, ela seria uma leitura diferente da que ele olhou,
     * e é a dele que responde "por que esta linha está no fluxo?" daqui a seis meses.
     */
    async postMarcarRecorrencia(companyId, corpo) {
      return request(`/firm/companies/${companyId}/recorrencia/marcar`, {
        method: "POST",
        body: JSON.stringify(corpo || {}),
      });
    },
    // ⚠ Registra que o DETECTOR sugeriu a saída. Ele não desmarca — quem decide é o contador.
    async postSaidaSugerida(companyId, serieId) {
      return request(`/firm/companies/${companyId}/recorrencia/${serieId}/saida-sugerida`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    // ⚠⚠ FUNDIR NÃO CONTABILIZA: o débito preenche o bloco de pagamento da nota e some absorvido.
    // Nenhum lançamento nasce daqui — quem leva ao razão é `confirmar`, num segundo ato.
    async postConferenciaFundir(companyId, { declaradoOfxId, declaradoNotaId }) {
      return request(`/firm/companies/${companyId}/conferencia/casamentos/fundir`, {
        method: "POST",
        body: JSON.stringify({ declaradoOfxId, declaradoNotaId }),
      });
    },
    /**
     * ⚠⚠ ABSORVER — o quarto verbo (01/09/2026), para a nota que JÁ virou lançamento.
     *
     * > Dono: *"eu posso ter feito os lançamentos através da nota, e depois importar o extrato (…)
     * > como não duplicar isso?"*
     *
     * ⚠ A diferença para `postConferenciaFundir` é o que ele NÃO faz: nada é criado no razão e a
     * nota não é tocada. O débito sai da fila porque a despesa já está lançada, do outro lado.
     * ⚠⚠ A resposta traz `divergencia` — o razão pode estar com uma data e o banco com outra, e
     * absorver não corrige isso. A decisão do dono foi AVISAR.
     */
    async postConferenciaAbsorver(companyId, { declaradoOfxId, declaradoNotaId }) {
      return request(`/firm/companies/${companyId}/conferencia/casamentos/absorver`, {
        method: "POST",
        body: JSON.stringify({ declaradoOfxId, declaradoNotaId }),
      });
    },
    // ⚠⚠ `desde` É OBRIGATÓRIA (o servidor recusa com 400 sem ela). São 1.897 notas recebidas: sem
    // corte, a primeira varredura produz a base inteira — e isso não é fila, é muro. Um default
    // aqui faria a TELA escolher o tamanho do trabalho, que é decisão do contador.
    async postVarrerNotas(companyId, desde) {
      const q = new URLSearchParams({ desde: String(desde || "") });
      return request(`/firm/companies/${companyId}/conferencia/varrer-notas?${q.toString()}`, {
        method: "POST",
      });
    },
    async getConferenciaVarredura(companyId) {
      return request(`/firm/companies/${companyId}/conferencia/varredura`);
    },
    /**
     * ⚠⚠ O BOTÃO «Sugerir contas com IA» (02/09/2026). Grava PROPOSTAS nas colunas `*Ia` das linhas
     * sem regra e sem histórico — nunca lança. Flag OFF no servidor ⇒ 503 `ia_classificacao_desligada`.
     */
    async postClassificarIa(companyId, { competencia } = {}) {
      const q = new URLSearchParams();
      if (competencia) q.set("competencia", String(competencia));
      const sufixo = q.toString() ? `?${q.toString()}` : "";
      return request(`/firm/companies/${companyId}/conferencia/classificar-ia${sufixo}`, { method: "POST" });
    },

    // ── A VARREDURA AUTOMÁTICA (01/09/2026) ───────────────────────────────────────────────────
    //
    // > Dono: *"aquela parte onde diz «trazer notas» — elas devem ser trazidas automaticamente,
    // > como tem na aba de notas fiscais deve aparecer ali."*
    //
    // ⚠⚠ A DATA-PISO CONTINUA OBRIGATÓRIA, e é o ponto: o que a automação guarda é a escolha do
    // CONTADOR, repetida a cada ciclo de captura. Um piso escolhido pelo sistema despejaria as
    // 1.897 notas recebidas na fila de uma vez.
    async getVarreduraAutomatica(companyId) {
      return request(`/firm/companies/${companyId}/conferencia/varredura-automatica`);
    },
    // ⚠ Ligar GUARDA a escolha **e varre na hora** — senão o contador escolhe a data e não vê nada
    // acontecer até o próximo ciclo do worker, o que se lê como "não funcionou".
    async postVarreduraAutomatica(companyId, desde) {
      return request(`/firm/companies/${companyId}/conferencia/varredura-automatica`, {
        method: "POST",
        body: JSON.stringify({ desde }),
      });
    },
    // ⚠ Desligar NÃO desfaz nada do que já entrou na fila: aquilo é fato consumado, e apagá-lo
    // desfaria decisões que o contador já tomou sobre aquelas notas.
    async deleteVarreduraAutomatica(companyId) {
      return request(`/firm/companies/${companyId}/conferencia/varredura-automatica`, { method: "DELETE" });
    },

    // ── A REGRA DO FORNECEDOR, E O EXTRATO DO QUE ELA LANÇOU (29/08/2026) ─────────────────────
    //
    // > Dono: *"o contador deve poder colocar o código de débito e crédito nessa despesa, e todo
    // > mês que essa nota aparecer ela já é lançada em despesa."*

    async getConferenciaRegras(companyId) {
      return request(`/firm/companies/${companyId}/conferencia/regras`);
    },

    /**
     * ⚠⚠ CRIAR A REGRA NÃO LANÇA NADA — ela passa a existir para o motor consultar.
     *
     * ⚠ `lancaSozinha` e `diaDoLancamento` são as duas coisas que ligam a automação daquele
     * fornecedor, e viajam **explícitas**: um default aqui ligaria a automação por omissão.
     * ⚠ `contaCredito` é RECUSADO pelo servidor se não for conta de disponibilidade (caixa/banco).
     */
    async postConferenciaRegra(companyId, corpo = {}) {
      return request(`/firm/companies/${companyId}/conferencia/regras`, {
        method: "POST",
        body: JSON.stringify(corpo || {}),
      });
    },

    async patchConferenciaRegra(companyId, regraId, { ativa }) {
      return request(`/firm/companies/${companyId}/conferencia/regras/${regraId}`, {
        method: "PATCH",
        body: JSON.stringify({ ativa }),
      });
    },

    /**
     * ⚠⚠ LIGAR O LANÇAMENTO AUTOMÁTICO DE UMA REGRA — porta SEPARADA da de ligar/desligar a regra.
     *
     * A separação é o ponto, e é a mesma do servidor: `ativa` decide se o sistema SUGERE;
     * `lancaSozinha` decide se ele LANÇA sem ninguém clicar. Um método só faria a tela poder ligar
     * o segundo achando que estava ligando o primeiro.
     */
    async patchConferenciaRegraAutomatico(companyId, regraId, { lancaSozinha, diaDoLancamento } = {}) {
      return request(`/firm/companies/${companyId}/conferencia/regras/${regraId}/automatico`, {
        method: "PATCH",
        body: JSON.stringify({ lancaSozinha, diaDoLancamento: diaDoLancamento ?? null }),
      });
    },

    /**
     * ⚠⚠ O EXTRATO DO QUE ENTROU SEM CLIQUE — o pré-requisito que `motorDeSugestao.js` nomeou.
     *
     * ⚠ `competencia` é OBRIGATÓRIA (o servidor recusa com 400): a pergunta é *"o que entrou sem
     * eu clicar NESTE mês?"*, e um default aqui faria a tela escolher o mês auditado.
     */
    async getLancadosPorRegra(companyId, competencia) {
      const q = new URLSearchParams({ competencia: String(competencia || "") });
      return request(`/firm/companies/${companyId}/conferencia/lancados-por-regra?${q.toString()}`);
    },

    /**
     * ⚠⚠ DESFAZER EM LOTE — é ele que torna a decisão do dono reversível.
     * ⚠ A resposta vem 200 mesmo com linhas recusadas: o lote não para, e o que falhou volta
     * NOMEADO. Tratar isso como erro esconderia que as outras foram desfeitas.
     */
    async postDesfazerLancadosPorRegra(companyId, ids) {
      return request(`/firm/companies/${companyId}/conferencia/lancados-por-regra/desfazer`, {
        method: "POST",
        body: JSON.stringify({ ids: Array.isArray(ids) ? ids : [] }),
      });
    },
    async getAuditoriaNotas(companyId, competencia) {
      const q = new URLSearchParams({ competencia: String(competencia || "") });
      return request(`/firm/companies/${companyId}/notas/auditoria?${q.toString()}`);
    },
    // A ÍNTEGRA de UMA nota (itens + XML bruto + identificadores + carimbos de captura).
    // A lista continua enxuta de propósito; a profundidade vem de clicar na linha.
    async getNota(companyId, notaId) {
      return request(`/firm/companies/${companyId}/notas/${notaId}`);
    },
    // O DANFSe da NFS-e (PDF do Padrão Nacional, NT 008), gerado sob demanda pelo backend.
    //
    // ⚠ NÃO PODE SER UM `<a href>`: a rota é autenticada e um link não leva o Bearer — mesmo motivo
    // do `fetchCompanyDocumentBlob` e do `fetchSitfisPdfBlob`. Vem como Blob e a tela entrega.
    //
    // ⚠ A RECUSA PRECISA CHEGAR NOMEADA. A rota responde **503 `danfse_sem_qrcode`** (com `motivo`)
    // quando a chave está ausente ou o QR não pôde ser gerado — e isso é deliberado: um DANFSe sem
    // QR Code não é um DANFSe. Um `Error` genérico aqui viraria "falha ao baixar" na tela, que é
    // exatamente a informação errada. Por isso o corpo JSON é lido e `code`/`motivo`/`status` sobem
    // junto, como o `request()` já faz para as demais rotas.
    async fetchDanfseBlob(companyId, notaId) {
      const baseUrl = getApiBaseUrl();
      const headers = {};
      const tok = accessToken || readStoredToken();
      if (tok) headers.Authorization = `Bearer ${tok}`;
      const res = await fetch(`${baseUrl}/firm/companies/${companyId}/notas/${notaId}/danfse`, { method: "GET", headers });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        const err = new Error(
          String(payload?.message || "").trim() || `Falha ao gerar o DANFSe (HTTP ${res.status})`,
        );
        err.code = String(payload?.error || "").trim() || "DANFSE_FETCH_FAILED";
        err.status = res.status;
        err.motivo = payload?.motivo ?? null;
        err.payload = payload;
        throw err;
      }
      return res.blob();
    },
    async marcarNotaStatus(companyId, notaId, statusEfetivo) {
      return request(`/firm/companies/${companyId}/notas/${notaId}/status`, {
        method: "PATCH", body: JSON.stringify({ statusEfetivo }),
      });
    },
    // Q12.B+++: cert A1 por empresa (upload/status/delete)
    async getCompanyCert(companyId) {
      const payload = await request(`/firm/companies/${companyId}/certificate`);
      return payload?.certificate || null;
    },
    async uploadCompanyCert(companyId, file, password) {
      const fd = new FormData();
      fd.append("pfx", file);
      fd.append("password", password);
      // request() detecta FormData e remove Content-Type (browser seta com boundary)
      return request(`/firm/companies/${companyId}/certificate`, { method: "POST", body: fd });
    },
    async deleteCompanyCert(companyId) {
      return request(`/firm/companies/${companyId}/certificate`, { method: "DELETE" });
    },

    // Q12.C.4: Apuração por empresa
    async calcularApuracao(companyId, competencia, { fs12 } = {}) {
      return request(`/firm/companies/${companyId}/apuracao/${competencia}/calcular`, {
        method: "POST",
        body: JSON.stringify({ fs12 }),
      });
    },
    async getApuracao(companyId, competencia) {
      const payload = await request(`/firm/companies/${companyId}/apuracao/${competencia}`);
      return payload?.apuracao || null;
    },
    async revisarApuracao(companyId, competencia) {
      return request(`/firm/companies/${companyId}/apuracao/${competencia}/revisar`, { method: "POST" });
    },
    async transmitirApuracao(companyId, competencia, confirmCompetencia) {
      return request(`/firm/companies/${companyId}/apuracao/${competencia}/transmitir`, {
        method: "POST",
        body: JSON.stringify({ confirmCompetencia }),
      });
    },
    async conferirApuracao(companyId, competencia) {
      return request(`/firm/companies/${companyId}/apuracao/${competencia}/conferir`, { method: "POST" });
    },
    async classificarNotas(companyId, { force = false } = {}) {
      return request(`/firm/companies/${companyId}/classificar?force=${force}`, { method: "POST" });
    },

    // Q12.C.2: Apuração global
    async listApuracao({ competencia, search } = {}) {
      const q = new URLSearchParams();
      if (competencia) q.set("competencia", competencia);
      if (search) q.set("search", search);
      const payload = await request(`/firm/apuracao?${q.toString()}`);
      return { competencia: payload?.competencia, items: payload?.items || [] };
    },

    // Q14.2 — apuração v2 (cadastro = autoridade)
    async getCadastroFiscal(companyId) {
      return request(`/firm/companies/${companyId}/cadastro-fiscal`);
    },
    async saveCadastroFiscal(companyId, payload) {
      return request(`/firm/companies/${companyId}/cadastro-fiscal`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    },
    // Módulo Fiscal (Aba Fiscal / Bloco A) — perfil de atividades permitidas.
    async getPerfilFiscal(companyId) {
      return request(`/firm/companies/${companyId}/perfil-fiscal`);
    },
    async savePerfilFiscal(companyId, perfilAtividades) {
      return request(`/firm/companies/${companyId}/perfil-fiscal`, {
        method: "PUT",
        body: JSON.stringify({ perfilAtividades }),
      });
    },
    async listProdutosServicos(companyId, { ativo = true } = {}) {
      return request(`/firm/companies/${companyId}/produtos-servicos?ativo=${ativo}`);
    },
    async createProdutoServico(companyId, payload) {
      return request(`/firm/companies/${companyId}/produtos-servicos`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async updateProdutoServico(companyId, produtoId, payload) {
      return request(`/firm/companies/${companyId}/produtos-servicos/${produtoId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    async deleteProdutoServico(companyId, produtoId) {
      return request(`/firm/companies/${companyId}/produtos-servicos/${produtoId}`, { method: "DELETE" });
    },
    async listPendencias(companyId, { resolvida = false, tipo, competencia } = {}) {
      const q = new URLSearchParams({ resolvida: String(resolvida) });
      if (tipo) q.set("tipo", tipo);
      if (competencia) q.set("competencia", competencia);
      return request(`/firm/companies/${companyId}/pendencias?${q.toString()}`);
    },
    async resolverPendencia(companyId, pendenciaId, payload) {
      return request(`/firm/companies/${companyId}/pendencias/${pendenciaId}/resolver`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async classificarV2(companyId, { force = false, competencia } = {}) {
      const q = new URLSearchParams();
      if (force) q.set("force", "true");
      if (competencia) q.set("competencia", competencia);
      return request(`/firm/companies/${companyId}/classificar-v2?${q.toString()}`, { method: "POST" });
    },
    // Q14.3 — motor de apuração local
    async apurarV2(companyId, competencia, { folha12m } = {}) {
      return request(`/firm/companies/${companyId}/apurar-v2/${competencia}`, {
        method: "POST",
        body: JSON.stringify({ folha12m }),
      });
    },
    async getApuracaoSnapshot(companyId, competencia) {
      return request(`/firm/companies/${companyId}/apuracao-snapshot/${competencia}`);
    },
    // ─── Relatório "Faturamento no Período — Consolidado" (empresas do Simples) ────────────────
    //
    // ⚠ DUAS ROTAS, E LER NÃO GERA. Um GET que gerasse faria abrir a aba recalcular a competência
    // inteira a cada visita — e o relatório é uma FOTO, com data de geração. Quem quer a foto de
    // agora clica em gerar. `relatorio: null` quando nunca foi gerado (ausência não é erro).
    //
    // ⚠ Nenhuma das duas chama ADN, SEFAZ ou SERPRO, e o POST não persiste `ApuracaoSnapshot`: o
    // pré-apurado é o motor LOCAL em `persistir: false`. Gerar é barato e não muda o estado da
    // apuração — é o que permite chamá-lo logo depois do Calcular.
    async getRelatorioFaturamento(companyId, competencia) {
      return request(`/firm/companies/${companyId}/relatorio-faturamento/${competencia}`);
    },
    async gerarRelatorioFaturamento(companyId, competencia) {
      return request(`/firm/companies/${companyId}/relatorio-faturamento/${competencia}`, { method: "POST" });
    },
    // Módulo Fiscal (§1.3) — sugestão de anexo por nota.
    async getSugestaoAnexo(companyId, competencia) {
      return request(`/firm/companies/${companyId}/apuracao-sugestao/${competencia}`);
    },
    // ─── Apuração do LUCRO PRESUMIDO ──────────────────────────────────────────────────────────
    //
    // ⚠ SÓ LEITURA, ZERO CHAMADA AO SERPRO: a rota lê as notas já capturadas e a DARF já capturada.
    // Quem gasta chamada PAGA é o botão "Buscar tributos do Presumido", na aba Lançamentos.
    // ⚠ E ela NÃO grava snapshot — `ApuracaoSnapshot.rbt12` é NOT NULL, e inventar um RBT12 para o
    // Presumido seria fabricar dado fiscal.
    //
    // ⚠⚠ `servicos16` tem TRÊS estados e o parâmetro só viaja quando FOI RESPONDIDO. `null` é "não
    // avaliado" e é o default do servidor (presunção de 32%, o comportamento de sempre); mandar
    // `servicos16=false` por omissão faria a tela afirmar, em nome do contador, que a empresa não se
    // enquadra no art. 15, § 4º.
    async getApuracaoLp(companyId, competencia, { servicos16 = null } = {}) {
      const qs = servicos16 === true || servicos16 === false ? `?servicos16=${servicos16}` : "";
      return request(`/firm/companies/${companyId}/apuracao-lp/${competencia}${qs}`);
    },
    // ─── Planejamento tributário — os dados da empresa para a simulação de regime ──────────────
    //
    // ⚠ SÓ LEITURA, e o backend não escreve nada (nem cache de RBT12): abrir um planejamento não
    // pode mudar o estado fiscal da empresa. Cada campo volta como
    // `{ valor, apurado, origem, motivoAusencia }` — `apurado: false` significa AUSENTE, com
    // `valor: null`, nunca zero. A folha é o caso que justifica o formato: lida como zero, ela
    // derruba o Fator R e troca o anexo (III → V) num PDF que vai ao cliente.
    async getDadosPlanejamento(companyId) {
      return request(`/firm/companies/${companyId}/planejamento`);
    },
    // ⚠ A FOTO da simulação. Salvar e gerar o PDF são DOIS atos, e a separação é deliberada: o
    // segundo pode falhar (sem Volume no Railway, o storage recusa) sem desfazer o primeiro — e a
    // tela precisa poder dizer "a simulação foi salva, o PDF não".
    async listarSimulacoesPlanejamento(companyId) {
      return request(`/firm/companies/${companyId}/planejamento/simulacoes`);
    },
    async salvarSimulacaoPlanejamento(companyId, payload) {
      return request(`/firm/companies/${companyId}/planejamento/simulacoes`, { method: "POST", body: payload });
    },
    async gerarDocumentoDaSimulacao(companyId, simulacaoId) {
      return request(
        `/firm/companies/${companyId}/planejamento/simulacoes/${simulacaoId}/documento`,
        { method: "POST" },
      );
    },
    // Q15 — fechamento
    async getFechamento(companyId, competencia) {
      return request(`/firm/companies/${companyId}/fechamento/${competencia}`);
    },
    async calcularFechamento(companyId, competencia, payload) {
      return request(`/firm/companies/${companyId}/fechamento/${competencia}/calcular`, {
        method: "POST", body: JSON.stringify(payload),
      });
    },
    async salvarFechamento(companyId, competencia, payload) {
      return request(`/firm/companies/${companyId}/fechamento/${competencia}/salvar`, {
        method: "POST", body: JSON.stringify(payload),
      });
    },
    async transmitirFechamento(companyId, competencia, confirmCompetencia) {
      return request(`/firm/companies/${companyId}/fechamento/${competencia}/transmitir`, {
        method: "POST", body: JSON.stringify({ confirmCompetencia }),
      });
    },
    // A declaração entregue FORA do portal (gov.br). ⚠ NÃO transmite nada: registra a afirmação do
    // contador, do nosso lado, para a competência parar de parecer esquecida sem parecer entregue
    // por aqui. `entregue:false` desfaz.
    async registrarEntregaPgdasExterna(companyId, competencia, { entregue, confirmCompetencia, observacao } = {}) {
      return request(`/firm/companies/${companyId}/fechamento/${competencia}/entrega-externa`, {
        method: "POST",
        body: JSON.stringify({ entregue: entregue === true, confirmCompetencia, observacao: observacao || null }),
      });
    },
    // Q55 — retificação: reabrir uma apuração transmitida + retransmitir como retificadora.
    async reabrirFechamento(companyId, competencia) {
      return request(`/firm/companies/${companyId}/fechamento/${competencia}/reabrir`, { method: "POST" });
    },
    async retificarFechamento(companyId, competencia, confirmCompetencia) {
      return request(`/firm/companies/${companyId}/fechamento/${competencia}/retificar`, {
        method: "POST", body: JSON.stringify({ confirmCompetencia, confirmRetificar: true }),
      });
    },
    // Q19 — lista de atividades PGDAS-D (de-para oficial) p/ o dropdown do modal de fechamento
    async listAtividadesPgdasd(companyId, dataReferencia) {
      const qs = dataReferencia ? `?dataReferencia=${encodeURIComponent(dataReferencia)}` : "";
      return request(`/firm/companies/${companyId}/atividades-pgdasd${qs}`);
    },
    // Q15 — fila batch
    async criarApuracaoBatch({ portalClientIds, competencia }) {
      return request(`/firm/apuracao/batch`, {
        method: "POST", body: JSON.stringify({ portalClientIds, competencia }),
      });
    },
    async getApuracaoBatch(jobId) {
      return request(`/firm/apuracao/batch/${jobId}`);
    },
    // Q44: processa a fila do lote sob demanda (worker de fundo pode estar desligado).
    async runApuracaoBatch(jobId) {
      return request(`/firm/apuracao/batch/${jobId}/run-now`, { method: "POST" });
    },
  };
}
