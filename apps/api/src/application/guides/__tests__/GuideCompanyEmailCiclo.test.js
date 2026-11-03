jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../../infrastructure/mail/EmailService.js', () => ({ EmailService: jest.fn() }));
jest.mock('../GuideService.js', () => ({ getGuidePdfBuffer: jest.fn() }));
jest.mock('../GuideScheduledEmailService.js', () => ({ validarDestinatariosAtuais: jest.fn(), resolveCompanyNotificationEmails: jest.fn() }));
jest.mock('../EnvioGuiaService.js', () => ({ registrarEnvio: jest.fn(), marcarEnviando: jest.fn(), marcarEnviado: jest.fn(), marcarFalhou: jest.fn(), marcarIndeterminado: jest.fn() }));
import { enviarGuiasExatasDoCiclo } from '../GuideCompanyEmailService.js';
import { registrarEnvio, marcarEnviando, marcarEnviado, marcarFalhou, marcarIndeterminado } from '../EnvioGuiaService.js';
function fixture() {
 const guide={id:'g',portalClientId:'a',tipo:'SIMPLES',competencia:'2026-10',status:'PROCESSED',valor:100,updatedAt:new Date('2026-11-10'),pdfBytes:Buffer.from('%PDF-test')};
 const db={guide:{updateMany:jest.fn(async()=>({count:1})),findUnique:jest.fn(async()=>guide)},envioGuia:{findFirst:jest.fn(async()=>null)}};db.$transaction=fn=>fn(db);
 registrarEnvio.mockImplementation(async ({destino})=>({envio:{id:destino}}));marcarEnviando.mockImplementation(async id=>({reservado:true,tentativaId:'attempt:'+id}));
 const validateTo=jest.fn(), beforeDispatch=jest.fn(), pdf=jest.fn(async()=>guide.pdfBytes), email={send:jest.fn(async input=>{await input.beforeDispatch();return {id:'fake-message'};})};
 const run=()=>enviarGuiasExatasDoCiclo({portalClientId:'a',guides:[guide],destinos:['a@example.test','b@example.test'],beforeDispatch},{db,email,pdf,validateTo});
 return {db,guide,email,pdf,validateTo,beforeDispatch,run};
}
beforeEach(()=>jest.clearAllMocks());
test('transporta somente PDFs e destinos exatos depois de reservar, autenticar e conferir',async()=>{
 const f=fixture();const result=await f.run();expect(result.status).toBe('sent');
 expect(registrarEnvio).toHaveBeenCalledTimes(2);expect(marcarEnviando).toHaveBeenCalledTimes(2);
 expect(f.email.send.mock.calls[0][0]).toMatchObject({to:'a@example.test, b@example.test',attachments:[{filename:expect.stringContaining('.pdf'),content:f.guide.pdfBytes}]});
 expect(f.beforeDispatch.mock.calls.map(c=>c[0].stage)).toEqual(['prepare','dispatch']);expect(f.validateTo).toHaveBeenCalledWith('a','a@example.test, b@example.test');
 expect(marcarEnviado).toHaveBeenCalledTimes(2);expect(marcarIndeterminado).not.toHaveBeenCalled();
});
test('aceite SMTP parcial distingue sucesso, recusa e não promove a guia inteira',async()=>{
 const f=fixture();f.email.send.mockImplementation(async input=>{await input.beforeDispatch();return {accepted:['a@example.test'],rejected:['b@example.test'],messageId:'fake-smtp'};});
 const result=await f.run();expect(result.status).toBe('partial');expect(result.outcomes.map(o=>o.status)).toEqual(['SENT','REVIEW']);
 expect(marcarEnviado).toHaveBeenCalledTimes(1);expect(marcarFalhou).toHaveBeenCalledTimes(1);
 expect(f.db.guide.updateMany.mock.calls.at(-1)[0].data.emailStatus).toBe('ERROR');
});
test('resolved sem aceite é incerto para cada destinatário',async()=>{
 const f=fixture();f.email.send.mockImplementation(async input=>{await input.beforeDispatch();return {pending:['a@example.test','b@example.test']};});
 const result=await f.run();expect(result.outcomes.every(o=>o.status==='UNCERTAIN')).toBe(true);expect(marcarEnviado).not.toHaveBeenCalled();expect(marcarIndeterminado).toHaveBeenCalledTimes(2);
});
test('nova pausa no preparo impede efeito e registra falha recuperável só manualmente',async()=>{
 const f=fixture();f.beforeDispatch.mockImplementation(async ({stage})=>{if(stage==='dispatch')throw new Error('paused');});
 await expect(f.run()).rejects.toMatchObject({dispatched:false});expect(marcarFalhou).toHaveBeenCalledTimes(2);expect(marcarEnviado).not.toHaveBeenCalled();
});
test('timeout após limite do transporte conserva incerteza',async()=>{
 const f=fixture();f.email.send.mockImplementation(async input=>{await input.beforeDispatch();throw new Error('timeout');});
 await expect(f.run()).rejects.toMatchObject({dispatched:true});expect(marcarIndeterminado).toHaveBeenCalledTimes(2);expect(marcarEnviado).not.toHaveBeenCalled();
});
test('corrida manual perdida na reserva impede materialização e transporte',async()=>{
 const f=fixture();f.db.guide.updateMany.mockResolvedValueOnce({count:0});
 await expect(f.run()).rejects.toMatchObject({code:'GUIA_ALTERADA'});expect(f.pdf).not.toHaveBeenCalled();expect(f.email.send).not.toHaveBeenCalled();expect(registrarEnvio).not.toHaveBeenCalled();
});
test('tentativa anterior impede reenvio automático mesmo se falhou',async()=>{
 const f=fixture();f.db.envioGuia.findFirst.mockImplementation(async ({where})=>where.canal==='EMAIL'?{status:'falhou'}:null);
 await expect(f.run()).rejects.toThrow();expect(f.email.send).not.toHaveBeenCalled();expect(marcarEnviando).not.toHaveBeenCalled();
});
