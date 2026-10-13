import React, { lazy, Suspense, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

const chave = 'app:recarga-por-chunk-velho';

beforeEach(() => {
  sessionStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('mudar a aba limpa o erro sem remontar o conteúdo saudável', () => {
  function Conteudo({ falha = false }) {
    const [valor, setValor] = useState('');
    if (falha) throw new Error('Erro da aba');
    return <input aria-label="Contexto" value={valor} onChange={e => setValor(e.target.value)}/>;
  }
  const { rerender } = render(<ErrorBoundary resetKey="a"><Conteudo/></ErrorBoundary>);
  fireEvent.change(screen.getByLabelText('Contexto'), { target: { value: 'guia de origem' } });
  rerender(<ErrorBoundary resetKey="b"><Conteudo/></ErrorBoundary>);
  expect(screen.getByLabelText('Contexto')).toHaveValue('guia de origem');
  rerender(<ErrorBoundary resetKey="b"><Conteudo falha/></ErrorBoundary>);
  expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  rerender(<ErrorBoundary resetKey="c"><Conteudo/></ErrorBoundary>);
  expect(screen.getByLabelText('Contexto')).toBeVisible();
});

test('renderiza normalmente quando a aba carrega', async () => {
  const Aba = lazy(() => Promise.resolve({ default: () => <p>Lançamentos carregados</p> }));
  render(<ErrorBoundary><Suspense fallback="Carregando…"><Aba /></Suspense></ErrorBoundary>);
  expect(await screen.findByText('Lançamentos carregados')).toBeVisible();
});

test('falha do módulo lazy mostra recuperação em vez de desmontar a tela inteira', async () => {
  sessionStorage.setItem(chave, String(Date.now()));
  const Aba = lazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/antigo.js')));
  render(<><nav>Circular e Lançamentos</nav><ErrorBoundary><Suspense fallback="Carregando…"><Aba /></Suspense></ErrorBoundary></>);
  expect(await screen.findByRole('button', { name: 'Recarregar' })).toBeVisible();
  expect(screen.getByRole('navigation')).toHaveTextContent('Circular e Lançamentos');
  expect(screen.queryByText('Carregando…')).not.toBeInTheDocument();
});

test('não repete recarga automática dentro da janela de proteção', async () => {
  const anterior = String(Date.now());
  sessionStorage.setItem(chave, anterior);
  const gravar = jest.spyOn(Storage.prototype, 'setItem');
  const Aba = () => { throw new Error('ChunkLoadError'); };
  render(<ErrorBoundary><Aba /></ErrorBoundary>);
  expect(await screen.findByRole('button', { name: 'Recarregar' })).toBeVisible();
  expect(gravar).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(chave)).toBe(anterior);
});

test('armazenamento bloqueado mantém recuperação manual sem laço de recarga', async () => {
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
  const Aba = () => { throw new Error('Importing a module script failed'); };
  render(<ErrorBoundary><Aba /></ErrorBoundary>);
  expect(await screen.findByRole('button', { name: 'Recarregar' })).toBeVisible();
  expect(console.error.mock.calls.flat().map(String).join(' ')).not.toMatch(/Not implemented: navigation/);
});

test('erro comum não é confundido com versão desatualizada', () => {
  const Aba = () => { throw new Error('Campo inválido'); };
  render(<ErrorBoundary><Aba /></ErrorBoundary>);
  expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Recarregar' })).not.toBeInTheDocument();
  expect(sessionStorage.getItem(chave)).toBeNull();
});
