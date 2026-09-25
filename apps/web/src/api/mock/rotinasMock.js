const keys = ["das", "inss", "extrato", "presumido", "parcelamento", "pagamento", "conferencia"];
const labels = ["DAS", "INSS", "Extrato", "Presumido", "Parcelamento", "Pagamento", "Conferência ADN"];
let savedCompanies = null;
let agenda = Object.fromEntries(keys.map(key => [key, { enabled: true, day: key === "conferencia" ? 1 : 10,
  hour: key === "pagamento" ? 8 : 7, frequency: key === "pagamento" ? "DAILY" : "MONTHLY", timeZone: "America/Sao_Paulo" }]));

export function mockExecucoesRotinas() {
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now).filter(p => p.type !== "literal").map(p => [p.type, Number(p.value)]));
  return keys.map(routine => {
    const cfg = agenda[routine];
    const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
    let next = new Date(Date.UTC(parts.year, parts.month - 1, cfg.frequency === "DAILY" ? parts.day : Math.min(cfg.day, lastDay), cfg.hour + 3));
    if (next <= now) next = cfg.frequency === "DAILY" ? new Date(+next + 86400000)
      : new Date(Date.UTC(parts.year, parts.month, Math.min(cfg.day, new Date(Date.UTC(parts.year, parts.month + 1, 0)).getUTCDate()), cfg.hour + 3));
    const failed = routine === "parcelamento";
    return { routine, enabled: cfg.enabled, workerEnabled: true, integrationEnabled: true,
      alive: routine !== "conferencia", heartbeatAt: routine === "conferencia" ? null : now.toISOString(),
      nextAt: next.toISOString(), overdue: routine === "conferencia", retryExhausted: failed, maxAttempts: 1,
      lastRun: failed ? { status: "FAILED", attempts: 1, scheduledAt: new Date(+now - 3600000).toISOString(),
        finishedAt: new Date(+now - 1800000).toISOString(), result: { parcelaResults: [{ razao: "Empresa de demonstração", status: "erro", reason: "Procuração precisa ser conferida (simulação)." }] } }
        : routine === "pagamento" ? { status: "SUCCEEDED", qualidadeConsulta: "PARCIAL", attempts: 1, finishedAt: new Date(+now - 3600000).toISOString(), result: { total: 2, paid: 1, indeterminados: 1, results: [{ razao: "Empresa de demonstração", status: "Pagamento confirmado (simulação)" }, { razao: "Outra empresa de demonstração", status: "Consulta inconclusiva (simulação)" }] } } : null };
  });
}

export function mockCarregarRotinas(companies) {
  return { ok: true, rotinas: keys.map((key, i) => ({ key, label: labels[i] })), agenda: structuredClone(agenda),
    executions: mockExecucoesRotinas(), empresas: companies.map((c, i) => ({ companyId: c.companyId, razao: c.razao, cnpj: c.cnpj,
      status: "ATIVA", regime: i % 3 === 0 ? "LUCRO_PRESUMIDO" : "SIMPLES",
      rotinas: savedCompanies?.find(e => e.companyId === c.companyId)?.rotinas || { das: i % 3 !== 0, inss: true, extrato: i % 3 !== 0, presumido: i % 3 === 0, parcelamento: true, pagamento: true, conferencia: true } })) };
}

export function mockSalvarRotinas(input) {
  agenda = { ...agenda, ...structuredClone(input.agenda || {}) };
  if (Array.isArray(input.empresas)) savedCompanies = structuredClone(input.empresas);
  return { ok: true, atualizadas: savedCompanies?.length || 0, agenda: structuredClone(agenda) };
}
