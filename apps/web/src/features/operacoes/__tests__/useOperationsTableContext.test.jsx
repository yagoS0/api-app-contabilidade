import { act, renderHook } from '@testing-library/react';
import { useOperationsTableContext, readOperationsTableContext, orderOperationsRows } from '../useOperationsTableContext';
const names = { apurar: 'Apuração', calculado: 'Calculado', enviado: 'Enviado' };
const saved = '?visao=operacoes&competencia=2026-10&operacoesCompetencia=2026-10&operacoesEtapa=enviado&operacoesLista=all&operacoesBusca=Alfa&operacoesFiltro=pending&operacoesOrdem=name-desc&operacoesPagina=2';

test('URL restaura apenas contexto de apresentação do período correto', () => {
  expect(readOperationsTableContext(saved, '2026-10', names)).toEqual({ competencia: '2026-10', key: 'enviado', mode: 'all', query: 'Alfa', filter: 'pending', order: 'name-desc', page: 2 });
  expect(readOperationsTableContext(saved, '2026-11', names)).toMatchObject({ key: 'apurar', query: '', page: 0, filter: 'all' });
  expect(readOperationsTableContext(saved.replace('operacoesPagina=2', 'operacoesPagina=-1'), '2026-10', names).page).toBe(0);
  expect(readOperationsTableContext(saved.replace('operacoesEtapa=enviado', 'operacoesEtapa=invalid'), '2026-10', names).key).toBe('apurar');
});

test('busca e ordenação reiniciam página, preservam outros parâmetros e não gravam comandos', () => {
  const navigate = jest.fn();
  const navigation = { navigate, location: { pathname: '/companies', search: saved + '&outro=preservado' } };
  const { result, rerender } = renderHook(({ competencia }) => useOperationsTableContext(navigation, competencia, names), { initialProps: { competencia: '2026-10' } });
  act(() => result.current.setQuery('Beta'));
  expect(result.current).toMatchObject({ query: 'Beta', page: 0, key: 'enviado' });
  const params = new URL(navigate.mock.calls[0][0], 'http://localhost').searchParams;
  expect(params.get('outro')).toBe('preservado'); expect(params.get('operacoesBusca')).toBe('Beta');
  act(() => result.current.setOrder('name'));
  expect(result.current).toMatchObject({ query: 'Beta', order: 'name', page: 0 });
  rerender({ competencia: '2026-11' });
  expect(result.current).toMatchObject({ key: 'apurar', query: '', order: 'stage', page: 0 });
});

test('ordenação é apresentação estável, sem alterar a projeção recebida', () => {
  const rows = [{ company: { companyId: 'b', razao: 'Beta' } }, { company: { companyId: 'a', razao: 'Alfa' } }];
  expect(orderOperationsRows(rows, 'name').map(row => row.company.companyId)).toEqual(['a', 'b']);
  expect(orderOperationsRows(rows, 'name-desc').map(row => row.company.companyId)).toEqual(['b', 'a']);
  expect(orderOperationsRows(rows, 'stage')).toBe(rows);
  expect(rows[0].company.companyId).toBe('b');
});
