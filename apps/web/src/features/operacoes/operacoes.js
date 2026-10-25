import { situacaoFiscalDaLinha } from '../companies/list/lib/situacaoFiscal';
import { fluxoDaEmpresa, ETAPAS_CARTEIRA, statusApresentacao } from '@contabilidade/shared/fluxo-carteira';
import { getComplianceTags } from '../companies/list/components/renderCompanyCard';
import { resumirGuias } from '../companies/list/lib/resumoGuias';

export function agruparPendencias(tasks) {
  return {
    pendencias: tasks.filter(t => t.tipo === 'pendencias'),
    faltantes: tasks.filter(t => t.categoria === 'faltantes'),
    envios: tasks.filter(t => t.categoria === 'envios'),
    revisoes: tasks.filter(t => t.categoria === 'revisoes'),
    erros: tasks.filter(t => t.tipo === 'erros'),
  };
}

// A mesma projeção exibida na tabela Empresas. Nenhuma leitura da agenda.
export function projetarOperacoesEmpresas(companies = [], competencia) {
  const unique = new Map();
  for (const company of companies) {
    if (!company.companyId || String(company.status || '').toUpperCase() === 'INATIVA') continue;
    const fluxo = fluxoDaEmpresa(company);
    if (fluxo.competencia && fluxo.competencia !== competencia) continue;
    unique.set(company.companyId, { company, fluxo });
  }
  const rows = [...unique.values()].sort((a, b) => ETAPAS_CARTEIRA.indexOf(a.fluxo.status.chave) - ETAPAS_CARTEIRA.indexOf(b.fluxo.status.chave)
    || String(a.company.razao || a.company.razaoSocial || '').localeCompare(String(b.company.razao || b.company.razaoSocial || ''), 'pt-BR'));
  const tasks = rows.flatMap(({ company, fluxo }) => {
    const resumo = resumirGuias(company.guideCompliance);
    const itens = getComplianceTags(company.guideCompliance).filter(t => ['missing', 'conflito', 'falhou', 'gerada'].includes(t.state) || t.pendenciaOperacional).map(tag => ({
      id: `${company.companyId}:guia:${tag.id || tag.key || tag.label}`, company, fluxo,
      tipo: tag.state === 'falhou' ? 'erros' : 'pendencias',
      categoria: tag.key === 'parcDas' && !tag.mensal ? 'revisoes' : tag.state === 'missing' ? 'faltantes' : ['gerada', 'falhou'].includes(tag.state) ? 'envios' : 'revisoes',
      titulo: `${tag.label} · ${tag.state === 'falhou' ? 'erro de envio' : tag.state === 'gerada' ? 'aguardando envio' : tag.state === 'conflito' ? 'conferir divergência' : tag.mensal && tag.state === 'missing' ? 'documento ausente' : tag.pendenciaOperacional ? 'conferir pendência' : 'documento ausente'}`,
      tag: { ...tag, envioPodeTentarDeNovo: company.guideCompliance?.[tag.key]?.envioPodeTentarDeNovo ?? null },
    }));
    if (!fluxo.apuracao.apurada) itens.unshift({ id: `${company.companyId}:apuracao`, company, fluxo, tipo: 'apuracoes', titulo: `Apuração · ${fluxo.apuracao.rotulo}` });
    if (!resumo.completo && !resumo.revisoes) itens.push({ id: `${company.companyId}:indisponivel`, company, fluxo, tipo: 'pendencias', categoria: 'revisoes', titulo: 'Guias · cobertura a conferir' });
    return itens;
  });
  const groups = {
    concluidas: rows.filter(r => r.fluxo.status.chave === 'concluido').map(r => ({ ...r, id: `${r.company.companyId}:concluido`, tipo: 'concluidas', titulo: 'Fluxo concluído' })),
    apuracoes: tasks.filter(t => t.tipo === 'apuracoes'),
    ...agruparPendencias(tasks),
  };
  return { rows, tasks, groups, metrics: [
    rows.filter(r => r.fluxo.status.chave === 'concluido').length,
    rows.filter(r => !r.fluxo.apuracao.apurada).length,
    rows.filter(r => r.fluxo.status.chave === 'guias').length,
    rows.filter(r => r.fluxo.contabilizacao.chave === 'aberto').length,
  ] };
}

