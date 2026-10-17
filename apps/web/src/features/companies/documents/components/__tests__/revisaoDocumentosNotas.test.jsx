import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { useCompanyDocuments, useCompanyNotes } from '../../hooks/useCompanyDocuments';
import { CompanyNotesTab } from '../renderCompanyNotesTab';
import { CompanyDocumentsTab } from '../renderCompanyDocumentsTab';
import { useOnboardings } from '../../../../onboarding/hooks/useOnboardings';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test.each(['documents', 'notes'])('resposta antiga não contamina outra empresa: %s', async tipo => {
  const antiga = deferred();
  const key = tipo === 'documents' ? 'documentos' : 'anotacoes';
  const api = { [tipo === 'documents' ? 'listCompanyDocuments' : 'listCompanyNotes']: jest.fn(id => id === 'a' ? antiga.promise : Promise.resolve({ [key]: [{ id: 'novo', texto: 'Nova' }] })) };
  const hook = tipo === 'documents' ? useCompanyDocuments : useCompanyNotes;
  const { result, rerender } = renderHook(({ id }) => hook({ api, companyId: id }), { initialProps: { id: 'a' } });
  rerender({ id: 'b' });
  await waitFor(() => expect(result.current.carregando).toBe(false));
  await act(async () => antiga.resolve({ [key]: [{ id: 'velho' }] }));
  expect(result.current[key].map(x => x.id)).toEqual(['novo']);
});

test('resposta vazia não é lista documental vazia', async () => {
  const api = { listCompanyDocuments: jest.fn().mockResolvedValue(undefined) };
  const { result } = renderHook(() => useCompanyDocuments({ api, companyId: 'a' }));
  await waitFor(() => expect(result.current.erro).toMatch(/indisponível/));
});

test('exclusão sem confirmação da API não retorna sucesso', async () => {
  const api = { listCompanyNotes: jest.fn().mockResolvedValue({ anotacoes: [] }), deleteCompanyNote: jest.fn().mockResolvedValue(undefined) };
  const { result } = renderHook(() => useCompanyNotes({ api, companyId: 'a' }));
  await waitFor(() => expect(result.current.carregando).toBe(false));
  let removida;
  await act(async () => { removida = await result.current.excluir('n'); });
  expect(removida).toBe(false);
});

test('exclusão recusada conserva confirmação e conteúdo da nota', async () => {
  const excluir = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<CompanyNotesTab notes={{ demais: [{ id: 'n', texto: 'Ligar ao cliente', importancia: 'ALTA' }], fixada: null, ordenarPor: 'data', excluir }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Excluir', exact: true }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir anotação' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível excluir');
  expect(screen.getByRole('dialog')).toHaveTextContent('Ligar ao cliente');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir anotação' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('busca e tipo recortam documentos sem perder seleção existente', () => {
  const docs = { documentos: [{ id: 'a', nome: 'Contrato.pdf', tipo: 'CONTRATO' }, { id: 'b', nome: 'CNPJ.pdf', tipo: 'CNPJ' }], tipos: [], tipoLabels: {}, selecionados: new Set(['a']), limparSelecao: jest.fn(), alternarSelecao: jest.fn() };
  render(<CompanyDocumentsTab docs={docs} />);
  fireEvent.change(screen.getByLabelText('Buscar documento'), { target: { value: 'CNPJ' } });
  expect(screen.queryByRole('button', { name: 'Baixar Contrato.pdf' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Baixar CNPJ.pdf' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tipo de documento'), { target: { value: 'CONTRATO' } });
  expect(screen.getByText('Nenhum documento para estes filtros.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
  expect(screen.getByLabelText('Selecionar Contrato.pdf')).toBeChecked();
});

test('busca de onboarding ignora resposta anterior', async () => {
  const antiga = deferred();
  const api = { listarOnboardings: jest.fn().mockReturnValueOnce(antiga.promise).mockResolvedValue({ itens: [{ id: 'atual' }] }) };
  const { result } = renderHook(() => useOnboardings({ api }));
  act(() => result.current.alterarFiltro('q', 'novo'));
  await waitFor(() => expect(result.current.itens[0]?.id).toBe('atual'));
  await act(async () => antiga.resolve({ itens: [{ id: 'antigo' }] }));
  expect(result.current.itens[0].id).toBe('atual');
});
