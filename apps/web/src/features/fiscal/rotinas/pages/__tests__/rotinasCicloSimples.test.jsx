import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RotinasPage } from '../renderRotinasPage';
import { mockCarregarRotinas, mockSalvarRotinas } from '../../../../../api/mock/rotinasMock';
beforeAll(() => { global.structuredClone ??= value => JSON.parse(JSON.stringify(value)); });
test('agenda nova inicia desligada; dias 1 a 8 fixos e horário matinal independente', async () => {
  const api = { getRotinas: async () => ({ rotinas: [{ key: 'simples_coleta_calculo', label: 'Coleta e cálculo do Simples' }], agenda: {}, empresas: [] }), saveRotinas: jest.fn(async body => body) };
  render(<MemoryRouter><RotinasPage api={api} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('tab', { name: 'Configuração' }));
  const enabled = await screen.findByLabelText('Ligar Coleta e cálculo do Simples');
  expect(enabled).not.toBeChecked(); expect(screen.getByText('Dias 1 a 8')).toBeVisible();
  expect(screen.queryByLabelText('Dia de Coleta e cálculo do Simples')).toBeNull();
  fireEvent.click(enabled);
  const hour = screen.getByLabelText('Horário de Coleta e cálculo do Simples');
  expect(hour).toHaveAttribute('max', '11:00');
  fireEvent.change(hour, { target: { value: '09:00' } });
  fireEvent.click(screen.getByText('Salvar horários'));
  await waitFor(() => expect(api.saveRotinas).toHaveBeenCalledWith({ agenda: { simples_coleta_calculo: { enabled: true, frequency: 'DAILY_UNTIL_DAY', day: 8, hour: 9 } } }));
});
test('mock mantém opt-in global e recusa horário fora da manhã sem gravar', () => {
  const before = mockCarregarRotinas([]).agenda.simples_coleta_calculo;
  expect(before).toMatchObject({ enabled: false, frequency: 'DAILY_UNTIL_DAY', day: 8, hour: 7 });
  expect(() => mockSalvarRotinas({ agenda: { simples_coleta_calculo: { ...before, hour: 12 } } })).toThrow();
  expect(mockCarregarRotinas([]).agenda.simples_coleta_calculo).toEqual(before);
});
