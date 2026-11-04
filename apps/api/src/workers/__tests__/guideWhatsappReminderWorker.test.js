import { solicitarPagamentosWhatsapp } from '../../application/guides/SolicitarPagamentosWhatsappService.js';
import { runGuideWhatsappReminderTick } from '../guideWhatsappReminderWorker.js';
test('avisos rodam diariamente no horário salvo, sem converter consulta fiscal mensal em diária', async () => {
  const salvo = { enabled: true, frequency: 'MONTHLY', day: 10, hour: 8 };
  const settings = jest.fn(async () => ({ enabled: false, rotinas: { pagamento: salvo, avisos_guias_whatsapp: {enabled:true,hour:8,frequency:"DAILY"} } }));
  const solicitar = jest.fn(async () => ({ total: 1 }));
  const schedule = jest.fn(async (_, config, run) => run({ scheduledAt: '2026-10-15T11:00:00Z', assertActive: jest.fn() }));
  const agora = new Date('2026-10-15T11:00:00Z');
  await runGuideWhatsappReminderTick({ ligado: true, settings, solicitar, schedule, agora });
  expect(schedule).toHaveBeenCalledWith('avisos_guias_whatsapp', { enabled: true, frequency: 'DAILY', hour: 8 }, expect.any(Function), expect.any(Object));
  expect(schedule).toHaveBeenCalledTimes(2);
  expect(schedule).toHaveBeenNthCalledWith(2, 'avisos_guias_relativos_v1', { enabled: true, frequency: 'DAILY', hour: 8 }, expect.any(Function), { now: agora });
  expect(salvo.frequency).toBe('MONTHLY'); expect(solicitar).toHaveBeenCalledTimes(2);
  for (const [index, executionMode] of ['LEGADO', 'RELATIVO_V1'].entries()) expect(solicitar).toHaveBeenNthCalledWith(index + 1, { scheduledAt: '2026-10-15T11:00:00Z', assertActive: expect.any(Function), agora, executionMode });
});
test('rotina desabilitada e agenda revogada não disparam', async () => {
  const schedule = jest.fn(); const settings = jest.fn(async () => ({ rotinas: { avisos_guias_whatsapp: { enabled: false } } }));
  await runGuideWhatsappReminderTick({ ligado: true, settings, schedule }); expect(schedule).not.toHaveBeenCalled();
  settings.mockResolvedValueOnce({ rotinas: { avisos_guias_whatsapp: { enabled: true, hour: 8 } } });
  schedule.mockImplementation(async (_, __, run) => run({ assertActive: jest.fn() }));
  const solicitar = jest.fn();
  await expect(runGuideWhatsappReminderTick({ ligado: true, settings, schedule, solicitar })).rejects.toMatchObject({ code: 'EVENT_TICK_FAILED', errors: [expect.objectContaining({ code: 'AGENDA_ALTERADA' }), expect.objectContaining({ code: 'AGENDA_ALTERADA' })], resultados: [{ executionMode: 'LEGADO', failed: true, code: 'AGENDA_ALTERADA' }, { executionMode: 'RELATIVO_V1', failed: true, code: 'AGENDA_ALTERADA' }] });
  expect(solicitar).not.toHaveBeenCalled();
});

test('agenda global OFF impede varredura mesmo com empresas selecionadas', async () => {
 const solicitar=jest.fn(),schedule=jest.fn();
 await runGuideWhatsappReminderTick({ligado:true,settings:async()=>({rotinas:{pagamento:{enabled:true},avisos_guias_whatsapp:{enabled:false,hour:8}}}),solicitar,schedule});
 expect(solicitar).not.toHaveBeenCalled();expect(schedule).not.toHaveBeenCalled();
});

test('dois avaliadores encaminham cada documento apenas ao modo adotado da sua empresa', async () => {
 const agora=new Date('2026-10-15T11:00:00Z');
 const guias=[{id:'guia-legado',portalClientId:'empresa-legado'},{id:'guia-relativo',portalClientId:'empresa-relativo'}];
 const db={feriado:{findMany:jest.fn(async()=>[])},guide:{findMany:jest.fn(async()=>guias)},appSetting:{findUnique:jest.fn(async({where:{key}})=>{
  if(key==='agenda_eventos_modo:v1:empresa-relativo')return {value:{schemaVersion:1,version:1,executionMode:'RELATIVO_V1',updatedBy:'contador',updatedAt:'2026-10-01T12:00:00Z'}};
  if(key.startsWith('acompanhamento_guias_config:'))return {value:{enabled:true,politica:'D2_D0_D2_V1',limiteConsultas:1}};
  return null;
 })}};
 const acompanhar=jest.fn(async()=>({status:'IGNORADO_NO_TESTE'})),avisar=jest.fn();
 const solicitar=input=>solicitarPagamentosWhatsapp(input,{db,idsAtivos:async()=>guias.map(g=>g.portalClientId),acompanhar,avisar});
 const schedule=jest.fn(async(_name,_config,run)=>run({scheduledAt:agora.toISOString(),assertActive:async()=>{}}));
 await runGuideWhatsappReminderTick({agora,ligado:true,settings:async()=>({rotinas:{avisos_guias_whatsapp:{enabled:true,hour:8}}}),schedule,solicitar});
 expect(acompanhar.mock.calls.map(([input])=>({guideId:input.guideId,executionMode:input.executionMode}))).toEqual([{guideId:'guia-legado',executionMode:'LEGADO'},{guideId:'guia-relativo',executionMode:'RELATIVO_V1'}]);
 expect(acompanhar).toHaveBeenCalledTimes(2);expect(avisar).not.toHaveBeenCalled();
});