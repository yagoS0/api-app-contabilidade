import { faker } from "@faker-js/faker";

faker.seed(20260127);

function delay(ms = 250) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockGuideComplianceRow({ hasProlabore, regimeTributario, inssOk, dasOk }) {
  const regime = String(regimeTributario || "SIMPLES").toUpperCase();
  const inssRequired = Boolean(hasProlabore);
  const dasRequired = regime === "SIMPLES";
  return {
    competencia: "2026-02",
    inss: { required: inssRequired, ok: inssRequired ? Boolean(inssOk) : true },
    das: { required: dasRequired, ok: dasRequired ? Boolean(dasOk) : true },
    expected: inssRequired ? "INSS" : dasRequired ? "SIMPLES" : null,
    ok: (inssRequired ? Boolean(inssOk) : true) && (dasRequired ? Boolean(dasOk) : true),
  };
}

function makeCompanies(count = 6) {
  return Array.from({ length: count }).map((_, i) => {
    const companyId = faker.string.uuid();
    const ownerEmail = faker.internet.email().toLowerCase();
    const hasProlabore = i === 0;
    const regimeTributario = i === 1 ? "LUCRO_PRESUMIDO" : "SIMPLES";
    return {
      companyId,
      razao: faker.company.name(),
      cnpj: faker.helpers.replaceSymbols("##.###.###/####-##"),
      ownerEmail,
      guideNotificationEmail: ownerEmail,
      hasProlabore,
      email: null,
      legacyCompany: { regimeTributario, tipoTributario: regimeTributario },
      guideCompliance: mockGuideComplianceRow({
        hasProlabore,
        regimeTributario,
        inssOk: i % 2 === 1,
        dasOk: i % 2 === 0,
      }),
    };
  });
}

function makeGuidesByCompany(companies) {
  const guidesByCompany = new Map();
  for (const company of companies) {
    const guides = Array.from({ length: faker.number.int({ min: 3, max: 12 }) }).map(() => {
      const status = faker.helpers.arrayElement(["PROCESSED", "PROCESSED", "PROCESSED", "ERROR"]);
      const emailStatus = status === "ERROR" ? "ERROR" : faker.helpers.arrayElement(["PENDING", "SENT"]);
      return {
        id: faker.string.uuid(),
        portalClientId: company.companyId,
        tipo: faker.helpers.arrayElement(["DAS", "FGTS", "INSS", "IRPJ", "SIMPLES"]),
        competencia: `${faker.number.int({ min: 2024, max: 2026 })}-${String(
          faker.number.int({ min: 1, max: 12 })
        ).padStart(2, "0")}`,
        valor: faker.finance.amount({ min: 120, max: 9500, dec: 2 }),
        status,
        emailStatus,
      };
    });
    guidesByCompany.set(company.companyId, guides);
  }
  return guidesByCompany;
}

const mockCompanies = makeCompanies();
const mockGuidesByCompany = makeGuidesByCompany(mockCompanies);
const mockUnidentifiedGuides = [];
const mockGuideSettings = {
  pdfReaderConfigured: true,
};
const mockSerproSettings = {
  enabled: false,
  environment: "homolog",
  authUrl: "https://autenticacao.sapi.serpro.gov.br/authenticate",
  baseUrl: "https://gateway.apiserpro.serpro.gov.br/integra-contador/v1",
  consumerKey: "",
  consumerSecretConfigured: false,
  scope: "",
  timeoutMs: 30000,
  fetchCron: "0 7 5 * *",
  certificate: {
    hasCertificate: false,
    originalName: null,
    uploadedAt: null,
    expiresAt: null,
    passwordConfigured: false,
  },
  source: {
    usingEnvBaseUrl: false,
    usingEnvConsumerKey: false,
    usingEnvConsumerSecret: false,
  },
};
let mockSerproLastRun = {
  key: "serpro_pgdasd_log:mock",
  updatedAt: new Date().toISOString(),
  value: {
    worker: "serpro_pgdasd",
    createdAt: new Date().toISOString(),
    competencia: "2026-04",
    summary: {
      totalCompanies: 4,
      captured: 2,
      failed: 1,
      skippedByProcuration: 1,
      durationMs: 1842,
    },
  },
};
const mockSerproProcurationByCompany = new Map();

// Plano de contas mock (por empresa)
const mockChartOfAccounts = new Map();
const mockEntriesByCompany = new Map();

// Históricos mockados globais (não atrelados a empresa específica)
const mockHistoricos = [
  { id: "h1", createdByUserId: "mock-user", companyPortalClientId: null, text: "PAGO AIRBNB", contaDebito: "426", contaCredito: "5", usageCount: 8, scope: "GLOBAL" },
  { id: "h2", createdByUserId: "mock-user", companyPortalClientId: null, text: "PAGO ALUGUEL", contaDebito: "426", contaCredito: "1", usageCount: 5, scope: "GLOBAL" },
  { id: "h3", createdByUserId: "mock-user", companyPortalClientId: null, text: "RECEBIMENTO DE CLIENTES", contaDebito: "1", contaCredito: "3", usageCount: 12, scope: "GLOBAL" },
  { id: "h4", createdByUserId: "mock-user", companyPortalClientId: null, text: "PAGO CONTA DE ENERGIA", contaDebito: "464", contaCredito: "5", usageCount: 3, scope: "GLOBAL" },
  { id: "h5", createdByUserId: "mock-user", companyPortalClientId: null, text: "PAGO INTERNET", contaDebito: "465", contaCredito: "5", usageCount: 4, scope: "GLOBAL" },
];
// Históricos específicos por empresa são adicionados dinamicamente em mockHistoricosByCompany
const mockHistoricosByCompany = new Map();

