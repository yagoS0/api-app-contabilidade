jest.mock('../../infrastructure/db/prisma.js',()=>({prisma:{appSetting:{findFirst:jest.fn(),findUnique:jest.fn()}}}));
import {prisma} from '../../infrastructure/db/prisma.js';
import {getRoutineExecutionStatus} from '../scheduledRoutineService.js';
test('expõe aviso diário e sua pendência sem depender de SERPRO ativo',async()=>{
 const before=process.env.INTEGRACAO_WHATSAPP;process.env.INTEGRACAO_WHATSAPP='1';
 try{prisma.appSetting.findFirst.mockImplementation(async({where})=>where.key.startsWith.includes('avisos_guias_whatsapp')?{value:{status:'FAILED',scheduledAt:'2026-10-14T11:00:00Z',result:{avisosPendentes:1,results:[{razao:'Empresa',mensagem:'Guia sem entrega confirmada'}]}}}:null);
 prisma.appSetting.findUnique.mockResolvedValue({value:{observedAt:'2026-10-14T12:00:00Z'}});
 const rows=await getRoutineExecutionStatus({enabled:false,rotinas:{pagamento:{enabled:true,frequency:'MONTHLY',hour:8,day:20}}},new Date('2026-10-14T12:01:00Z'));
 expect(rows.find(r=>r.routine==='avisos_guias_whatsapp')).toMatchObject({label:'Lembretes de guias no WhatsApp',enabled:true,alive:true,lastRun:{status:'FAILED',result:{avisosPendentes:1}}});
 expect(prisma.appSetting.findUnique).toHaveBeenCalledWith({where:{key:'fiscal_worker:GUIAS_WHATSAPP_AVISOS'}});
 }finally{if(before===undefined)delete process.env.INTEGRACAO_WHATSAPP;else process.env.INTEGRACAO_WHATSAPP=before;}
});
