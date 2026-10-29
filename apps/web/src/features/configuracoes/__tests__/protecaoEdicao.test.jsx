import { Request } from 'node-fetch/lib/index.js';
import { useState } from 'react';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { WorkspaceNavigationProvider } from '../../../app/navigation/WorkspaceNavigation';
import { OperationsManualInss } from '../../operacoes/OperationsManualInss';
import { ProtecaoEdicao } from '../ProtecaoEdicao';
import { useEdicaoPendente, useConfirmarSaida } from '../ProtecaoEdicao.shared.js';

function Editor({ navegar }) {
  const [valor, setValor] = useState('salvo');
  const confirmar = useConfirmarSaida();
  useEdicaoPendente(valor !== 'salvo');
  return <><input aria-label="Nome" value={valor} onChange={e=>setValor(e.target.value)}/>
    <a href="/outra-secao" onClick={e=>{e.preventDefault();navegar();}}>Outra seção</a>
    <button onClick={()=>confirmar(navegar)}>Voltar</button>
    <button onClick={()=>setValor('salvo')}>Salvar</button></>;
}
afterEach(()=>jest.restoreAllMocks());
it('preserva edição ao recusar troca por link ou botão e libera após salvar',()=>{
  const navegar=jest.fn();
  render(<ProtecaoEdicao><Editor navegar={navegar}/></ProtecaoEdicao>);
  fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'novo'}});
  fireEvent.click(screen.getByText('Outra seção'));
  expect(screen.getByRole('dialog',{name:'Alterações não salvas'})).toBeInTheDocument();
  fireEvent.click(screen.getByText('Continuar editando'));fireEvent.click(screen.getByText('Voltar'));
  expect(navegar).not.toHaveBeenCalled();fireEvent.click(screen.getByText('Continuar editando'));
  expect(screen.getByLabelText('Nome')).toHaveValue('novo');
  fireEvent.click(screen.getByText('Salvar'));fireEvent.click(screen.getByText('Outra seção'));
  expect(navegar).toHaveBeenCalledTimes(1);expect(screen.queryByRole('dialog')).toBeNull();
});
it('confirma só a transição e mantém beforeunload quando editor legado continua montado',()=>{
  render(<ProtecaoEdicao><Editor navegar={jest.fn()}/></ProtecaoEdicao>);
  const limpo=new Event('beforeunload',{cancelable:true});window.dispatchEvent(limpo);expect(limpo.defaultPrevented).toBe(false);
  fireEvent.change(screen.getByLabelText('Nome'),{target:{value:'novo'}});
  const pendente=new Event('beforeunload',{cancelable:true});window.dispatchEvent(pendente);expect(pendente.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByText('Outra seção'));
  fireEvent.click(screen.getByText('Sair sem confirmação'));
  const saiu=new Event('beforeunload',{cancelable:true});window.dispatchEvent(saiu);expect(saiu.defaultPrevented).toBe(true);
});

it('proteção legada não oferece Guardar sem operação de persistência', () => {
  render(<ProtecaoEdicao><Editor navegar={jest.fn()}/></ProtecaoEdicao>);
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'novo' } });
  fireEvent.click(screen.getByText('Voltar'));
  expect(screen.queryByRole('button', { name: /Guardar/ })).toBeNull();
  fireEvent.click(screen.getByText('Continuar editando'));
  expect(screen.getByLabelText('Nome')).toHaveValue('novo');
});