// Seed de plano de contas para a primeira empresa mock
const _seedAccounts = [
  { codigo: "1", nome: "Ativo", tipo: "ATIVO", natureza: "DEVEDORA", status: "CONFIRMADA" },
  { codigo: "5", nome: "Caixa", tipo: "ATIVO", natureza: "DEVEDORA", status: "CONFIRMADA" },
  { codigo: "6", nome: "Banco Conta Corrente", tipo: "ATIVO", natureza: "DEVEDORA", status: "CONFIRMADA" },
  { codigo: "266", nome: "Impostos a Recolher", tipo: "PASSIVO", natureza: "CREDORA", status: "CONFIRMADA" },
  { codigo: "400", nome: "Despesas Gerais", tipo: "DESPESA", natureza: "DEVEDORA", status: "CONFIRMADA" },
  { codigo: "401", nome: "Aluguel", tipo: "DESPESA", natureza: "DEVEDORA", status: "CONFIRMADA" },
  { codigo: "402", nome: "Energia Elétrica", tipo: "DESPESA", natureza: "DEVEDORA", status: "CONFIRMADA" },
  { codigo: "464", nome: "Serviços Prestados Pessoa Jurídica", tipo: "DESPESA", natureza: "DEVEDORA", status: "CONFIRMADA" },
  { codigo: "700", nome: "Receitas de Serviços", tipo: "RECEITA", natureza: "CREDORA", status: "CONFIRMADA" },
];
for (const company of mockCompanies) {
  mockChartOfAccounts.set(
    company.companyId,
    _seedAccounts.map((a) => ({
      id: faker.string.uuid(),
      portalClientId: company.companyId,
      ...a,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
  );
  mockEntriesByCompany.set(company.companyId, []);
}

// Seed provisões para a primeira empresa
const _firstCompanyId = mockCompanies[0]?.companyId;
if (_firstCompanyId) {
  mockEntriesByCompany.set(_firstCompanyId, [
    {
      id: faker.string.uuid(), portalClientId: _firstCompanyId,
      data: new Date("2026-04-05").toISOString(), competencia: "2026-04",
      historico: "Provisão DAS Simples Nacional Abril/2026",
      tipo: "PROVISAO", subtipo: "SIMPLES", origem: "MANUAL",
      loteImportacao: null,
      status: "CONFIRMADO", statusPagamento: "ABERTO", openEntryId: null,
      lines: [
        { id: faker.string.uuid(), conta: "266", tipo: "D", valor: 1200, ordem: 0 },
        { id: faker.string.uuid(), conta: "266", tipo: "C", valor: 1200, ordem: 1 },
      ],
      totalD: 1200, totalC: 1200, valor: 1200,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    {
      id: faker.string.uuid(), portalClientId: _firstCompanyId,
      data: new Date("2026-03-05").toISOString(), competencia: "2026-03",
      historico: "Provisão DAS Simples Nacional Março/2026",
      tipo: "PROVISAO", subtipo: "SIMPLES", origem: "MANUAL",
      loteImportacao: null,
      status: "CONFIRMADO", statusPagamento: "PAGO", openEntryId: null,
      lines: [
        { id: faker.string.uuid(), conta: "266", tipo: "D", valor: 980, ordem: 0 },
        { id: faker.string.uuid(), conta: "266", tipo: "C", valor: 980, ordem: 1 },
      ],
      totalD: 980, totalC: 980, valor: 980,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ]);
}

function buildCompanyPayload(input) {
  const ownerEmail = String(input.ownerEmail || "").trim().toLowerCase();
  const guideEmail =
    String(input.guideNotificationEmail || "").trim().toLowerCase() || ownerEmail || null;
  const hasProlabore = Boolean(input.hasProlabore);
  const regimeTributario = String(input.regimeTributario || "SIMPLES");
  return {
    companyId: faker.string.uuid(),
    portalId: faker.string.uuid(),
    myRole: "FIRM_ADMIN",
    scopes: ["*"],
    razao: String(input.razaoSocial || "").trim(),
    cnpj: String(input.cnpj || "").replace(/\D+/g, ""),
    inscricaoMunicipal: null,
    uf: String(input.enderecoUf || "").trim().toUpperCase() || null,
    municipio: String(input.enderecoCidade || "").trim() || null,
    ownerEmail: ownerEmail || null,
    guideNotificationEmail: guideEmail,
    hasProlabore,
    email: null,
    telefone: String(input.telefone || "").trim() || null,
    portalCreatedAt: new Date().toISOString(),
    portalUpdatedAt: new Date().toISOString(),
    legacyCompany: { regimeTributario, tipoTributario: regimeTributario },
    guideCompliance: mockGuideComplianceRow({ hasProlabore, regimeTributario, inssOk: true, dasOk: true }),
  };
}

export function createMockApi() {
  let accessToken = "";

  return {
    setUnauthorizedHandler() {},
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
      await delay();
      if (!identifier || !password) {
        throw new Error("invalid_credentials");
      }
      accessToken = `mock-token-${faker.string.alphanumeric(12)}`;
      return {
        accessToken,
        refreshToken: `mock-refresh-${faker.string.alphanumeric(12)}`,
        user: {
          id: "mock-user-id",
          role: "contador",
          accountType: "FIRM",
          defaultClientId: null,
          name: "Usuario Mock",
        },
      };
    },
    async me() {
      await delay();
      if (!accessToken) throw new Error("invalid_token");
      return {
        id: "mock-user-id",
        role: "contador",
        accountType: "FIRM",
        defaultClientId: null,
        name: "Usuario Mock",
      };
    },
    async listCompanies() {
      await delay();
      return mockCompanies;
    },
    async createCompany(input) {
      await delay();
      const company = buildCompanyPayload(input || {});
      mockCompanies.unshift(company);
      mockGuidesByCompany.set(company.companyId, []);
      return { ok: true, companyId: company.companyId, portalId: company.companyId };
    },
    async updateCompany(companyId, input) {
      await delay();
      const index = mockCompanies.findIndex((item) => item.companyId === companyId);
      if (index < 0) throw new Error("not_found");
      const body = input || {};
      const nested = body.company && typeof body.company === "object" ? body.company : {};
      const companyInput = { ...nested, ownerEmail: body.ownerEmail, ownerName: body.ownerName };
      const current = mockCompanies[index];
      const legacyCurrent = current.legacyCompany && typeof current.legacyCompany === "object"
        ? current.legacyCompany
        : {};
      const endereco = companyInput.endereco && typeof companyInput.endereco === "object"
        ? companyInput.endereco
        : {};
      const next = {
        ...current,
        razao: String(companyInput.razaoSocial || current.razao || "").trim(),
        cnpj: String(companyInput.cnpj || current.cnpj || "").trim(),
        hasProlabore:
          body.hasProlabore !== undefined ? Boolean(body.hasProlabore) : Boolean(current.hasProlabore),
        ownerEmail: String(companyInput.ownerEmail || current.ownerEmail || "").trim().toLowerCase() || null,
        guideNotificationEmail:
          companyInput.guideNotificationEmail !== undefined && companyInput.guideNotificationEmail !== null
            ? String(companyInput.guideNotificationEmail || "").trim().toLowerCase() || null
            : current.guideNotificationEmail ?? null,
        email: String(companyInput.email || current.email || "").trim().toLowerCase() || null,
        telefone: String(companyInput.telefone || current.telefone || "").trim() || null,
        uf: String(endereco.uf || current.uf || "").trim().toUpperCase() || null,
        municipio: String(endereco.cidade || current.municipio || "").trim() || null,
        inscricaoMunicipal:
          String(companyInput.inscricaoMunicipal || current.inscricaoMunicipal || "").trim() || null,
        portalUpdatedAt: new Date().toISOString(),
      };
      next.legacyCompany = {
        ...legacyCurrent,
        razaoSocial: String(companyInput.razaoSocial || legacyCurrent.razaoSocial || next.razao || "").trim(),
        nomeFantasia: String(companyInput.nomeFantasia || legacyCurrent.nomeFantasia || "").trim() || null,
        cnpj: next.cnpj,
        email: next.email,
        telefone: next.telefone,
        regimeTributario: String(
          companyInput.regimeTributario || legacyCurrent.regimeTributario || "SIMPLES"
        ),
        cnaePrincipal: String(companyInput.cnaePrincipal || legacyCurrent.cnaePrincipal || "").trim() || null,
        enderecoJson: {
          rua: String(endereco.rua || legacyCurrent.enderecoJson?.rua || "").trim() || null,
          numero: String(endereco.numero || legacyCurrent.enderecoJson?.numero || "").trim() || null,
          bairro: String(endereco.bairro || legacyCurrent.enderecoJson?.bairro || "").trim() || null,
          cidade: String(endereco.cidade || legacyCurrent.enderecoJson?.cidade || next.municipio || "").trim() || null,
          uf: String(endereco.uf || legacyCurrent.enderecoJson?.uf || next.uf || "").trim().toUpperCase() || null,
          cep: String(endereco.cep || legacyCurrent.enderecoJson?.cep || "").trim() || null,
          complemento:
            String(endereco.complemento || legacyCurrent.enderecoJson?.complemento || "").trim() || null,
        },
      };
      next.guideCompliance = mockGuideComplianceRow({
        hasProlabore: next.hasProlabore,
        regimeTributario: next.legacyCompany.regimeTributario,
        inssOk: next.guideCompliance?.inss?.ok ?? true,
        dasOk: next.guideCompliance?.das?.ok ?? true,
      });
      mockCompanies[index] = next;
      return { ok: true, company: next };
    },
    async getCompanyGuides(companyId) {
      await delay();
      return (mockGuidesByCompany.get(companyId) || []).slice().sort((a, b) => {
        if (a.competencia < b.competencia) return 1;
        if (a.competencia > b.competencia) return -1;
        return 0;
      });
    },
    async sendLatestGuidesEmail(companyId) {
      await delay(500);
      const list = mockGuidesByCompany.get(companyId) || [];
      const pending = list.filter((item) => item.status === "PROCESSED" && item.emailStatus !== "SENT");
      const toSendNow = pending.slice(0, faker.number.int({ min: 1, max: 4 }));
      for (const guide of toSendNow) {
        guide.emailStatus = "SENT";
      }
      return {
        status: "sent",
        companyId,
        totalFound: list.length,
        sentNow: toSendNow.length,
        alreadySent: list.filter((item) => item.emailStatus === "SENT").length,
      };
    },
    async resendGuideEmail(guideId) {
      await delay();
      for (const guides of mockGuidesByCompany.values()) {
        const target = guides.find((item) => item.id === guideId);
        if (target) {
          target.emailStatus = "PENDING";
          return { ok: true, guideId, emailStatus: "PENDING" };
        }
      }
      throw new Error("not_found");
    },
    async getGuideSettings() {
      await delay();
      return { ...mockGuideSettings };
    },
    async updateGuideSettings() {
      await delay();
      return { ok: true, settings: { ...mockGuideSettings } };
    },
    async getSerproSettings() {
      await delay();
      return {
        ...mockSerproSettings,
        certificate: { ...mockSerproSettings.certificate },
        source: { ...mockSerproSettings.source },
      };
    },
    async getSerproStatus() {
      await delay();
      return {
        ok: true,
        workerEnabled: true,
        lastRun: mockSerproLastRun,
      };
    },
    async updateSerproSettings(input) {
      await delay();
      mockSerproSettings.enabled = Boolean(input?.enabled);
      mockSerproSettings.environment = String(input?.environment || mockSerproSettings.environment);
      mockSerproSettings.authUrl = String(input?.authUrl || "");
      mockSerproSettings.baseUrl = String(input?.baseUrl || "");
      mockSerproSettings.consumerKey = String(input?.consumerKey || "");
      mockSerproSettings.scope = String(input?.scope || "");
      mockSerproSettings.timeoutMs = Number(input?.timeoutMs || 30000);
      mockSerproSettings.fetchCron = String(input?.fetchCron || mockSerproSettings.fetchCron);
      if (String(input?.consumerSecret || "").trim()) {
        mockSerproSettings.consumerSecretConfigured = true;
      }
      return { ok: true, settings: await this.getSerproSettings() };
    },
    async uploadSerproCertificate({ file, password }) {
      await delay();
      if (!file || !password) throw new Error("pfx_required");
      mockSerproSettings.certificate = {
        hasCertificate: true,
        originalName: String(file.name || "certificado.pfx"),
        uploadedAt: new Date().toISOString(),
        expiresAt: null,
        passwordConfigured: true,
      };
      return { ok: true, settings: { certificate: { ...mockSerproSettings.certificate } } };
    },
    async deleteSerproCertificate() {
      await delay();
      mockSerproSettings.certificate = {
        hasCertificate: false,
        originalName: null,
        uploadedAt: null,
        expiresAt: null,
        passwordConfigured: false,
      };
      return { ok: true, deletedFile: true, settings: { certificate: { ...mockSerproSettings.certificate } } };
    },
    async getSerproCompanyProcuration(companyId) {
      await delay();
      return {
        ok: true,
        result:
          mockSerproProcurationByCompany.get(String(companyId)) || {
            companyId: String(companyId),
            status: "DESCONHECIDA",
            validUntil: null,
            systems: [],
            checkedAt: null,
            payload: null,
          },
      };
    },
    async checkSerproCompanyProcuration(companyId) {
      await delay();
      const result = {
        company: mockCompanies.find((item) => item.companyId === companyId) || null,
        procuradorCnpj: "12345678000199",
        status: faker.helpers.arrayElement(["ATIVA", "ATIVA", "AUSENTE"]),
        validUntil: faker.date.soon({ days: 180 }).toISOString(),
        systems: ["PGDASD", "PROCURACOES", "DCTFWEB"],
        checkedAt: new Date().toISOString(),
      };
      mockSerproProcurationByCompany.set(String(companyId), { ...result, companyId: String(companyId) });
      return { ok: true, result };
    },
    async captureSerproPgdasd(companyId, input = {}) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      const guide = {
        guideId: faker.string.uuid(),
        companyId,
        competencia: String(input.competencia || "2026-04"),
        tipo: "SIMPLES",
        valor: Number(faker.finance.amount({ min: 300, max: 5000, dec: 2 })),
        vencimento: faker.date.soon({ days: 20 }).toISOString(),
        status: "PROCESSED",
        emailStatus: "PENDING",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const current = mockGuidesByCompany.get(companyId) || [];
      current.unshift({
        id: guide.guideId,
        portalClientId: companyId,
        tipo: guide.tipo,
        competencia: guide.competencia,
        valor: guide.valor,
        vencimento: guide.vencimento,
        status: guide.status,
        emailStatus: guide.emailStatus,
      });
      mockGuidesByCompany.set(companyId, current);
      mockSerproLastRun = {
        key: `serpro_pgdasd_log:${Date.now()}`,
        updatedAt: new Date().toISOString(),
        value: {
          worker: "serpro_pgdasd",
          createdAt: new Date().toISOString(),
          competencia: guide.competencia,
          summary: {
            totalCompanies: 1,
            captured: 1,
            failed: 0,
            skippedByProcuration: 0,
            durationMs: 850,
          },
        },
      };
      return {
        ok: true,
        result: {
          company: { id: companyId, razao: company.razao, cnpj: company.cnpj },
          guide,
          integration: {
            sistema: "PGDASD",
            servico: "GERARDASCOBRANCA17",
            contratanteCnpj: "12345678000199",
            numeroDocumento: faker.string.numeric(14),
          },
        },
      };
    },
    async uploadGuides(files) {
      await delay(700);
      const normalizedFiles = Array.isArray(files) ? files : [];
      const items = normalizedFiles.map((file) => {
        const fileName = String(file?.name || "guia.pdf");
        const identified = faker.datatype.boolean({ probability: 0.7 });
        if (!identified) {
          const pending = {
            guideId: faker.string.uuid(),
            fileName,
            hash: faker.string.hexadecimal({ length: 24, prefix: "" }),
            cnpj: faker.helpers.replaceSymbols("##############"),
            competencia: `2026-${String(faker.number.int({ min: 1, max: 12 })).padStart(2, "0")}`,
            tipo: faker.helpers.arrayElement(["SIMPLES", "INSS", "FGTS", "OUTRA"]),
            valor: Number(faker.finance.amount({ min: 120, max: 9500, dec: 2 })),
            vencimento: new Date().toISOString(),
            status: "ERROR",
            code: "GUIDE_NOT_PROCESSED",
            reason: "company_not_found_by_cnpj",
            message: "Não encontramos uma empresa cadastrada para o CNPJ extraído desta guia.",
            rawTextSample: faker.lorem.paragraph(),
            fields: {},
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          mockUnidentifiedGuides.unshift(pending);
          return {
            status: "ERROR",
            guideId: pending.guideId,
            fileName,
            code: pending.code,
            reason: pending.reason,
            message: pending.message,
            extracted: {
              cnpj: pending.cnpj,
              competencia: pending.competencia,
              tipo: pending.tipo,
              valor: pending.valor,
              vencimento: pending.vencimento,
            },
          };
        }

        const company = faker.helpers.arrayElement(mockCompanies);
        const guideId = faker.string.uuid();
        const emailSent = faker.datatype.boolean({ probability: 0.8 });
        const guide = {
          id: guideId,
          portalClientId: company.companyId,
          tipo: faker.helpers.arrayElement(["SIMPLES", "INSS", "FGTS"]),
          competencia: `2026-${String(faker.number.int({ min: 1, max: 12 })).padStart(2, "0")}`,
          valor: faker.finance.amount({ min: 120, max: 9500, dec: 2 }),
          status: "PROCESSED",
          emailStatus: emailSent ? "SENT" : "ERROR",
          emailLastError: emailSent ? null : "smtp_mock_error",
        };
        const list = mockGuidesByCompany.get(company.companyId) || [];
        list.unshift(guide);
        mockGuidesByCompany.set(company.companyId, list);

        return {
          status: "PROCESSED",
          guideId,
          companyId: company.companyId,
          fileName,
          message: "Guia processada e salva com sucesso.",
          extracted: {
            cnpj: company.cnpj,
            competencia: guide.competencia,
            tipo: guide.tipo,
            valor: Number(guide.valor),
          },
          email: emailSent
            ? {
                status: "SENT",
                message: "Guia processada e e-mail enviado com sucesso.",
              }
            : {
                status: "ERROR",
                message: "A guia foi processada, mas o e-mail não pôde ser enviado.",
              },
        };
      });

      return {
        ok: true,
        result: {
          total: normalizedFiles.length,
          processed: items.filter((item) => item.status === "PROCESSED").length,
          errors: items.filter((item) => item.status === "ERROR").length,
          skipped: items.filter((item) => item.status === "SKIPPED").length,
          sent: items.filter((item) => item.email?.status === "SENT").length,
          failedToSend: items.filter((item) => item.email?.status === "ERROR").length,
          emailDispatch: {
            attempted: true,
            skipped: false,
            reason: null,
            message: null,
          },
          items,
        },
      };
    },
    async getUnidentifiedGuides() {
      await delay(250);
      return {
        data: [...mockUnidentifiedGuides],
        page: 1,
        limit: mockUnidentifiedGuides.length || 25,
        total: mockUnidentifiedGuides.length,
      };
    },
    async getPendingGuidesReport() {
      await delay(300);
      const data = [];
      for (const company of mockCompanies) {
        const companyGuides = mockGuidesByCompany.get(company.companyId) || [];
        for (const guide of companyGuides) {
          if (!["PENDING", "ERROR", "SENDING"].includes(String(guide.emailStatus || "").toUpperCase())) {
            continue;
          }
          data.push({
            guideId: guide.id,
            companyId: company.companyId,
            companyName: company.razao,
            cnpj: company.cnpj,
            tipo: guide.tipo,
            competencia: guide.competencia,
            valor: Number(guide.valor),
            vencimento: null,
            status: guide.status,
            emailStatus: guide.emailStatus,
            emailAttempts: faker.number.int({ min: 0, max: 3 }),
            emailLastError: guide.emailStatus === "ERROR" ? "smtp_timeout" : null,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      return {
        data,
        page: 1,
        limit: data.length || 25,
        total: data.length,
      };
    },
    async sendSelectedPendingEmails(guideIds) {
      await delay(500);
      const normalized = [...new Set((Array.isArray(guideIds) ? guideIds : []).map((id) => String(id)))];
      let sent = 0;
      let failed = 0;
      const items = [];
      for (const id of normalized) {
        let found = false;
        for (const guides of mockGuidesByCompany.values()) {
          const target = guides.find((item) => item.id === id);
          if (!target) continue;
          found = true;
          const fail = faker.datatype.boolean({ probability: 0.2 });
          if (fail) {
            target.emailStatus = "ERROR";
            failed += 1;
            items.push({
              guideId: id,
              status: "ERROR",
              reason: "smtp_mock_error",
              code: "GUIDE_EMAIL_SEND_ERROR",
              willRetry: true,
            });
          } else {
            target.emailStatus = "SENT";
            sent += 1;
            items.push({
              guideId: id,
              status: "SENT",
              to: faker.internet.email().toLowerCase(),
            });
          }
          break;
        }
        if (!found) {
          failed += 1;
          items.push({
            guideId: id,
            status: "ERROR",
            reason: "guide_not_found_or_not_processed",
            code: "GUIDE_NOT_FOUND_OR_NOT_PROCESSED",
            willRetry: false,
          });
        }
      }
      return {
        ok: true,
        result: {
          totalRequested: normalized.length,
          sent,
          failed,
          items,
        },
      };
    },

    // ── Plano de Contas (mock) ─────────────────────────────────────────────
    async getChartOfAccounts(companyId) {
      await delay();
      return mockChartOfAccounts.get(companyId) || [];
    },
    async createChartOfAccount(companyId, input) {
      await delay();
      const list = mockChartOfAccounts.get(companyId) || [];
      if (list.find((a) => a.codigo === input.codigo)) throw new Error("codigo_ja_existe");
      const account = {
        id: faker.string.uuid(),
        portalClientId: companyId,
        codigo: String(input.codigo),
        nome: String(input.nome),
        tipo: String(input.tipo || "DESPESA").toUpperCase(),
        natureza: String(input.natureza || "DEVEDORA").toUpperCase(),
        status: "PENDENTE_ERP",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      list.push(account);
      mockChartOfAccounts.set(companyId, list);
      return { ok: true, account };
    },
    async updateChartOfAccount(companyId, codigo, input) {
      await delay();
      const list = mockChartOfAccounts.get(companyId) || [];
      const idx = list.findIndex((a) => a.codigo === codigo);
      if (idx < 0) throw new Error("conta_nao_encontrada");
      list[idx] = { ...list[idx], ...input, updatedAt: new Date().toISOString() };
      mockChartOfAccounts.set(companyId, list);
      return { ok: true, account: list[idx] };
    },
    async deleteChartOfAccount(companyId, codigo) {
      await delay();
      const list = mockChartOfAccounts.get(companyId) || [];
      mockChartOfAccounts.set(companyId, list.filter((a) => a.codigo !== codigo));
      return { ok: true };
    },
    async importChartOfAccountsFile() {
      await delay(600);
      return { ok: true, created: 0, skipped: 0, errors: [] };
    },

    // ── Lançamentos (mock) ─────────────────────────────────────────────────
    async getAccountingEntries(companyId, params = {}) {
      await delay();
      let list = mockEntriesByCompany.get(companyId) || [];
      if (params.competencia) list = list.filter((e) => e.competencia === params.competencia);
      if (params.tipo) list = list.filter((e) => e.tipo === params.tipo);
      if (params.subtipo) list = list.filter((e) => e.subtipo === params.subtipo);
      if (params.origem) list = list.filter((e) => e.origem === params.origem);
      if (params.status) list = list.filter((e) => e.status === params.status);
      if (params.statusPagamento) list = list.filter((e) => e.statusPagamento === params.statusPagamento);
      const page = Math.max(1, Number(params.page || 1));
      const limit = Math.min(200, Number(params.limit || 50));
      const paged = list.slice((page - 1) * limit, page * limit);
      return { data: paged, total: list.length, page, limit };
    },
    async createAccountingEntry(companyId, input) {
      await delay();
      const lines = Array.isArray(input.lines) ? input.lines : [];
      const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
      const totalC = lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
      if (Math.abs(totalD - totalC) > 0.01) throw new Error("entry_nao_balanceada");
      const data = input.data ? new Date(input.data) : new Date();
      const entryId = faker.string.uuid();
      const entry = {
        id: entryId,
        portalClientId: companyId,
        data: data.toISOString(),
        competencia: `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`,
        historico: String(input.historico || ""),
        tipo: String(input.tipo || "DESPESA").toUpperCase(),
        subtipo: input.subtipo ? String(input.subtipo).toUpperCase() : null,
        origem: "MANUAL",
        loteImportacao: null,
        status: "RASCUNHO",
        statusPagamento: input.statusPagamento ? String(input.statusPagamento).toUpperCase() : "NA",
        openEntryId: null,
        lines: lines.map((l, idx) => ({
          id: faker.string.uuid(),
          entryId,
          conta: String(l.conta || ""),
          tipo: String(l.tipo || "D").toUpperCase(),
          valor: Number(l.valor || 0),
          ordem: idx,
        })),
        totalD,
        totalC,
        valor: totalD,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const list = mockEntriesByCompany.get(companyId) || [];
      list.push(entry);
      mockEntriesByCompany.set(companyId, list);

      // Auto-save do histórico no mock
      if (input.historico && lines.length > 0) {
        const compList = mockHistoricosByCompany.get(companyId) || [];
        const dLine = lines.find((l) => String(l.tipo || "").toUpperCase() === "D");
        const cLine = lines.find((l) => String(l.tipo || "").toUpperCase() === "C");
        const existing = compList.find((h) => h.text === input.historico && h.companyPortalClientId === companyId);
        if (existing) {
          existing.usageCount += 1;
        } else {
          compList.push({
            id: faker.string.uuid(), createdByUserId: "mock-user", companyPortalClientId: companyId,
            text: input.historico,
            contaDebito: dLine ? String(dLine.conta || "") : null,
            contaCredito: cLine ? String(cLine.conta || "") : null,
            usageCount: 1, scope: "COMPANY",
          });
        }
        mockHistoricosByCompany.set(companyId, compList);
      }

      return { ok: true, entry };
    },
    async updateAccountingEntry(companyId, entryId, input) {
      await delay();
      const list = mockEntriesByCompany.get(companyId) || [];
      const idx = list.findIndex((e) => e.id === entryId);
      if (idx < 0) throw new Error("lancamento_nao_encontrado");
      const updated = { ...list[idx], updatedAt: new Date().toISOString() };
      if (input.data !== undefined) updated.data = input.data;
      if (input.historico !== undefined) updated.historico = input.historico;
      if (input.tipo !== undefined) updated.tipo = input.tipo;
      if (input.subtipo !== undefined) updated.subtipo = input.subtipo;
      if (input.status !== undefined) updated.status = input.status;
      if (input.statusPagamento !== undefined) updated.statusPagamento = input.statusPagamento;
      if (Array.isArray(input.lines)) {
        const totalD = input.lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
        const totalC = input.lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
        if (Math.abs(totalD - totalC) > 0.01) throw new Error("entry_nao_balanceada");
        updated.lines = input.lines.map((l, i) => ({
          id: faker.string.uuid(), entryId,
          conta: String(l.conta || ""), tipo: String(l.tipo || "D").toUpperCase(),
          valor: Number(l.valor || 0), ordem: i,
        }));
        updated.totalD = totalD;
        updated.totalC = totalC;
        updated.valor = totalD;
      }
      list[idx] = updated;
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, entry: list[idx] };
    },
    async deleteAccountingEntry(companyId, entryId) {
      await delay();
      const list = mockEntriesByCompany.get(companyId) || [];
      mockEntriesByCompany.set(companyId, list.filter((e) => e.id !== entryId));
      return { ok: true };
    },
    async createBaixa(companyId, entryId, { data, historico, lines }) {
      await delay();
      const list = mockEntriesByCompany.get(companyId) || [];
      const openIdx = list.findIndex((e) => e.id === entryId);
      if (openIdx < 0) throw new Error("lancamento_nao_encontrado");
      if (list[openIdx].statusPagamento !== "ABERTO") throw new Error("lancamento_nao_esta_aberto");
      const linesArr = Array.isArray(lines) ? lines : [];
      const totalD = linesArr.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
      const totalC = linesArr.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0);
      if (Math.abs(totalD - totalC) > 0.01) throw new Error("entry_nao_balanceada");
      const baixaId = faker.string.uuid();
      const dt = data ? new Date(data) : new Date();
      const baixa = {
        id: baixaId,
        portalClientId: companyId,
        data: dt.toISOString(),
        competencia: `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`,
        historico: String(historico || ""),
        tipo: "BAIXA",
        subtipo: null,
        origem: "MANUAL",
        loteImportacao: null,
        status: "CONFIRMADO",
        statusPagamento: "NA",
        openEntryId: entryId,
        lines: linesArr.map((l, i) => ({
          id: faker.string.uuid(), entryId: baixaId,
          conta: String(l.conta || ""), tipo: String(l.tipo || "D").toUpperCase(),
          valor: Number(l.valor || 0), ordem: i,
        })),
        totalD, totalC, valor: totalD,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      list.push(baixa);
      list[openIdx] = { ...list[openIdx], statusPagamento: "PAGO", updatedAt: new Date().toISOString() };
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, entry: baixa, openEntry: list[openIdx] };
    },
    async getCircular(companyId, { year } = {}) {
      await delay();
      const y = year || new Date().getFullYear();
      const meses = Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`);
      const list = mockEntriesByCompany.get(companyId) || [];
      const provisoes = list.filter(
        (e) => e.tipo === "PROVISAO" && ["ABERTO", "PAGO"].includes(e.statusPagamento) && meses.includes(e.competencia)
      );
      const receitas = {};
      for (const e of list.filter((e) => e.tipo === "RECEITA" && meses.includes(e.competencia))) {
        const total = (e.lines || []).filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
        receitas[e.competencia] = (receitas[e.competencia] || 0) + total;
      }
      return { year: y, provisoes, receitas };
    },
    async previewOFX() {
      await delay(400);
      const transactions = Array.from({ length: faker.number.int({ min: 3, max: 10 }) }).map(() => ({
        fitId: faker.string.alphanumeric(12),
        trnType: "DEBIT",
        data: faker.date.recent({ days: 30 }).toISOString(),
        valor: Number(faker.finance.amount({ min: 50, max: 5000, dec: 2 })),
        sinal: "DEBITO",
        historico: faker.helpers.arrayElement([
          "PAGAMENTO FORNECEDOR",
          "TED RECEBIDA",
          "DEBITO AUTOMATICO",
          "COMPRA CARTAO",
          "TARIFA BANCARIA",
        ]),
      }));
      return { ok: true, transactions, total: transactions.length };
    },
    async importOFX(companyId, { contaDebito, contaCredito, tipo }) {
      await delay(600);
      const count = faker.number.int({ min: 3, max: 10 });
      const loteImportacao = `OFX-${Date.now()}`;
      const list = mockEntriesByCompany.get(companyId) || [];
      for (let i = 0; i < count; i++) {
        const data = faker.date.recent({ days: 30 });
        const valor = Number(faker.finance.amount({ min: 50, max: 5000, dec: 2 }));
        const entryId = faker.string.uuid();
        list.push({
          id: entryId,
          portalClientId: companyId,
          data: data.toISOString(),
          competencia: `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`,
          historico: faker.helpers.arrayElement(["PAGAMENTO FORNECEDOR", "DEBITO AUTOMATICO", "TARIFA BANCARIA"]),
          tipo: tipo || "DESPESA",
          subtipo: null,
          origem: "OFX",
          loteImportacao,
          status: "RASCUNHO",
          statusPagamento: "NA",
          openEntryId: null,
          lines: [
            { id: faker.string.uuid(), entryId, conta: contaDebito, tipo: "D", valor, ordem: 0 },
            { id: faker.string.uuid(), entryId, conta: contaCredito, tipo: "C", valor, ordem: 1 },
          ],
          totalD: valor, totalC: valor, valor,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, created: count, loteImportacao };
    },
    getEntriesExportCsvUrl(companyId) {
      return `#mock-csv-export-${companyId}`;
    },

    // ── Históricos (mock) ──────────────────────────────────────────────────
    async getAllHistoricos(companyId) {
      await delay(200);
      const companySpecific = mockHistoricosByCompany.get(companyId) || [];
      return [...mockHistoricos, ...companySpecific]
        .sort((a, b) => b.usageCount - a.usageCount)
        .map((h) => ({ ...h, scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL" }));
    },
    async updateHistorico(companyId, id, input) {
      await delay(150);
      // procura globais
      const gi = mockHistoricos.findIndex((h) => h.id === id);
      if (gi >= 0) {
        const h = mockHistoricos[gi];
        if (input.scope === "COMPANY") { h.companyPortalClientId = companyId; h.scope = "COMPANY"; }
        if (input.scope === "GLOBAL") { h.companyPortalClientId = null; h.scope = "GLOBAL"; }
        if (input.contaDebito !== undefined) h.contaDebito = input.contaDebito || null;
        if (input.contaCredito !== undefined) h.contaCredito = input.contaCredito || null;
        return { ok: true, historico: { ...h } };
      }
      const compList = mockHistoricosByCompany.get(companyId) || [];
      const ci = compList.findIndex((h) => h.id === id);
      if (ci >= 0) {
        const h = compList[ci];
        if (input.scope === "GLOBAL") {
          // promove para global: remove da lista da empresa, adiciona nos globais
          compList.splice(ci, 1);
          mockHistoricosByCompany.set(companyId, compList);
          h.companyPortalClientId = null; h.scope = "GLOBAL";
          mockHistoricos.push(h);
        } else {
          if (input.contaDebito !== undefined) h.contaDebito = input.contaDebito || null;
          if (input.contaCredito !== undefined) h.contaCredito = input.contaCredito || null;
        }
        return { ok: true, historico: { ...h } };
      }
      return { ok: false, error: "not_found" };
    },
    async searchHistoricos(companyId, q) {
      await delay(150);
      const companySpecific = mockHistoricosByCompany.get(companyId) || [];
      const all = [...mockHistoricos, ...companySpecific];
      const nq = String(q || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const filtered = nq.length < 2
        ? all
        : all.filter((h) => h.text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(nq));
      return filtered
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 12)
        .map((h) => ({ ...h, scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL" }));
    },
    async getHistoricosByCode(companyId, codigo) {
      await delay(150);
      const companySpecific = mockHistoricosByCompany.get(companyId) || [];
      const all = [...mockHistoricos, ...companySpecific];
      return all
        .filter((h) => h.contaDebito === codigo || h.contaCredito === codigo)
        .sort((a, b) => b.usageCount - a.usageCount)
        .slice(0, 10)
        .map((h) => ({ ...h, scope: h.companyPortalClientId ? "COMPANY" : "GLOBAL" }));
    },
    async deleteHistorico(companyId, id) {
      await delay(100);
      const compList = mockHistoricosByCompany.get(companyId) || [];
      const globalIdx = mockHistoricos.findIndex((h) => h.id === id);
      if (globalIdx >= 0) { mockHistoricos.splice(globalIdx, 1); return { ok: true }; }
      const compIdx = compList.findIndex((h) => h.id === id);
      if (compIdx >= 0) { compList.splice(compIdx, 1); mockHistoricosByCompany.set(companyId, compList); return { ok: true }; }
      return { ok: false, error: "not_found" };
    },
  };
}
