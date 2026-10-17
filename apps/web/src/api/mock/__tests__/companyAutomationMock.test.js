import { criarCompanyAutomationMock, aplicabilidadeRotinasMock } from '../companyAutomationMock';
beforeAll(() => { global.structuredClone ??= value => JSON.parse(JSON.stringify(value)); });

test('regime da empresa legada é o mesmo da central e da configuração', async () => {
  const company = { companyId: 'legacy-regime', legacyCompany: { regimeTributario: 'LUCRO_PRESUMIDO' } };
  expect(aplicabilidadeRotinasMock(company)).toMatchObject({ regime: 'LUCRO_PRESUMIDO', unavailableReason: null });
  const data = await criarCompanyAutomationMock([company]).getCompanyAutomation(company.companyId);
  expect(data.rotinas.find(r => r.key === 'presumido')).toMatchObject({ applicable: true, enabled: true });
  expect(data.rotinas.find(r => r.key === 'das')).toMatchObject({ applicable: false, enabled: false });
  expect(aplicabilidadeRotinasMock({}).regime).toBeNull();
});

test('salva pausa sem alterar rotinas e repete resultado por requestId', async () => {
  const api = criarCompanyAutomationMock([{ companyId: 'policy-test', razao: 'Demonstração' }]);
  const before = await api.getCompanyAutomation('policy-test');
  const input = { expectedRevision: before.revision, requestId: 'pause-id', serproPolicy: { paused: true, reason: 'Conferência' } };
  const saved = await api.saveCompanyAutomation('policy-test', input);
  expect(saved.rotinas).toEqual(before.rotinas);
  expect(saved.serproPolicy.paused).toBe(true);
  expect(await api.saveCompanyAutomation('policy-test', input)).toEqual(saved);
  await expect(api.saveCompanyAutomation('policy-test', { ...input, requestId: 'stale-id' })).rejects.toMatchObject({ status: 409 });
});