// Every chart keeps the counted items, so its drill-down cannot use a different predicate.
export function distribuirOperacoes(rows, manualInss = []) {
  const group = (keys, unit) => keys.map(([key, label, color]) => ({ key, label, color, unit, items: [] }));
  const neutral = 'var(--text-faint)', green = 'var(--state-ok)';
  const guias = group([['pendente','Pendente','var(--state-danger)'],['disponivel','Disponível','var(--accent-orange)'],['enviada','Enviada','var(--logo-sol)'],['paga','Paga',green],['verificar','A verificar',neutral]], 'obrigações com guia');
  const status = group([['apuracao','Apuração','var(--accent-orange)'],['obrigacoes','Obrigações','var(--primary)'],['guias','Guias','var(--logo-sol)'],['contabilizacao','Contabilização',green],['importacao','Importação','var(--accent-purple)'],['concluido','Concluído',green],['desconhecido','A verificar',neutral]], 'empresas');
  const parcelas = group([['com','Em parcelamento','var(--accent-purple)'],['sem','Sem parcelamento',neutral],['verificar','A verificar',neutral]], 'empresas');
  const fiscal = group([['pendencia','Com pendência','var(--state-danger)'],['emDia','Sem pendência',green],['verificar','A verificar',neutral]], 'empresas');
  const apuracao = group([['sim','Apuradas',green],['nao','Não apuradas',neutral],['verificar','A verificar',neutral]], 'empresas');
  const add = (groups, key, item) => groups.find(g => g.key === key).items.push(item);
  for (const row of rows) {
    const { company, fluxo } = row;
    add(status, status.some(g => g.key === fluxo.status?.chave) ? fluxo.status.chave : 'desconhecido', row);
    const parc = company.guideCompliance?.parcDas;
    add(parcelas, company.temParcelamento === true || parc?.required === true ? 'com' : company.temParcelamento === false || parc?.required === false ? 'sem' : 'verificar', row);
    const checked = new Date(company.fiscalCheckedAt).getTime();
    const savedSituation = situacaoFiscalDaLinha(company).estado.chave;
    const situation = checked > Date.now() && savedSituation === 'emDia' ? 'verificar' : savedSituation;
    add(fiscal, ['pendencia','emDia'].includes(situation) ? situation : 'verificar', row);
    add(apuracao, fluxo.apuracao?.apurada === true ? 'sim' : fluxo.apuracao?.apurada === false ? 'nao' : 'verificar', row);
    const manual = manualInss.find(item => item.companyId === company.companyId);
    const compliance = { ...company.guideCompliance };
    // Only the chart's INSS document axis reconciles the monthly control. The
    // general status remains exactly fluxo.status.chave from the company table.
    if (manual) {
      const existing = compliance.inss;
      const hasDocument = ['present', 'gerada', 'enviada', 'falhou'].includes(existing?.state);
      if (!hasDocument || manual.status === 'DOCUMENT_REVIEW') {
        const states = { NOT_APPLICABLE: 'na', DOCUMENT_ABSENT: 'vazio', PENDING_DOCUMENT: 'missing', DOCUMENT_REVIEW: 'conflito', DOCUMENT_AVAILABLE: 'gerada' };
        // Review changes only the document axis of the existing evidence. Never
        // attach an old delivery/payment to another guide selected by the control.
        compliance.inss = { ...existing, required: true, state: states[manual.status] || 'unknown',
          guideId: existing?.guideId || manual.guides?.find(g => g.available)?.id,
          communicationState: existing?.communicationState || existing?.state };
      }
    }
    const resumo = resumirGuias(compliance);
    for (const item of resumo.items.filter(item => !item.dispensada)) add(guias, item.grupo, { ...row, item });
  }
  return { guias, status, parcelas, fiscal, apuracao,
    coberturaIndisponivel: rows.filter(row => !resumirGuias(row.company.guideCompliance).completo) };
}

export const CHECKLIST_OPERACOES = [['receitas', 'Receitas'], ['provisoes', 'Provisões'], ['folhaProlabore', 'Folha/Pró-labore'], ['despesas', 'Despesas'], ['pagamentos', 'Pagamentos']];

