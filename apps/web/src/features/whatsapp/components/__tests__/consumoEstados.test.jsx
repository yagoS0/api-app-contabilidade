import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConsumoIaDetalhado } from '../PendenciasSuporte';

const consumo = { custoUsd: .0045, reservaUsd: .2, itens: [] };
function abrir() { fireEvent.click(screen.getByText('Custos por área')); }

test('consulta anuncia carga, permite recuperar falha e mantém reserva separada do consumo', async () => {
  let rejeitar;
  const api = { getConsumoIaDetalhado: jest.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejeitar = reject; })).mockResolvedValue({ ok: true, consumo }) };
  render(<ConsumoIaDetalhado api={api} />);
  abrir();
  expect(await screen.findByRole('status')).toHaveTextContent('Carregando consumo');
  await act(async () => rejeitar(Error('indisponível')));
  expect(await screen.findByRole('alert')).toHaveTextContent('Consumo indisponível');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(await screen.findByText(/Reservado:/)).toHaveTextContent('0,2000');
  expect(screen.getByText(/Estimativa do mês:/)).toHaveTextContent('0,0045');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(api.getConsumoIaDetalhado).toHaveBeenCalledTimes(2);
});

test('falha ao atualizar identifica que os valores preservados são da leitura anterior', async () => {
  const api = { getConsumoIaDetalhado: jest.fn().mockResolvedValueOnce({ ok: true, consumo }).mockRejectedValue(Error('negado')) };
  render(<ConsumoIaDetalhado api={api} />);
  abrir(); await screen.findByText(/Reservado:/);
  abrir(); await waitFor(() => expect(screen.getByText('Custos por área').closest('details')).not.toHaveAttribute('open'));
  abrir();
  expect(await screen.findByRole('alert')).toHaveTextContent('última leitura disponível');
  expect(screen.getByText(/Reservado:/)).toHaveTextContent('0,2000');
});
