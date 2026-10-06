import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AcompanhamentoComercial } from '../AcompanhamentoComercial';

function montar(comercial) {
  return render(<MemoryRouter><AcompanhamentoComercial api={{ comercial }} onboarding={{ id: 'f1', versao: 4 }} /></MemoryRouter>);
}
test('prepara o contato autorizado e abre a conversa sem enviar mensagem', async () => {
  const comercial = jest.fn(async (path, body) => {
    if (path === '/canais-comerciais') return { canais: [{ id: 'c1', chave: 'Comercial' }] };
    if (body) return { conversaId: 'conv1' };
    return { versao: 4, retorno: null, conversaId: null };
  });
  montar(comercial);
  fireEvent.click(await screen.findByRole('button', { name: 'Iniciar contato' }));
  await screen.findByRole('option', { name: 'Comercial' });
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Contato demonstração' } });
  fireEvent.change(screen.getByLabelText('Telefone com DDI'), { target: { value: '5521999990000' } });
  fireEvent.change(screen.getByLabelText('Origem da autorização'), { target: { value: 'Solicitou pelo formulário de teste' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Preparar conversa' }));
  expect(await screen.findByRole('link', { name: /Abrir conversa/ })).toHaveAttribute('href', '/comercial/conversas?conversa=conv1');
  expect(comercial).toHaveBeenCalledWith('/onboardings/f1/contato', expect.objectContaining({ autorizado: true, canalId: 'c1' }));
  expect(comercial.mock.calls.filter(([, body]) => body)).toHaveLength(1);
});

test('conflito ao agendar mantém os dados e mostra erro para conferência', async () => {
  const comercial = jest.fn(async (path, body) => {
    if (body) throw new Error('A ficha mudou. Atualize antes de salvar.');
    return { versao: 4 };
  });
  montar(comercial);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar retorno' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Agendar retorno' }));
  fireEvent.change(screen.getByLabelText('Próxima ação'), { target: { value: 'Revisar proposta' } });
  fireEvent.change(screen.getByLabelText('Data e hora'), { target: { value: '2026-10-07T10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Salvar retorno' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A ficha mudou');
  expect(screen.getByLabelText('Próxima ação')).toHaveValue('Revisar proposta');
  expect(comercial).toHaveBeenLastCalledWith('/onboardings/f1/retorno', expect.objectContaining({ versao: 4, acao: 'Revisar proposta' }));
});
