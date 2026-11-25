import { createHash } from 'node:crypto';
import { avaliarAptidaoFiscalOperacoes, recuperarFiscalFs12 } from '../../composition/execucaoFs12.js';
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
  recover: recuperarFiscalFs12, fiscal: avaliarAptidaoFiscalOperacoes, audit: auditarCompetencia, context: contextoOrigemCalculo,
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
  let aptidaoFiscal = null;
  if (regime === 'SIMPLES' && competencia >= '2026-11') {
    aptidaoFiscal = await deps.fiscal({ portalClientId: companyId, competencia, autorId: deps.autorId }, { db });
    if (aptidaoFiscal?.capacidades?.calcular !== true) blockers.push(...(aptidaoFiscal?.impedimentos?.length ? aptidaoFiscal.impedimentos.map(p => typeof p === 'string' ? p : p.mensagem) : ['Aptidão fiscal não comprovada.']));
  }
  if (portal.status !== 'ATIVA') blockers.push('Empresa não está ativa.');
  if (regime !== 'SIMPLES') blockers.push(regime === 'PRESUMIDO' ? 'Apuração externa do Lucro Presumido.' : 'Simples não comprovado para toda a competência.');
  if (cadastro?.regime !== 'SIMPLES_NACIONAL' || cadastro?.regimeApuracao !== 'COMPETENCIA') blockers.push('Confira o cadastro fiscal e o regime de competência.');
  if (!Array.isArray(config?.fontes) || !config.fontes.length) blockers.push('Confira as fontes de receita da empresa antes do cálculo em lote.');
  if (outside || config?.fontes?.some(f => f !== 'NFSE')) blockers.push('Há receita ou fonte fora de NFS-e. Confira a base completa na Apuração.');
  if (snapshot && !['aberta', 'calculada'].includes(snapshot.estado)) blockers.push('Apuração fechada, transmitida ou incerta. Confira a tentativa antes de calcular.');
  if (attempt && ['COLLECTING', 'CALCULATING', 'UNCERTAIN'].includes(attempt.status)) blockers.push('Tentativa em andamento ou incerta. Acompanhe o resultado antes de repetir.');
  const status = global.paused || policy.paused ? 'PAUSED' : config?.enabled === true ? 'CONFIGURED' : 'DISABLED';
  return { portal, history, company, cadastro, config, snapshot, audit, auditSummary, regime, blockers, attempt,
    aptidaoFiscal, routine: { status, label: { PAUSED: 'Rotina pausada', CONFIGURED: 'Rotina selecionada', DISABLED: 'Rotina desligada' }[status] },
    inputHash: hash([portal.id, portal.cnpj, portal.status, history, cadastro, config, outside, company?.codigosServicoNacional, ...(aptidaoFiscal ? [aptidaoFiscal.fs12] : [])]) };
}
const resultView = value => value ? { companyId: value.companyId, competencia: value.competencia, attemptId: value.attemptId, requestId: value.attemptId, status: value.status, startedAt: value.startedAt, updatedAt: value.updatedAt || null, audit: value.audit || null, warnings: value.warnings || [], calculation: value.calculation || null, reason: value.reason || null, errorCode: value.errorCode || null } : null;
export async function lerResultadoCalculoOperacoes(db, companyId, competencia, requestId) { identity(companyId, competencia); if (requestId && !/^[\w-]{8,100}$/.test(requestId)) throw fail("Pedido inválido.", 422); return { companyId, competencia, attempt: resultView(await read(db, keyFor(companyId, competencia) + (requestId ? `:request:${requestId}` : ""))) }; }
async function previewInTransaction(tx, companyId, competencia, d) {
    const i = await inputs(tx, companyId, competencia, d), context = await d.context({ portalClientId: companyId, competencia }, tx);
    const revision = hash([i.inputHash, context, i.snapshot, i.audit, i.attempt]);
    return { companyId, competencia, revision, scope: 'NFSE', aptidaoFiscal: i.aptidaoFiscal, canCalculate: !i.blockers.length, regime: i.regime, routine: i.routine,
      audit: i.auditSummary, blockers: i.blockers, warnings: i.auditSummary.warnings || [],
      calculation: i.snapshot ? { receitaInterna: i.snapshot.receitaInterna, receitaExterna: i.snapshot.receitaExterna, imposto: i.snapshot.dasSimuladoSerpro, calculoId: i.snapshot.idempotencyKey, origem: 'Simulação salva' } : null,
      lastAttempt: resultView(i.attempt), external: i.regime === 'PRESUMIDO' };
}
export async function prepararCalculoOperacoes(db, companyId, competencia, dependencies = {}) {
 identity(companyId, competencia); const d = { ...defaults, ...dependencies };
 return db.$transaction(tx => previewInTransaction(tx, companyId, competencia, d), { isolationLevel: 'RepeatableRead', timeout: 20000 });
}
function form(dados, cadastro, aptidaoFiscal, competencia, confirmSemMovimento) {
  const atividades = dados.atividades;
  const zeroComprovado = confirmSemMovimento === true && dados.semMovimentoDisponivel === true
    && finite(dados.faturamento?.total) && Number(dados.faturamento.total) === 0;
  if (!Array.isArray(atividades) || (!atividades.length && !zeroComprovado) || dados.prefillValor?.indefinido || dados.disparidades?.length || dados.semClassificacao > 0 || atividades._semMapeamento?.length || atividades.some(a => !a.idAtividade || !finite(a.valorInterno) || !finite(a.valorExterno))) throw fail('Confira atividades, classificação e distribuição das receitas na Apuração.');
  const total = atividades.reduce((n, a) => n + Number(a.valorInterno) + Number(a.valorExterno), 0);
  if (!(total > 0 || total === 0 && zeroComprovado) || !finite(dados.faturamento?.total) || Math.abs(total - Number(dados.faturamento.total)) > 0.005) throw fail('Receita incompleta ou sem movimento. Confira explicitamente a base na Apuração.');
  if (dados.rbt12Origem !== 'EXTRATO_PGDAS' || !finite(dados.rbt12)) throw fail('Confira a base completa de receitas anteriores (RBT12).');
  const fatorR = cadastro.usaFatorR || atividades.some(a => a.sujeitoFatorR !== false);
  // A memória de outra competência não comprova folha atual. O formulário individual
  // permite sua conferência explícita, inclusive zero, sem criar uma dispensa fiscal.
  if (fatorR && competencia < '2026-11') throw fail('Preencher/conferir folha do Fator R na Apuração antes de calcular pelo formulário individual.');
  const fs12 = aptidaoFiscal?.fs12;
  if (competencia >= '2026-11' && (!Number.isInteger(fs12?.revisao) || fs12.revisao < 1 || !fs12.contextoRevisao || !Array.isArray(fs12.serie))) throw fail('Confirme a folha atual antes de calcular.');
  return { atividades, folhaMensal12: competencia >= '2026-11' ? fs12.serie.map(m => ({ pa: m.mes, valor: m.valorCentavos / 100 })) : [],
    ...(competencia >= '2026-11' ? { fs12RevisaoEsperada: fs12.revisao, fs12ContextoRevisao: fs12.contextoRevisao } : {}),
    regimeApuracao: 'COMPETENCIA', semMovimento: zeroComprovado && total === 0 };
}
export async function executarCalculoOperacoes(db, { companyId, competencia, userId, expectedRevision, requestId, confirmCompetencia, confirmSemMovimento = false }, dependencies = {}) {
  identity(companyId, competencia); const d = { ...defaults, ...dependencies, autorId: userId };
  if (!/^[a-f0-9]{64}$/.test(expectedRevision || '') || !/^[\w-]{8,100}$/.test(requestId || '') || confirmCompetencia !== competencia) throw fail('Confirme a seleção atual e a competência.', 422);
  const key = keyFor(companyId, competencia), requestKey = `${key}:request:${requestId}`;
  const requestHash = hash([userId, expectedRevision, competencia, ...(confirmSemMovimento ? [true] : [])]);
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
    if (current?.attemptId !== requestId || current.requestHash !== requestHash || current.userId !== String(userId)) throw fail('A tentativa atual mudou.');
    // A reconciliação pode concluir enquanto este executor aguarda o transporte.
    // Seu resultado persistido tem precedência sobre sucesso/erro tardio do executor.
    if (['REVIEW', 'CALCULATED'].includes(current.status)) { state = current; return resultView(current); }
    if (current.status !== state.status || !['COLLECTING', 'CALCULATING'].includes(current.status)) throw fail('A fase da tentativa mudou.');
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
      const formulario = form(dados, current.cadastro, current.aptidaoFiscal, competencia, confirmSemMovimento);
      return { current, context, dados, formulario, hash: hash([current.inputHash, context, current.audit, formulario]) };
    };
    const prepared = await db.$transaction(prepare, { isolationLevel: 'RepeatableRead', timeout: 20000 });
    const oldAnexos = before.snapshot?.atividadesEscolhidas?.map(a => a.anexoImplicito).filter(Boolean).sort();
    const newAnexos = prepared.formulario.atividades.map(a => a.anexoImplicito).filter(Boolean).sort();
    const warnings = [...(prepared.current.auditSummary.warnings || [])];
    if (oldAnexos?.length && hash(oldAnexos) !== hash(newAnexos)) warnings.push(`Anexo ${oldAnexos.join('/')} → ${newAnexos.join('/')}`);
    await finish({ status: 'CALCULATING', audit: prepared.current.auditSummary, warnings, proof: { context: prepared.context, auditHash: hash(prepared.current.audit), inputHash: prepared.current.inputHash }, fs12Expected: prepared.current.aptidaoFiscal?.fs12 || null, preparedReceita: prepared.formulario.atividades.reduce((n,a)=>n+Number(a.valorInterno)+Number(a.valorExterno),0) });
    const verify = async () => {
      await actor(db, userId, companyId);
      const latest = await read(db, key);
      if (latest?.attemptId !== requestId || latest.status !== 'CALCULATING') throw fail('Tentativa substituída.');
      const fresh = await db.$transaction(prepare, { isolationLevel: 'RepeatableRead', timeout: 20000 });
      if (fresh.hash !== prepared.hash) throw fail('Notas, auditoria ou parâmetros mudaram. Confira uma nova revisão.');
    };
    const result = await comContextoSerpro({ origem: 'operacoes:calculo-nfse', userId, forcar: false }, () => d.calculate({ portalClientId: companyId, competencia, ...prepared.formulario, chaveIdempotencia: requestId,
      manualOperation: { beforeDispatch: async () => { await verify(); dispatched = true; }, verify, attemptId: requestId, requestId } }));
    await verify();
    if (result?.ok !== true || !result.calculoId || !finite(result.dasValor)) throw Error('Cálculo sem resultado comprovado. Confira a tentativa antes de repetir.');
    return await finish({ status: 'CALCULATED', warnings: [...warnings, ...(result.mensagens || []).map(m => typeof m === 'string' ? m : [m.codigo, m.texto || m.mensagem].filter(Boolean).join(': '))], proof: { context: prepared.context, auditHash: hash(prepared.current.audit), inputHash: prepared.current.inputHash }, calculation: {
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

// Fiscal owns causal evidence; Operations alone updates its own attempt under CAS.
export async function reconciliarCalculoOperacoes(db, {companyId,competencia,userId,requestId,encerrarSemDespacho=false,confirmEncerramentoSemDespacho=false,confirmCompetencia}, dependencies={}) {
 identity(companyId,competencia); await actor(db,userId,companyId);
 if(encerrarSemDespacho===true && (confirmEncerramentoSemDespacho!==true||confirmCompetencia!==competencia))throw fail('Confirme explicitamente o encerramento e a competência.',422);
 if(!/^[\w-]{8,100}$/.test(requestId||''))throw fail('Pedido inválido.',422);
 const d={...defaults,...dependencies}, key=keyFor(companyId,competencia), requestKey=`${key}:request:${requestId}`;
 const original=await read(db,requestKey);
 if(!original||original.attemptId!==requestId)throw fail('Tentativa não encontrada.',404);
 if(original.status==='CALCULATED'||original.status==='REVIEW'&&(original.recovery?.encerradaSemDespacho===true||original.recovery?.rejeitada===true))return {companyId,competencia,attempt:resultView(original)};
 if(!['UNCERTAIN','CALCULATING'].includes(original.status)||!original.fs12Expected||!original.proof)throw fail('A tentativa não possui prova recuperável.');
 const command=await db.fs12Comando.findUnique({where:{portalClientId_competencia_chaveIdempotencia:{portalClientId:companyId,competencia,chaveIdempotencia:requestId}}});
 if(!command||command.intencao!=='SIMULAR'||command.esperado?.preparacao?.operationsRequestId!==requestId||command.revisaoFs12!==original.fs12Expected.revisao||command.contextoHash!==original.fs12Expected.contextoRevisao)throw fail('Comando causal desta tentativa não comprovado.');
 const result=await d.recover({portalClientId:companyId,competencia,autorId:userId,comandoId:command.id,encerrarSemDespacho:encerrarSemDespacho===true});
 if(result?.ok===false && result.estado==='REJEITADA'){
  if(result.comandoId!==command.id||result.tentativaId!==command.tentativaId||result.operationsRequestId!==requestId||result.respostaId!==command.esperado?.custodia?.respostaId||result.revisaoFs12!==command.revisaoFs12||result.portalClientId!==companyId||result.competencia!==competencia)throw fail('Recusa sem correlação com esta tentativa.');
  return db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
   await actor(tx,userId,companyId);
   const current=await read(tx,key),immutable=await tx.fs12Comando.findUnique({where:{id:command.id}});
   if(current?.attemptId!==requestId||!['UNCERTAIN','CALCULATING','REVIEW'].includes(current.status)||immutable?.portalClientId!==companyId||immutable.competencia!==competencia||immutable.intencao!=='SIMULAR'
    ||immutable.autorId!==current.userId||immutable.esperado?.preparacao?.operationsRequestId!==requestId||immutable.revisaoFs12!==current.fs12Expected?.revisao||immutable.contextoHash!==current.fs12Expected?.contextoRevisao)throw fail('A tentativa recusada mudou.');
   const responseId=immutable.esperado?.custodia?.respostaId;
   if(!responseId)throw fail('Resposta causal não identificada.');
   const response=await tx.fs12ComandoResposta.findUnique({where:{id:responseId}}),reservation=await tx.fs12ComandoReserva.findUnique({where:{comandoId:immutable.id}});
   const marker=response?.marcadorKey?await read(tx,response.marcadorKey):null;
   if(!response||response.comandoId!==immutable.id||response.reservaId!==reservation?.reservaId||response.marcadorKey!==`serpro_dispatch:${reservation?.reservaId}`||!marker||hash(marker)!==hash(response.marcadorObservado))throw fail('Custódia da recusa não comprovada. O bloqueio foi preservado.');
   if(current.status==='REVIEW'&&current.recovery?.respostaId===response.id)return {companyId,competencia,attempt:resultView(current)};
   const warnings=(result.mensagens||[]).map(m=>typeof m==='string'?m:[m.codigo,m.texto||m.mensagem].filter(Boolean).join(': '));
   const next={...current,status:'REVIEW',calculation:null,reason:result.motivo||'Simulação recusada. Corrija os dados antes de preparar novo cálculo.',errorCode:'FS12_SIMULACAO_REJEITADA',warnings:[...(current.warnings||[]),...warnings],updatedAt:new Date().toISOString(),
    recovery:{comandoId:immutable.id,tentativaId:immutable.tentativaId,respostaId:response.id,actorId:userId,rejeitada:true}};
   await put(tx,requestKey,next);await put(tx,key,next);return {companyId,competencia,attempt:resultView(next)};
  });
 }
 if(result?.encerradaSemDespacho===true){
  if(result.ok!==true||result.estado!=='NAO_TRANSMITIDA'||result.comandoId!==command.id||result.tentativaId!==command.tentativaId)throw fail('Encerramento não comprova esta tentativa.');
  return db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
   await actor(tx,userId,companyId);
   const current=await read(tx,key),immutable=await tx.fs12Comando.findUnique({where:{id:command.id}});
   const closed=await read(tx,`fs12_comando_sem_despacho:${command.id}`),reservation=await tx.fs12ComandoReserva.findUnique({where:{comandoId:command.id}});
   const marker=reservation?await read(tx,`serpro_dispatch:${reservation.reservaId}`):null;
   if(current?.attemptId!==requestId||!['UNCERTAIN','CALCULATING','REVIEW'].includes(current.status)
    ||immutable?.portalClientId!==companyId||immutable.competencia!==competencia||immutable.autorId!==current.userId
    ||immutable.esperado?.preparacao?.operationsRequestId!==requestId||immutable.revisaoFs12!==current.fs12Expected?.revisao||immutable.contextoHash!==current.fs12Expected?.contextoRevisao
    ||closed?.versao!==1||closed.evento!=='COMANDO_ENCERRADO_ANTES_DESPACHO'||closed.comandoId!==immutable.id||closed.tentativaId!==immutable.tentativaId
    ||closed.portalClientId!==companyId||closed.companyId!==immutable.companyId||closed.competencia!==competencia
    ||!closed.autorId||!closed.encerradoEm||closed.motivo!=='CONFERENCIA_EXPLICITA_SEM_MARCADOR'||(closed.reservaId??null)!==(reservation?.reservaId??null)||marker)throw fail('Encerramento sem despacho não comprovado; bloqueio preservado.');
   if(current.status==='REVIEW'&&current.recovery?.comandoId===immutable.id)return {companyId,competencia,attempt:resultView(current)};
   const next={...current,status:'REVIEW',reason:'Tentativa encerrada comprovadamente antes do despacho. Confira uma nova prévia para calcular.',errorCode:'FS12_ENCERRADA_SEM_DESPACHO',updatedAt:new Date().toISOString(),calculation:null,
    recovery:{comandoId:immutable.id,tentativaId:immutable.tentativaId,actorId:userId,encerradaSemDespacho:true,evento:closed.evento}};
   await put(tx,requestKey,next);await put(tx,key,next);return {companyId,competencia,attempt:resultView(next)};
  });
 }
 if(result?.estado==='DESCONHECIDA'||result?.estado==='EM_PROCESSAMENTO')return {companyId,competencia,attempt:resultView(original)};
 if(result?.ok!==true||result.historico||result.operationsRequestId!==requestId||result.comandoId!==command.id||result.snapshot?.idempotencyKey!==result.calculoId||!finite(result.dasValor))throw fail('Resultado não comprova esta tentativa. O bloqueio foi preservado.');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
  await actor(tx,userId,companyId);
  const current=await read(tx,key), archived=await read(tx,requestKey);
  if(current?.attemptId===requestId&&current.status==='CALCULATED'&&current.calculation?.calculoId===result.calculoId)return {companyId,competencia,attempt:resultView(current)};
  if(current?.attemptId!==requestId||archived?.attemptId!==requestId||!['UNCERTAIN','CALCULATING'].includes(current.status))throw fail('A tentativa atual mudou.');
  const snapshot=await tx.apuracaoSnapshot.findUnique({where:{portalClientId_competencia:{portalClientId:companyId,competencia}}});
  const associations=await tx.fs12ComandoCalculo.findMany({where:{comandoId:command.id,portalClientId:companyId,competencia,revisaoFs12:command.revisaoFs12,intencao:'SIMULAR',vinculo:{calculoId:result.calculoId,contextoHash:command.contextoHash}}});
  if(snapshot?.idempotencyKey!==result.calculoId||!associations.length||hash(current.fs12Expected)!==hash(original.fs12Expected)||hash(current.proof)!==hash(original.proof))throw fail('A prova persistida mudou.');
  const next={...current,status:'CALCULATED',reason:null,errorCode:null,warnings:[...(current.warnings||[]),...(result.mensagens||[]).map(m=>typeof m==='string'?m:[m.codigo,m.texto||m.mensagem].filter(Boolean).join(': '))],updatedAt:new Date().toISOString(),recovery:{comandoId:command.id,tentativaId:command.tentativaId,actorId:userId},calculation:{calculoId:result.calculoId,imposto:Number(result.dasValor),receita:current.preparedReceita,origem:'Simulação SERPRO recuperada'}};
  await put(tx,requestKey,next);await put(tx,key,next);return {companyId,competencia,attempt:resultView(next)};
 });
}
