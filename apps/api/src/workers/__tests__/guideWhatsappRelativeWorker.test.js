jest.mock('../../application/fiscal/automacaoCicloFiscalContext.js',()=>({conferirContextoCicloFiscal:jest.fn(async()=>{})}));
jest.mock('../../application/fiscal/serpro/SerproRuntimeSettings.js',()=>({getSerproRuntimeSettings:jest.fn()}));
jest.mock('../../application/guides/SolicitarPagamentosWhatsappService.js',()=>({solicitarPagamentosWhatsapp:jest.fn()}));
jest.mock('../scheduledRoutineService.js',()=>({runScheduledRoutine:jest.fn(),recordWorkerHeartbeat:jest.fn()}));
import {runGuideWhatsappReminderTick} from '../guideWhatsappReminderWorker.js';
const agora=new Date('2026-11-24T13:00:00Z');
test('OFF não reserva slots; relativo usa avaliador horário sem modificar agenda legada',async()=>{
 const schedule=jest.fn(async()=>null);
 await runGuideWhatsappReminderTick({ligado:true,agora,settings:async()=>({rotinas:{avisos_guias_whatsapp:{enabled:false,hour:8}}}),schedule});
 expect(schedule).not.toHaveBeenCalled();
 await runGuideWhatsappReminderTick({ligado:true,agora,settings:async()=>({rotinas:{avisos_guias_whatsapp:{enabled:true,hour:8}}}),schedule});
 expect(schedule.mock.calls.map(([name,cfg])=>[name,cfg.hour])).toEqual([['avisos_guias_whatsapp',8],['avisos_guias_relativos_v1',10]]);
});
test('erro legado não impede avaliador relativo e não é ocultado',async()=>{
 const schedule=jest.fn(async(name,_cfg,run)=>{if(name==='avisos_guias_whatsapp')throw Error('legacy failure');return run({scheduledAt:agora.toISOString(),assertActive:async()=>{}});});
 const solicitar=jest.fn(async()=>({total:0}));
 await expect(runGuideWhatsappReminderTick({ligado:true,agora,settings:async()=>({rotinas:{avisos_guias_whatsapp:{enabled:true,hour:8}}}),schedule,solicitar})).rejects.toMatchObject({code:'EVENT_TICK_FAILED'});
 expect(solicitar).toHaveBeenCalledTimes(1);expect(solicitar.mock.calls[0][0].executionMode).toBe('RELATIVO_V1');
});
