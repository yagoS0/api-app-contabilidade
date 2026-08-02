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
    // Folha e pró-labore variam em empresas DIFERENTES de propósito: é o que deixa conferir na
    // tela que os dois selos são independentes, em vez de sempre aparecerem juntos.
    const temFolha = i === 1 || i === 2;
    const regimeTributario = i === 1 ? "LUCRO_PRESUMIDO" : "SIMPLES";
    return {
      companyId,
      razao: faker.company.name(),
      cnpj: faker.helpers.replaceSymbols("##.###.###/####-##"),
      ownerEmail,
      guideNotificationEmail: ownerEmail,
      hasProlabore,
      temFolha,
      email: null,
      legacyCompany: { regimeTributario, tipoTributario: regimeTributario },
      guideCompliance: mockGuideComplianceRow({
        hasProlabore,
        regimeTributario,
        inssOk: i % 2 === 1,
        dasOk: i % 2 === 0,
      }),
      // C6: paridade com o real — o card usa estes campos pro toggle guias⇄"Enviado",
      // pro aviso de pendência fiscal (SITFIS) e pro selo PARC.
      guidesEnvio: { competencia: null, total: 2, enviadas: i % 3 === 0 ? 2 : 1, todasEnviadas: i % 3 === 0 },
      fiscalSituacao: i === 0 ? "COM_PENDENCIA" : i === 1 ? "EM_PARCELAMENTO" : i === 2 ? "REGULAR" : null,
      fiscalCheckedAt: i <= 2 ? new Date().toISOString() : null,
      temParcelamento: i === 1,
    };
  });
}

function makeGuidesByCompany(companies) {
  const guidesByCompany = new Map();
  for (const company of companies) {
    const guides = Array.from({ length: faker.number.int({ min: 3, max: 12 }) }).map(() => {
      const status = faker.helpers.arrayElement(["PROCESSED", "PROCESSED", "PROCESSED", "ERROR"]);
      const emailStatus = status === "ERROR" ? "ERROR" : faker.helpers.arrayElement(["PENDING", "SENT"]);
      const vencimento = faker.date.soon({ days: 20 }).toISOString();
      const paymentStatus = faker.helpers.arrayElement(["OPEN", "OPEN", "PAID", "OVERDUE"]);
      return {
        id: faker.string.uuid(),
        portalClientId: company.companyId,
        tipo: faker.helpers.arrayElement(["DAS", "FGTS", "INSS", "IRPJ", "SIMPLES"]),
        competencia: `${faker.number.int({ min: 2024, max: 2026 })}-${String(
          faker.number.int({ min: 1, max: 12 })
        ).padStart(2, "0")}`,
        valor: faker.finance.amount({ min: 120, max: 9500, dec: 2 }),
        vencimento,
        status,
        emailStatus,
        paymentStatus,
        paymentStatusSource: paymentStatus === "PAID" ? faker.helpers.arrayElement(["MANUAL", "SERPRO"]) : "SERPRO",
        paymentConfirmedAt: paymentStatus === "PAID" ? new Date().toISOString() : null,
        serproLastCheckedAt: new Date().toISOString(),
        serproLastCheckResult: paymentStatus === "PAID" ? "NOT_FOUND" : "FOUND",
        serproService: "GERARDAS12",
        canConfirmPayment: paymentStatus !== "PAID",
        canRecalculate: paymentStatus !== "PAID", // Q29: vencida ou em aberto (não só vencida)
      };
    });
    guidesByCompany.set(company.companyId, guides);
  }
  return guidesByCompany;
}

const mockCompanies = makeCompanies();
const mockGuidesByCompany = makeGuidesByCompany(mockCompanies);
const mockUnidentifiedGuides = [];

// ── Obrigações ────────────────────────────────────────────────────────────────────────────────
// Gera a janela de 12 meses com as MESMAS regras do backend (clamp do dia 31, fim de semana,
// defasagem da competência). Repetir a regra aqui é chato, mas um mock que devolvesse datas
// bonitas esconderia justamente o que precisa ser visto na tela.
function mockCriarObrigacao(companyId, empresa, dados) {
  const periodicidade = String(dados.periodicidade || "MENSAL").toUpperCase();
  const diaPedido = Number(dados.diaVencimento) || 20;
  const ajuste = String(dados.ajusteDiaUtil || "ANTECIPAR").toUpperCase();
  const defasagem = dados.defasagemMeses == null ? 1 : Number(dados.defasagemMeses);
  const mesRef = dados.mesReferencia == null ? null : Number(dados.mesReferencia);

  const hoje = new Date();
  const ocorrencias = [];
  for (let i = 0; i < 12; i += 1) {
    const bruto = hoje.getUTCMonth() + i;
    const ano = hoje.getUTCFullYear() + Math.floor(bruto / 12);
    const mes = (bruto % 12) + 1;
    if (periodicidade === "ANUAL" && mes !== mesRef) continue;
    if (periodicidade === "TRIMESTRAL" && (((mes - mesRef) % 3) + 3) % 3 !== 0) continue;

    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const d = new Date(Date.UTC(ano, mes - 1, Math.min(diaPedido, ultimoDia)));
    if (ajuste !== "MANTER") {
      const passo = ajuste === "ANTECIPAR" ? -1 : 1;
      while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + passo);
    }
    const compBruta = ano * 12 + (mes - 1) - Math.max(0, defasagem);
    ocorrencias.push({
      ocorrenciaId: `mock-oc-${companyId}-${ano}${String(mes).padStart(2, "0")}-${Math.random().toString(36).slice(2, 7)}`,
      dataVencimento: d.toISOString().slice(0, 10),
      competenciaRef: `${Math.floor(compBruta / 12)}-${String((compBruta % 12) + 1).padStart(2, "0")}`,
      status: "PENDENTE",
      concluidaEm: null,
      fonteConclusao: null,
    });
  }

  return {
    obrigacaoId: `mock-obr-${Math.random().toString(36).slice(2, 9)}`,
    companyId,
    empresa,
    nome: String(dados.nome || "").trim() || "Obrigação sem nome",
    categoria: String(dados.categoria || "").trim() || null,
    periodicidade,
    diaVencimento: diaPedido,
    mesReferencia: periodicidade === "MENSAL" ? null : mesRef,
    defasagemMeses: defasagem,
    antecedenciaLembreteDias: dados.antecedenciaLembreteDias == null ? 5 : Number(dados.antecedenciaLembreteDias),
    ajusteDiaUtil: ajuste,
    cor: dados.cor || null,
    ativa: dados.ativa === undefined ? true : Boolean(dados.ativa),
    verificador: dados.verificador || null,
    regraId: dados.regraId || null,
    sobrescritaLocal: false,
    ocorrencias,
  };
}

// Semente escolhida para cobrir os três casos que a tela precisa distinguir: uma que se conclui
// sozinha, uma manual com vencimento já passado (para o VENCIDA derivado aparecer) e uma anual.
const mockObrigacoes = mockCompanies.length
  ? [
      mockCriarObrigacao(mockCompanies[0].companyId, mockCompanies[0].razao, {
        nome: "Transmitir apuração do Simples",
        categoria: "fiscal",
        periodicidade: "MENSAL",
        diaVencimento: 20,
        verificador: "APURACAO_TRANSMITIDA",
      }),
      mockCriarObrigacao(mockCompanies[0].companyId, mockCompanies[0].razao, {
        nome: "Enviar folha ao cliente",
        categoria: "trabalhista",
        periodicidade: "MENSAL",
        diaVencimento: 5,
        defasagemMeses: 0,
      }),
      mockCriarObrigacao(mockCompanies[1]?.companyId || mockCompanies[0].companyId, mockCompanies[1]?.razao || mockCompanies[0].razao, {
        nome: "Entregar ECD",
        categoria: "fiscal",
        periodicidade: "ANUAL",
        mesReferencia: 5,
        diaVencimento: 31,
        defasagemMeses: 5,
      }),
    ]
  : [];

// Feriados de 2026 — os mesmos que `scripts/semear-feriados.mjs` grava, para a tela poder ser
// conferida no mock. Carnaval e Corpus Christi entram por decisão do dono (são ponto facultativo
// federal, não feriado, mas banco não opera).
const MOCK_FERIADOS = {
  "2026-01-01": "Confraternização Universal",
  "2026-02-16": "Carnaval (segunda)",
  "2026-02-17": "Carnaval (terça)",
  "2026-04-03": "Sexta-feira Santa",
  "2026-04-21": "Tiradentes",
  "2026-05-01": "Dia do Trabalho",
  "2026-06-04": "Corpus Christi",
  "2026-07-09": "Revolução Constitucionalista (SP)",
  "2026-09-07": "Independência do Brasil",
  "2026-10-12": "Nossa Senhora Aparecida",
  "2026-11-02": "Finados",
  "2026-11-15": "Proclamação da República",
  "2026-11-20": "Consciência Negra",
  "2026-12-25": "Natal",
};

// ── Regras do escritório ──────────────────────────────────────────────────────────────────────
const mockRegras = [];

const MOCK_ROTULO_REGIME = {
  SIMPLES: "Simples Nacional", LUCRO_PRESUMIDO: "Lucro Presumido", LUCRO_REAL: "Lucro Real",
};

function mockRegimeDaEmpresa(c) {
  return c.legacyCompany?.regimeTributario || null;
}

function mockEmpresasDoEscopo(escopo, filtros, excecoesIds = []) {
  const fora = new Set(excecoesIds);
  let alvo = mockCompanies.filter((c) => !fora.has(c.companyId));
  if (escopo === "SELECAO_MANUAL") {
    const ids = new Set(filtros?.empresasIds || []);
    alvo = alvo.filter((c) => ids.has(c.companyId));
  } else if (escopo === "POR_FILTRO") {
    const regimes = filtros?.regimes || [];
    if (filtros?.temFolha === true) alvo = alvo.filter((c) => c.temFolha);
    // Empresa sem regime declarado NÃO entra num filtro por regime — mesma regra do backend.
    if (regimes.length) alvo = alvo.filter((c) => regimes.includes(mockRegimeDaEmpresa(c)));
  }
  return alvo.map((c) => ({ companyId: c.companyId, razao: c.razao, cnpj: c.cnpj, temFolha: Boolean(c.temFolha) }));
}

function mockResumoEscopo(regra, total) {
  const sufixo = `${total} empresa${total === 1 ? "" : "s"}`;
  if (regra.escopo === "TODAS") return `Todas as empresas · ${sufixo}`;
  if (regra.escopo === "SELECAO_MANUAL") return `Empresas escolhidas à mão · ${sufixo}`;
  const partes = [];
  if (regra.filtros?.regimes?.length) partes.push(regra.filtros.regimes.map((r) => MOCK_ROTULO_REGIME[r] || r).join(", "));
  if (regra.filtros?.temFolha === true) partes.push("somente com folha");
  return `${partes.join(" · ") || "Todas"} · ${sufixo}`;
}

