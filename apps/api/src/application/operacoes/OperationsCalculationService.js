import { createHash } from 'node:crypto';
import { regimeComprovado, avaliarAuditoriaNfse } from './OperationsEligibility.js';
import { auditarCompetencia } from '../notas/auditoria/AuditoriaNotasService.js';
import { contextoOrigemCalculo } from '../notas/apuracao/v2/RecuperacaoCalculo.js';
import { lerAutomacaoCicloFiscal } from '../fiscal/AutomacaoCicloFiscalService.js';
import { lerPoliticaAutomacao } from '../fiscal/serpro/CompanyAutomationPolicy.js';
import { comContextoSerpro } from '../fiscal/serpro/serproCallContext.js';

const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const fail = (message, status = 409) => Object.assign(new Error(message), { status, beforeDispatch: true });
const keyFor = (id, pa) => `operations_calculation:${id}:${pa}`;
const read = async (db, key) => (await db.appSetting.findUnique({ where: { key } }))?.value || null;
const put = (db, key, value) => db.appSetting.upsert({ where: { key }, create: { key, value: copy(value) }, update: { value: copy(value) } });
const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
function identity(id, pa) { if (typeof id !== 'string' || !id.trim() || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(pa || '')) throw fail('Empresa e competência inválidas.', 422); }
export async function actor(db, userId, companyId) {
  const user = await db.user.findUnique({ where: { id: String(userId) } });
  if (user?.status !== 'active' || !(user.role === 'admin' || user.accountType === 'FIRM')) throw fail('Acesso interno ativo não confirmado.', 403);
  if (user.role !== 'admin') {
    const access = await db.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: String(userId) } } });
    if (access?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(access.role)) throw fail('Seu acesso à empresa mudou.', 403);
  }
}
const defaults = {
  audit: auditarCompetencia, context: contextoOrigemCalculo,
  prepareRbt: async args => (await import('../notas/apuracao/v2/RbtExtratoService.js')).getRbt12(args),
  collect: async args => (await import('../notas/adn/AdnNotasService.js')).syncAdnNotasForCompany(args),
  getDados: async args => (await import('../notas/apuracao/v2/FechamentoService.js')).getDadosFechamento(args),
  calculate: async args => (await import('../notas/apuracao/v2/FechamentoService.js')).calcularFechamento(args),
};
async function inputs(db, companyId, competencia, deps) {
  const portal = await db.portalClient.findUnique({ where: { id: companyId } });
  if (!portal) throw fail('Empresa não encontrada.', 404);
  const [history, company, cadastro, config, snapshot, audit, global, policy, attempt] = await Promise.all([
    portal.companyId ? db.regimeHistorico.findMany({ where: { companyId: portal.companyId }, orderBy: { vigenciaInicio: 'asc' } }) : [],
    portal.companyId ? db.company.findUnique({ where: { id: portal.companyId } }) : null,
    db.cadastroFiscal.findUnique({ where: { portalClientId: companyId } }),
    read(db, `ciclo_simples_config:${companyId}`),
    db.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } }),
    deps.audit({ portalClientId: companyId, competencia }, { db }), lerAutomacaoCicloFiscal(db), lerPoliticaAutomacao(db, companyId), read(db, keyFor(companyId, competencia)),
  ]);
  const [year, month] = competencia.split('-').map(Number);
  const outside = await db.portalInvoice.count({ where: { clientId: companyId, papel: 'EMIT', statusEfetivo: 'autorizada', NOT: { type: 'NFSE' }, competencia: { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) } } });
  const regime = regimeComprovado(history, competencia, cadastro, company);
  const auditSummary = avaliarAuditoriaNfse(audit, companyId, competencia);
  const blockers = [];
  if (portal.status !== 'ATIVA') blockers.push('Empresa não está ativa.');
  if (regime !== 'SIMPLES') blockers.push(regime === 'PRESUMIDO' ? 'Apuração externa do Lucro Presumido.' : 'Simples não comprovado para toda a competência.');
  if (cadastro?.regime !== 'SIMPLES_NACIONAL' || cadastro?.regimeApuracao !== 'COMPETENCIA') blockers.push('Confira o cadastro fiscal e o regime de competência.');
  if (!Array.isArray(config?.fontes) || !config.fontes.length) blockers.push('Confira as fontes de receita da empresa antes do cálculo em lote.');
  if (outside || config?.fontes?.some(f => f !== 'NFSE')) blockers.push('Há receita ou fonte fora de NFS-e. Confira a base completa na Apuração.');
  if (snapshot && !['aberta', 'calculada'].includes(snapshot.estado)) blockers.push('Apuração fechada, transmitida ou incerta. Confira a tentativa antes de calcular.');
  if (attempt && ['COLLECTING', 'CALCULATING', 'UNCERTAIN'].includes(attempt.status)) blockers.push('Tentativa em andamento ou incerta. Acompanhe o resultado antes de repetir.');
  const status = global.paused || policy.paused ? 'PAUSED' : config?.enabled === true ? 'CONFIGURED' : 'DISABLED';
  return { portal, history, company, cadastro, config, snapshot, audit, auditSummary, regime, blockers, attempt,
    routine: { status, label: { PAUSED: 'Rotina pausada', CONFIGURED: 'Rotina selecionada', DISABLED: 'Rotina desligada' }[status] },
    inputHash: hash([portal.id, portal.cnpj, portal.status, history, cadastro, config, outside, company?.codigosServicoNacional]) };
}
const resultView = value => value ? { companyId: value.companyId, competencia: value.competencia, attemptId: value.attemptId, requestId: value.attemptId, status: value.status, startedAt: value.startedAt, updatedAt: value.updatedAt || null, audit: value.audit || null, warnings: value.warnings || [], calculation: value.calculation || null, reason: value.reason || null, errorCode: value.errorCode || null } : null;
export async function lerResultadoCalculoOperacoes(db, companyId, competencia, requestId) { identity(companyId, competencia); if (requestId && !/^[\w-]{8,100}$/.test(requestId)) throw fail("Pedido inválido.", 422); return { companyId, competencia, attempt: resultView(await read(db, keyFor(companyId, competencia) + (requestId ? `:request:${requestId}` : ""))) }; }
async function previewInTransaction(tx, companyId, competencia, d) {
    const i = await inputs(tx, companyId, competencia, d), context = await d.context({ portalClientId: companyId, competencia }, tx);
    const revision = hash([i.inputHash, context, i.snapshot, i.audit, i.attempt]);
    return { companyId, competencia, revision, scope: 'NFSE', canCalculate: !i.blockers.length, regime: i.regime, routine: i.routine,
      audit: i.auditSummary, blockers: i.blockers, warnings: i.auditSummary.warnings || [],
      calculation: i.snapshot ? { receitaInterna: i.snapshot.receitaInterna, receitaExterna: i.snapshot.receitaExterna, imposto: i.snapshot.dasSimuladoSerpro, calculoId: i.snapshot.idempotencyKey, origem: 'Simulação salva' } : null,
      lastAttempt: resultView(i.attempt), external: i.regime === 'PRESUMIDO' };
}
export async function prepararCalculoOperacoes(db, companyId, competencia, dependencies = {}) {
 identity(companyId, competencia); const d = { ...defaults, ...dependencies };
 return db.$transaction(tx => previewInTransaction(tx, companyId, competencia, d), { isolationLevel: 'RepeatableRead', timeout: 20000 });
}
function form(dados, cadastro) {
  const atividades = dados.atividades;
  if (!Array.isArray(atividades) || !atividades.length || dados.prefillValor?.indefinido || dados.disparidades?.length || dados.semClassificacao > 0 || atividades._semMapeamento?.length || atividades.some(a => !a.idAtividade || !finite(a.valorInterno) || !finite(a.valorExterno))) throw fail('Confira atividades, classificação e distribuição das receitas na Apuração.');
  const total = atividades.reduce((n, a) => n + Number(a.valorInterno) + Number(a.valorExterno), 0);
  if (!(total > 0) || !finite(dados.faturamento?.total) || Math.abs(total - Number(dados.faturamento.total)) > 0.005) throw fail('Receita incompleta ou sem movimento. Confira explicitamente a base na Apuração.');
  if (dados.rbt12Origem !== 'EXTRATO_PGDAS' || !finite(dados.rbt12)) throw fail('Confira a base completa de receitas anteriores (RBT12).');
  const fatorR = cadastro.usaFatorR || atividades.some(a => a.sujeitoFatorR !== false);
  // A memória de outra competência não comprova folha atual. O formulário individual
  // permite sua conferência explícita, inclusive zero, sem criar uma dispensa fiscal.
  if (fatorR) throw fail('Preencher/conferir folha do Fator R na Apuração antes de calcular pelo formulário individual.');
  return { atividades, folhaMensal12: [], regimeApuracao: 'COMPETENCIA', semMovimento: false };
}
export async function executarCalculoOperacoes(db, { companyId, competencia, userId, expectedRevision, requestId, confirmCompetencia }, dependencies = {}) {
  identity(companyId, competencia); const d = { ...defaults, ...dependencies };
  if (!/^[a-f0-9]{64}$/.test(expectedRevision || '') || !/^[\w-]{8,100}$/.test(requestId || '') || confirmCompetencia !== competencia) throw fail('Confirme a seleção atual e a competência.', 422);
  const key = keyFor(companyId, competencia), requestKey = `${key}:request:${requestId}`;
  const requestHash = hash([userId, expectedRevision, competencia]);
  await actor(db, userId, companyId);
  const claim = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
    await actor(tx, userId, companyId);
    const previous = await read(tx, requestKey);
    if (previous) { if (previous.requestHash !== requestHash) throw fail('Pedido reutilizado com outros dados.'); return { existing: true, value: previous }; }
    const preview = await previewInTransaction(tx, companyId, competencia, d);
    if (preview.revision !== expectedRevision || !preview.canCalculate) throw fail(preview.blockers.join(' ') || 'A prévia mudou. Atualize antes de calcular.');
    const before = await read(tx, key);
    if (before && ['COLLECTING', 'CALCULATING', 'UNCERTAIN'].includes(before.status)) throw fail('Há uma tentativa a conferir; nenhuma nova execução foi iniciada.');
    const value = { companyId, competencia, attemptId: requestId, userId: String(userId), requestHash, status: 'COLLECTING', inputHash: (await inputs(tx, companyId, competencia, d)).inputHash, previousCalculationId: (await tx.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } }))?.idempotencyKey || null, startedAt: new Date().toISOString(), audit: null, warnings: [], calculation: null };
    await put(tx, requestKey, value); await put(tx, key, value); return { existing: false, value };
  });
  if (claim.existing) return resultView(claim.value);
  let state = claim.value, dispatched = false;
  const finish = async patch => db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
    const current = await read(tx, key);
    if (current?.attemptId !== requestId) throw fail('A tentativa atual mudou.');
    state = { ...current, ...patch, updatedAt: new Date().toISOString() };
    await put(tx, requestKey, state); await put(tx, key, state); return resultView(state);
  });
  try {
    const before = await db.$transaction(tx => inputs(tx, companyId, competencia, d), { isolationLevel: 'RepeatableRead' });
    if (before.inputHash !== state.inputHash || before.blockers.filter(b => !b.startsWith('Tentativa em andamento')).length) throw fail('A base mudou antes da coleta. Atualize a prévia.');
    await actor(db, userId, companyId);
    const collected = await d.collect({ portalClientId: companyId, somenteColeta: true });
    if (collected?.ok !== true || collected.complete !== true || collected.partial === true || String(collected.cnpj).replace(/\D/g, '') !== String(before.portal.cnpj).replace(/\D/g, '')) throw fail('Coleta NFS-e parcial ou identidade não comprovada. Confira antes de calcular.');
    await finish({ collection: { complete: true, totalDocs: collected.totalDocs ?? null, checkedAt: new Date().toISOString() } });
    // Materializa somente a base local antes de fixar o contexto. O cálculo individual
    // também a atualiza; sua primeira gravação não pode parecer alteração concorrente.
    // EXTRATO_PGDAS completo continua obrigatório no preparo consistente abaixo.
    await d.prepareRbt({ portalClientId: companyId, competencia });
    const prepare = async tx => {
      const current = await inputs(tx, companyId, competencia, d);
      if (current.inputHash !== before.inputHash) throw fail('Cadastro, regime ou fontes mudaram durante o preparo.');
      if (current.auditSummary.reason) throw fail(current.auditSummary.reason);
      const context = await d.context({ portalClientId: companyId, competencia }, tx);
      const dados = await d.getDados({ portalClientId: companyId, competencia, db: tx, preparacaoAutomatica: true });
      const formulario = form(dados, current.cadastro);
      return { current, context, dados, formulario, hash: hash([current.inputHash, context, current.audit, formulario]) };
    };
    const prepared = await db.$transaction(prepare, { isolationLevel: 'RepeatableRead', timeout: 20000 });
    const oldAnexos = before.snapshot?.atividadesEscolhidas?.map(a => a.anexoImplicito).filter(Boolean).sort();
    const newAnexos = prepared.formulario.atividades.map(a => a.anexoImplicito).filter(Boolean).sort();
    const warnings = [...(prepared.current.auditSummary.warnings || [])];
    if (oldAnexos?.length && hash(oldAnexos) !== hash(newAnexos)) warnings.push(`Anexo ${oldAnexos.join('/')} → ${newAnexos.join('/')}`);
    await finish({ status: 'CALCULATING', audit: prepared.current.auditSummary, warnings });
    const verify = async () => {
      await actor(db, userId, companyId);
      const latest = await read(db, key);
      if (latest?.attemptId !== requestId || latest.status !== 'CALCULATING') throw fail('Tentativa substituída.');
      const fresh = await db.$transaction(prepare, { isolationLevel: 'RepeatableRead', timeout: 20000 });
      if (fresh.hash !== prepared.hash) throw fail('Notas, auditoria ou parâmetros mudaram. Confira uma nova revisão.');
    };
    const result = await comContextoSerpro({ origem: 'operacoes:calculo-nfse', userId, forcar: false }, () => d.calculate({ portalClientId: companyId, competencia, ...prepared.formulario,
      manualOperation: { beforeDispatch: async () => { await verify(); dispatched = true; }, verify, attemptId: requestId } }));
    await verify();
    if (result?.ok !== true || !result.calculoId || !finite(result.dasValor)) throw Error('Cálculo sem resultado comprovado. Confira a tentativa antes de repetir.');
    return await finish({ status: 'CALCULATED', proof: { context: prepared.context, auditHash: hash(prepared.current.audit), inputHash: prepared.current.inputHash }, calculation: {
      calculoId: result.calculoId, imposto: result.dasValor, receita: prepared.formulario.atividades.reduce((n, a) => n + Number(a.valorInterno) + Number(a.valorExterno), 0), origem: 'Simulação SERPRO',
    } });
  } catch (error) { return finish({ status: dispatched ? 'UNCERTAIN' : 'REVIEW', reason: error.message || 'Falha no cálculo. Confira a tentativa.', errorCode: error.code || null }); }
}
export async function conferirRegimeSimplesOperacoes(db, companyId, competencia) {
  identity(companyId, competencia);
  const portal = await db.portalClient.findUnique({ where: { id: companyId }, select: { id: true, companyId: true } });
  if (!portal) throw fail('Empresa não encontrada.', 404);
  const [history, cadastro, company] = await Promise.all([
    portal.companyId ? db.regimeHistorico.findMany({ where: { companyId: portal.companyId } }) : [],
    db.cadastroFiscal.findUnique({ where: { portalClientId: companyId } }),
    portal.companyId ? db.company.findUnique({ where: { id: portal.companyId } }) : null,
  ]);
  if (regimeComprovado(history, competencia, cadastro, company) !== 'SIMPLES') throw fail('Simples não comprovado para toda a competência. Confira o regime antes de confirmar, liberar ou transmitir.');
}
export async function conferirCalculoManualOperacoes(db, companyId, competencia, dependencies = {}) {
  await conferirRegimeSimplesOperacoes(db, companyId, competencia);
  const d = { ...defaults, ...dependencies }, attempt = await read(db, keyFor(companyId, competencia));
  if (!attempt) return;
  if (['COLLECTING', 'CALCULATING', 'UNCERTAIN'].includes(attempt.status)) throw fail('O cálculo manual está em andamento ou incerto. Confira a tentativa.');
  const snapshot = await db.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
  // Um cálculo posterior conferido no formulário individual substitui o atalho,
  // sem transformar a tentativa anterior em prova desse novo cálculo.
  if (attempt.status === 'REVIEW' && snapshot?.idempotencyKey && snapshot.idempotencyKey !== attempt.previousCalculationId && ['calculada', 'fechada'].includes(snapshot.estado)) return;
  if (attempt.status !== 'CALCULATED') throw fail(attempt.reason || 'Revise o preparo manual antes de confirmar.');
  if (snapshot?.idempotencyKey !== attempt.calculation?.calculoId) return;
  const current = await inputs(db, companyId, competencia, d);
  if (current.regime !== 'SIMPLES' || current.inputHash !== attempt.proof?.inputHash) throw fail('Regime, cadastro ou fontes mudaram desde o cálculo. Confira novamente.');
  if (current.auditSummary.reason || hash(current.audit) !== attempt.proof?.auditHash) throw fail('A auditoria mudou desde o cálculo. Confira novamente as notas.');
}
