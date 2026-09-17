import { act, fireEvent, render, screen } from '@testing-library/react';
import { LinhaHorarioAtual, useRelogioAgenda } from '../LinhaHorarioAtual';
import { ALTURA_HORA } from '../../lib/escalaAgenda';

function Relogio({ dias }) {
  const agora = useRelogioAgenda();
  return <LinhaHorarioAtual dias={dias} agora={agora} />;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-17T12:45:30Z'));
});
afterEach(() => { jest.useRealTimers(); });

test('marca 09:45 em São Paulo e avança no próximo minuto sem acumular timers', () => {
  const { unmount } = render(<Relogio dias={['2026-09-16', '2026-09-17']} />);
  expect(screen.getByRole('img', { name: 'Horário atual: 09:45' })).toHaveStyle({ top: `${9.75 * ALTURA_HORA}px` });
  act(() => jest.advanceTimersByTime(30000));
  expect(screen.getByRole('img', { name: 'Horário atual: 09:46' })).toBeInTheDocument();
  expect(jest.getTimerCount()).toBe(1);
  unmount();
  expect(jest.getTimerCount()).toBe(0);
});

test('retorno à janela atualiza hora e troca a coluna à meia-noite', () => {
  const { container } = render(<Relogio dias={['2026-09-17', '2026-09-18']} />);
  jest.setSystemTime(new Date('2026-09-18T03:00:00Z'));
  fireEvent(window, new Event('focus'));
  expect(screen.getByRole('img', { name: 'Horário atual: 00:00' })).toHaveStyle({ top: '0px' });
  expect(container.querySelector('.agenda-now-today')).toHaveStyle({ left: '50%', width: '50%' });
});

test('não mostra a linha quando o período não contém hoje', () => {
  render(<Relogio dias={['2026-09-18']} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
