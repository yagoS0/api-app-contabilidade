import { runGuideWhatsappReminderTick } from '../guideWhatsappReminderWorker.js';
test('avisos rodam diariamente no horário salvo, sem converter consulta fiscal mensal em diária', async () => {
  const salvo = { enabled: true, frequency: 'MONTHLY', day: 10, hour: 8 };
  const settings = jest.fn(async () => ({ enabled: false, rotinas: { pagamento: salvo } }));
  const solicitar = jest.fn(async () => ({ total: 1 }));
  const schedule = jest.fn(async (_, config, run) => run({ scheduledAt: '2026-10-15T11:00:00Z', assertActive: jest.fn() }));
  await runGuideWhatsappReminderTick({ ligado: true, settings, solicitar, schedule });
  expect(schedule).toHaveBeenCalledWith('avisos_guias_whatsapp', { enabled: true, frequency: 'DAILY', hour: 8 }, expect.any(Function), expect.any(Object));
  expect(salvo.frequency).toBe('MONTHLY'); expect(solicitar).toHaveBeenCalledTimes(1);
});
test('rotina desabilitada e agenda revogada não disparam', async () => {
  const schedule = jest.fn(); const settings = jest.fn(async () => ({ rotinas: { pagamento: { enabled: false } } }));
  await runGuideWhatsappReminderTick({ ligado: true, settings, schedule }); expect(schedule).not.toHaveBeenCalled();
  settings.mockResolvedValueOnce({ rotinas: { pagamento: { enabled: true, hour: 8 } } });
  schedule.mockImplementation(async (_, __, run) => run({ assertActive: jest.fn() }));
  const solicitar = jest.fn();
  await expect(runGuideWhatsappReminderTick({ ligado: true, settings, schedule, solicitar })).rejects.toMatchObject({ code: 'AGENDA_ALTERADA' });
  expect(solicitar).not.toHaveBeenCalled();
});
