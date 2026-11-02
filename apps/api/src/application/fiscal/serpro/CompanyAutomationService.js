import { createHash, randomUUID } from 'node:crypto';
import { lerPoliticaAutomacao, chavePoliticaAutomacao } from './CompanyAutomationPolicy.js';
import { lerAutomacaoCicloFiscal } from '../AutomacaoCicloFiscalService.js';
import { ROTINA_KEYS } from './SerproRuntimeSettings.js';
import { ROTINA_LABELS } from './CompanyRotinasService.js';
import { lerPoliticaSerpro, chavePoliticaSerpro, bloquearPoliticaEmpresa } from './CompanySerproPolicy.js';
import { aplicarRegimeRotinas, labelRotinaAplicavel } from './CompanyRoutineApplicability.js';

const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const projecaoSelecao = value => ({ enabled: value?.enabled === true, fontes: Array.isArray(value?.fontes) ? [...value.fontes].sort() : [] });
export function identidadeSelecaoCicloSimples(value) {
  if (value && Object.hasOwn(value, 'selectionToken')) {
    if (typeof value.selectionToken !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.selectionToken)) throw fail('AUTOMACAO_EMPRESA_SELECAO_INVALIDA', 'A identidade da seleção automática está inválida. Confira a configuração.');
    return `token:${value.selectionToken}`;
  }
  return `legacy:${createHash('sha256').update(JSON.stringify(projecaoSelecao(value))).digest('hex')}`;
}
export async function lerAutomacaoEmpresa(db, companyId) {
  const company = await db.portalClient.findUnique({ where: { id: companyId }, select: { id: true, companyId: true } });
  if (!company) throw fail('COMPANY_NOT_FOUND', 'Empresa não encontrada.', 404);
  const legacy = company.companyId ? await db.company.findUnique({ where: { id: company.companyId }, select: { regimeTributario: true, tipoTributario: true } }) : null;
  const applicability = aplicarRegimeRotinas(legacy);
  const rows = await db.companyRotina.findMany({ where: { portalClientId: companyId }, orderBy: { rotina: 'asc' } });
  const setting = await db.appSetting.findUnique({ where: { key: 'serpro_runtime_settings' } });
  // Somente agenda salva. Não retornar credenciais nem inferir habilitação de defaults.
  const agenda = Object.fromEntries(ROTINA_KEYS.map(key => {
    const r = setting?.value?.rotinas?.[key];
    const integer = (v, min, max) => (typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v)) && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
    const valid = r && integer(r.day, 1, 31) && integer(r.hour, 0, 23) && (r.frequency == null || r.frequency === 'MONTHLY' || key === 'pagamento' && r.frequency === 'DAILY');
    return [key, r ? { enabled: r.enabled === true && Boolean(valid), day: valid ? Number(r.day) : null, hour: valid ? Number(r.hour) : null, frequency: r.frequency ?? 'MONTHLY' } : null];
  }));
  const cicloRow = await db.appSetting.findUnique({ where: { key: `ciclo_simples_config:${companyId}` } });
  const cicloSaved = cicloRow?.value;
  const fontesValidas = Array.isArray(cicloSaved?.fontes) && cicloSaved.fontes.length > 0 && cicloSaved.fontes.every(f => ["NFE", "NFSE"].includes(f)) && new Set(cicloSaved.fontes).size === cicloSaved.fontes.length;
  const cicloSimples = { enabled: cicloSaved?.enabled === true, fontes: fontesValidas ? [...cicloSaved.fontes].sort() : [],
    applicableCurrentRegime: applicability.regime === 'SIMPLES', configurationValid: fontesValidas };
  const serproPolicy = await lerPoliticaSerpro(db, companyId);
  const automationPolicy = await lerPoliticaAutomacao(db, companyId);
  const globalAutomationPolicy = await lerAutomacaoCicloFiscal(db);
  const savedReminder = setting?.value?.rotinas?.avisos_guias_whatsapp;
  const integer = (v, min, max) => (typeof v === 'number' || typeof v === 'string' && /^\d+$/.test(v)) && Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max;
  const validReminder = savedReminder && integer(savedReminder.day, 1, 31) && integer(savedReminder.hour, 0, 23) && (savedReminder.frequency === undefined || savedReminder.frequency === 'DAILY');
  const lembretes = { enabled: rows.some(r => r.rotina === 'avisos_guias_whatsapp' && r.enabled === true),
    agenda: { enabled: savedReminder?.enabled === true && Boolean(validReminder), hour: validReminder ? Number(savedReminder.hour) : null, frequency: 'DAILY', timeZone: 'America/Sao_Paulo' } };
  const revision = createHash('sha256').update(JSON.stringify([companyId, rows.map(r => [r.rotina, r.enabled, r.updatedAt]), agenda, serproPolicy, applicability, lembretes, automationPolicy, globalAutomationPolicy, cicloSaved ?? null])).digest('hex');
  return { companyId, revision, serproPolicy, automationPolicy, globalAutomationPolicy,
    effectiveAutomationState: globalAutomationPolicy.paused ? 'GLOBAL_PAUSED' : automationPolicy.paused ? 'COMPANY_PAUSED' : 'SUBJECT_TO_SCHEDULE',
    lembretes, cicloSimples, ...applicability, rotinas: ROTINA_KEYS.map(key => ({ key, label: labelRotinaAplicavel(key, ROTINA_LABELS), applicable: applicability.applicableKeys.includes(key), enabled: rows.some(r => r.rotina === key && r.enabled), agenda: agenda[key] })) };
}

