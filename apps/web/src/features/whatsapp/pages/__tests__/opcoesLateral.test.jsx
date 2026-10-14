import { act, fireEvent, render, screen } from '@testing-library/react';
import { WhatsappPage } from '../renderWhatsappPage';

test('opções preservam estimativa e reservas sem API detalhada, e aviso offline permanece visível', async () => {
  const onlineOriginal = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  const api = {
    whatsappContratoV2: true,
    listarConversasWhatsapp: jest.fn(async () => ({ conversas: [], versaoContrato: 2, consumoIa: { escritorio: { consumoCentavos: 2, reservaCentavos: 5, teto: 100, chamadas: 1 } } })),
  };
  try {
    render(<WhatsappPage api={api} area="comercial" />);
    const consumo = await screen.findByTestId('consumo-ia');
    expect(consumo).toHaveTextContent('US$ 0.05 reservados, ainda sem consumo confirmado');
    expect(consumo).toHaveTextContent('Estimativa por tokens');
    expect(consumo).not.toBeVisible();
    const opcoes = screen.getByText('Opções').closest('details');
    fireEvent.click(screen.getByText('Opções'));
    fireEvent.click(screen.getByText('Consumo IA'));
    expect(consumo).toBeVisible();
    expect(screen.getAllByTestId('consumo-ia')).toHaveLength(1);
    expect(screen.queryByText('Custos por área')).not.toBeInTheDocument();
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getAllByText(/Sem conexão. Seus textos/)).toHaveLength(1);
    fireEvent.click(screen.getByText('Opções'));
    expect(opcoes).not.toHaveAttribute('open');
    expect(screen.getByText(/Sem conexão. Seus textos/)).toBeVisible();
  } finally {
    if (onlineOriginal) Object.defineProperty(navigator, 'onLine', onlineOriginal);
    else delete navigator.onLine;
  }
});
