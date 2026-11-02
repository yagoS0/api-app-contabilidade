const keys = ["das", "inss", "extrato", "presumido", "parcelamento", "pagamento", "conferencia", "avisos_guias_whatsapp"];
const labels = ["DAS", "INSS", "Extrato", "Presumido", "Parcelamento", "Pagamento", "Conferência ADN", "Lembretes de guias no WhatsApp"];
let savedCompanies = null;
let pausa = { paused: false, version: 0, legacy: true, reason: null, actor: null, changedAt: null, resumedAt: null };
export function mockLerPausaCicloFiscal() { return { ok: true, policy: structuredClone(pausa) }; }
export function mockSalvarPausaCicloFiscal(input) {
  if (input.version !== pausa.version) throw new Error('A configuração mudou. Atualize antes de confirmar.');
  if (typeof input.paused !== 'boolean' || !input.reason?.trim() || input.reason.trim().length > 1000) throw new Error('Informe motivo válido.');
  if (input.paused !== pausa.paused) {
    const changedAt = new Date().toISOString();
    pausa = { paused: input.paused, version: pausa.version + 1, reason: input.reason.trim(), actor: { id: 'demo', name: 'Demonstração' }, changedAt, resumedAt: input.paused ? pausa.resumedAt : changedAt, legacy: false };
  }
  return mockLerPausaCicloFiscal();
}
let agenda = Object.fromEntries(keys.map(key => [key, { enabled: key !== "avisos_guias_whatsapp", day: key === "conferencia" ? 1 : 10,
  hour: ["pagamento", "avisos_guias_whatsapp"].includes(key) ? 8 : 7, frequency: key === "avisos_guias_whatsapp" ? "DAILY" : "MONTHLY", timeZone: "America/Sao_Paulo" }]));

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
        : routine === "pagamento" ? { status: "SUCCEEDED", attempts: 1, finishedAt: new Date(+now - 3600000).toISOString(), result: { results: [{ razao: "Empresa de demonstração", status: "Pagamento conferido (simulação)" }] } } : null };
  });
}

export function mockCarregarRotinas(companies) {
  return { ok: true, rotinas: keys.map((key, i) => ({ key, label: labels[i] })), agenda: structuredClone(agenda),
    executions: mockExecucoesRotinas(), empresas: companies.map(c => {
      const regime = c.regimeTributario || c.tipoTributario || c.legacyCompany?.regimeTributario || null;
      return { companyId: c.companyId, razao: c.razao, cnpj: c.cnpj,
      status: "ATIVA", regime,
      rotinas: savedCompanies?.find(e => e.companyId === c.companyId)?.rotinas || { das: regime === 'SIMPLES', inss: true, extrato: regime === 'SIMPLES', presumido: regime === 'LUCRO_PRESUMIDO', parcelamento: regime === 'SIMPLES', pagamento: true, conferencia: true } }; }) };
}

export function mockSalvarRotinas(input) {
  agenda = { ...agenda, ...structuredClone(input.agenda || {}) };
  if (Array.isArray(input.empresas)) savedCompanies = structuredClone(input.empresas);
  return { ok: true, atualizadas: savedCompanies?.length || 0, agenda: structuredClone(agenda) };
}