// Each metric owns both sets. Position in the workflow never proves another axis.
export function resumirEtapasOperacoes(rows, evidence = [], manualInss = []) {
  const indexed = new Map(evidence.map(e => [e.companyId, e]));
  const manual = new Map(manualInss.map(e => [e.companyId, e]));
  const items = rows.map(row => {
    const { company, fluxo } = row;
    const operation = indexed.get(company.companyId);
    const current = operation?.competencia === fluxo.competencia ? operation : null;
    const manualEvidence = manual.get(company.companyId);
    const inss = !manualEvidence?.competencia || manualEvidence.competencia === fluxo.competencia ? manualEvidence : null;
    const compliance = { ...company.guideCompliance };
    if (inss) {
      const existing = compliance.inss;
      const hasDocument = ['present', 'gerada', 'enviada', 'falhou'].includes(existing?.state);
      if (!hasDocument || inss.status === 'DOCUMENT_REVIEW') {
        const state = ({ NOT_APPLICABLE: 'na', DOCUMENT_ABSENT: 'vazio', PENDING_DOCUMENT: 'missing', DOCUMENT_REVIEW: 'conflito', DOCUMENT_AVAILABLE: 'gerada' })[inss.status] || 'unknown';
        const id = existing?.guideId || inss.guides?.find(g => g.available)?.id;
        compliance.inss = { ...(id && id === existing?.guideId ? existing : {}), required: true, state, guideId: id,
          communicationState: hasDocument ? existing.communicationState || existing.state : undefined };
      }
    }
    const periodMatches = !compliance.competencia || compliance.competencia === fluxo.competencia;
    const summary = resumirGuias(periodMatches ? compliance : null);
    // parcDas is an operational aggregate, never a document or payment receipt.
    const coverage = periodMatches && Array.isArray(compliance.coberturaParcelamentoMes) ? compliance.coberturaParcelamentoMes : null;
    const parcelas = (coverage || []).map(p => ({
      key: p.id, label: `${p.tipo || 'Parcelamento'} ${p.numeroParcelamento || ''} · Parcela ${p.numeroParcela ?? 'a identificar'} · ${p.mesOperacional}`,
      dispensada: p.documento === 'nao_exigido', disponivel: p.documento === 'disponivel',
      enviada: p.comunicacao === 'enviada', comunicacaoDispensada: p.comunicacao === 'nao_exigida',
      paga: p.pagamentoConfirmado === true, revisar: !['disponivel', 'faltante', 'nao_exigido'].includes(p.documento),
      documento: ({ disponivel: 'Disponível', faltante: 'Faltante', nao_exigido: 'Não exigido' })[p.documento] || 'A conferir',
      comunicacao: ({ enviada: 'Enviada', nao_exigida: 'Não exigida', pendente: 'Pendente', aguarda_documento: 'Aguardando documento' })[p.comunicacao] || 'A verificar',
      pagamento: p.pagamentoConfirmado === true ? 'Confirmado' : 'Não confirmado', parcela: true,
    }));
    summary.items = [...summary.items, ...parcelas];
    summary.completo = summary.completo && periodMatches && (compliance.parcDas?.required !== true || coverage !== null);
    const inssPending = ['PENDING_DOCUMENT', 'DOCUMENT_REVIEW'].includes(inss?.status);
    const guideItems = summary.items.filter(i => !i.dispensada);
    const known = Boolean(company.guideCompliance) && summary.completo && !company.guideCompliance?.error && !company.guideCompliance?.erro;
    const available = known && !inssPending && summary.items.every(i => i.disponivel || i.dispensada);
    const sent = known && available && summary.items.every(i => i.enviada || i.comunicacaoDispensada || (!i.parcela && i.dispensada));
    const payable = summary.items.filter(i => i.parcela || !i.dispensada);
    const tasks = fluxo.tarefas;
    const stageDone = stages => Array.isArray(tasks) && tasks.some(t => stages.includes(t.etapa)) && tasks.filter(t => stages.includes(t.etapa)).every(t => t.concluida === true);
    const apurar = stageDone(['apuracao', 'obrigacoes']) && (fluxo.obrigacoes || []).filter(o => o.verificador !== 'MES_FECHADO').every(o => o.concluida === true);
    const accounting = stageDone(['contabilizacao', 'importacao']);
    const checks = Object.fromEntries(CHECKLIST_OPERACOES.map(([key]) => [key, fluxo.contabilizacao?.versao === null ? null : fluxo.contabilizacao?.conferenciaDesatualizada ? false : fluxo.contabilizacao?.checklist?.[key] ?? null]));
    const presentation = statusApresentacao(fluxo, { guiasConhecidas: known, guiasPendentes: inssPending || (known && !sent) });
    const axes = {
      calculado: fluxo.apuracao?.apurada ?? null,
      confirmado: current ? ['CONFIRMED', 'RELEASED', 'EXECUTED'].includes(current.status) && current.status !== 'INVALIDATED' : null,
      transmitido: fluxo.apuracao?.transmitida ?? null,
      disponivel: known ? available : null, enviado: known ? sent : null,
      pago: known ? payable.length ? payable.every(i => i.paga) : 'na' : null,
      ...checks,
      apurar, guias: sent, contabilizacao: accounting,
      concluido: presentation.chave === 'concluido',
    };
    return { ...row, operation: current, guideSummary: summary, guideItems, manualInss: inss, axes, presentation };
  });
  const keys = ['apurar', 'guias', 'contabilizacao', 'concluido', 'calculado', 'confirmado', 'transmitido', 'disponivel', 'enviado', 'pago', ...CHECKLIST_OPERACOES.map(([k]) => k)];
  const metrics = Object.fromEntries(keys.map(key => [key, { done: items.filter(r => r.axes[key] === true), missing: items.filter(r => r.axes[key] !== true && r.axes[key] !== 'na'), unknown: items.filter(r => r.axes[key] == null), notApplicable: items.filter(r => r.axes[key] === 'na'), total: items.filter(r => r.axes[key] !== 'na').length }]));
  return { items, metrics };
}