function mockPropagarRegra(regra) {
  const excecoesIds = (regra.excecoes || []).map((e) => e.companyId);
  const alvo = regra.ativa === false ? [] : mockEmpresasDoEscopo(regra.escopo, regra.filtros, excecoesIds);
  const alvoIds = new Set(alvo.map((e) => e.companyId));
  let criadas = 0, atualizadas = 0, puladas = 0;

  for (const empresa of alvo) {
    const atual = mockObrigacoes.find((o) => o.regraId === regra.regraId && o.companyId === empresa.companyId);
    // Sobrescrita local é pulada: a regra não apaga a escolha de quem editou na empresa.
    if (atual?.sobrescritaLocal) { puladas += 1; continue; }
    const nova = mockCriarObrigacao(empresa.companyId, empresa.razao, { ...regra });
    nova.regraId = regra.regraId;
    if (atual) {
      const concluidas = atual.ocorrencias.filter((oc) => oc.status === "CONCLUIDA");
      const jaTem = new Set(concluidas.map((oc) => oc.dataVencimento));
      nova.obrigacaoId = atual.obrigacaoId;
      nova.ocorrencias = [...concluidas, ...nova.ocorrencias.filter((oc) => !jaTem.has(oc.dataVencimento))]
        .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));
      mockObrigacoes[mockObrigacoes.indexOf(atual)] = nova;
      atualizadas += 1;
    } else {
      mockObrigacoes.push(nova);
      criadas += 1;
    }
  }

  const removidas = mockObrigacoes.filter(
    (o) => o.regraId === regra.regraId && !alvoIds.has(o.companyId) && !o.sobrescritaLocal,
  );
  for (const o of removidas) mockObrigacoes.splice(mockObrigacoes.indexOf(o), 1);

  return { criadas, atualizadas, puladas, removidas: removidas.length, empresasNoEscopo: alvo.length };
}

const MOCK_TIPOS_DOC = ["CONTRATO_SOCIAL", "CARTAO_CNPJ", "INSCRICAO_ESTADUAL", "INSCRICAO_MUNICIPAL", "ALVARA", "PROCURACAO", "OUTRO"];
const MOCK_TIPO_DOC_LABELS = {
  CONTRATO_SOCIAL: "Contrato social", CARTAO_CNPJ: "Cartão CNPJ",
  INSCRICAO_ESTADUAL: "Inscrição estadual", INSCRICAO_MUNICIPAL: "Inscrição municipal",
  ALVARA: "Alvará", PROCURACAO: "Procuração", OUTRO: "Outro",
};
let mockDocumentos = [
  { id: "mock-doc-1", tipo: "CONTRATO_SOCIAL", nome: "Contrato social.pdf", mimeType: "application/pdf", bytes: 184320, validade: null, createdAt: "2026-03-10T12:00:00.000Z" },
  { id: "mock-doc-2", tipo: "CARTAO_CNPJ", nome: "Cartão CNPJ.pdf", mimeType: "application/pdf", bytes: 51200, validade: null, createdAt: "2026-05-02T12:00:00.000Z" },
  { id: "mock-doc-3", tipo: "ALVARA", nome: "Alvará de funcionamento.pdf", mimeType: "application/pdf", bytes: 92160, validade: "2026-12-31T00:00:00.000Z", createdAt: "2026-01-15T12:00:00.000Z" },
];
// A fixada é de propósito a MENOS importante e a MAIS antiga: é o caso que revela um orderBy
// ingênuo — nas duas ordenações ela tem que continuar em primeiro.
let mockAnotacoes = [
  { id: "mock-nota-1", texto: "Cliente prefere receber as guias até o dia 5.", importancia: "BAIXA", fixada: true, createdAt: "2026-02-01T12:00:00.000Z" },
  { id: "mock-nota-2", texto: "Sócio entrou em 04/2026 — conferir pró-labore.", importancia: "ALTA", fixada: false, createdAt: "2026-07-20T12:00:00.000Z" },
  { id: "mock-nota-3", texto: "Enviar balancete trimestral ao contador do grupo.", importancia: "MEDIA", fixada: false, createdAt: "2026-06-11T12:00:00.000Z" },
];
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
const mockMonthlyCirculars = new Map();

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

// Histórico de execuções fiscais por empresa
const mockFiscalExecutions = new Map();

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
  const temFolha = Boolean(input.temFolha);
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
    temFolha,
    email: null,
    telefone: String(input.telefone || "").trim() || null,
    portalCreatedAt: new Date().toISOString(),
    portalUpdatedAt: new Date().toISOString(),
    legacyCompany: { regimeTributario, tipoTributario: regimeTributario },
    guideCompliance: mockGuideComplianceRow({ hasProlabore, regimeTributario, inssOk: true, dasOk: true }),
  };
}

function makeCircularKey(companyId, competencia) {
  return `${companyId}::${competencia}`;
}

