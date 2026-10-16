import { criarCompanyAutomationMock } from '../companyAutomationMock';
beforeAll(() => { global.structuredClone ??= value => JSON.parse(JSON.stringify(value)); });

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
