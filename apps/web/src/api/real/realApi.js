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
    return "O recálculo só fica disponível após o vencimento da guia.";
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

  return reason || payload?.error || `request_failed_${status}`;
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

export function createRealApi() {
  let accessToken = String(import.meta.env.VITE_API_TOKEN || "").trim();
  let unauthorizedHandler = null;

  async function request(path, options = {}) {
    const baseUrl = getApiBaseUrl();
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    const headers = {
      ...(options.headers || {}),
    };
    if (!isFormData) {
      headers["Content-Type"] = "application/json";
    }
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
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
    },
    async login({ identifier, password }) {
      const payload = await request("/auth/login", {
        method: "POST",
        body: JSON.stringify({ identifier, password }),
      });
      accessToken = String(payload?.accessToken || "").trim();
      return payload;
    },
    async me() {
      return request("/auth/me");
    },
    async listCompanies() {
      const payload = await request("/firm/companies");
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
    async getPayrollTemplate(companyId, kind, competencia) {
      const qs = new URLSearchParams({ kind: String(kind), competencia: String(competencia) }).toString();
      return request(`/firm/companies/${companyId}/payroll/template?${qs}`);
    },

    // ===== Accounting Entry Rules =====
    async listAccountingRulesEventTypes() {
      return request(`/firm/accounting-entry-rules/event-types`);
    },
    async listGlobalAccountingRules() {
      return request(`/firm/accounting-entry-rules/global`);
    },
    async createGlobalAccountingRule(payload) {
      return request(`/firm/accounting-entry-rules/global`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async listAccountingRules(companyId) {
      return request(`/firm/companies/${companyId}/accounting-entry-rules`);
    },
    async createAccountingRule(companyId, payload) {
      return request(`/firm/companies/${companyId}/accounting-entry-rules`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    async updateAccountingRule(companyId, ruleId, payload) {
      const path = companyId
        ? `/firm/companies/${companyId}/accounting-entry-rules/${ruleId}`
        : `/firm/accounting-entry-rules/${ruleId}`;
      return request(path, { method: "PUT", body: JSON.stringify(payload) });
    },
    async deactivateAccountingRule(companyId, ruleId) {
      const path = companyId
        ? `/firm/companies/${companyId}/accounting-entry-rules/${ruleId}/deactivate`
        : `/firm/accounting-entry-rules/${ruleId}/deactivate`;
      return request(path, { method: "PATCH" });
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
    async importOFX(companyId, { file, contaDebito, contaCredito, tipo }) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("contaDebito", contaDebito);
      formData.append("contaCredito", contaCredito);
      formData.append("tipo", tipo || "DESPESA");
      return request(`/firm/companies/${companyId}/entries/import/ofx`, {
        method: "POST",
        body: formData,
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
  };
}