function synthesizeCircularEntries(companyId, circular) {
  const list = mockEntriesByCompany.get(companyId) || [];
  const rules = [
    { eventType: "RECEITA_SIMPLES", amountSource: "receitaBruta", debit: "5", credit: "301", tipo: "RECEITA", subtipo: null, statusPagamento: "NA", label: "VR REF RECEITA BRUTA DO SIMPLES NACIONAL - " },
    { eventType: "DAS_SIMPLES", amountSource: "dasTotal", debit: "401", credit: "5", tipo: "PROVISAO", subtipo: "DAS", statusPagamento: "ABERTO", label: "VR REF DAS SIMPLES NACIONAL - " },
    // INSS_DCTFWEB removido: INSS é lançado via folha/pró-labore manualmente.
  ];

  for (const rule of rules) {
    const amount = Number(circular?.[rule.amountSource] || 0);
    const entryId = `mock-circular-${companyId}-${circular.competencia}-${rule.eventType}`;
    const idx = list.findIndex((item) => item.id === entryId);
    if (!(amount > 0)) {
      if (idx >= 0) list.splice(idx, 1);
      continue;
    }
    const entry = {
      id: entryId,
      portalClientId: companyId,
      circularId: circular.id,
      ruleId: `rule-${rule.eventType}`,
      eventType: rule.eventType,
      data: new Date(`${circular.competencia}-28T00:00:00.000Z`).toISOString(),
      competencia: circular.competencia,
      historico: `${rule.label}${circular.competencia.slice(5)}/${circular.competencia.slice(0, 4)}`,
      tipo: rule.tipo,
      subtipo: rule.subtipo,
      origem: "SERPRO",
      loteImportacao: `SERPRO-${circular.competencia}`,
      status: circular.status || "RASCUNHO",
      statusPagamento: rule.statusPagamento,
      openEntryId: null,
      lines: [
        { id: `${entryId}-d`, entryId, conta: rule.debit, tipo: "D", valor: amount, ordem: 0 },
        { id: `${entryId}-c`, entryId, conta: rule.credit, tipo: "C", valor: amount, ordem: 1 },
      ],
      totalD: amount,
      totalC: amount,
      valor: amount,
      createdAt: circular.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
  }
  mockEntriesByCompany.set(companyId, list);
}

function getCircularRecord(companyId, competencia) {
  return mockMonthlyCirculars.get(makeCircularKey(companyId, competencia)) || null;
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
        temFolha:
          body.temFolha !== undefined ? Boolean(body.temFolha) : Boolean(current.temFolha),
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
    async uploadCompanyGuide(companyId, file, metadata) {
      await delay(600);
      if (!metadata?.tipo || !metadata?.competencia) {
        return {
          ok: false,
          needsMetadata: true,
          parsed: {
            tipo: metadata?.tipo || "",
            competencia: metadata?.competencia || "",
            valor: metadata?.valor ?? null,
            vencimento: metadata?.vencimento || null,
          },
        };
      }
      const id = `mock-guide-upload-${Date.now()}`;
      const guide = {
        id,
        guideId: id,
        tipo: String(metadata.tipo).toUpperCase(),
        competencia: metadata.competencia,
        valor: metadata.valor != null ? Number(metadata.valor) : null,
        vencimento: metadata.vencimento || null,
        status: "PROCESSED",
        paymentStatus: "OPEN",
        emailStatus: "SENT",
        source: "UPLOAD",
        canConfirmPayment: true,
        canRecalculate: false,
      };
      const list = mockGuidesByCompany.get(companyId) || [];
      list.unshift(guide);
      mockGuidesByCompany.set(companyId, list);
      return { ok: true, guide, emailStatus: "SENT", emailMessage: "Guia processada e e-mail enviado com sucesso." };
    },
    async fetchGuidePdfBlob() {
      await delay(120);
      // PDF de 1x1 vazio só pra abrir o iframe no mock sem erro
      const tinyPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
      return new Blob([tinyPdf], { type: "application/pdf" });
    },
    async identifyGuide(companyId, guideId, metadata) {
      await delay(300);
      const list = mockGuidesByCompany.get(companyId) || [];
      const idx = list.findIndex((g) => g.id === guideId || g.guideId === guideId);
      if (idx < 0) return { ok: false, error: "guide_not_found" };
      const updated = {
        ...list[idx],
        tipo: String(metadata.tipo || "").toUpperCase(),
        competencia: metadata.competencia,
        valor: metadata.valor != null ? Number(metadata.valor) : list[idx].valor,
        vencimento: metadata.vencimento || list[idx].vencimento,
        status: "PROCESSED",
      };
      list[idx] = updated;
      mockGuidesByCompany.set(companyId, list);
      return { ok: true, guide: updated };
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
    // Libera SÓ esta guia ao cliente e "envia" só ela (página da empresa).
    async liberarGuiaCliente(guideId) {
      await delay();
      for (const guides of mockGuidesByCompany.values()) {
        const target = guides.find((item) => item.id === guideId);
        if (target) {
          target.liberadaCliente = true;
          target.liberadaEm = new Date().toISOString();
          target.emailStatus = "SENT";
          return { ok: true, guideId, liberadas: 1, emailStatus: "SENT", sent: true };
        }
      }
      throw new Error("not_found");
    },
    async confirmGuidePayment(guideId) {
      await delay();
      for (const guides of mockGuidesByCompany.values()) {
        const target = guides.find((item) => item.id === guideId);
        if (target) {
          target.paymentStatus = "PAID";
          target.paymentStatusSource = "MANUAL";
          target.paymentConfirmedAt = new Date().toISOString();
          target.serproLastCheckResult = "MANUAL_CONFIRMED";
          target.canConfirmPayment = false;
          target.canRecalculate = false;
          return { ok: true, guide: { ...target, guideId: target.id, companyId: target.portalClientId } };
        }
      }
      throw new Error("not_found");
    },
    async recalculateGuide(guideId) {
      await delay(500);
      for (const guides of mockGuidesByCompany.values()) {
        const target = guides.find((item) => item.id === guideId);
        if (target) {
          target.valor = Number(faker.finance.amount({ min: 300, max: 5000, dec: 2 }));
          target.vencimento = faker.date.soon({ days: 10 }).toISOString();
          target.paymentStatus = "OPEN";
          target.paymentStatusSource = "SERPRO";
          target.paymentConfirmedAt = null;
          target.serproLastCheckedAt = new Date().toISOString();
          target.serproLastCheckResult = "FOUND";
          target.emailStatus = "PENDING";
          target.canConfirmPayment = true;
          target.canRecalculate = false;
          return {
            ok: true,
            result: {
              company: { id: target.portalClientId },
              guide: { ...target, guideId: target.id, companyId: target.portalClientId },
              integration: {
                sistema: "PGDASD",
                servico: "GERARDASCOBRANCA17",
                contratanteCnpj: "12345678000199",
                numeroDocumento: faker.string.numeric(14),
              },
            },
            emailDispatch: {
              skipped: false,
              total: 1,
              sent: 1,
              errors: 0,
              results: [{ guideId: target.id, status: "SENT" }],
            },
          };
        }
      }
      throw new Error("not_found");
    },
    async getExpectedGuides(_companyId, competencia) {
      await delay();
      return {
        ok: true,
        competencia: competencia || null,
        compliance: {
          competencia: competencia || null,
          das: { required: true, ok: false, state: "missing" },
          inss: { required: false, ok: true, state: "na" },
          irpj: { required: false, ok: true, state: "na" },
          csll: { required: false, ok: true, state: "na" },
          pisCofins: { required: false, ok: true, state: "na" },
          iss: { required: false, ok: true, state: "na" },
          ok: false,
        },
      };
    },
    async markGuideVazio() {
      await delay();
      return { ok: true, status: "VAZIO" };
    },
    async undoGuideVazio() {
      await delay();
      return { ok: true, removed: 1 };
    },
    async getFechamentoContabil(_companyId, competencia) {
      await delay();
      // Checklist com um item pendente de propósito, pra dar pra ver o estado bloqueado na tela.
      return {
        ok: true, competencia, fechado: false, folhaProlaboreOk: true,
        checklist: { folhaProlabore: true, despesas: true, receitas: true, provisoes: false, pagamentos: false },
        checklistPendentes: [{ chave: "provisoes", label: "Provisões lançadas" }, { chave: "pagamentos", label: "Pagamentos lançados" }],
        podeFechar: false, blockers: [],
      };
    },
    async setFolhaProlabore(_companyId, competencia, ok) {
      await delay();
      return { ok: true, competencia, folhaProlaboreOk: Boolean(ok) };
    },
    async listParcelasPendentesBaixa() {
      await delay();
      return { ok: true, parcelas: [] };
    },
    async lancarBaixaParcela() {
      await delay();
      return { ok: true, resultado: { pagamentoId: "mock-baixa-parcela" } };
    },
    async buscarPagamentoGuia() {
      await delay();
      return {
        ok: true, encontrado: true,
        comprovante: { dataArrecadacao: "13/07/2026", principal: 178.31, juros: 12.94, multa: 1.78, total: 193.03, meioPagamento: "PIX", confiavel: true },
      };
    },
    async setChecklistFechamento(_companyId, competencia, item, ok) {
      await delay();
      return { ok: true, competencia, item, valor: Boolean(ok) };
    },
    async fecharFechamentoContabil(_companyId, competencia) {
      await delay();
      return { ok: true, competencia, fechado: true };
    },
    async reabrirFechamentoContabil(_companyId, competencia) {
      await delay();
      return { ok: true, competencia, fechado: false };
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
      const serviceId = String(input?.serviceId || "GERARDAS12").trim() || "GERARDAS12";
      const guide = {
        guideId: faker.string.uuid(),
        companyId,
        competencia: String(input.competencia || "2026-04"),
        tipo: "SIMPLES",
        valor: Number(faker.finance.amount({ min: 300, max: 5000, dec: 2 })),
        vencimento: faker.date.soon({ days: 20 }).toISOString(),
        status: "PROCESSED",
        emailStatus: "PENDING",
        paymentStatus: "OPEN",
        paymentStatusSource: "SERPRO",
        paymentConfirmedAt: null,
        serproLastCheckedAt: new Date().toISOString(),
        serproLastCheckResult: "FOUND",
        serproService: serviceId,
        canConfirmPayment: true,
        canRecalculate: false,
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
        paymentStatus: guide.paymentStatus,
        paymentStatusSource: guide.paymentStatusSource,
        paymentConfirmedAt: guide.paymentConfirmedAt,
        serproLastCheckedAt: guide.serproLastCheckedAt,
        serproLastCheckResult: guide.serproLastCheckResult,
        serproService: guide.serproService,
        canConfirmPayment: guide.canConfirmPayment,
        canRecalculate: guide.canRecalculate,
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
            servico: serviceId,
            contratanteCnpj: "12345678000199",
            numeroDocumento: faker.string.numeric(14),
          },
        },
      };
    },
    async captureSerproLp(companyId, input = {}) {
      await delay();
      return { ok: true, result: { cabecalho: {}, debitos: [], totais: { principal: 0, juros: 0, multa: 0, total: 0 }, provisao: { ok: true } } };
    },
    async syncSerproInss(companyId, input = {}) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      const competencia = String(input.competencia || "2026-04");
      const inssTotal = Number(faker.finance.amount({ min: 180, max: 12000, dec: 2 }));
      const inssVencimento = faker.date.soon({ days: 20 }).toISOString();
      const circular = {
        id: `mock-circular-${companyId}-${competencia}`,
        portalClientId: companyId,
        competencia,
        receitaBruta: 0,
        receitaServicos: 0,
        receitaVendas: 0,
        dasTotal: 0,
        inssTotal,
        inssVencimento,
        inssPdfFileId: `mock-inss-${companyId}-${competencia}.pdf`,
        inssPdfUrl: `file:///mock/${companyId}/${competencia}.pdf`,
        inssStatus: "EMITTED",
        metadata: {
          integrationSource: "SERPRO_DCTFWEB",
          sistema: "DCTFWEB",
          servico: "GERARGUIA31",
          rawPayload: { inssTotal, inssVencimento },
        },
        hasAccountingDivergence: false,
        accountingDivergenceMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockMonthlyCirculars.set(makeCircularKey(companyId, competencia), circular);
      synthesizeCircularEntries(companyId, circular);
      return {
        ok: true,
        result: {
          company: { id: companyId, razao: company.razao, cnpj: company.cnpj },
          circular,
          accounting: { ok: true, generatedEntries: [] },
          inss: { status: "EMITTED", competencia, inssTotal, inssVencimento, pdfFileId: circular.inssPdfFileId, pdfUrl: circular.inssPdfUrl },
        },
      };
    },
    async captureSerproParcelamento(companyId) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      return { ok: true, parcelamentos: [], skipped: "sem_parcelamento_ativo" };
    },
    // Q40 stubs
    async confirmarPagamentoSerpro(companyId) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      return { ok: true, result: { total: 0, paid: 0, open: 0, errors: 0, results: [] } };
    },
    async getSitfis(companyId) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      return { ok: true, processando: false, situacao: "REGULAR", protocolo: null, relatorioPdfFileId: null, relatorioTexto: null, verificadoTrial: false };
    },
    async getStoredSitfis(companyId) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      return {
        ok: true,
        status: {
          situacao: "COM_PENDENCIA",
          checkedAt: new Date().toISOString(),
          // Relatório interpretado — o mesmo formato que o backend devolve (parseSitfisRelatorio).
          // Com um órgão COM pendência, um SEM, e um TERCEIRO que o parser não conseguiu ler:
          // esse último é o caso que a tabela precisa continuar mostrando em vez de esconder.
          // Espelha o formato REAL do parser (conferido contra a ATIM em produção): um bloco por
          // assunto, cada um com suas próprias colunas. Inclui de propósito um bloco ILEGÍVEL —
          // é o caso que precisa continuar visível em vez de sumir.
          relatorio: {
            emitidoEm: "29/07/2026 14:54:45",
            contribuinte: { cnpj: "52.682.158", nome: "EMPRESA MOCK" },
            diagnosticos: [
              {
                orgao: "Receita Federal", chave: "RFB", semPendencia: false,
                blocos: [
                  {
                    titulo: "Pendência - Parcelamento (PARCSN/PARCMEI)",
                    descricao: ["SIMPLES NACIONAL - EM PARCELAMENTO"],
                    colunas: ["Parcelas em atraso"],
                    registros: [{ "Parcelas em atraso": "4" }],
                    anotacoes: [], naoInterpretado: [],
                  },
                  {
                    titulo: "Pendência - Débito (SIEF)",
                    descricao: [],
                    colunas: ["Receita", "PA/Exerc.", "Dt. Vcto", "Vl. Original", "Sdo. Devedor", "Multa", "Juros", "Sdo. Dev. Cons.", "Situação"],
                    registros: [
                      { "Receita": "4406-01 - MAED - PGDAS-D", "PA/Exerc.": "23/02/2026", "Dt. Vcto": "25/03/2026", "Vl. Original": "50,00", "Sdo. Devedor": "50,00", "Multa": "0,00", "Juros": "2,14", "Sdo. Dev. Cons.": "52,14", "Situação": "DEVEDOR" },
                      { "Receita": "1099-01 - CP-SEGUR.", "PA/Exerc.": "02/2026", "Dt. Vcto": "20/03/2026", "Vl. Original": "178,31", "Sdo. Devedor": "178,31", "Multa": "35,66", "Juros": "7,63", "Sdo. Dev. Cons.": "221,60", "Situação": "DEVEDOR" },
                      { "Receita": "SIMPLES NAC.", "PA/Exerc.": "12/2025", "Dt. Vcto": "21/01/2026", "Vl. Original": "2.382,50", "Sdo. Devedor": "2.382,50", "Multa": "476,50", "Juros": "154,62", "Sdo. Dev. Cons.": "3.013,62", "Situação": "DEVEDOR" },
                    ],
                    anotacoes: ["52682158202601001"], naoInterpretado: [],
                  },
                  {
                    titulo: "Pendência - Processo Fiscal (SIEF)",
                    descricao: [], colunas: ["Processo", "Situação", "Localização"],
                    registros: [{ "Processo": "10642.032.115/2026-17", "Situação": "DEVEDOR", "Localização": "SETOR PROC ELETRONICO REFIS-DRFRJ2-RJ" }],
                    anotacoes: [], naoInterpretado: [],
                  },
                  {
                    titulo: "Pendência - Bloco de exemplo (ilegível)",
                    descricao: [], colunas: [], registros: [], anotacoes: [],
                    naoInterpretado: ["LINHA SOLTA A", "LINHA SOLTA B"],
                  },
                ],
              },
              { orgao: "Procuradoria-Geral da Fazenda Nacional", chave: "PGFN", semPendencia: true, blocos: [] },
            ],
            naoInterpretado: [],
            temTexto: true,
          },
          // Sem PDF no mock → dá pra conferir que a tabela aparece SEM depender do PDF.
          relatorioPdfFileId: null,
          protocolo: null,
          podeConsultar: true,
          proximaConsultaEm: null,
        },
      };
    },
    async listFiscalPendencias() {
      await delay();
      return { items: mockCompanies.map((c) => ({ companyId: c.companyId, razao: c.razao, cnpj: c.cnpj, situacao: null, checkedAt: null, protocolo: null, relatorioPdfFileId: null })) };
    },
    async fetchSitfisPdfBlob() {
      await delay();
      const tinyPdf = "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF";
      return new Blob([tinyPdf], { type: "application/pdf" });
    },
    async runSerproPaymentConfirmation() {
      await delay(500);
      return { ok: true, result: { total: 0, paid: 0, open: 0, errors: 0, results: [] } };
    },
    // Rotinas: espelha o shape do GET /firm/rotinas (rotinas + agenda + empresas).
    async getRotinas() {
      await delay();
      return {
        ok: true,
        rotinas: [
          { key: "das", label: "DAS" },
          { key: "inss", label: "INSS" },
          { key: "extrato", label: "Extrato" },
          { key: "presumido", label: "Presumido" },
          { key: "parcelamento", label: "Parcelamento" },
          { key: "pagamento", label: "Pagamento" },
        ],
        agenda: {
          das: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          inss: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          extrato: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          presumido: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          parcelamento: { enabled: true, day: 10, hour: 7, cron: "0 7 10-12 * *" },
          pagamento: { enabled: true, day: 20, hour: 8, cron: "0 8 20-22 * *" },
        },
        empresas: mockCompanies.map((c, i) => ({
          companyId: c.companyId,
          razao: c.razao,
          cnpj: c.cnpj,
          status: "ATIVA",
          regime: i % 3 === 0 ? "LUCRO_PRESUMIDO" : "SIMPLES",
          rotinas: i % 3 === 0
            ? { das: false, inss: true, extrato: false, presumido: true, parcelamento: false, pagamento: true }
            : { das: true, inss: true, extrato: true, presumido: false, parcelamento: true, pagamento: true },
        })),
      };
    },
    async saveRotinas(input = {}) {
      await delay(400);
      const atualizadas = Array.isArray(input.empresas)
        ? input.empresas.reduce((s, e) => s + Object.keys(e.rotinas || {}).length, 0)
        : 0;
      return { ok: true, atualizadas, agenda: input.agenda || {} };
    },
    async runSerproCron(input = {}) {
      await delay(800);
      const competencia = String(input.competencia || "2026-04");
      return {
        ok: true,
        competencia,
        durationMs: 812,
        pgdasd: {
          ok: true,
          summary: { totalCompanies: 4, captured: 3, failed: 0, skippedByProcuration: 1, durationMs: 612 },
        },
        dctfweb: {
          ok: true,
          summary: { totalCompanies: 4, captured: 2, failed: 0, skippedByProcuration: 1, durationMs: 198 },
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
    // Q52: folha/pró-labore — cada linha vira 1 entry individual (mesmo lote).
    async createFolhaEntries(companyId, payload = {}) {
      await delay();
      const subtipo = String(payload.subtipo || "FOLHA").toUpperCase() === "PROLABORE" ? "PROLABORE" : "FOLHA";
      const loteImportacao = `${subtipo}-${Date.now()}`;
      const list = mockEntriesByCompany.get(companyId) || [];
      const created = [];
      const mk = (data, historico, lines) => {
        const entryId = faker.string.uuid();
        const totalD = lines.filter((l) => l.tipo === "D").reduce((s, l) => s + Number(l.valor || 0), 0);
        const entry = {
          id: entryId, portalClientId: companyId,
          data: new Date(data).toISOString(),
          competencia: String(payload.competencia || ""),
          historico, tipo: "FOLHA", subtipo, origem: "MANUAL", loteImportacao,
          status: "RASCUNHO", statusPagamento: "NA", openEntryId: null,
          lines: lines.map((l, idx) => ({ id: faker.string.uuid(), entryId, conta: l.conta, tipo: l.tipo, valor: Number(l.valor || 0), ordem: idx })),
          totalD, totalC: lines.filter((l) => l.tipo === "C").reduce((s, l) => s + Number(l.valor || 0), 0),
          valor: totalD,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        list.push(entry);
        created.push({ entryId, historico, valor: Number(lines[0]?.valor || 0) });
      };
      for (const p of payload.provisoes || []) mk(p.data, p.historico || subtipo, [p.line]);
      for (const b of payload.baixas || []) mk(b.data, b.historico || `PAGO ${subtipo}`, b.lines || []);
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, loteImportacao, created };
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
      let list = mockEntriesByCompany.get(companyId) || [];
      const target = list.find((e) => e.id === entryId);
      if (target?.tipo === "BAIXA" && target?.openEntryId) {
        list = list.map((e) =>
          e.id === target.openEntryId ? { ...e, statusPagamento: "ABERTO" } : e
        );
      }
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
    // Q47: baixa do INSS (guia sintética) — stubs para o modo mock.
    async getInssBaixaTemplate() {
      await delay();
      return { ok: true, template: null, reason: "mock" };
    },
    async saveInssBaixa() {
      await delay();
      return { ok: true, inssBaixa: { ok: true } };
    },
    // Mock do parcelamento Simples Nacional — cria N entries no array mock.
    async createParcelamentoSimples(companyId, payload = {}) {
      await delay();
      const numParcelas = Math.min(60, Math.max(1, Number(payload.numParcelas) || 1));
      const principalValue = Number(payload.principalValue || 0);
      const jurosValue = Number(payload.jurosValue || 0);
      const totalLinha = principalValue + jurosValue;
      const comp = String(payload.competenciaInicial || "");
      const [y, m] = comp.split("-").map(Number);
      const dia = Math.min(31, Math.max(1, Number(payload.diaPagamento) || 1));
      const loteImportacao = `PARC_DAS-${Date.now()}`;
      const list = mockEntriesByCompany.get(companyId) || [];
      const created = [];
      for (let i = 0; i < numParcelas; i++) {
        const compN = new Date(Date.UTC(y, m - 1 + i, 1));
        const compStr = `${compN.getUTCFullYear()}-${String(compN.getUTCMonth() + 1).padStart(2, "0")}`;
        const lastDay = new Date(Date.UTC(compN.getUTCFullYear(), compN.getUTCMonth() + 1, 0)).getUTCDate();
        const dataN = new Date(Date.UTC(compN.getUTCFullYear(), compN.getUTCMonth(), Math.min(dia, lastDay)));
        const id = faker.string.uuid();
        const historicoN = `VR REF ${payload.label || "PARCELAMENTO SIMPLES NACIONAL"} EM ${numParcelas} PARCELAS N/${i + 1}`;
        list.push({
          id,
          portalClientId: companyId,
          data: dataN.toISOString(),
          competencia: compStr,
          historico: historicoN,
          tipo: "PROVISAO",
          subtipo: "PARC_DAS",
          origem: "MANUAL",
          loteImportacao,
          status: "RASCUNHO",
          statusPagamento: "ABERTO",
          lines: [
            { id: faker.string.uuid(), entryId: id, conta: payload.principalAccount, tipo: "D", valor: principalValue, ordem: 0 },
            ...(jurosValue > 0 ? [{ id: faker.string.uuid(), entryId: id, conta: payload.jurosAccount, tipo: "D", valor: jurosValue, ordem: 1 }] : []),
            { id: faker.string.uuid(), entryId: id, conta: payload.contraAccount, tipo: "C", valor: totalLinha, ordem: 2 },
          ],
          totalD: totalLinha, totalC: totalLinha, valor: totalLinha,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        created.push({ parcela: i + 1, entryId: id, competencia: compStr, data: dataN.toISOString(), valor: totalLinha });
      }
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, loteImportacao, created, totalParcelas: numParcelas };
    },
    async getBatchEmailReport(competencia) {
      await delay(200);
      const ref = competencia || "2026-04";
      // Gera dataset mock baseado nas empresas mockadas. Cada empresa simula um regime.
      const REGIMES = ["SIMPLES", "LUCRO_PRESUMIDO"];
      const simples = [];
      const presumidos = [];
      mockCompanies.forEach((c, idx) => {
        const regime = REGIMES[idx % REGIMES.length];
        const row = {
          portalClientId: c.companyId,
          razao: c.razao,
          cnpj: c.cnpj,
          regimeTributario: regime,
          tiposGuias: {
            DAS: null, INSS: null, IRPJ: null, CSLL: null,
            PIS_COFINS: null, ISS: null, FGTS: null, PARC_DAS: null,
          },
          pendingGuideIds: [],
        };
        // Aleatoriamente "captura" 0-3 guias do regime correspondente
        const captured = faker.helpers.arrayElement([0, 1, 2, 2, 3]);
        if (regime === "SIMPLES") {
          if (captured >= 1) row.tiposGuias.DAS = { guideId: faker.string.uuid(), valor: 500 };
          if (captured >= 2) row.tiposGuias.INSS = { guideId: faker.string.uuid(), valor: 250 };
          if (idx % 4 === 0) row.tiposGuias.PARC_DAS = { entryId: faker.string.uuid(), isParcelamento: true };
          simples.push(row);
        } else {
          if (captured >= 1) row.tiposGuias.IRPJ = { guideId: faker.string.uuid(), valor: 800 };
          if (captured >= 2) row.tiposGuias.CSLL = { guideId: faker.string.uuid(), valor: 400 };
          if (captured >= 3) row.tiposGuias.PIS_COFINS = { guideId: faker.string.uuid(), valor: 350 };
          if (idx % 3 === 0) row.tiposGuias.ISS = { guideId: faker.string.uuid(), valor: 200 };
          if (idx % 2 === 0) row.tiposGuias.INSS = { guideId: faker.string.uuid(), valor: 250 };
          presumidos.push(row);
        }
      });
      return { competencia: ref, simples, presumidos, outros: [] };
    },
    async sendBatchEmails(items) {
      await delay(800);
      return {
        ok: true,
        total: items.length,
        sent: items.length,
        results: items.map((it) => ({
          portalClientId: it.portalClientId, competencia: it.competencia,
          ok: true, status: "sent", sentNow: 2, attachmentsCount: 2,
        })),
      };
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
      // Fixture: uma provisão ABERTA garante o botão "Dar baixa" no mock (o modal de baixa só
      // aparece a partir dela). Sem isso não dá pra conferir o modal sem backend.
      if (provisoes.length === 0) {
        provisoes.push({
          id: "mock-provisao-das",
          competencia: meses[5],
          tipo: "PROVISAO",
          subtipo: "DAS",
          eventType: "DAS_SIMPLES",
          statusPagamento: "ABERTO",
          valor: 1234.56,
          totalD: 1234.56,
          totalC: 1234.56,
          lines: [
            { conta: "265", tipo: "D", valor: 1234.56, ordem: 0 },
            { conta: "553", tipo: "C", valor: 1234.56, ordem: 1 },
          ],
          baixas: [],
        });
      }
      return { year: y, provisoes, receitas };
    },
    async getCircularAccountingEntries(companyId, competencia) {
      await delay();
      const circular = getCircularRecord(companyId, competencia);
      const list = mockEntriesByCompany.get(companyId) || [];
      const entries = list.filter((entry) => entry.competencia === competencia && entry.origem === "SERPRO");
      return { circular, entries, allEntries: entries };
    },
    async updateCircular(companyId, competencia, input = {}) {
      await delay();
      const receitaServicos = Number(input.receitaServicos ?? 0);
      const receitaVendas = Number(input.receitaVendas ?? 0);
      const receitaBruta = input.receitaBruta != null ? Number(input.receitaBruta) : receitaServicos + receitaVendas;
      const circular = {
        id: `mock-circular-${companyId}-${competencia}`,
        portalClientId: companyId,
        competencia,
        receitaBruta,
        receitaServicos,
        receitaVendas,
        dasTotal: input.dasTotal ?? null,
        inssTotal: input.inssTotal ?? null,
        inssVencimento: input.inssVencimento ? new Date(input.inssVencimento).toISOString() : null,
        inssPdfFileId: input.inssPdfFileId || null,
        inssPdfUrl: input.inssPdfUrl || null,
        inssStatus: input.inssStatus || null,
        metadata: input.metadata || null,
        hasAccountingDivergence: false,
        accountingDivergenceMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockMonthlyCirculars.set(makeCircularKey(companyId, competencia), circular);
      synthesizeCircularEntries(companyId, circular);
      return { ok: true, circular, accounting: { ok: true, generatedEntries: [] } };
    },
    async syncPgdasCircular(companyId, competencia) {
      await delay();
      const company = mockCompanies.find((item) => item.companyId === companyId);
      if (!company) throw new Error("PORTAL_COMPANY_NOT_FOUND");
      const receitaBruta = Number(faker.finance.amount({ min: 15000, max: 95000, dec: 2 }));
      const isServico = faker.datatype.boolean();
      const receitaServicos = isServico ? receitaBruta : 0;
      const receitaVendas = isServico ? 0 : receitaBruta;
      const dasTotal = Number(faker.finance.amount({ min: 800, max: 8000, dec: 2 }));
      const circular = {
        id: `mock-circular-${companyId}-${competencia}`,
        portalClientId: companyId,
        competencia,
        receitaBruta,
        receitaServicos,
        receitaVendas,
        dasTotal,
        inssTotal: 0,
        pgdasNumeroDeclaracao: `${company.cnpj.replace(/\D/g, "").slice(0, 8)}${competencia.replace(/\D/g, "")}001`,
        pgdasDeclaracaoFileId: `mock-pgdas-declaracao-${companyId}-${competencia}.pdf`,
        pgdasDeclaracaoFileUrl: `file:///mock/${companyId}/${competencia}-pgdas-declaracao.pdf`,
        pgdasReciboFileId: `mock-pgdas-recibo-${companyId}-${competencia}.pdf`,
        pgdasReciboFileUrl: `file:///mock/${companyId}/${competencia}-pgdas-recibo.pdf`,
        receitaStatus: "SUCCESS",
        dasStatus: "SUCCESS",
        serproSyncStatus: "SUCCESS",
        serproLastSyncAt: new Date().toISOString(),
        serproLastError: null,
        metadata: {
          integrationSource: "SERPRO_PGDASD_DECLARACAO",
          sistema: "PGDASD",
          servico: "CONSULTIMADECREC14",
        },
        hasAccountingDivergence: false,
        accountingDivergenceMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      mockMonthlyCirculars.set(makeCircularKey(companyId, competencia), circular);
      synthesizeCircularEntries(companyId, circular);
      return { ok: true, result: { company: { id: companyId, razao: company.razao, cnpj: company.cnpj }, circular, accounting: { ok: true, generatedEntries: [] } } };
    },
    async approveAccountingEntry(companyId, entryId) {
      await delay();
      const list = mockEntriesByCompany.get(companyId) || [];
      const idx = list.findIndex((entry) => entry.id === entryId);
      if (idx < 0) throw new Error("lancamento_nao_encontrado");
      list[idx] = { ...list[idx], status: "CONFIRMADO", updatedAt: new Date().toISOString() };
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, entry: list[idx] };
    },
    async previewOFX() {
      await delay(400);
      // Mock: parte das linhas vem com match (simulando histórico salvo), parte sem.
      const SAMPLE_DESCS = [
        { desc: "PAGAMENTO FORNECEDOR", match: { historicoSugerido: "Pagamento fornecedor", contaDebito: "411", contaCredito: "5", matchType: "exact", usageCount: 4, scope: "COMPANY" } },
        { desc: "TARIFA BANCARIA", match: { historicoSugerido: "Tarifa bancária", contaDebito: "425", contaCredito: "5", matchType: "exact", usageCount: 12, scope: "GLOBAL" } },
        { desc: "TED RECEBIDA CLIENTE XYZ 12345", match: null },
        { desc: "COMPRA CARTAO POSTO ABC", match: null },
        { desc: "DEBITO AUTOMATICO LUZ", match: { historicoSugerido: "Energia elétrica", contaDebito: "423", contaCredito: "5", matchType: "substring", usageCount: 2, scope: "COMPANY" } },
      ];
      const transactions = Array.from({ length: faker.number.int({ min: 3, max: 8 }) }).map((_, idx) => {
        const sample = faker.helpers.arrayElement(SAMPLE_DESCS);
        return {
          rowIndex: idx,
          fitId: faker.string.alphanumeric(12),
          trnType: "DEBIT",
          data: faker.date.recent({ days: 30 }).toISOString().slice(0, 10),
          descricaoOfx: sample.desc,
          valor: Number(faker.finance.amount({ min: 50, max: 5000, dec: 2 })),
          sinal: "DEBITO",
          match: sample.match,
        };
      });
      return { ok: true, transactions, total: transactions.length };
    },
    async importOFX(companyId, { transactions = [] } = {}) {
      await delay(600);
      const loteImportacao = `OFX-${Date.now()}`;
      const list = mockEntriesByCompany.get(companyId) || [];
      for (const t of transactions) {
        const data = t.data ? new Date(t.data) : new Date();
        const valor = Number(t.valor || 0);
        const entryId = faker.string.uuid();
        list.push({
          id: entryId,
          portalClientId: companyId,
          data: data.toISOString(),
          competencia: `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`,
          historico: t.historico || t.descricaoOfx || "",
          tipo: t.tipo || "DESPESA",
          subtipo: null,
          origem: "OFX",
          loteImportacao,
          status: "RASCUNHO",
          statusPagamento: "NA",
          openEntryId: null,
          lines: [
            { id: faker.string.uuid(), entryId, conta: t.contaDebito, tipo: "D", valor, ordem: 0 },
            { id: faker.string.uuid(), entryId, conta: t.contaCredito, tipo: "C", valor, ordem: 1 },
          ],
          totalD: valor, totalC: valor, valor,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      mockEntriesByCompany.set(companyId, list);
      return { ok: true, created: transactions.length, failed: 0, loteImportacao };
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

    async runCompanyFiscalAction(companyId, input) {
      await delay(500);
      const action = String(input?.action || "").toLowerCase();
      const competencia = input?.competencia;

      if (!action) throw new Error("action_required");
      if (!competencia) throw new Error("competencia_required");

      const startedAt = new Date().toISOString();
      let result;

      switch (action) {
        case "search_guides": {
          result = {
            action: "search_guides",
            competencia,
            status: "completed",
            guidesFound: faker.number.int({ min: 0, max: 5 }),
            guidesCaptured: faker.number.int({ min: 0, max: 3 }),
            guidesUpdated: faker.number.int({ min: 0, max: 2 }),
            circularUpdated: faker.datatype.boolean(),
            entriesGenerated: faker.number.int({ min: 0, max: 10 }),
            timestamp: startedAt,
          };
          break;
        }
        case "check_payments": {
          const total = faker.number.int({ min: 2, max: 8 });
          const paid = faker.number.int({ min: 0, max: total });
          const overdue = faker.number.int({ min: 0, max: total - paid });
          result = {
            action: "check_payments",
            competencia,
            status: "completed",
            guidesChecked: total,
            guidesPaid: paid,
            guidesOverdue: overdue,
            guidesOpen: total - paid - overdue,
            timestamp: startedAt,
          };
          break;
        }
        case "sync_inss": {
          result = {
            action: "sync_inss",
            competencia,
            status: "completed",
            guidesFound: faker.number.int({ min: 0, max: 2 }),
            guidesCaptured: faker.number.int({ min: 0, max: 1 }),
            circularUpdated: faker.datatype.boolean(),
            timestamp: startedAt,
          };
          break;
        }
        default: {
          const err = new Error(`Unknown action: ${action}`);
          err.code = "UNKNOWN_FISCAL_ACTION";
          throw err;
        }
      }

      // Persist execution to mock store
      const logEntry = {
        id: faker.string.uuid(),
        portalClientId: companyId,
        competencia,
        action,
        status: result.status,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: faker.number.int({ min: 200, max: 2000 }),
        guidesFound: result.guidesFound ?? null,
        guidesCaptured: result.guidesCaptured ?? null,
        guidesUpdated: result.guidesUpdated ?? null,
        guidesChecked: result.guidesChecked ?? null,
        guidesPaid: result.guidesPaid ?? null,
        guidesOverdue: result.guidesOverdue ?? null,
        guidesOpen: result.guidesOpen ?? null,
        circularUpdated: result.circularUpdated ?? null,
        entriesGenerated: result.entriesGenerated ?? null,
        errorCode: null,
        errorMessage: null,
        skipReason: result.reason ?? null,
        triggeredBy: null,
      };

      const existing = mockFiscalExecutions.get(companyId) || [];
      mockFiscalExecutions.set(companyId, [logEntry, ...existing]);

      return result;
    },

    async getFiscalExecutions(companyId, params = {}) {
      await delay(200);
      const all = mockFiscalExecutions.get(companyId) || [];
      let filtered = all;
      if (params.competencia) filtered = filtered.filter((e) => e.competencia === params.competencia);
      if (params.action) filtered = filtered.filter((e) => e.action === params.action);
      const limit = Math.min(Number(params.limit) || 20, 100);
      return filtered.slice(0, limit);
    },

    // ── Q12.A: stubs do módulo Notas (mock não persiste) ──
    async listProcuracoes() { await delay(60); return []; },
    async createProcuracao() { await delay(60); return { ok: true, procuracao: null }; },
    async revogarProcuracao() { await delay(60); return { ok: true }; },
    async listCompetenciasNotas(_id, ano) {
      await delay(80);
      const y = ano || new Date().getUTCFullYear();
      return {
        ano: y,
        competencias: Array.from({ length: 12 }, (_, i) => ({
          id: null, competencia: `${y}-${String(i + 1).padStart(2, "0")}`,
          estado: "aberto", lockedAt: null, reopenedAt: null,
          rb12: null, fs12Manual: null, fs12Origem: null, fatorR: null,
          notasCount: 0, pendenciasAbertas: 0,
        })),
      };
    },
    async getCompetenciaNotas(_id, competencia) {
      await delay(60);
      return { competencia, estado: "aberto", notasCount: 0, pendenciasAbertas: 0 };
    },
    async fecharCompetencia() { await delay(60); return { ok: true, competencia: { estado: "fechado" } }; },
    async reabrirCompetencia() { await delay(60); return { ok: true, competencia: { estado: "em_conferencia" } }; },
    async listPendenciasPosFechamento() { await delay(60); return []; },
    async resolverPendencia() { await delay(60); return { ok: true }; },
    async syncDfe() { await delay(80); return { ok: true, result: { totalDocs: 0, byType: {}, newCursor: "0" } }; },
    async getDfeState() { await delay(60); return null; },
    async clearDfeError() { await delay(40); return { ok: true }; },
    async syncAdn() { await delay(80); return { ok: true, result: { totalDocs: 0, byStatus: {}, newCursor: "0" } }; },
    async getAdnState() { await delay(60); return null; },
    async clearAdnError() { await delay(40); return { ok: true }; },
    async importInvoicesXml() { await delay(120); return { created: 0, updated: 0, duplicates: 0, errors: [] }; },
    // Q48: download de notas em lote — job fake que "conclui" no primeiro poll.
    async createNotasDownload(payload = {}) {
      await delay(80);
      return { ok: true, jobId: `mock-notas-dl-${Date.now()}` };
    },
    // ── Calendário fiscal (mock) ───────────────────────────────────────────────────────────
    // Popula o mês pedido: guias em dias fixos, um marco do escritório e um da empresa. Mês vazio
    // não deixaria conferir a grade, que é justamente o que precisa ser visto.
    async getCalendario(mes) {
      await delay(80);
      const [y, m] = String(mes || "2026-07").split("-").map(Number);
      const diasNoMes = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const iso = (d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const porDia = {
        15: [
          { tipo: "guia", id: "g1", titulo: "INSS", companyId: "c1", empresa: "Farrell - Brakus", competencia: mes, valor: 193.03, resolvido: false },
          { tipo: "guia", id: "g2", titulo: "INSS", companyId: "c2", empresa: "Schultz and Sons", competencia: mes, valor: 421.9, resolvido: true },
        ],
        20: [
          { tipo: "guia", id: "g3", titulo: "SIMPLES", companyId: "c1", empresa: "Farrell - Brakus", competencia: mes, valor: 1441.25, resolvido: false },
          { tipo: "guia", id: "g4", titulo: "SIMPLES", companyId: "c3", empresa: "Kirlin - Kris", competencia: mes, valor: 2380.11, resolvido: false },
        ],
        1: [{ tipo: "marco", id: "mk1", titulo: "CBS passa a ser cobrada", descricao: "Fim da fase de teste", importancia: "ALTA", companyId: null, empresa: null, doEscritorio: true }],
        8: [{ tipo: "marco", id: "mk2", titulo: "Reuniao com o cliente", importancia: "BAIXA", companyId: "c1", empresa: "Farrell - Brakus", doEscritorio: false }],
      };

      // Quinta fonte: as obrigações cadastradas, no mesmo formato do backend. Vêm do estado real do
      // mock (não de uma lista fixa), então criar uma obrigação na aba aparece aqui na hora.
      const hojeStr = new Date().toISOString().slice(0, 10);
      for (const o of mockObrigacoes) {
        if (!o.ativa) continue;
        for (const oc of o.ocorrencias) {
          if (!oc.dataVencimento.startsWith(mes)) continue;
          const dia = Number(oc.dataVencimento.slice(8));
          const situacao = oc.status === "CONCLUIDA" ? "CONCLUIDA"
            : oc.dataVencimento < hojeStr ? "VENCIDA" : "PENDENTE";
          porDia[dia] = [...(porDia[dia] || []), {
            tipo: "obrigacao", id: oc.ocorrenciaId, titulo: o.nome, categoria: o.categoria,
            cor: o.cor, companyId: o.companyId, empresa: o.empresa,
            competencia: oc.competenciaRef, data: oc.dataVencimento, situacao,
            resolvido: oc.status === "CONCLUIDA",
            conclusaoAutomatica: Boolean(o.verificador), fonteConclusao: oc.fonteConclusao,
          }];
        }
      }
      return {
        ok: true, competencia: mes, diasNoMes,
        dias: Array.from({ length: diasNoMes }, (_, i) => ({
          dia: i + 1,
          data: iso(i + 1),
          itens: porDia[i + 1] || [],
          // Feriado é propriedade do DIA, não item: não se clica nem se conclui.
          feriado: MOCK_FERIADOS[iso(i + 1)] || null,
        })),
        pendenciasDoMes: [
          { tipo: "apuracao", companyId: "c1", empresa: "Farrell - Brakus", competencia: mes, titulo: "Apuracao nao transmitida", estado: "calculada" },
          { tipo: "fechamento", companyId: "c2", empresa: "Schultz and Sons", competencia: mes, titulo: "Mes contabil nao fechado" },
        ],
        totais: { guias: 4, marcos: 2, apuracoes: 1, fechamentos: 1 },
      };
    },
    // ── Obrigações (mock com estado em memória) ────────────────────────────────────────────
    // Estado de verdade, não retorno fixo: as regras que importam aqui só aparecem mexendo — a
    // janela de 12 ocorrências, a recusa do clique em obrigação automática e o VENCIDA derivado.
    // Um mock imutável passaria por todas elas sem testar nenhuma.
    async listObrigacoes({ companyId, incluirInativas } = {}) {
      await delay(70);
      const hoje = new Date().toISOString().slice(0, 10);
      const emSeteDias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      let pendentes = 0, vencendoEm7Dias = 0, vencidas = 0;

      const lista = mockObrigacoes
        .filter((o) => (companyId ? o.companyId === companyId : true))
        .filter((o) => (incluirInativas ? true : o.ativa))
        .map((o) => {
          const ocorrencias = o.ocorrencias.map((oc) => {
            const situacao =
              oc.status === "CONCLUIDA" ? "CONCLUIDA" : oc.dataVencimento < hoje ? "VENCIDA" : "PENDENTE";
            return { ...oc, situacao };
          });
          for (const oc of ocorrencias) {
            if (oc.situacao === "VENCIDA") vencidas += 1;
            else if (oc.situacao === "PENDENTE") {
              pendentes += 1;
              if (oc.dataVencimento <= emSeteDias) vencendoEm7Dias += 1;
            }
          }
          const proxima = ocorrencias.find((oc) => oc.situacao === "PENDENTE");
          return {
            ...o,
            conclusaoAutomatica: Boolean(o.verificador),
            proximoVencimento: proxima?.dataVencimento || null,
            ocorrencias,
          };
        });

      return {
        ok: true,
        obrigacoes: lista,
        resumo: { pendentes, vencendoEm7Dias, vencidas },
        opcoes: {
          periodicidades: ["MENSAL", "TRIMESTRAL", "ANUAL"],
          ajustesDiaUtil: ["ANTECIPAR", "POSTERGAR", "MANTER"],
          verificadores: [
            { chave: "APURACAO_TRANSMITIDA", rotulo: "Quando a apuração da competência for transmitida" },
            { chave: "MES_FECHADO", rotulo: "Quando o mês contábil da competência for fechado" },
          ],
        },
      };
    },
    async createObrigacao(companyId, dados) {
      await delay(90);
      const empresa = mockCompanies.find((c) => c.companyId === companyId);
      const obrigacao = mockCriarObrigacao(companyId, empresa?.razao || null, dados);
      mockObrigacoes.push(obrigacao);
      return { ok: true, obrigacao, ocorrenciasCriadas: obrigacao.ocorrencias.length };
    },
    async updateObrigacao(obrigacaoId, patch) {
      await delay(80);
      const i = mockObrigacoes.findIndex((o) => o.obrigacaoId === obrigacaoId);
      if (i < 0) return { ok: false, error: "nao_encontrada", message: "Obrigação não encontrada." };
      const antes = mockObrigacoes[i];
      // Concluída é histórico: sobrevive à regeração, igual ao backend.
      const concluidas = antes.ocorrencias.filter((oc) => oc.status === "CONCLUIDA");
      const nova = mockCriarObrigacao(antes.companyId, antes.empresa, { ...antes, ...patch });
      nova.obrigacaoId = antes.obrigacaoId;
      const jaTem = new Set(concluidas.map((oc) => oc.dataVencimento));
      nova.ocorrencias = [...concluidas, ...nova.ocorrencias.filter((oc) => !jaTem.has(oc.dataVencimento))]
        .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));
      if (nova.ativa === false) nova.ocorrencias = concluidas;
      mockObrigacoes[i] = nova;
      return { ok: true, obrigacao: nova, ocorrenciasCriadas: 0, ocorrenciasRemovidas: 0 };
    },
    async deleteObrigacao(obrigacaoId) {
      await delay(60);
      const i = mockObrigacoes.findIndex((o) => o.obrigacaoId === obrigacaoId);
      if (i < 0) return { ok: false, error: "nao_encontrada" };
      const [removida] = mockObrigacoes.splice(i, 1);
      return { ok: true, removida: { id: removida.obrigacaoId, nome: removida.nome } };
    },
    async concluirOcorrencia(ocorrenciaId) {
      await delay(60);
      for (const o of mockObrigacoes) {
        const oc = o.ocorrencias.find((x) => x.ocorrenciaId === ocorrenciaId);
        if (!oc) continue;
        // Mesma recusa do backend: o que se conclui sozinho não aceita clique.
        if (o.verificador) {
          return {
            ok: false,
            error: "conclusao_automatica",
            message: "Esta obrigação se conclui sozinha quando o sistema observa o serviço feito.",
          };
        }
        oc.status = "CONCLUIDA";
        oc.concluidaEm = new Date().toISOString();
        oc.fonteConclusao = "MANUAL";
        return { ok: true, ocorrencia: oc };
      }
      return { ok: false, error: "nao_encontrada" };
    },
    async reabrirOcorrencia(ocorrenciaId) {
      await delay(60);
      for (const o of mockObrigacoes) {
        const oc = o.ocorrencias.find((x) => x.ocorrenciaId === ocorrenciaId);
        if (!oc) continue;
        oc.status = "PENDENTE";
        oc.concluidaEm = null;
        oc.fonteConclusao = null;
        return { ok: true, ocorrencia: oc };
      }
      return { ok: false, error: "nao_encontrada" };
    },
    // ── Regras do escritório (mock com propagação de verdade) ─────────────────────────────
    // A propagação é o comportamento que precisa ser visto: quem entra no filtro, quem sai, e o
    // que acontece com a empresa editada localmente. Um retorno fixo mostraria a tela e esconderia
    // exatamente isso.
    async listRegrasObrigacao() {
      await delay(70);
      return {
        ok: true,
        regras: mockRegras.map((r) => {
          const aplicadas = mockObrigacoes.filter((o) => o.regraId === r.regraId);
          return {
            ...r,
            totalEmpresas: aplicadas.length,
            totalExcecoes: r.excecoes.length,
            totalSobrescritas: aplicadas.filter((o) => o.sobrescritaLocal).length,
            resumoEscopo: mockResumoEscopo(r, aplicadas.length),
            empresas: aplicadas.map((o) => ({
              companyId: o.companyId, razao: o.empresa, obrigacaoId: o.obrigacaoId,
              sobrescritaLocal: o.sobrescritaLocal,
            })),
          };
        }),
        opcoes: {
          escopos: ["TODAS", "POR_FILTRO", "SELECAO_MANUAL"],
          regimes: ["SIMPLES", "LUCRO_PRESUMIDO", "LUCRO_REAL"],
          periodicidades: ["MENSAL", "TRIMESTRAL", "ANUAL"],
          ajustesDiaUtil: ["ANTECIPAR", "POSTERGAR", "MANTER"],
          verificadores: [
            { chave: "APURACAO_TRANSMITIDA", rotulo: "Quando a apuração da competência for transmitida" },
            { chave: "MES_FECHADO", rotulo: "Quando o mês contábil da competência for fechado" },
          ],
        },
      };
    },
    async previewEscopoRegra({ escopo, filtros }) {
      await delay(50);
      const empresas = mockEmpresasDoEscopo(escopo, filtros);
      return { ok: true, total: empresas.length, empresas };
    },
    async createRegraObrigacao(dados) {
      await delay(120);
      const regraId = `mock-regra-${Math.random().toString(36).slice(2, 9)}`;
      const regra = { ...dados, regraId, excecoes: [], ativa: true };
      mockRegras.push(regra);
      const efeito = mockPropagarRegra(regra);
      return { ok: true, regra, ...efeito };
    },
    async updateRegraObrigacao(regraId, patch) {
      await delay(120);
      const i = mockRegras.findIndex((r) => r.regraId === regraId);
      if (i < 0) return { ok: false, error: "regra_nao_encontrada", message: "Regra não encontrada." };
      mockRegras[i] = { ...mockRegras[i], ...patch };
      const efeito = mockPropagarRegra(mockRegras[i]);
      return { ok: true, regra: mockRegras[i], ...efeito };
    },
    async deleteRegraObrigacao(regraId, modo) {
      await delay(90);
      const i = mockRegras.findIndex((r) => r.regraId === regraId);
      if (i < 0) return { ok: false, error: "regra_nao_encontrada" };
      const [regra] = mockRegras.splice(i, 1);
      const ligadas = mockObrigacoes.filter((o) => o.regraId === regraId);
      if (modo === "desvincular") {
        for (const o of ligadas) { o.regraId = null; o.sobrescritaLocal = false; }
        return { ok: true, nome: regra.nome, desvinculadas: ligadas.length, removidas: 0 };
      }
      for (const o of ligadas) {
        const idx = mockObrigacoes.indexOf(o);
        if (idx >= 0) mockObrigacoes.splice(idx, 1);
      }
      return { ok: true, nome: regra.nome, desvinculadas: 0, removidas: ligadas.length };
    },
    async addExcecaoRegra(regraId, companyId, motivo) {
      await delay(80);
      const regra = mockRegras.find((r) => r.regraId === regraId);
      if (!regra) return { ok: false, error: "regra_nao_encontrada" };
      if (!regra.excecoes.some((e) => e.companyId === companyId)) regra.excecoes.push({ companyId, motivo });
      return { ok: true, ...mockPropagarRegra(regra) };
    },
    async removeExcecaoRegra(regraId, companyId) {
      await delay(80);
      const regra = mockRegras.find((r) => r.regraId === regraId);
      if (!regra) return { ok: false, error: "regra_nao_encontrada" };
      regra.excecoes = regra.excecoes.filter((e) => e.companyId !== companyId);
      return { ok: true, ...mockPropagarRegra(regra) };
    },
    async listMarcosFiscais() { await delay(50); return { ok: true, marcos: [] }; },
    async createMarcoFiscal(input) { await delay(80); return { ok: true, marco: { id: `mk-${Date.now()}`, ...input } }; },
    async updateMarcoFiscal(marcoId, patch) { await delay(60); return { ok: true, marco: { id: marcoId, ...patch } }; },
    async deleteMarcoFiscal(marcoId) { await delay(50); return { ok: true, removido: { id: marcoId } }; },
    // ── Documentos e anotações (mock com estado em memória) ────────────────────────────────
    // Estado de verdade, não retorno fixo: as duas features têm REGRAS que só dá pra conferir
    // mexendo (fixação exclusiva, seleção múltipla), e um mock imutável passaria por elas.
    async listCompanyDocuments() {
      await delay(60);
      return { ok: true, documentos: mockDocumentos, tipos: MOCK_TIPOS_DOC, tipoLabels: MOCK_TIPO_DOC_LABELS };
    },
    async uploadCompanyDocument(_companyId, { arquivo, tipo, nome }) {
      await delay(120);
      const doc = {
        id: `mock-doc-${mockDocumentos.length + 1}`,
        tipo: tipo || "OUTRO",
        nome: nome || arquivo?.name || "documento.pdf",
        mimeType: arquivo?.type || "application/pdf",
        bytes: arquivo?.size || 1024,
        validade: null,
        createdAt: "2026-07-28T12:00:00.000Z",
      };
      mockDocumentos = [doc, ...mockDocumentos];
      return { ok: true, documento: doc };
    },
    async fetchCompanyDocumentBlob() {
      await delay(60);
      return new Blob(["mock"], { type: "application/pdf" });
    },
    async deleteCompanyDocument(_companyId, documentId) {
      await delay(60);
      mockDocumentos = mockDocumentos.filter((d) => d.id !== documentId);
      return { ok: true, removido: { id: documentId } };
    },
    async sendCompanyDocuments(_companyId, documentIds) {
      await delay(150);
      const docs = mockDocumentos.filter((d) => documentIds.includes(d.id));
      return {
        ok: true, enviados: docs.length, destinatario: "cliente@exemplo.com.br",
        documentos: docs.map((d) => ({ id: d.id, nome: d.nome, tipo: d.tipo })),
      };
    },
    async listCompanyNotes(_companyId, ordenarPor = "data") {
      await delay(60);
      const PESO = { ALTA: 0, MEDIA: 1, BAIXA: 2 };
      const porData = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
      const criterio = ordenarPor === "importancia"
        ? (a, b) => ((PESO[a.importancia] ?? 9) - (PESO[b.importancia] ?? 9)) || porData(a, b)
        : porData;
      // Espelha a regra do backend: fixada sempre no topo, em qualquer ordenação.
      const anotacoes = [...mockAnotacoes].sort((a, b) => {
        if (a.fixada !== b.fixada) return a.fixada ? -1 : 1;
        return criterio(a, b);
      });
      return { ok: true, anotacoes, importancias: ["ALTA", "MEDIA", "BAIXA"] };
    },
    async createCompanyNote(_companyId, { texto, importancia, fixada }) {
      await delay(80);
      if (fixada) mockAnotacoes = mockAnotacoes.map((n) => ({ ...n, fixada: false }));
      const nota = {
        id: `mock-nota-${mockAnotacoes.length + 1}`, texto,
        importancia: importancia || "MEDIA", fixada: Boolean(fixada),
        createdAt: new Date().toISOString(),
      };
      mockAnotacoes = [nota, ...mockAnotacoes];
      return { ok: true, anotacao: nota };
    },
    async updateCompanyNote(_companyId, noteId, patch) {
      await delay(80);
      // Fixação EXCLUSIVA, igual ao backend — é o que a tela precisa exercitar.
      if (patch.fixada === true) mockAnotacoes = mockAnotacoes.map((n) => ({ ...n, fixada: false }));
      mockAnotacoes = mockAnotacoes.map((n) => (n.id === noteId ? { ...n, ...patch } : n));
      return { ok: true, anotacao: mockAnotacoes.find((n) => n.id === noteId) };
    },
    async deleteCompanyNote(_companyId, noteId) {
      await delay(60);
      mockAnotacoes = mockAnotacoes.filter((n) => n.id !== noteId);
      return { ok: true, removida: { id: noteId } };
    },
    async listNotasDownloads() { await delay(60); return { ok: true, jobs: [] }; },
    async getNotasDownload(jobId) {
      await delay(60);
      return {
        ok: true,
        job: {
          id: jobId, status: "concluido", competenciaDe: "2026-01", competenciaAte: "2026-01",
          totalEmpresas: 1, processadas: 1, totalNotas: 0,
          arquivoNome: "notas-mock.zip", arquivoBytes: 0, erroMensagem: null,
        },
      };
    },
    async fetchNotasDownloadBlob() {
      await delay(60);
      return new Blob(["mock"], { type: "application/zip" });
    },
    // Q62: download em lote das SITFIS (mock)
    async createSitfisDownload() { await delay(80); return { ok: true, jobId: `mock-sitfis-dl-${Date.now()}` }; },
    async getSitfisDownload(jobId) {
      await delay(60);
      return { ok: true, job: { id: jobId, status: "concluido", totalEmpresas: 1, processadas: 1, comPdf: 1, arquivoNome: "situacao-fiscal-mock.zip", arquivoBytes: 0, erroMensagem: null } };
    },
    async fetchSitfisDownloadBlob() { await delay(60); return new Blob(["mock"], { type: "application/zip" }); },
    // C9: no mock não há job de verdade rodando — sempre zero (o selo simplesmente não aparece).
    async getJobsAtivos() { await delay(40); return { ok: true, total: 0, jobs: [] }; },
    // C8: grade anual de mentira, só pra conferir o layout (meses passados variam, futuros vazios).
    async getCompaniesAnnual(ano) {
      await delay(80);
      const y = Number(ano) || new Date().getUTCFullYear();
      return {
        ok: true,
        ano: y,
        empresas: mockCompanies.map((c, idx) => ({
          companyId: c.companyId,
          razao: c.razao,
          cnpj: c.cnpj,
          meses: Array.from({ length: 12 }, (_, i) => {
            const passado = i < 6;
            return {
              competencia: `${y}-${String(i + 1).padStart(2, "0")}`,
              mes: i + 1,
              fechado: passado && (i + idx) % 3 !== 0,
              fechadoEm: null,
              apurada: passado && (i + idx) % 2 === 0,
              estadoApuracao: passado && (i + idx) % 2 === 0 ? "transmitida" : null,
            };
          }),
        })),
      };
    },
    // Duas notas fixas — uma autorizada e uma CANCELADA — pra dar pra conferir sem backend que a
    // caixa "Canceladas" mostra/esconde de verdade. Sem a cancelada no mock, a tela ficava igual
    // nos dois estados e o toggle parecia funcionar mesmo quebrado.
    async listNotas(_companyId, filters = {}) {
      await delay(60);
      const todas = [
        { id: "mock-nota-1", type: "NFSE", papel: "EMIT", statusEfetivo: "autorizada", status: "EMITIDA",
          chaveAcesso: null, numero: "101", serie: null, competencia: "2026-06-01T00:00:00.000Z",
          issueDate: "2026-06-10T00:00:00.000Z", total: "1500.00", emitenteNome: "EMPRESA MOCK",
          emitenteDoc: "00000000000191", tomadorNome: "CLIENTE MOCK", tomadorDoc: null, competenciaPosFechamento: false },
        { id: "mock-nota-2", type: "NFSE", papel: "EMIT", statusEfetivo: "cancelada", status: "CANCELADA",
          chaveAcesso: null, numero: "102", serie: null, competencia: "2026-06-01T00:00:00.000Z",
          issueDate: "2026-06-12T00:00:00.000Z", total: "800.00", emitenteNome: "EMPRESA MOCK",
          emitenteDoc: "00000000000191", tomadorNome: "CLIENTE MOCK", tomadorDoc: null, competenciaPosFechamento: false },
      ];
      const notas = String(filters.incluirCanceladas || "") === "1"
        ? todas
        : todas.filter((n) => n.statusEfetivo !== "cancelada");
      return { ok: true, total: notas.length, limit: 100, offset: 0, notas };
    },
    async getNotasSummary(_companyId, filtros = {}) {
      await delay(60);
      // Números fixos só pra conferir o resumo da aba Notas Fiscais sem backend.
      return {
        ok: true,
        ano: filtros.ano || new Date().getUTCFullYear(),
        filtersApplied: { type: filtros.type || null, competencia: filtros.competencia || null },
        totals: { totalNotas: 14, totalEmitido: 48250.75, totalRecebido: 9310.4, countNfe: 5, countNfse: 9, countCanceladas: 2 },
        byMonth: [],
      };
    },
    async listApuracao({ competencia } = {}) { await delay(60); return { competencia, items: [] }; },
    async calcularApuracao() { await delay(120); return { ok: true, result: { rb12: 0, fs12: 0, fatorR: 0, receitaMes: 0, receitaPorAnexo: {}, divergencias: 0 } }; },
    async getApuracao() { await delay(60); return null; },
    async revisarApuracao() { await delay(60); return { ok: true }; },
    async transmitirApuracao() { await delay(200); return { ok: true, result: { estado: "transmitida", numeroDeclaracao: "MOCK-001", reciboNumero: "MOCK-REC-001", dasValor: 0 } }; },
    async conferirApuracao() { await delay(150); return { ok: true, result: { estado: "confirmada", conferiu: true, divergencias: 0, totalDeclaracoesNoSerpro: 1 } }; },
    async classificarNotas() { await delay(80); return { ok: true, result: { processed: 0, classified: 0, defaultUsed: 0, byAnexo: {} } }; },
    // Q14.2 — apuração v2
    async getCadastroFiscal() { await delay(40); return { ok: true, cadastro: null, cnaePrincipalRef: null }; },
    async saveCadastroFiscal() { await delay(60); return { ok: true, cadastro: null }; },
    async getPerfilFiscal() { await delay(40); return { ok: true, regime: null, usaFatorR: false, temCadastro: false, temFatorR: false, candidatos: [] }; },
    async savePerfilFiscal() { await delay(60); return { ok: true, candidatos: [] }; },
    async listProdutosServicos() { await delay(40); return { ok: true, items: [] }; },
    async createProdutoServico() { await delay(60); return { ok: true, produto: null }; },
    async updateProdutoServico() { await delay(60); return { ok: true, produto: null }; },
    async deleteProdutoServico() { await delay(40); return { ok: true }; },
    async listPendencias() { await delay(40); return { ok: true, items: [], counts: [] }; },
    async resolverPendencia() { await delay(60); return { ok: true, result: { regraCriada: null, produtoCriado: null, reclassificacao: null } }; },
    async classificarV2() { await delay(120); return { ok: true, result: { processed: 0, classified: 0, pendentes: 0, byTipo: {}, byFonte: {} } }; },
    async apurarV2() { await delay(150); return { ok: true, result: { ok: true, snapshot: null, dasCalculadoLocal: 0, rbt12: 0, receitaPorAnexo: {}, aliquotaEfetivaPorAnexo: {} } }; },
    async getApuracaoSnapshot() { await delay(40); return { ok: true, snapshot: null }; },
    async getSugestaoAnexo() { await delay(60); return { ok: true, competencia: null, totalNotas: 0, perfilConfigurado: false, anexosAtivos: [], resumo: { alta: 0, media: 0, revisao: 0, porAnexo: {} }, notas: [] }; },
    // Mock com atividade SUJEITA A FATOR R e folha derivada dos lançamentos — é a única forma de
    // conferir a comparação da folha sem backend. A folha digitada vem DIFERENTE da derivada de
    // propósito: o caso que precisa avisar é a divergência, não a coincidência.
    async getFechamento(_companyId, competencia) {
      await delay(60);
      const pas = [];
      const [y, m] = String(competencia || "2026-06").split("-").map(Number);
      for (let i = 12; i >= 1; i--) {
        const d = new Date(Date.UTC(y, m - 1 - i, 1));
        // `pa` como STRING "YYYY-MM": é o formato que o modal usa (`pasAnteriores`) e que ele
        // envia de volta ao salvar. Usar número aqui fazia o prefill não casar.
        pas.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
      }
      return {
        ok: true,
        dados: {
          faturamento: { interno: 120000, externo: 0, total: 120000 },
          atividades: [{ idAtividade: 11, descricao: "Serviços sujeitos ao Fator R", anexoImplicito: "III", mercado: "interno", sujeitoFatorR: true, valorInterno: 120000, valorExterno: 0 }],
          rbt12: 480000, disparidades: [], estado: "aberta", regimeApuracao: "COMPETENCIA",
          // Digitado: 5.000 em todos os meses. Derivado: 5.000, MENOS num mês (4.200) — divergência
          // de 800, que é a que a tela precisa apontar, inclusive na célula do mês.
          folhaMensal12: pas.map((pa) => ({ pa, valor: 5000 })),
          folhaDerivada: {
            disponivel: true,
            total: 59200,
            mesesComLancamento: 12,
            competencias: pas,
            porMes: pas.map((pa, i) => ({ competencia: pa, valor: i === 3 ? 4200 : 5000, lancamentos: 1 })),
            serie: pas.map((pa, i) => ({ pa: Number(pa.replace("-", "")), valor: i === 3 ? 4200 : 5000 })),
          },
        },
      };
    },
    async calcularFechamento() { await delay(150); return { ok: true, result: { dasValor: 0, rbt12: 0, mensagens: [] } }; },
    async salvarFechamento() { await delay(80); return { ok: true, result: { snapshot: { estado: "fechada" } } }; },
    async transmitirFechamento() { await delay(200); return { ok: true, result: { numeroDeclaracao: "MOCK-1", dasValor: 0 } }; },
    async reabrirFechamento() { await delay(80); return { ok: true, result: { snapshot: { estado: "calculada" } } }; },
    async retificarFechamento() { await delay(200); return { ok: true, result: { numeroDeclaracao: "MOCK-RET-1", dasValor: 0 } }; },
    async listAtividadesPgdasd() { await delay(40); return { ok: true, atividades: [] }; },
    async criarApuracaoBatch() { await delay(100); return { ok: true, jobId: "mock-job", totalEmpresas: 0 }; },
    async getApuracaoBatch() { await delay(60); return { ok: true, job: { status: "completed", okCount: 0, errorCount: 0, pendenteCount: 0, totalEmpresas: 0 }, items: [] }; },
    async runApuracaoBatch() { await delay(80); return { ok: true, job: { status: "completed", okCount: 0, errorCount: 0, pendenteCount: 0, totalEmpresas: 0 } }; },
    async getCompanyCert() { await delay(60); return { hasCertificate: false, uploadedAt: null, expiresAt: null }; },
    async uploadCompanyCert() { await delay(150); return { ok: true, certificate: { uploadedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 365*86400000).toISOString() } }; },
    async deleteCompanyCert() { await delay(60); return { ok: true }; },

    // ── Q6: stubs (mock não persiste; só retorna estrutura básica para não quebrar UI) ──
    async listAccountingFunctions() { await delay(80); return []; },
    async createAccountingFunction() { await delay(80); return { ok: true, data: null }; },
    async updateAccountingFunction() { await delay(80); return { ok: true, data: null }; },
    async deleteAccountingFunction() { await delay(80); return { ok: true }; },
    async applyAccountingFunction() { await delay(80); return { ok: true, entries: [] }; },

    // ── Q9: Parcelamentos stubs ─────────────────────────────────────────
    async listParcelamentos() { await delay(80); return []; },
    async getParcelamento() { await delay(80); return null; },
    async createParcelamento() { await delay(80); return { ok: true, data: null }; },
    async ingestParcelamento() { await delay(80); return { ok: true, data: { parcelamentoId: "mock", criouParcelamento: true } }; },
    async getContasProvisao() { await delay(40); return { ok: true, contas: { CONTRAPARTIDA: "", PARC: "" } }; },
    async consultarParcelamentoSerpro() { await delay(60); return { ok: true, parcelamento: { tipo: "PARCSN", numeroParcelamento: "0", valorTotal: null, quantidadeParcelas: null, situacao: "mock", origem: "SERPRO" } }; },
    async getParcelamentoConfig() { await delay(40); return { ok: true, parcelamento: { id: "mock", configProvisao: null, configPagamento: null } }; },
    async saveParcelamentoConfig() { await delay(40); return { ok: true, parcelamento: { id: "mock" } }; },
    async getConferenciaParcelas() { await delay(40); return { ok: true, items: [] }; },
    async aprovarConferenciaParcelas() { await delay(40); return { ok: true, aprovadas: 0 }; },
    async linkGuideToParcelamento() { await delay(80); return { ok: true }; },
    async payParcela() { await delay(80); return { ok: true, baixas: [] }; },
    async rescindirParcelamento() { await delay(80); return { ok: true }; },
    async vincularEntryParcelamento() { await delay(40); return { ok: true }; },

    // ── Q11.1: stubs Suspender/Reativar/Excluir ─────────────────────────
    async suspendCompany() { await delay(80); return { ok: true }; },
    async resumeCompany() { await delay(80); return { ok: true }; },
    async deleteCompany() { await delay(80); return { ok: true }; },
  };
}
