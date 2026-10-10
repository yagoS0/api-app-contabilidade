import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PendenciasSuporte, ConsumoIaDetalhado } from '../PendenciasSuporte';
test('pendência lida permanece até ação explícita, assumindo antes de resolver', async () => {
  const item = { id: 'p1', conversaId: 'cv1', estado: 'AGUARDANDO', empresa: 'Empresa teste', motivo: 'Ajuda', resumo: 'Emitir para Gusmed' };
  const api = { getPendenciasSuporte: jest.fn(async () => ({ ok: true, total: 1, itens: [item] })),
    assumirConversaWhatsapp: jest.fn(async () => { item.estado = 'EM_ATENDIMENTO'; }), resolverSuporte: jest.fn(async () => {}) };
  const onAbrir = jest.fn(); render(<PendenciasSuporte api={api} onAbrir={onAbrir} />);
  fireEvent.click(await screen.findByText('Equipe · 1'));
  fireEvent.click(screen.getByText('Empresa teste')); expect(onAbrir).toHaveBeenCalledWith('cv1');
  expect(screen.getByText('Equipe · 1')).toBeTruthy();
  fireEvent.click(screen.getByText('Assumir')); await waitFor(() => expect(screen.getByText('Resolver')).not.toBeDisabled());
  fireEvent.click(screen.getByText('Resolver')); await waitFor(() => expect(api.resolverSuporte).toHaveBeenCalledWith('cv1'));
});
test('erro de ação aparece e preserva pendência', async () => {
  const api = { getPendenciasSuporte: async () => ({ ok: true, total: 1, itens: [{ id: 'p', conversaId: 'c', estado: 'AGUARDANDO' }] }), assumirConversaWhatsapp: async () => { throw Error('Outro atendente assumiu'); } };
  render(<PendenciasSuporte api={api} onAbrir={() => {}} />); fireEvent.click(await screen.findByText('Equipe · 1'));
  fireEvent.click(screen.getByText('Assumir')); expect(await screen.findByRole('alert')).toHaveTextContent('Outro atendente assumiu');
});
test('custos detalhados distinguem consumo de reserva', async () => {
  const api = { getConsumoIaDetalhado: async () => ({ ok: true, consumo: { custoUsd: .0045, reservaUsd: .2, itens: [{ area: 'Suporte', custoUsd: .0045, chamadas: 1 }] } }) };
  render(<ConsumoIaDetalhado api={api} />); fireEvent.click(screen.getByText('Custos por área'));
  expect(await screen.findByText(/Suporte:.*0,0045/)).toBeTruthy(); expect(screen.getByText(/Reservado:/)).toBeTruthy();
});
