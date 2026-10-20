import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createRealApi } from '../../../../../api/real/realApi';
import { useManageAccountingWorkspace } from '../../../../../app/hooks/useManageAccountingWorkspace';
import { CompanyDetailPage } from '../../pages/renderCompanyDetailPage';

jest.mock('../../../../accounting/hooks/useAvisosContabeis', () => ({ useAvisosContabeis: () => ({ dados: null }) }));
jest.mock('../../../../tasks/TaskCenterPlacement', () => ({ TaskCenterSlot: () => null }));

const conta = { codigo: '1', nome: 'Caixa fictício A', tipo: 'ATIVO', natureza: 'DEVEDORA', status: 'CONFIRMADA', scope: 'COMPANY' };
const originalFetch = global.fetch;
const resposta = data => ({ ok: true, status: 200, json: async () => data });
beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; });

// O botão de releitura expõe o mesmo handler usado pela recuperação. Página,
// formulário, hook e adaptador são reais; somente transporte e avisos alheios são isolados.
function Ficha({ api, companyId = 'A' }) {
 const workspace = useManageAccountingWorkspace({ api, page: 'companyDetail', selectedCompanyId: companyId, companyDetailTab: 'planoContas' });
 const { accounts, loading, error } = workspace.chartOfAccountsState;
 return <MemoryRouter>
  <button onClick={() => workspace.loadChartOfAccounts()}>Reler contas da ficha</button>
  <CompanyDetailPage
   company={{ selectedCompany: { companyId, razao: `Empresa ${companyId}` }, companyDetailTab: 'planoContas', setCompanyDetailTab: jest.fn() }}
   accountingPanel={{ accounts, accountsLoading: loading, accountsError: error, onLoadAccounts: () => workspace.loadChartOfAccounts() }}
   circularPanel={{ competencia: '2026-09' }} guidesPanel={{}} feedback={{}}
  />
 </MemoryRouter>;
}

test('HTTP 200 inválido conserva contas e rascunho real; recuperação aceita vazio válido', async () => {
 let terminar;
 global.fetch.mockResolvedValueOnce(resposta({ data: [conta] }))
  .mockImplementationOnce(() => new Promise(resolve => { terminar = resolve; }))
  .mockResolvedValueOnce(resposta({ data: [] }));
 render(<Ficha api={createRealApi()} />);
 await screen.findByText(conta.nome);
 fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Rascunho da conta' } });
 const linha = screen.getByText(conta.nome).closest('tr');
 fireEvent.click(screen.getByRole('button', { name: 'Reler contas da ficha' }));
 expect(screen.getByRole('status')).toHaveTextContent(/plano de contas/);
 expect(screen.getByText(conta.nome).closest('tr')).toBe(linha);
 await act(async () => terminar(resposta({ data: null })));
 expect(await screen.findByRole('alert')).toHaveTextContent('Resposta inválida');
 expect(screen.getByText(conta.nome).closest('tr')).toBe(linha);
 expect(screen.getByLabelText('Nome')).toHaveValue('Rascunho da conta');
 expect(screen.queryByText(/Nenhuma conta cadastrada/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
 await screen.findByText(/Nenhuma conta cadastrada/);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 expect(screen.getByLabelText('Nome')).toHaveValue('Rascunho da conta');
 expect(global.fetch).toHaveBeenCalledTimes(3);
});

test('falha inicial real não afirma vazio e permite recuperar', async () => {
 global.fetch.mockResolvedValueOnce(resposta({})).mockResolvedValueOnce(resposta({ data: [conta] }));
 render(<Ficha api={createRealApi()} />);
 expect(await screen.findByRole('alert')).toHaveTextContent('Resposta inválida');
 expect(screen.queryByText(/Nenhuma conta cadastrada/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
 await screen.findByText(conta.nome);
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('troca A–B–A não reaproveita contas ou respostas da visita anterior', async () => {
 let terminarAntiga;
 let terminarAtual;
 global.fetch.mockResolvedValueOnce(resposta({ data: [conta] }))
  .mockImplementationOnce(() => new Promise(resolve => { terminarAntiga = resolve; }))
  .mockResolvedValueOnce(resposta({ data: [{ ...conta, nome: 'Caixa fictício B' }] }))
  .mockImplementationOnce(() => new Promise(resolve => { terminarAtual = resolve; }));
 const api = createRealApi();
 const { rerender } = render(<Ficha api={api} />);
 await screen.findByText(conta.nome);
 fireEvent.click(screen.getByRole('button', { name: 'Reler contas da ficha' }));
 rerender(<Ficha api={api} companyId="B" />);
 expect(screen.queryByText(conta.nome)).not.toBeInTheDocument();
 await screen.findByText('Caixa fictício B');
 rerender(<Ficha api={api} companyId="A" />);
 expect(screen.queryByText('Caixa fictício B')).not.toBeInTheDocument();
 expect(screen.queryByText(conta.nome)).not.toBeInTheDocument();
 await act(async () => terminarAntiga(resposta({ data: [conta] })));
 expect(screen.queryByText(conta.nome)).not.toBeInTheDocument();
 await act(async () => terminarAtual(resposta({ data: [{ ...conta, nome: 'Caixa A atual' }] })));
 await screen.findByText('Caixa A atual');
 expect(global.fetch).toHaveBeenCalledTimes(4);
});