export async function salvarAutomacaoEmpresa(db, companyId, userId, input, { isAdmin = false } = {}) {
  const { expectedRevision, requestId, rotinas, serproPolicy, lembretes, automationPolicy, cicloSimples } = input || {};
  const validCiclo = cicloSimples === undefined || cicloSimples && !Array.isArray(cicloSimples) && typeof cicloSimples === "object" && typeof cicloSimples.enabled === "boolean"
    && Object.keys(cicloSimples).every(k => ["enabled", "fontes"].includes(k)) && Array.isArray(cicloSimples.fontes)
    && cicloSimples.fontes.every(f => ["NFE", "NFSE"].includes(f)) && new Set(cicloSimples.fontes).size === cicloSimples.fontes.length
    && (!cicloSimples.enabled || cicloSimples.fontes.length > 0);
  const validReminders = lembretes === undefined || lembretes && !Array.isArray(lembretes) && typeof lembretes === 'object'
    && typeof lembretes.enabled === 'boolean' && Object.keys(lembretes).every(k => k === 'enabled');
  const validRoutines = rotinas === undefined || rotinas && !Array.isArray(rotinas) && typeof rotinas === 'object'
    && Object.keys(rotinas).length > 0 && Object.entries(rotinas).every(([k, v]) => ROTINA_KEYS.includes(k) && typeof v === 'boolean');
  const validPolicy = serproPolicy === undefined || serproPolicy && !Array.isArray(serproPolicy) && typeof serproPolicy === 'object'
    && typeof serproPolicy.paused === 'boolean' && typeof serproPolicy.reason === 'string'
    && serproPolicy.reason.trim().length > 0 && serproPolicy.reason.trim().length <= 300
    && Object.keys(serproPolicy).every(k => ['paused', 'reason'].includes(k));
  const validAutomationPolicy = automationPolicy === undefined || automationPolicy && !Array.isArray(automationPolicy) && typeof automationPolicy === 'object'
    && typeof automationPolicy.paused === 'boolean' && typeof automationPolicy.reason === 'string'
    && automationPolicy.reason.trim().length > 0 && automationPolicy.reason.trim().length <= 300
    && Object.keys(automationPolicy).every(k => ['paused', 'reason'].includes(k));
  if (!/^[a-f0-9]{64}$/.test(expectedRevision || '') || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId || '')
    || !validCiclo || !validRoutines || !validPolicy || !validReminders || !validAutomationPolicy || rotinas === undefined && serproPolicy === undefined && lembretes === undefined && automationPolicy === undefined && cicloSimples === undefined) {
    throw fail('INVALID_AUTOMATION', 'Revise as rotinas selecionadas e atualize a configuração antes de salvar.', 422);
  }
  const key = `company_automation_request:${userId}:${requestId}`;
  const policyInput = serproPolicy === undefined ? null : { paused: serproPolicy.paused, reason: serproPolicy.reason.trim() };
  const automationInput = automationPolicy === undefined ? null : { paused: automationPolicy.paused, reason: automationPolicy.reason.trim() };
  const cicloInput = cicloSimples === undefined ? null : { enabled: cicloSimples.enabled, fontes: [...cicloSimples.fontes].sort() };
  const hash = createHash('sha256').update(JSON.stringify([companyId, expectedRevision, Object.entries(rotinas || {}).sort(), policyInput, lembretes ?? null, automationInput, cicloInput])).digest('hex');
  return db.$transaction(async tx => {
    await bloquearPoliticaEmpresa(tx, companyId);
    if (!isAdmin) {
      const access = await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: String(userId) } } });
      if (access?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(access.role)) throw fail('ACCESS_CHANGED', 'Seu acesso não permite alterar as consultas desta empresa.', 403);
    }
    const saved = await tx.appSetting.findUnique({ where: { key } });
    if (saved) {
      if (saved.value.hash !== hash) throw fail('IDEMPOTENCY_CONFLICT', 'Esta solicitação pertence a outra alteração. Recarregue a configuração.');
      const current = await lerAutomacaoEmpresa(tx, companyId);
      if (current.revision !== saved.value.result?.revision) throw fail('AUTOMATION_CHANGED', 'A configuração mudou após este salvamento. Recarregue para conferir o estado atual.');
      return saved.value.result;
    }
    const before = await lerAutomacaoEmpresa(tx, companyId);
    if (before.revision !== expectedRevision) throw fail('AUTOMATION_CHANGED', 'A configuração mudou em outra sessão. Recarregue antes de salvar.');
    if (Object.entries(rotinas || {}).some(([key, enabled]) => enabled && !before.applicableKeys.includes(key))) {
      throw fail('ROUTINE_NOT_APPLICABLE', before.unavailableReason || 'Esta rotina não se aplica ao regime cadastrado da empresa. Recarregue a configuração.', 422);
    }
    if (cicloInput && before.regime !== 'SIMPLES') {
      const mesmasFontes = JSON.stringify(cicloInput.fontes) === JSON.stringify(before.cicloSimples.fontes);
      if (cicloInput.enabled && (!before.cicloSimples.enabled || !mesmasFontes)
        || !cicloInput.enabled && cicloInput.fontes.some(f => !before.cicloSimples.fontes.includes(f))) {
        throw fail('ROUTINE_NOT_APPLICABLE', 'O regime atual não permite nova ativação ou alteração de fontes do Simples. A seleção anterior pode ser desativada; a execução histórica depende da competência.', 422);
      }
    }
    if (cicloInput) {
      const configKey = `ciclo_simples_config:${companyId}`;
      const previous = (await tx.appSetting.findUnique({ where: { key: configKey } }))?.value;
      if (JSON.stringify(projecaoSelecao(previous)) !== JSON.stringify(cicloInput)) {
        const value = { ...cicloInput, selectionToken: randomUUID() };
        await tx.appSetting.upsert({ where: { key: configKey }, create: { key: configKey, value }, update: { value } });
      }
    }
    for (const [rotina, enabled] of Object.entries(rotinas || {})) {
      await tx.companyRotina.upsert({ where: { portalClientId_rotina: { portalClientId: companyId, rotina } }, create: { portalClientId: companyId, rotina, enabled }, update: { enabled } });
    }
    if (lembretes !== undefined) {
      const rotina = 'avisos_guias_whatsapp', enabled = lembretes.enabled;
      await tx.companyRotina.upsert({ where: { portalClientId_rotina: { portalClientId: companyId, rotina } }, create: { portalClientId: companyId, rotina, enabled }, update: { enabled } });
    }
    if (policyInput) {
      const value = { ...policyInput, updatedAt: new Date().toISOString(), updatedBy: String(userId) };
      await tx.appSetting.upsert({ where: { key: chavePoliticaSerpro(companyId) }, create: { key: chavePoliticaSerpro(companyId), value }, update: { value } });
    }
    if (automationInput) {
      const updatedAt = new Date().toISOString();
      const value = { ...automationInput, version: before.automationPolicy.version + 1, updatedAt, updatedBy: String(userId),
        resumedAt: !automationInput.paused && before.automationPolicy.paused ? updatedAt : before.automationPolicy.resumedAt };
      const policyKey = chavePoliticaAutomacao(companyId);
      await tx.appSetting.upsert({ where: { key: policyKey }, create: { key: policyKey, value }, update: { value } });
    }
    const result = { ...await lerAutomacaoEmpresa(tx, companyId), savedAt: new Date().toISOString() };
    await tx.appSetting.create({ data: { key, value: { hash, companyId, userId, before: before.rotinas.map(r => ({ key: r.key, enabled: r.enabled })), beforeLembretes: before.lembretes, beforeCicloSimples: before.cicloSimples, beforeSerproPolicy: before.serproPolicy, beforeAutomationPolicy: before.automationPolicy, result, eventId: randomUUID() } } });
    return result;
  }, { isolationLevel: 'Serializable' });
}