export function distribuicoesCadastrais(rows, now = Date.now()) {
  const timestamp = value => {
    if (!value) return NaN;
    const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(String(value));
    if (!parts) return NaN;
    const [, year, month, day] = parts.map(Number), civil = new Date(Date.UTC(year, month - 1, day));
    if (civil.getUTCFullYear() !== year || civil.getUTCMonth() !== month - 1 || civil.getUTCDate() !== day) return NaN;
    return Date.parse(value);
  };
  const civilParts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now)).map(part => [part.type, part.value]));
  const civilToday = `${civilParts.year}-${civilParts.month}-${civilParts.day}`;
  const vigente = value => {
    const instant = timestamp(value);
    if (!Number.isFinite(instant)) return null;
    // A civil expiry is inclusive in Brasília; a real timestamp keeps its instant.
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value >= civilToday : instant > now;
  };
  const chart = (negative, positive) => [
    { key: 'negative', label: negative, color: 'var(--state-danger)', items: [] },
    { key: 'positive', label: positive, color: 'var(--state-ok)', items: [] },
    { key: 'unknown', label: 'A verificar', color: 'var(--text-faint)', items: [] },
  ];
  const result = { parcelas: chart('Com parcelamento', 'Sem parcelamento'), fiscal: chart('Com pendência', 'Sem pendência'), certificado: chart('Sem certificado válido', 'Com certificado válido'), procuracao: chart('Sem procuração vigente', 'Com procuração vigente') };
  const add = (key, state, row) => result[key].find(g => g.key === state).items.push(row);
  for (const row of rows) {
    const c = row.company, parc = c.guideCompliance?.parcDas;
    add('parcelas', c.temParcelamento === true || parc?.required === true ? 'negative' : c.temParcelamento === false || parc?.required === false ? 'positive' : 'unknown', row);
    const fiscal = situacaoFiscalDaLinha(c).estado.chave;
    const checked = timestamp(c.fiscalCheckedAt);
    add('fiscal', fiscal === 'pendencia' ? 'negative' : fiscal === 'emDia' && checked <= now ? 'positive' : 'unknown', row);
    const cert = c.legacyCompany;
    const expires = vigente(cert?.certExpiresAt);
    add('certificado', !cert || !Object.hasOwn(cert, 'certStorageKey') ? 'unknown' : !cert.certStorageKey ? 'negative' : expires === null ? 'unknown' : expires ? 'positive' : 'negative', row);
    const p = c.serproStatus;
    const status = p?.procurationStatus || p?.status;
    const date = vigente(p?.validUntil), check = timestamp(p?.checkedAt);
    // Document validity and the provider's 24h operational eligibility are separate.
    const state = p?.vinculoConfirmado !== true || !Number.isFinite(check) || check > now ? 'unknown'
      : status === 'ATIVA' && date !== null ? date ? 'positive' : 'negative'
        : status === 'AUSENTE' && now - check < 86400000 ? 'negative' : 'unknown';
    add('procuracao', state, row);
  }
  return result;
}
