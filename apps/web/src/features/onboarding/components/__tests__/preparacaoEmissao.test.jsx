import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { PreparacaoEmissao } from '../PreparacaoEmissao';
it('acompanha a liberação salva e atualiza depois da configuração', async () => {
  const api = { getPerfisEmissao: jest.fn(async () => ({ perfis: [], emissaoCliente: { liberada: false } })) };
  render(<PreparacaoEmissao api={api} portalClientId="p1" />);
  expect(await screen.findByText(/aguardando liberação/)).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/companies/p1/emissao-nfse');
  api.getPerfisEmissao.mockResolvedValue({ perfis: [{ ativo: true }], emissaoCliente: { liberada: true } });
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar preparação' }));
  expect(await screen.findByText(/liberada pelo escritório/)).toBeInTheDocument();
});
it('não apresenta falha como falta de perfil ou liberação', async () => {
  const api = { getPerfisEmissao: jest.fn(async () => { throw new Error(); }) };
  render(<PreparacaoEmissao api={api} portalClientId="p1" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível consultar');
  expect(screen.queryByText(/aguardando liberação/)).not.toBeInTheDocument();
});
it('ignora resposta atrasada de outra empresa', async () => {
  let resolver;
  const api = { getPerfisEmissao: jest.fn(id => id === 'p1' ? new Promise(r => { resolver = r; }) : Promise.resolve({ perfis: [], emissaoCliente: { liberada: false } })) };
  const { rerender } = render(<PreparacaoEmissao api={api} portalClientId="p1" />);
  rerender(<PreparacaoEmissao api={api} portalClientId="p2" />);
  await screen.findByText(/aguardando liberação/);
  resolver({ perfis: [], emissaoCliente: { liberada: true } });
  await waitFor(() => expect(screen.getByRole('link')).toHaveAttribute('href', '/companies/p2/emissao-nfse'));
  expect(screen.queryByText(/liberada pelo escritório/)).not.toBeInTheDocument();
});
