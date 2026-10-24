import { situacaoFiscalDaLinha } from '../companies/list/lib/situacaoFiscal';
import { fluxoDaEmpresa, ETAPAS_CARTEIRA } from '@contabilidade/shared/fluxo-carteira';
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
