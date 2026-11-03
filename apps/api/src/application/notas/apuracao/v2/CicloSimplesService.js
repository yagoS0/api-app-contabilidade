import { randomUUID } from 'node:crypto';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { hashCalculo } from './CalculoConfirmado.js';
import { conferirContextoCicloFiscal, comVerificacaoTentativaAutomatica } from '../../../fiscal/automacaoCicloFiscalContext.js';
import { aplicarRegimeRotinas } from '../../../fiscal/serpro/CompanyRoutineApplicability.js';

import { prepararSimplesConsistente, comPreparacaoAutomatica } from './PreparacaoAutomaticaSimples.js';

const keyFor = (id, pa) => `ciclo_simples:${id}:${pa}`;
const fail = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const copy = value => JSON.parse(JSON.stringify(value));
const revisable = new Set(['COLETA_PARCIAL', 'REVISAO_NECESSARIA', 'CALCULADO']);
const expiredCollection = (value, now) => value.status === 'COLETANDO' && !value.calculo && new Date(value.updatedAt).getTime() + 60 * 60_000 < now.getTime();
const publicState = (value, now = new Date()) => {
  if (expiredCollection(value, now)) return { ...value, status: 'REVISAO_NECESSARIA', canRevise: true, reason: 'Coleta interrompida sem tentativa de cálculo. Confira os documentos e abra uma revisão explícita para continuar.' };
  if (value.status === 'CALCULANDO' && new Date(value.updatedAt).getTime() + 60 * 60_000 < now.getTime()) return { ...value, status: 'INCERTO', canRevise: false, reason: 'Tentativa interrompida: confira o cálculo salvo na Apuração. Não haverá repetição automática.' };
  return { ...value, canRevise: revisable.has(value.status) };
};
function identity({ portalClientId, competencia }) {
  if (typeof portalClientId !== 'string' || !portalClientId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia || '')) throw fail('CICLO_SIMPLES_IDENTIDADE', 'Empresa e competência válidas são obrigatórias.', 422);
}
const initial = (portalClientId, competencia) => ({ portalClientId, competencia, revision: 0, status: 'NAO_INICIADO', reason: null, coleta: null, calculo: null, updatedAt: null });
async function locked(db, key, run) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`;
    return run(tx);
  });
}
async function save(tx, key, value) {
  const clean = copy(value);
  await tx.appSetting.upsert({ where: { key }, create: { key, value: clean }, update: { value: clean } });
  return clean;
}
const defaults = {
  db: prisma,
  now: () => new Date(),
  conferir: (db, id) => conferirContextoCicloFiscal(db, { requireCompany: true, portalClientId: id }),
  coletarAdn: async args => (await import('../../adn/AdnNotasService.js')).syncAdnNotasForCompany(args),
  coletarDfe: async args => (await import('../../dfe/DfeSyncService.js')).syncDfeForCompany(args),
  envolverTentativa: comVerificacaoTentativaAutomatica,
  resolverIdentidade: async (id, db) => (await import('./FechamentoService.js')).resolverCnpjs(id, db),
  getDados: async args => (await import('./FechamentoService.js')).getDadosFechamento(args),
  calcular: async args => (await import('./FechamentoService.js')).calcularFechamento(args),
  contexto: async (args, db) => (await import('./RecuperacaoCalculo.js')).contextoOrigemCalculo(args, db),
};
async function currentInputs(db, portalClientId, competencia) {
  const portal = await db.portalClient.findUnique({ where: { id: portalClientId }, select: { id: true, status: true, cnpj: true, companyId: true } });
  const cadastro = await db.cadastroFiscal.findUnique({ where: { portalClientId } });
  const config = (await db.appSetting.findUnique({ where: { key: `ciclo_simples_config:${portalClientId}` } }))?.value;
  if (!portal || portal.status === 'SUSPENSA' || !/^\d{14}$/.test(String(portal.cnpj || '').replace(/\D/g, ''))) throw fail('CICLO_CADASTRO_INDISPONIVEL', 'Confira o cadastro e a situação da empresa.');
  if (!config?.enabled || !Array.isArray(config.fontes) || !config.fontes.length || new Set(config.fontes).size !== config.fontes.length || config.fontes.some(f => !['NFE', 'NFSE'].includes(f))) throw fail('CICLO_FONTES_NAO_CONFIGURADAS', 'Selecione e habilite explicitamente as fontes de notas nas configurações da empresa.');
  if (cadastro?.regime !== 'SIMPLES_NACIONAL' || cadastro.regimeApuracao !== 'COMPETENCIA' || !cadastro.cnaePrincipal) throw fail('CICLO_CONFIGURACAO_FISCAL', 'O cálculo automático exige cadastro fiscal do Simples e regime de competência confirmado; não altera regimes ausentes ou de caixa.');
  const history = portal.companyId ? await db.regimeHistorico.findMany({ where: { companyId: portal.companyId } }) : [];
  const start = `${competencia}-01`, [year, month] = competencia.split('-').map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const civil = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10);
  let regimeAtual = null;
  if (history.length) {
    const relevant = history.filter(h => civil(h.vigenciaInicio) <= end && (!h.vigenciaFim || civil(h.vigenciaFim) >= start));
    if (relevant.length !== 1 || relevant[0].regime !== 'SIMPLES' || civil(relevant[0].vigenciaInicio) > start || relevant[0].vigenciaFim && civil(relevant[0].vigenciaFim) < end) throw fail('CICLO_REGIME_HISTORICO', 'O histórico não confirma Simples durante toda a competência. Confira o regime do período.');
  } else {
    const company = portal.companyId ? await db.company.findUnique({ where: { id: portal.companyId }, select: { regimeTributario: true, tipoTributario: true } }) : null;
    regimeAtual = aplicarRegimeRotinas(company).regime;
    if (regimeAtual !== 'SIMPLES') throw fail('CICLO_REGIME_ATUAL_DIVERGENTE', 'Sem histórico fiscal da competência, o cadastro atual da empresa também precisa confirmar Simples. Confira a divergência antes da coleta automática.');
    if (!cadastro.dataOpcaoSN || civil(cadastro.dataOpcaoSN) > start) throw fail('CICLO_VIGENCIA_NAO_CONFIRMADA', 'Confirme a vigência do Simples no histórico ou no cadastro fiscal antes do cálculo automático.');
  }
  return { config, cadastro, history, regimeAtual };
}
function validateCalculation(dados, cadastro, revision) {
  if (!(dados.estado === 'aberta' || revision > 1 && dados.estado === 'calculada') || dados.entregaPgdas?.numeroDeclaracaoRfb || dados.entregaPgdas?.declaradaForaEm) throw fail('CICLO_APURACAO_EXISTENTE', 'Já há cálculo, fechamento ou entrega a conferir nesta competência.');
  if (!['EXTRATO_PGDAS'].includes(dados.rbt12Origem) || !Number.isFinite(Number(dados.rbt12))) throw fail('CICLO_RECEITAS_ANTERIORES', 'As receitas anteriores não têm base completa comprovada. Confira o RBT12 antes do cálculo.');
  if (dados.origemAtividades === 'cnae' || !dados.origemAtividades || dados.prefillValor?.indefinido || Number(dados.semClassificacao) !== 0 || dados.disparidades?.length || dados.atividades?._semMapeamento?.length) throw fail('CICLO_CLASSIFICACAO_PENDENTE', 'Confira a classificação, as atividades e a distribuição das receitas.');
  const atividades = dados.atividades;
  const validNumber = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
  if (!Array.isArray(atividades) || !atividades.length || atividades.some(a => !a.idAtividade || !validNumber(a.valorInterno) || !validNumber(a.valorExterno))) throw fail('CICLO_VALORES_PENDENTES', 'Preencha as atividades e os valores por mercado antes do cálculo.');
  const total = atividades.reduce((n, a) => n + Number(a.valorInterno) + Number(a.valorExterno), 0);
  if (!(total > 0) || !validNumber(dados.faturamento?.total) || Math.abs(total - Number(dados.faturamento.total)) > 0.005) throw fail('CICLO_RECEITA_PENDENTE', 'Ausência de notas não comprova ausência de movimento. Confira as receitas da competência.');
  if (cadastro.usaFatorR || atividades.some(a => a.sujeitoFatorR !== false)) {
    // Memória do mês anterior não comprova folha corrente nem a série de 12 meses.
    throw fail('CICLO_FATOR_R_CONFERENCIA', 'Atividades sujeitas ao Fator R ou sem enquadramento explícito exigem conferência da folha pelo contador.');
  }
  return { atividades, folhaMensal12: [], regimeApuracao: cadastro.regimeApuracao, semMovimento: false };
}

export async function lerCicloSimples(args, dependencies = {}) {
  identity(args);
  const d = { ...defaults, ...dependencies };
  const saved = (await d.db.appSetting.findUnique({ where: { key: keyFor(args.portalClientId, args.competencia) } }))?.value;
  if (!saved) return publicState(initial(args.portalClientId, args.competencia));
  // A leitura não consulta o Fisco nem altera o cálculo. O vínculo é conferido também pelo fechamento.
  if (saved.status === 'CALCULADO' && saved.contextoHash) {
    const atual = await d.contexto(args, d.db);
    const prova = saved.preparacaoHash ? await prepararSimplesConsistente(args, { db: d.db, getDados: d.getDados, contexto: d.contexto, resolverIdentidade: d.resolverIdentidade }) : null;
    if (hashCalculo(atual) !== saved.contextoHash || prova && prova.hash !== saved.preparacaoHash) return publicState({ ...saved, status: 'REVISAO_NECESSARIA', reason: 'As notas ou os parâmetros fiscais mudaram após o cálculo. Confira uma nova revisão; nenhuma operação foi repetida.' });
  }
  return publicState(saved, d.now());
}

export async function revisarCicloSimples(args, dependencies = {}) {
  identity(args);
  const d = { ...defaults, ...dependencies }, { portalClientId, competencia, userId, expectedRevision } = args;
  const motivo = String(args.motivo || '').trim();
  if (!userId || !Number.isInteger(expectedRevision) || motivo.length < 3 || motivo.length > 500) throw fail('CICLO_REVISAO_INVALIDA', 'Informe a revisão atual e o motivo da correção.', 422);
  const key = keyFor(portalClientId, competencia);
  return locked(d.db, key, async tx => {
    const user = await tx.user.findUnique({ where: { id: String(userId) }, select: { role: true, status: true, accountType: true } });
    const access = await tx.companyFirmAccess.findUnique({ where: { companyId_userId: { companyId: portalClientId, userId: String(userId) } } });
    if (user?.status !== 'active' || !(user.role === 'admin' || user.accountType === 'FIRM' && access?.status === 'ACTIVE' && ['ACCOUNTANT', 'FIRM_ADMIN'].includes(access.role))) throw fail('CICLO_ACESSO_NEGADO', 'Seu acesso atual não permite revisar esta empresa.', 403);
    const before = (await tx.appSetting.findUnique({ where: { key } }))?.value;
    if (!before || before.revision !== expectedRevision) throw fail('CICLO_REVISAO_ALTERADA', 'A revisão mudou. Atualize antes de continuar.');
    if (!revisable.has(before.status) && !expiredCollection(before, d.now())) throw fail('CICLO_RESULTADO_PENDENTE', 'Esta tentativa está em andamento ou tem resultado incerto. Confira o resultado antes de abrir nova tentativa.');
    const updatedAt = d.now().toISOString();
    const value = { ...initial(portalClientId, competencia), revision: before.revision + 1, status: 'AGUARDANDO_COLETA_FINAL', updatedAt, revisedBy: String(userId), reason: 'Correção registrada. O automático só atende esta competência até o dia 8 do mês seguinte, em horário futuro habilitado. Fora dessa janela, conclua pela Apuração; não haverá recuperação automática.' };
    await tx.appSetting.create({ data: { key: `${key}:revisao:${before.revision}`, value: copy({ before, motivo, userId: String(userId), updatedAt }) } });
    return publicState(await save(tx, key, value));
  });
}

export async function executarCicloSimples(args, dependencies = {}) {
  identity(args);
  const d = { ...defaults, ...dependencies }, { portalClientId, competencia } = args;
  const at = new Date(args.scheduledAt), now = d.now();
  if (!Number.isFinite(at.getTime())) throw fail('CICLO_AGENDA_INVALIDA', 'Horário agendado obrigatório.');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const [year, month, day] = date.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  if (day < 1 || day > 8 || previous !== competencia) throw fail('CICLO_FORA_DA_JANELA', 'A coleta automática atende a competência anterior somente até o dia 8.');
  if (now.getTime() < at.getTime()) throw fail('CICLO_HORARIO_INVALIDO', 'O horário agendado ainda não chegou.');
  const guard = async () => {
    await args.assertActive?.();
    if (!await d.conferir(d.db, portalClientId)) throw fail('CICLO_CONTEXTO_OBRIGATORIO', 'A execução exige contexto automático agendado e empresarial.');
  };
  await guard();
  const key = keyFor(portalClientId, competencia), token = randomUUID();
  const claim = await locked(d.db, key, async tx => {
    const before = (await tx.appSetting.findUnique({ where: { key } }))?.value || initial(portalClientId, competencia);
    if (!['NAO_INICIADO', 'AGUARDANDO_COLETA_FINAL'].includes(before.status) || before.scheduledAt === at.toISOString()) return { acquired: false, value: before };
    if (before.scheduledAt) await tx.appSetting.create({ data: { key: `${key}:janela:${before.scheduledAt}`, value: copy(before) } });
    const value = { ...before, revision: before.revision || 1, status: 'COLETANDO', reason: 'Coleta reservada. Em caso de interrupção, confira os registros antes de continuar; a tentativa não será repetida automaticamente.', token, scheduledAt: at.toISOString(), updatedAt: now.toISOString(), coleta: {} };
    return { acquired: true, value: await save(tx, key, value) };
  });
  if (!claim.acquired) return publicState(claim.value);
  const finish = async patch => locked(d.db, key, async tx => {
    const before = (await tx.appSetting.findUnique({ where: { key } }))?.value;
    if (before?.token !== token || before.revision !== claim.value.revision) throw fail('CICLO_REVISAO_ALTERADA', 'A tentativa não pertence mais à revisão atual.');
    return save(tx, key, { ...before, ...patch, updatedAt: d.now().toISOString() });
  });
  const coleta = {};
  let reserved = false;
  try {
    const inputs = await currentInputs(d.db, portalClientId, competencia), configHash = hashCalculo(inputs);
    await finish({ configHash });
    for (const fonte of inputs.config.fontes) {
      await guard();
      if (hashCalculo(await currentInputs(d.db, portalClientId, competencia)) !== configHash) throw fail('CICLO_CONFIGURACAO_ALTERADA', 'A seleção mudou durante a coleta. Nenhuma próxima fonte será consultada até a conferência.');
      const result = await (fonte === 'NFSE' ? d.coletarAdn : d.coletarDfe)({ portalClientId, somenteColeta: true });
      coleta[fonte] = { complete: result?.complete === true && result?.ok === true && !result?.partial && (fonte !== 'NFE' || result.revenueComplete === true), reason: result?.reason || null, totalDocs: result?.totalDocs ?? null, cursor: result?.newCursor ?? null, checkedAt: d.now().toISOString() };
      await finish({ coleta });
      if (!coleta[fonte].complete) return publicState(await finish({ status: 'COLETA_PARCIAL', reason: result?.message || 'A fonte não confirmou captura completa. O contador deve conferir antes de calcular.' }));
    }
    if (day < 8) return publicState(await finish({ status: 'AGUARDANDO_COLETA_FINAL', reason: 'Notas coletadas. Cálculo aguarda a coleta final do dia 8.' }));
    await guard();
    const fresh = await currentInputs(d.db, portalClientId, competencia);
    if (hashCalculo(fresh) !== configHash) throw fail('CICLO_CONFIGURACAO_ALTERADA', 'A configuração mudou durante a coleta. Confira antes de calcular.');
    const captureDeps = { db: d.db, getDados: d.getDados, contexto: d.contexto, resolverIdentidade: d.resolverIdentidade, lerInputs: tx => currentInputs(tx, portalClientId, competencia) };
    const preparo = await prepararSimplesConsistente({ portalClientId, competencia }, captureDeps);
    if (hashCalculo(preparo.inputs) !== configHash) throw fail('CICLO_CONFIGURACAO_ALTERADA', 'A seleção mudou durante o preparo.');
    const formulario = validateCalculation(preparo.dados, preparo.inputs.cadastro, claim.value.revision);
    const contexto = preparo.contexto;
    await guard();
    const conferirTentativa = async ({ db = d.db } = {}) => {
      const state = (await db.appSetting.findUnique({ where: { key } }))?.value;
      if (!state || state.token !== token || state.revision !== claim.value.revision || state.status !== 'CALCULANDO') throw fail('AUTOMACAO_EMPRESA_TENTATIVA_ALTERADA', 'A tentativa automática mudou. Confira a revisão.');
      if (hashCalculo(await currentInputs(db, portalClientId, competencia)) !== configHash) throw fail('AUTOMACAO_EMPRESA_SELECAO_ALTERADA', 'A seleção mudou antes do despacho.');
      // A guarda usa ReadCommitted: a prova fiscal abre sua própria captura RR curta.
      const atual = await prepararSimplesConsistente({ portalClientId, competencia }, captureDeps);
      if (hashCalculo(atual.inputs) !== configHash) throw fail('AUTOMACAO_EMPRESA_SELECAO_ALTERADA', 'A seleção ou configuração mudou. Nenhuma simulação foi autorizada.');
      if (atual.hash !== preparo.hash || hashCalculo(atual.periodosAceitos) !== hashCalculo(preparo.periodosAceitos)) throw fail('AUTOMACAO_EMPRESA_BASE_ALTERADA', 'A base fiscal mudou. Confira antes de simular.');
    };
    await finish({ status: 'CALCULANDO', reason: 'Cálculo reservado. Se o processo for interrompido, confira o resultado salvo antes de qualquer nova tentativa.', contextoHash: hashCalculo(contexto), preparacaoHash: preparo.hash, calculo: { reservedAt: d.now().toISOString(), attemptId: token } });
    reserved = true;
    const automatico = { ...preparo, formulario, attemptId: token, revision: claim.value.revision };
    const result = await d.envolverTentativa({ portalClientId, competencia, verificar: conferirTentativa }, () => comPreparacaoAutomatica(automatico, () => d.calcular({ portalClientId, competencia, ...formulario, expectedAutomaticContextHash: hashCalculo(contexto) })));
    if (result?.ok !== true || !result.calculoId || result.dasValor == null || !Number.isFinite(Number(result.dasValor))) throw fail('CICLO_RESULTADO_INCONCLUSIVO', 'O cálculo não retornou resultado comprovado. Confira a tentativa antes de repetir.');
    return publicState(await finish({ status: 'CALCULADO', reason: 'Cálculo disponível para conferência do contador. Não houve transmissão.', calculo: { attemptId: token, calculoId: result.calculoId, dasValor: String(result.dasValor), completedAt: d.now().toISOString() } }));
  } catch (error) {
    // Uma reserva seguida de queda/timeout nunca é liberada por troca de hash ou reinício.
    const definitive = error?.recusaAntesDespacho === true || error?.code === 'RECEITAS_ANTERIORES_NAO_CONVERGIU' || error?.code === 'SERPRO_BUSINESS_ERROR';
    return publicState(await finish({ status: reserved && !definitive ? 'INCERTO' : 'REVISAO_NECESSARIA', reason: String(error?.message || 'Falha na rotina; confira a tentativa.').slice(0, 500), errorCode: error?.code || 'CICLO_FALHA', coleta }));
  }
}
