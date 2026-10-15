import { fluxoDaEmpresa, ETAPAS_CARTEIRA } from '@contabilidade/shared/fluxo-carteira';
import { getComplianceTags } from '../companies/list/components/renderCompanyCard';

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
    const itens = getComplianceTags(company.guideCompliance).filter(t => ['missing', 'conflito', 'falhou', 'gerada'].includes(t.state) || t.pendenciaOperacional).map(tag => ({
      id: `${company.companyId}:guia:${tag.id || tag.key || tag.label}`, company, fluxo,
      tipo: tag.state === 'falhou' ? 'erros' : 'pendencias',
      titulo: `${tag.label} · ${tag.state === 'falhou' ? 'erro de envio' : tag.state === 'gerada' ? 'aguardando envio' : tag.state === 'conflito' ? 'conferir divergência' : tag.pendenciaOperacional ? 'conferir pendência' : 'documento ausente'}`,
      tag: { ...tag, envioPodeTentarDeNovo: company.guideCompliance?.[tag.key]?.envioPodeTentarDeNovo ?? null },
    }));
    if (!fluxo.apuracao.apurada) itens.unshift({ id: `${company.companyId}:apuracao`, company, fluxo, tipo: 'apuracoes', titulo: `Apuração · ${fluxo.apuracao.rotulo}` });
    if (!company.guideCompliance || company.guideCompliance.erro) itens.push({ id: `${company.companyId}:indisponivel`, company, fluxo, tipo: 'pendencias', titulo: 'Guias · dados indisponíveis' });
    return itens;
  });
  const groups = {
    concluidas: rows.filter(r => r.fluxo.status.chave === 'concluido').map(r => ({ ...r, id: `${r.company.companyId}:concluido`, tipo: 'concluidas', titulo: 'Fluxo concluído' })),
    apuracoes: tasks.filter(t => t.tipo === 'apuracoes'),
    pendencias: tasks.filter(t => t.tipo === 'pendencias'),
    erros: tasks.filter(t => t.tipo === 'erros'),
  };
  return { rows, tasks, groups, metrics: [
    rows.filter(r => r.fluxo.status.chave === 'concluido').length,
    rows.filter(r => !r.fluxo.apuracao.apurada).length,
    rows.filter(r => r.fluxo.status.chave === 'guias').length,
    rows.filter(r => r.fluxo.contabilizacao.chave === 'aberto').length,
  ] };
}
