function getApiBaseUrl() {
  return String(import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function mapKnownError(payload, status) {
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
  // Erro de negócio do SERPRO: a mensagem REAL vem em payload.message (ex.: "PA já declarado",
  // atividade inválida, cadastro incompleto) — mostrar ela, não o código seco.
  if (code === "SERPRO_BUSINESS_ERROR") {
    return String(payload?.message || "").trim() || "O SERPRO rejeitou a operação (erro de negócio).";
  }

  // Fallback: prefere a mensagem humana do backend ({error, message}) antes do código cru.
  return reason || String(payload?.message || "").trim() || payload?.error || `request_failed_${status}`;
}

function normalizeError(payload, status) {
  return mapKnownError(payload, status);
}

function buildCompanyPayload(input) {
  return {
    ownerEmail: String(input.ownerEmail || "").trim().toLowerCase(),
    ownerName: String(input.ownerName || "").trim() || null,
    ownerPassword: String(input.ownerPassword || ""),
    hasProlabore: Boolean(input.hasProlabore),
    empresaZerada: Boolean(input.empresaZerada),
    company: {
      cnpj: String(input.cnpj || "").trim(),
      razaoSocial: String(input.razaoSocial || "").trim(),
      nomeFantasia: String(input.nomeFantasia || "").trim() || null,
      email: String(input.email || "").trim().toLowerCase() || null,
      guideNotificationEmail: String(input.guideNotificationEmail || "").trim().toLowerCase() || null,
      telefone: String(input.telefone || "").trim() || null,
      regimeTributario: String(input.regimeTributario || "SIMPLES"),
      cnaePrincipal: String(input.cnaePrincipal || "").trim(),
      cnaesSecundarios: [],
      endereco: {
        rua: String(input.enderecoRua || "").trim(),
        numero: String(input.enderecoNumero || "").trim(),
        bairro: String(input.enderecoBairro || "").trim(),
        cidade: String(input.enderecoCidade || "").trim(),
        uf: String(input.enderecoUf || "").trim().toUpperCase(),
        cep: String(input.enderecoCep || "").replace(/\D+/g, ""),
        complemento: String(input.enderecoComplemento || "").trim() || null,
      },
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
      throw new Error(normalizeError(payload, response.status));
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
    async updateCompany(companyId, input) {
      return request(`/firm/companies/${companyId}`, {
        method: "PATCH",
        body: JSON.stringify(buildCompanyPayload(input)),
      });
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
    // Portal Cliente (#3.1): libera/revoga as guias de uma competência para o app do cliente.
    async liberarGuiasCliente(companyId, competencia) {
      return request(`/firm/guides/liberar-cliente`, {
        method: "POST",
        body: JSON.stringify({ items: [{ portalClientId: companyId, competencia }] }),
      });
    },
    async revogarGuiasCliente(companyId, competencia) {
      return request(`/firm/guides/revogar-cliente`, {
        method: "POST",
        body: JSON.stringify({ items: [{ portalClientId: companyId, competencia }] }),
      });
    },
    // Q17: guias esperadas da competência + estado (present/vazio/missing)
    async getExpectedGuides(companyId, competencia) {
      const suffix = competencia ? `?competencia=${encodeURIComponent(competencia)}` : "";
      return request(`/firm/companies/${companyId}/guides/expected${suffix}`);
    },
    // Q17: marcar "não há guia neste mês" (Vazio) → campo amarelo
    async markGuideVazio(portalClientId, tipo, competencia) {
      return request("/firm/guides/vazio", {
        method: "POST",
        body: JSON.stringify({ portalClientId, tipo, competencia }),
      });
    },
    async undoGuideVazio(portalClientId, tipo, competencia) {
      return request("/firm/guides/vazio", {
        method: "DELETE",
        body: JSON.stringify({ portalClientId, tipo, competencia }),
      });
    },
    // Q17: fechamento CONTÁBIL do mês
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
    async getParcelamento(companyId, parcId) {
      const payload = await request(`/firm/companies/${companyId}/parcelamentos/${parcId}`);
      return payload?.data || null;
    },
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
    async linkGuideToParcelamento(companyId, parcId, { guideId, numeroParcela }) {
      return request(`/firm/companies/${companyId}/parcelamentos/${parcId}/link-guide`, {
        method: "POST",
        body: JSON.stringify({ guideId, numeroParcela }),
      });
    },
    async payParcela(companyId, parcId, numeroParcela, { jurosValor, dataPagamento }) {
      return request(`/firm/companies/${companyId}/parcelamentos/${parcId}/parcelas/${numeroParcela}/pagar`, {
        method: "POST",
        body: JSON.stringify({ jurosValor, dataPagamento }),
      });
    },
    async rescindirParcelamento(companyId, parcId, { dataRescisao, observacoes, rescisaoLines } = {}) {
      return request(`/firm/companies/${companyId}/parcelamentos/${parcId}/rescindir`, {
        method: "POST",
        body: JSON.stringify({ dataRescisao, observacoes, rescisaoLines }),
      });
    },
    // Q31 Parte D: vincula/desvincula uma provisão (competência aberta) a um parcelamento (só marca).
    async vincularEntryParcelamento(companyId, entryId, parcelamentoId) {
      return request(`/firm/companies/${companyId}/entries/${entryId}/vincular-parcelamento`, {
        method: "POST",
        body: JSON.stringify({ parcelamentoId: parcelamentoId || null }),
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
    // Cria N parcelas de um parcelamento (Simples Nacional, INSS, etc.) em transação.
    async createParcelamentoSimples(companyId, payload) {
      return request(`/firm/companies/${companyId}/entries/parcelamento`, {
        method: "POST",
        body: JSON.stringify(payload || {}),
      });
    },
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
    // Q12.C.1: listagem de notas + resumo
    async listNotas(companyId, filters = {}) {
      const q = new URLSearchParams();
      ["papel", "type", "competencia", "search", "cfop", "servico", "limit", "offset"].forEach((k) => {
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
    // Módulo Fiscal (§1.3) — sugestão de anexo por nota.
    async getSugestaoAnexo(companyId, competencia) {
      return request(`/firm/companies/${companyId}/apuracao-sugestao/${competencia}`);
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
