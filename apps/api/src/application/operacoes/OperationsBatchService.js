import { createHash, randomUUID } from 'node:crypto';
import { lerOperacao, salvarOperacao, validarCompetencia } from './OperationsService.js';
import { conferirExecucao, executarOperacao, conferirEvolucaoDocumental } from './OperationsExecution.js';
import { createManualTaskService } from '../tasks/ManualTaskService.js';
import { conferirAutomacaoCicloFiscal } from '../fiscal/AutomacaoCicloFiscalService.js';
import { conferirPoliticaAutomacao } from '../fiscal/serpro/CompanyAutomationPolicy.js';
import { identidadeSelecaoCicloSimples } from '../fiscal/serpro/CompanyAutomationService.js';
import { aplicarRegimeRotinas } from '../fiscal/serpro/CompanyRoutineApplicability.js';
import { comAutomacaoCicloFiscal, comAutomacaoEmpresa } from '../fiscal/automacaoCicloFiscalContext.js';
import { contextoOrigemCalculo } from '../notas/apuracao/v2/RecuperacaoCalculo.js';
import { prepararSimplesConsistente } from '../notas/apuracao/v2/PreparacaoAutomaticaSimples.js';

const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' && !(value instanceof Date)
  ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value ?? null))).digest('hex');
const fail = (message, status = 409) => Object.assign(new Error(message), { status });
const key = id => `operations_batch:${id}`;
const opKey = (id, pa) => `operations:v1:${id}:${pa}`;
const attemptKey = (id, pa, release) => `operations_execution:${id}:${pa}:${release}`;
const read = async (db, k) => (await db.appSetting.findUnique({ where: { key: k } }))?.value;
const put = (db, k, value) => db.appSetting.upsert({ where: { key: k }, create: { key: k, value: copy(value) }, update: { value: copy(value) } });
const lock = (db, k) => db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))::text`;
const civil = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10);
const PREVIEW_MS = 15 * 60_000;

export async function conferirAtorOperacoes(db, userId, companyId) {
  const user = await db.user.findUnique({ where: { id: String(userId) } });
  if (user?.status !== 'active' || !(user.role === 'admin' || user.accountType === 'FIRM')) throw fail('Acesso interno ativo não confirmado.', 403);
  if (companyId && user.role !== 'admin') {
    const access = await db.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId, userId: String(userId) } } });
    if (access?.status !== 'ACTIVE' || !['ACCOUNTANT', 'FIRM_ADMIN'].includes(access.role)) throw fail('Seu acesso atual não permite transmitir esta empresa.', 403);
  }
  return user;
}

// Somente leituras locais. A seleção do ciclo é distinta de uma seleção de linhas.
async function selection(db, companyId, competencia) {
  const portal = await db.portalClient.findUnique({ where: { id: companyId } });
  const config = await read(db, `ciclo_simples_config:${companyId}`);
  const cadastro = await db.cadastroFiscal.findUnique({ where: { portalClientId: companyId } });
  if (!portal || portal.status !== 'ATIVA' || config?.enabled !== true || !Array.isArray(config.fontes) || !config.fontes.length
    || config.fontes.some(f => !['NFE', 'NFSE'].includes(f))) throw fail('Ciclo automático não habilitado ou cadastro incompleto. Confira a configuração da empresa.');
  if (cadastro?.regime !== 'SIMPLES_NACIONAL') throw fail('Regime do Simples não confirmado.');
  const history = portal.companyId ? await db.regimeHistorico.findMany({ where: { companyId: portal.companyId } }) : [];
  const start = `${competencia}-01`, [year, month] = competencia.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const relevant = history.filter(h => civil(h.vigenciaInicio) <= end && (!h.vigenciaFim || civil(h.vigenciaFim) >= start));
  if (history.length) {
    if (relevant.length !== 1 || relevant[0].regime !== 'SIMPLES' || civil(relevant[0].vigenciaInicio) > start || relevant[0].vigenciaFim && civil(relevant[0].vigenciaFim) < end) throw fail('Histórico não confirma Simples em toda a competência.');
  } else {
    const company = portal.companyId ? await db.company.findUnique({ where: { id: portal.companyId } }) : null;
    if (aplicarRegimeRotinas(company).regime !== 'SIMPLES' || !cadastro.dataOpcaoSN || civil(cadastro.dataOpcaoSN) > start) throw fail('Vigência do Simples não confirmada para a competência.');
  }
  return hash([identidadeSelecaoCicloSimples(config), config, relevant, cadastro.regime, cadastro.dataOpcaoSN, portal.cnpj, portal.status]);
}

export function createOperationsBatchService({ db, tasks = createManualTaskService({ db }), now = () => new Date(),
  operation = lerOperacao, saveOperation = salvarOperacao, execute = executarOperacao,
  credentials = async () => (await import('../fiscal/serpro/SerproRuntimeSettings.js')).getResolvedSerproCredentials(), executionDeps = {} } = {}) {
  if (!db) throw new Error('Banco raiz obrigatório para o lote de operações.');
  const transact = fn => db.$transaction(fn, { isolationLevel: 'Serializable', timeout: 60000 });
  async function authorizedBatch(database, id, userId) {
    await conferirAtorOperacoes(database, userId);
    const batch = await read(database, key(id));
    if (!batch || batch.userId !== String(userId)) throw fail('Liberação não encontrada neste acesso.', 404);
    return batch;
  }
  async function visibleItems(database, batch, userId) {
    const items = [];
    for (const item of batch.items) {
      try { await conferirAtorOperacoes(database, userId, item.companyId); items.push(item); }
      catch (error) { if (error.status !== 403) throw error; }
    }
    return items;
  }
  async function eligible(database, companyId, competencia, userId, status = 'CONFIRMED') {
    const actor = await conferirAtorOperacoes(database, userId, companyId);
    await conferirAutomacaoCicloFiscal({ db: database });
    await conferirPoliticaAutomacao(database, companyId);
    const selectionHash = await selection(database, companyId, competencia);
    const current = await operation(database, companyId, competencia, { rootDb: db });
    if (current.status !== status || current.blocked || current.execution) throw fail(current.blocked || 'Apuração ainda não confirmada, alterada ou já tentada.');
    const context = await contextoOrigemCalculo({ portalClientId: companyId, competencia }, database);
    await conferirExecucao(database, { companyId, competencia, userId, isAdmin: actor.role === 'admin', contextHash: context.hash }, (await credentials()).certificate.document);
    const snapshot = await database.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: companyId, competencia } } });
    return { companyId, revision: current.revision, calculoId: current.calculation.calculoId, selectionHash,
      contextHash: context.hash, calculationProof: snapshot.simulacaoSerpro._portalCalculo };
  }
  async function preview({ userId, competencia, batchId = null }) {
    validarCompetencia(competencia);
    const actor = await conferirAtorOperacoes(db, userId);
    const previous = batchId ? await authorizedBatch(db, batchId, userId) : null;
    if (previous && previous.competencia !== competencia) throw fail('Competência divergente.');
    const companies = previous ? (await visibleItems(db, previous, userId)).filter(i => i.state === 'WAITING').map(i => ({ id: i.companyId, razao: i.name }))
      : await db.portalClient.findMany({ where: actor.role === 'admin' ? {} : { id: { in: (await db.companyFirmAccess.findMany({ where: { userId: String(userId), status: 'ACTIVE', role: { in: ['ACCOUNTANT', 'FIRM_ADMIN'] } }, select: { companyId: true } })).map(a => a.companyId) } }, select: { id: true, razao: true }, orderBy: { id: 'asc' } });
    const items = [], blocked = [];
    for (const company of companies) {
      try {
        const item = await eligible(db, company.id, competencia, userId, previous ? 'RELEASED' : 'CONFIRMED');
        if (previous) {
          const old = previous.items.find(i => i.companyId === company.id);
          if (old.releaseRevision !== item.revision || old.selectionHash !== item.selectionHash || await read(db, attemptKey(company.id, competencia, old.releaseId))) throw fail('Revisão alterada ou tentativa já iniciada.');
        }
        items.push({ ...item, name: company.razao || company.id });
      } catch (error) {
        if (!error.status) throw error; // Falha de leitura não é uma lista vazia.
        blocked.push({ companyId: company.id, name: company.razao || company.id, reason: error.message });
      }
    }
    const value = { id: randomUUID(), userId: String(userId), competencia, batchId, generation: previous?.generation ?? 0,
      createdAt: now().toISOString(), items, blocked };
    await db.appSetting.create({ data: { key: `operations_batch_preview:${value.id}`, value: copy(value) } });
    return publicPreview(value);
  }
  function publicPreview(p) {
    return { id: p.id, competencia: p.competencia, batchId: p.batchId, createdAt: p.createdAt,
      items: p.items.map(i => ({ companyId: i.companyId, name: i.name })), blocked: p.blocked };
  }
  async function get({ userId, batchId }) {
    const batch = await authorizedBatch(db, batchId, userId);
    // Fonte da tentativa é OperationsExecution; uma queda no progresso não a apaga.
    const items = [];
    const visible = await visibleItems(db, batch, userId);
    for (const item of visible) {
      const attempt = await read(db, attemptKey(item.companyId, batch.competencia, item.releaseId));
      items.push({ companyId: item.companyId, name: item.name, state: attempt?.status === 'DONE' ? 'DONE' : attempt || item.state === 'STARTED' ? 'ATTENTION' : item.state,
        message: attempt?.status === 'DONE' ? attempt.message || null : attempt?.message || item.message || (attempt || item.state === 'STARTED' ? 'Tentativa iniciada: acompanhe Tarefas e confira a apuração. Não repita.' : null) });
    }
    return { id: batch.id, competencia: batch.competencia, taskId: visible.length === batch.items.length ? batch.taskId || null : null, generation: batch.generation,
      acceptedAt: batch.acceptedAt, schedulingError: batch.schedulingError || null, items, canResume: items.some(i => i.state === 'WAITING') };
  }
  async function accept({ userId, previewId, requestId, confirmCompetencia }) {
    if (!/^[\w-]{16,100}$/.test(requestId || '') || !/^[\w-]{16,100}$/.test(previewId || '')) throw fail('Identificador inválido. Atualize a prévia.', 422);
    const receipt = `operations_batch_request:${userId}:${requestId}`, payload = hash([previewId, confirmCompetencia]);
    const accepted = await transact(async tx => {
      await lock(tx, receipt);
      await conferirAtorOperacoes(tx, userId);
      const replay = await read(tx, receipt);
      if (replay) {
        if (replay.hash !== payload) throw fail('Solicitação já utilizada para outra liberação.');
        return { batch: await authorizedBatch(tx, replay.batchId, userId), fresh: false };
      }
      const p = await read(tx, `operations_batch_preview:${previewId}`);
      if (!p || p.userId !== String(userId) || p.competencia !== confirmCompetencia || now().getTime() - Date.parse(p.createdAt) > PREVIEW_MS) throw fail('Prévia ausente, expirada ou de outra competência. Atualize antes de liberar.');
      if (!p.items.length) throw fail('Não há empresas elegíveis nesta prévia.');
      const id = p.batchId || randomUUID();
      await lock(tx, key(id));
      const previous = p.batchId ? await authorizedBatch(tx, id, userId) : null;
      if (previous && previous.generation !== p.generation) throw fail('O lote mudou. Atualize a prévia de retomada.');
      const items = previous ? copy(previous.items) : [];
      // Mesma ordem em todos os aceites. O manual usa a mesma trava por empresa/período.
      for (const item of [...p.items].sort((a, b) => a.companyId.localeCompare(b.companyId))) await lock(tx, opKey(item.companyId, p.competencia));
      for (const item of p.items) {
        const current = await eligible(tx, item.companyId, p.competencia, userId, previous ? 'RELEASED' : 'CONFIRMED');
        if (hash(current) !== hash(Object.fromEntries(Object.entries(item).filter(([k]) => k !== 'name')))) throw fail('Os dados mudaram desde a prévia. Confira novamente.');
        if (previous) {
          const old = items.find(i => i.companyId === item.companyId);
          if (!old || old.state !== 'WAITING' || old.releaseRevision !== current.revision || await read(tx, attemptKey(item.companyId, p.competencia, old.releaseId))) throw fail('Item já iniciado ou alterado. Não pode ser retomado.');
        } else {
          const releaseId = randomUUID();
          const released = await saveOperation(db, item.companyId, p.competencia, userId, { action: 'release', expectedRevision: item.revision, requestId: releaseId },
            { transaction: tx, rootDb: db, isAdmin: (await conferirAtorOperacoes(tx, userId, item.companyId)).role === 'admin' });
          items.push({ ...item, releaseId, releaseRevision: released.revision, state: 'WAITING' });
        }
      }
      const acceptedAt = now().toISOString(), policy = await conferirAutomacaoCicloFiscal({ db: tx });
      const batch = { id, userId: String(userId), competencia: p.competencia, generation: (previous?.generation || 0) + 1,
        acceptedAt, expiresAt: new Date(now().getTime() + PREVIEW_MS).toISOString(), policyVersion: policy.version, items,
        selectedIds: p.items.map(i => i.companyId), taskId: null };
      await tx.appSetting.create({ data: { key: `${key(id)}:audit:${batch.generation}`, value: copy({ before: previous, after: batch, previewId, requestId }) } });
      await put(tx, key(id), batch);
      await tx.appSetting.create({ data: { key: receipt, value: { hash: payload, batchId: id } } });
      return { batch, fresh: true };
    });
    if (accepted.fresh) await schedule(accepted.batch);
    return get({ userId, batchId: accepted.batch.id });
  }
  async function mutate(batch, fn) {
    return transact(async tx => {
      await lock(tx, key(batch.id));
      const current = await read(tx, key(batch.id));
      if (current?.generation !== batch.generation) throw fail('Geração de execução alterada.');
      await fn(current, tx);
      await put(tx, key(batch.id), current);
      return current;
    });
  }
  async function schedule(batch) {
    try {
      const task = await tasks.start({ ownerId: batch.userId, requestKey: `operations-${batch.id}-${batch.generation}`, kind: 'apuracao-rotina',
        companyIds: batch.items.map(i => i.companyId), total: batch.selectedIds.length, competencia: batch.competencia,
        description: `Transmissão da competência ${batch.competencia}`, fingerprint: [batch.id, batch.generation] }, progress => process(batch, progress));
      await mutate(batch, value => { value.taskId = task.id; });
    } catch {
      await mutate(batch, value => { value.schedulingError = 'Aceite preservado. Agendamento não confirmado; confira os itens antes de retomar os não iniciados.'; }).catch(() => {});
    }
  }
  async function dispatchGuard(database, batch, item) {
    await conferirAtorOperacoes(database, batch.userId, item.companyId);
    const current = await read(database, key(batch.id));
    if (current?.generation !== batch.generation || now().getTime() > Date.parse(batch.expiresAt)) throw fail('Liberação expirada ou substituída. Confira os itens não iniciados.');
    if (await selection(database, item.companyId, batch.competencia) !== item.selectionHash) throw fail('Seleção ou regime alterado após o aceite.');
    const state = await read(database, opKey(item.companyId, batch.competencia));
    if (state?.status !== 'RELEASED' || state.releaseId !== item.releaseId || state.contextHash !== item.contextHash) throw fail('Liberação alterada.');
    const snapshot = await database.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: item.companyId, competencia: batch.competencia } } });
    if (snapshot?.idempotencyKey !== item.calculoId || hash(snapshot?.simulacaoSerpro?._portalCalculo) !== hash(item.calculationProof)) throw fail('Cálculo alterado após o aceite.');
    const documentaryEvidence = await conferirEvolucaoDocumental(database, { companyId: item.companyId, competencia: batch.competencia,
      releaseId: item.releaseId, calculoId: item.calculoId, calculationProof: item.calculationProof });
    if (item.calculationProof.origemCalculo === 'AUTOMATICO_SIMPLES') {
      const proof = item.calculationProof.preparacaoAutomatica;
      const attempt = await read(database, `ciclo_simples:${item.companyId}:${batch.competencia}`);
      if (attempt?.token !== proof.attemptId || attempt.revision !== proof.revision || attempt.calculo?.calculoId !== item.calculoId) throw fail('Tentativa automática alterada.');
      const prepared = await prepararSimplesConsistente({ portalClientId: item.companyId, competencia: batch.competencia }, { db });
      const actual = copy(prepared.prova), expected = copy(proof.prova);
      // Somente o número comprovado pela transmissão ou pelo extrato desta claim pode evoluir.
      // Entrega externa manual e os demais elementos da prova permanecem comparados.
      if (snapshot.estado === 'transmitida' && actual.entrega?.numeroDeclaracaoRfb !== expected.entrega?.numeroDeclaracaoRfb) {
        const number = documentaryEvidence?.documento.numeroDeclaracao || snapshot.numeroDeclaracao;
        if (!number || actual.entrega?.numeroDeclaracaoRfb !== number
          || (expected.entrega?.numeroDeclaracaoRfb && expected.entrega.numeroDeclaracaoRfb !== number)) throw fail('Declaração divergente antes do despacho.');
        actual.entrega.numeroDeclaracaoRfb = expected.entrega.numeroDeclaracaoRfb;
      }
      if (hash(actual) !== hash(expected)) throw fail('Prova automática alterada antes do despacho.');
      const latest = await db.apuracaoSnapshot.findUnique({ where: { portalClientId_competencia: { portalClientId: item.companyId, competencia: batch.competencia } } });
      if (latest?.idempotencyKey !== snapshot.idempotencyKey || hash(latest?.simulacaoSerpro?._portalCalculo) !== hash(item.calculationProof)) throw fail('Revisão mudou durante a conferência.');
    }
  }
  async function process(batch, progress) {
    let completed = 0;
    for (const companyId of batch.selectedIds) {
      const item = batch.items.find(i => i.companyId === companyId);
      // Antes de iniciar: se falhar, permanece não iniciado e exige nova prévia explícita.
      try {
        await conferirAutomacaoCicloFiscal({ db, version: batch.policyVersion, scheduledAt: batch.acceptedAt });
        await conferirPoliticaAutomacao(db, companyId, { scheduledAt: batch.acceptedAt });
        await dispatchGuard(db, batch, item);
      } catch (error) {
        await mutate(batch, value => { value.items.find(i => i.companyId === companyId).message = error.status || error.code ? error.message : 'Não foi possível conferir os requisitos. Execução não iniciada; atualize a prévia.'; });
        break;
      }
      await mutate(batch, async (current, tx) => {
        const target = current.items.find(i => i.companyId === companyId);
        if (target.state !== 'WAITING' || await read(tx, attemptKey(companyId, batch.competencia, item.releaseId))) throw fail('Tentativa já iniciada.');
        target.state = 'STARTED'; target.message = null; target.startedAt = now().toISOString();
      });
      try {
        const actor = await conferirAtorOperacoes(db, batch.userId, companyId);
        await comAutomacaoCicloFiscal({ version: batch.policyVersion, scheduledAt: batch.acceptedAt }, () => comAutomacaoEmpresa(companyId,
          () => execute(db, { companyId, competencia: batch.competencia, userId: batch.userId, isAdmin: actor.role === 'admin', revision: item.releaseRevision },
            { ...executionDeps, credentials, beforeDispatch: tx => dispatchGuard(tx, batch, item) }), db), db);
        await mutate(batch, value => { value.items.find(i => i.companyId === companyId).state = 'DONE'; });
      } catch {
        await mutate(batch, value => { const target = value.items.find(i => i.companyId === companyId); target.state = 'ATTENTION'; target.message = 'Resultado a conferir na apuração e em Tarefas. Esta tentativa não será repetida.'; });
      }
      await progress(++completed, { batchId: batch.id, competencia: batch.competencia });
    }
    const result = await get({ userId: batch.userId, batchId: batch.id });
    return { body: { ok: result.items.length === batch.items.length && result.items.every(i => i.state === 'DONE' && !i.message), batchId: batch.id,
      results: result.items.map(i => ({ ...i, ok: i.state === 'DONE' && !i.message })) } };
  }
  async function list({ userId, competencia }) {
    validarCompetencia(competencia);
    await conferirAtorOperacoes(db, userId);
    const records = await db.appSetting.findMany({ where: { key: { startsWith: 'operations_batch:' } } });
    const items = [];
    for (const row of records) {
      const b = row.value;
      if (!b?.id || row.key !== key(b.id) || b.userId !== String(userId) || b.competencia !== competencia) continue;
      try { items.push(await get({ userId, batchId: b.id })); } catch (e) { if (e.status !== 403) throw e; }
    }
    return { items: items.sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt)) };
  }
  return { preview, accept, get, list };
}
