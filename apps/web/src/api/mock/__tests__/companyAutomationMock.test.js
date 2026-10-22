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

test('lembretes isolados por empresa não herdam pagamento nem modificam agenda e rotinas fiscais', async () => {
 const api=criarCompanyAutomationMock([{companyId:'rem-a'},{companyId:'rem-b'}]);
 const before=await api.getCompanyAutomation('rem-a');
 expect(before.lembretes.enabled).toBe(false);expect(before.lembretes.agenda.enabled).toBe(false);
 expect(before.rotinas.some(r=>r.key==='avisos_guias_whatsapp')).toBe(false);
 const input={expectedRevision:before.revision,requestId:'reminder-mock',lembretes:{enabled:true}};
 const saved=await api.saveCompanyAutomation('rem-a',input);
 expect(saved.lembretes.enabled).toBe(true);expect(saved.lembretes.agenda).toEqual(before.lembretes.agenda);
 expect(saved.rotinas).toEqual(before.rotinas);expect((await api.getCompanyAutomation('rem-b')).lembretes.enabled).toBe(false);
 expect(await api.saveCompanyAutomation('rem-a',input)).toEqual(saved);
 await expect(api.saveCompanyAutomation('rem-a',{...input,requestId:'reminder-stale'})).rejects.toMatchObject({status:409});
 await expect(api.saveCompanyAutomation('rem-a',{...input,expectedRevision:saved.revision,requestId:'reminder-invalid',lembretes:{enabled:true,hour:7}})).rejects.toMatchObject({status:422});
});
