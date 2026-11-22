import { useEffect, useState } from 'react';

const filters = ['all', 'done', 'pending', 'error', 'unknown', 'ready', 'external'];
const orders = ['stage', 'name', 'name-desc'];
const fields = ['operacoesEtapa', 'operacoesLista', 'operacoesCompetencia', 'operacoesBusca', 'operacoesFiltro', 'operacoesOrdem', 'operacoesPagina', 'operacoesModal'];
const initial = competencia => ({ competencia, key: 'apurar', mode: 'all', query: '', filter: 'all', order: 'stage', page: 0, open: false });

export function readOperationsTableContext(search, competencia, names) {
  const params = new URLSearchParams(search), value = initial(competencia);
  if (params.get('operacoesCompetencia') !== competencia || (params.has('competencia') && params.get('competencia') !== competencia)) return value;
  if (!Object.hasOwn(names, params.get('operacoesEtapa'))) return value;
  const page = Number(params.get('operacoesPagina'));
  return { ...value, open: params.get('operacoesModal') === 'aberto', key: params.get('operacoesEtapa'),
    mode: ['all', 'stage', 'missing', 'warnings'].includes(params.get('operacoesLista')) ? params.get('operacoesLista') : 'all',
    query: params.get('operacoesBusca') || '',
    filter: filters.includes(params.get('operacoesFiltro')) && (!['ready','external'].includes(params.get('operacoesFiltro')) || params.get('operacoesEtapa')==='confirmado') ? params.get('operacoesFiltro') : 'all',
    order: orders.includes(params.get('operacoesOrdem')) ? params.get('operacoesOrdem') : 'stage',
    page: Number.isSafeInteger(page) && page >= 0 ? page : 0 };
}

// Persist presentation only: never selections, evidence or command authorization.
export function useOperationsTableContext(navigation, competencia, names) {
  const search = navigation?.location?.search;
  const [saved, setSaved] = useState(() => readOperationsTableContext(search, competencia, names));
  useEffect(() => { setSaved(readOperationsTableContext(search, competencia, names)); }, [search, competencia, names]);
  const value = saved.competencia === competencia ? saved : initial(competencia);
  function update(patch) {
    const next = { ...value, ...patch };
    setSaved(next);
    if (navigation?.location?.pathname !== '/companies') return;
    const params = new URLSearchParams(search);
    fields.forEach(field => params.delete(field));
    params.set('competencia', competencia); params.set('visao', 'operacoes');
    params.set('operacoesEtapa', next.key); params.set('operacoesLista', next.mode); params.set('operacoesCompetencia', competencia);
    if (next.open) params.set('operacoesModal', 'aberto');
    if (next.query) params.set('operacoesBusca', next.query);
    if (next.filter !== 'all') params.set('operacoesFiltro', next.filter);
    if (next.order !== 'stage') params.set('operacoesOrdem', next.order);
    if (next.page) params.set('operacoesPagina', String(next.page));
    navigation.navigate(`/companies?${params.toString()}`, { replace: true });
  }
  return { ...value, update,
    select: (key, mode = 'all') => update({ ...initial(competencia), key, mode, open: true }),
    setQuery: query => update({ query, page: 0 }),
    setFilter: filter => update({ filter, page: 0 }),
    setOrder: order => update({ order, page: 0 }),
    setPage: page => update({ page }) };
}

export function orderOperationsRows(rows, order) {
  if (order === 'stage') return rows;
  const name = row => String(row.company.razao || row.company.razaoSocial || row.company.nome || row.company.cnpj || '');
  return [...rows].sort((a, b) => (order === 'name-desc' ? -1 : 1) * name(a).localeCompare(name(b), 'pt-BR') || String(a.company.companyId).localeCompare(String(b.company.companyId)));
}
