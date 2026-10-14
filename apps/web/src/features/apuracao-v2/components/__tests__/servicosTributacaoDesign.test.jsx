import { render, screen } from '@testing-library/react';
import { ServicosTributacao } from '../ServicosTributacao';

const dados = { integracaoLigada: false, ibscbsLigado: false, perfis: [{ id: 'p', nome: 'Consultoria', codigoServicoNacional: '010101', codigoServicoMunicipal: '1.01' }], derivadoDoCadastro: {}, sugestoes: { porServico: [] } };
const api = { getPerfisEmissao: jest.fn(async () => dados) };

test('edição mantém dados fiscais em detalhe e aviso de integração apenas uma vez', async () => {
  const { container } = render(<ServicosTributacao companyId="a" api={api} podeEditar />);
  await screen.findByRole('button', { name: 'Novo perfil' });
  expect(container.querySelector('.servicos-tributacao-resumo')).not.toHaveAttribute('open');
  expect(screen.getByText('Complemento municipal (cTribMun)')).toBeInTheDocument();
  expect(screen.getByText(/Os perfis estão desativados/)).toBeVisible();
  expect(screen.queryByText(/Perfis sem integração ativa/)).not.toBeInTheDocument();
});

test('leitura sem permissão conserva resumo fiscal e aviso de integração visíveis', async () => {
  const { container } = render(<ServicosTributacao companyId="a" api={api} podeEditar={false} />);
  expect(await screen.findByText('Complemento municipal (cTribMun)')).toBeVisible();
  expect(screen.getByText(/Perfis sem integração ativa/)).toBeVisible();
  expect(container.querySelector('details')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Novo perfil' })).not.toBeInTheDocument();
});
