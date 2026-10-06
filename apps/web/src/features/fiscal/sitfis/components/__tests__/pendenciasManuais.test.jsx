import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createPendenciasManuaisMock } from '../../../../../api/mock/pendenciasManuaisMock';
import { usePendenciasManuais } from '../../hooks/usePendenciasManuais';
import { PendenciasFiscaisTabelas } from '../PendenciasFiscaisTabelas';
import { SitfisTab } from '../renderSitfisTab';

function Tela({ api, companyId = 'a' }) {
  const manuais = usePendenciasManuais({ api, companyId });
  return <PendenciasFiscaisTabelas key={companyId} relatorio={null} manuais={manuais} />;
}
beforeEach(() => { localStorage.clear(); Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => 'd7d592d7-c4b3-4fd1-8670-b25cd43923bb' }); });
test('cria ISS sem SITFIS, mantém após remount, edita e exclui apenas na empresa escolhida', async () => {
  const api = createPendenciasManuaisMock();
  const tela = render(<Tela api={api} />);
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Municipal — ISS e taxas' })).getByRole('button', { name: 'Adicionar' })).toBeEnabled());
  fireEvent.click(within(screen.getByRole('region', { name: 'Municipal — ISS e taxas' })).getByRole('button', { name: 'Adicionar' }));
  fireEvent.change(screen.getByLabelText('Competência'), { target: { value: '09/2026' } });
  fireEvent.change(screen.getByLabelText('Vencimento'), { target: { value: '2026-10-15' } });
  fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'ISS em atraso' } });
  expect(screen.getByRole('dialog').querySelectorAll('input, textarea, select')).toHaveLength(5);
  fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '1.234,56' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar pendência' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('table')).toHaveTextContent('ISS');
  expect(screen.getByRole('table')).toHaveTextContent('1.234,56');
  expect(screen.getByRole('table')).toHaveTextContent('15/10/2026');
  tela.unmount();
  const outra = render(<Tela api={createPendenciasManuaisMock()} />);
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Detalhes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
  expect(screen.getByLabelText('Descrição')).toHaveValue('ISS em atraso');
  expect(screen.getByLabelText('Valor (R$)')).toHaveValue('1234,56');
  fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '2.000,00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar pendência' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('table')).toHaveTextContent('2.000,00');
  outra.rerender(<Tela api={api} companyId="b" />);
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Municipal — ISS e taxas' })).getByRole('button', { name: 'Adicionar' })).toBeEnabled());
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  outra.rerender(<Tela api={api} companyId="a" />);
  await screen.findByRole('table');
  fireEvent.click(screen.getByRole('button', { name: 'Detalhes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
  fireEvent.click(screen.getByRole('button', { name: 'Excluir lançamento' }));
  await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
});
test('aba sem consulta permite cadastro manual e erro de gravação mantém formulário', async () => {
  const salvar = jest.fn().mockRejectedValue(new Error('Sem conexão'));
  render(<SitfisTab companyId="a" sitfisPanel={{ status: null, manuais: { disponivel: true, itens: [], salvar } }} />);
  fireEvent.click(within(screen.getByRole('region', { name: 'Municipal — ISS e taxas' })).getByRole('button', { name: 'Adicionar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar pendência' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
  expect(screen.getByLabelText('Imposto')).toHaveValue('ISS');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});
test('total vazio não vira zero e valor negativo não é enviado', async () => {
  const salvar = jest.fn().mockResolvedValue({});
  render(<PendenciasFiscaisTabelas manuais={{ disponivel: true, itens: [], salvar }} />);
  fireEvent.click(within(screen.getByRole('region', { name: 'Municipal — ISS e taxas' })).getByRole('button', { name: 'Adicionar' }));
  fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '-1,00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar pendência' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('valor positivo');
  expect(salvar).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Valor (R$)'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar pendência' }));
  await waitFor(() => expect(salvar).toHaveBeenCalledWith(expect.objectContaining({ dados: expect.objectContaining({ total: '' }) })));
});
