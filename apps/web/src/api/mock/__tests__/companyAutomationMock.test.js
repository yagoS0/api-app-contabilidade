import { criarCompanyAutomationMock, aplicabilidadeRotinasMock } from '../companyAutomationMock';
beforeAll(() => { global.structuredClone ??= value => JSON.parse(JSON.stringify(value)); });

test('pausa automática é independente por empresa e não substitui pausa SERPRO', async () => {
  const api = criarCompanyAutomationMock([{ companyId: 'auto-a' }, { companyId: 'auto-b' }]);
  const before = await api.getCompanyAutomation('auto-a');
  const input = { expectedRevision: before.revision, requestId: 'auto-pause', automationPolicy: { paused: true, reason: 'Conferir ciclo' } };
  const saved = await api.saveCompanyAutomation('auto-a', input);
  expect(saved.automationPolicy).toMatchObject({ paused: true, version: 1, updatedBy: 'mock-user' });
  expect(saved.serproPolicy).toEqual(before.serproPolicy); expect(saved.rotinas).toEqual(before.rotinas);
  expect(saved.lembretes).toEqual(before.lembretes);
  expect((await api.getCompanyAutomation('auto-b')).automationPolicy.paused).toBe(false);
  expect(await api.saveCompanyAutomation('auto-a', input)).toEqual(saved);
});

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

import { mockLerPausaCicloFiscal, mockSalvarPausaCicloFiscal } from '../rotinasMock';
test('replay não devolve pausa global antiga nem altera escolhas salvas', async () => {
 const api=criarCompanyAutomationMock([{companyId:'replay-global'}]);
 const initial=await api.getCompanyAutomation('replay-global');
 const input={expectedRevision:initial.revision,requestId:'replay-global-id',automationPolicy:{paused:true,reason:'Conferir empresa'}};
 const saved=await api.saveCompanyAutomation('replay-global',input);
 expect(await api.saveCompanyAutomation('replay-global',input)).toEqual(saved);
 const before=mockLerPausaCicloFiscal().policy;
 try {
  mockSalvarPausaCicloFiscal({paused:!before.paused,version:before.version,reason:'Pausa geral posterior'});
  await expect(api.saveCompanyAutomation('replay-global',input)).rejects.toMatchObject({status:409});
  const current=await api.getCompanyAutomation('replay-global');
  expect(current.globalAutomationPolicy.paused).toBe(!before.paused);
  expect(current.automationPolicy).toEqual(saved.automationPolicy);
  expect(current.rotinas).toEqual(saved.rotinas);expect(current.lembretes).toEqual(saved.lembretes);
  expect(saved.globalAutomationPolicy).toEqual(before);
 } finally {
  const current=mockLerPausaCicloFiscal().policy;
  mockSalvarPausaCicloFiscal({paused:before.paused,version:current.version,reason:'Restaurar cenário'});
 }
});
test('mock de envio é independente, inicia desligado e não dispara ao consultar',async()=>{
 const id='envio-guias-mock-novo';const api=criarCompanyAutomationMock([{companyId:id,razao:'Teste',regimeTributario:'SIMPLES'}]);
 const first=await api.getCompanyAutomation(id);expect(first.envioGuias.enabled).toBe(false);
 const saved=await api.saveCompanyAutomation(id,{expectedRevision:first.revision,requestId:'envio-mock-request',envioGuias:{enabled:true}});
 expect(saved.envioGuias.enabled).toBe(true);expect(saved.lembretes.enabled).toBe(false);
 const delivery=await api.getCompanyGuideDelivery(id,'2026-10');expect(delivery.status).toBe('DISABLED');expect(delivery.items).toEqual([]);
 expect(delivery.warnings[0].message).toContain('nenhum envio real');
});

test('acompanhamento mock mantém desligado, isolamento, revisão e leitura sem provas inventadas', async () => {
 const api=criarCompanyAutomationMock([{companyId:'track-a'},{companyId:'track-b'}]);
 const before=await api.getCompanyAutomation('track-a');expect(before.acompanhamentoGuias.enabled).toBe(false);
 const input={expectedRevision:before.revision,requestId:'tracking-mock',acompanhamentoGuias:{enabled:true,politica:'D2_D0_D2_V1',limiteConsultas:1}};
 const saved=await api.saveCompanyAutomation('track-a',input);expect(saved.lembretes).toEqual(before.lembretes);expect(saved.rotinas).toEqual(before.rotinas);
 expect(saved.revision).not.toBe(before.revision);expect(await api.saveCompanyAutomation('track-a',input)).toEqual(saved);
 expect((await api.getCompanyGuideTracking('track-a','2026-10')).items).toEqual([]);expect((await api.getCompanyGuideTracking('track-b','2026-10')).enabled).toBe(false);
 await expect(api.saveCompanyAutomation('track-a',{...input,expectedRevision:saved.revision,requestId:'tracking-invalid',acompanhamentoGuias:{...input.acompanhamentoGuias,limiteConsultas:2}})).rejects.toMatchObject({status:422});
});
