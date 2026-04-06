function getApiBaseUrl() {
  return String(import.meta.env.VITE_API_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function normalizeError(payload, status) {
  return payload?.reason || payload?.error || `request_failed_${status}`;
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
      throw new Error(normalizeError(payload, response.status));
    }
    return payload;
  }

  return {
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
    async resendGuideEmail(guideId) {
      return request(`/firm/guides/${guideId}/resend-email`, { method: "POST" });
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
    async sendPendingGuideEmails(input) {
      return request("/firm/guides/emails/send-pending", {
        method: "POST",
        body: JSON.stringify(input || {}),
      });
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
  };
}