it('INSS real não oferece descarte fictício durante escrita ativa ou resultado incerto', async () => {
  Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'test-inss' });
  const initial = { revision: 'r1', status: 'PENDING_DOCUMENT', state: {
    applicable: null, responsible: '', dueDate: null, note: '', reason: '',
  } };
  let reject;
  const api = { getCompanyManualInss: jest.fn().mockResolvedValue(initial),
    saveCompanyManualInss: jest.fn(() => new Promise((_, no) => { reject = no; })) };
  const router = createMemoryRouter([{ path: '*', element: <WorkspaceNavigationProvider>
    <OperationsManualInss api={api} companyId="a" competencia="2026-09" canEdit />
  </WorkspaceNavigationProvider> }], { initialEntries: ['/companies/a'] });
  try {
    render(<RouterProvider router={router} />);
    fireEvent.change(await screen.findByLabelText('Responsável'), { target: { value: 'Equipe' } });
    fireEvent.click(screen.getByRole('button', { name: 'Conferir controle' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar controle' }));
    await act(async () => { await router.navigate('/comercial'); });
    expect(screen.queryByRole('button', { name: 'Descartar e sair' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sair sem confirmação' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar e sair' })).toBeNull();
    expect(router.state.location.pathname).toBe('/companies/a');
    await act(async () => { reject(new Error('Resultado incerto')); });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await act(async () => { await router.navigate('/comercial'); });
    expect(screen.queryByRole('button', { name: 'Descartar e sair' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sair sem confirmação' })).toBeNull();
    expect(router.state.location.pathname).toBe('/companies/a');
    expect(screen.getByLabelText('Responsável')).toHaveValue('Equipe');
    expect(api.saveCompanyManualInss).toHaveBeenCalledTimes(1);
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    const originalInput = api.saveCompanyManualInss.mock.calls[0][2];
    api.saveCompanyManualInss.mockResolvedValueOnce({ ...initial, revision: 'r2', state: originalInput.state });
    fireEvent.click(screen.getByRole('button', { name: 'Conferir salvamento' }));
    await screen.findByText(/Controle salvo/);
    expect(api.saveCompanyManualInss).toHaveBeenCalledTimes(2);
    expect(api.saveCompanyManualInss.mock.calls[1]).toEqual(api.saveCompanyManualInss.mock.calls[0]);
    await act(async () => { await router.navigate('/comercial'); });
    expect(router.state.location.pathname).toBe('/comercial');
  } finally { cleanup(); router.dispose(); }
});

it('fallback confirma cada saída, sem apagar edição ou executar a continuação em loop', () => {
  const navegar = jest.fn(); render(<ProtecaoEdicao><Editor navegar={navegar}/></ProtecaoEdicao>);
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'rascunho' } });
  for (let index = 1; index <= 2; index++) {
    fireEvent.click(screen.getByText('Outra seção'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Sair sem confirmação'));
    expect(navegar).toHaveBeenCalledTimes(index);
    expect(screen.getByLabelText('Nome')).toHaveValue('rascunho');
  }
});

it('INSS real permite abandonar rascunho puro sem chamar salvamento', async () => {
  const api = { getCompanyManualInss: jest.fn().mockResolvedValue({ revision: 'r1', status: 'PENDING_DOCUMENT', state: { applicable: null, responsible: '', dueDate: null, note: '', reason: '' } }), saveCompanyManualInss: jest.fn() };
  const router = createMemoryRouter([{ path: '*', element: <WorkspaceNavigationProvider><OperationsManualInss api={api} companyId="sintetica" competencia="2026-10" canEdit /></WorkspaceNavigationProvider> }], { initialEntries: ['/origem'] });
  try {
    render(<RouterProvider router={router}/>);
    fireEvent.change(await screen.findByLabelText('Responsável'), { target: { value: 'Somente local' } });
    await act(async () => { await router.navigate('/destino'); });
    expect(router.state.location.pathname).toBe('/origem');
    fireEvent.click(screen.getByRole('button', { name: 'Sair sem confirmação' }));
    await act(async () => { await Promise.resolve(); });
    expect(router.state.location.pathname).toBe('/destino');
    expect(api.saveCompanyManualInss).not.toHaveBeenCalled();
    // Persistent editor still owns its boolean and must protect another transition.
    await act(async () => { await router.navigate('/terceiro'); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/destino');
  } finally { cleanup(); router.dispose(); }
});
// Same installed Request implementation as bootstrapDataRouter; no router mock or fetch replacement.
const requestDescriptorBeforeSuite = Object.getOwnPropertyDescriptor(globalThis, 'Request');
beforeEach(() => { Object.defineProperty(globalThis, 'Request', { configurable: true, writable: true, value: Request }); });
afterEach(() => {
  if (requestDescriptorBeforeSuite) Object.defineProperty(globalThis, 'Request', requestDescriptorBeforeSuite);
  else delete globalThis.Request;
});
