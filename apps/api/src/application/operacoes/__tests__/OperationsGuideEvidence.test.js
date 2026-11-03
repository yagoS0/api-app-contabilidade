import { createOperationsGuideEvidence } from '../OperationsGuideEvidence.js';
jest.mock('../../guides/EnvioGuiaService.js',()=>({CANAL:{WHATSAPP:'WHATSAPP'},materializarEnvioDeEmailLegado:async()=>({materializou:false}),marcarEnviado:jest.fn(async()=>{}),marcarFalhou:jest.fn(async()=>{}),marcarIndeterminado:jest.fn(async()=>{})}));
jest.mock('../../whatsapp/ConversaWhatsappService.js',()=>({garantirConversa:async()=>({id:'conv'})}));
jest.mock('../../whatsapp/HistoricoArquivoWhatsappService.js',()=>({prepararHistoricoGuia:async()=>{},reconciliarTentativaGuia:async()=>{}}));
jest.mock('../../whatsapp/CanalWhatsappService.js',()=>({CANAL_PRINCIPAL:'main',identidadeWhatsappV2Ativa:()=>false}));
jest.mock('../../whatsapp/ContatoWhatsappService.js',()=>({destinatariosDeEnvio:jest.fn(),gravarWaIdDoContato:async()=>{}}));
jest.mock('../../whatsapp/PrepararGuiaPagamentoWhatsapp.js',()=>({TEMPLATE_GUIA_PAGAMENTO:'fake-only',prepararGuiaPagamentoWhatsapp:async({conferir})=>{await conferir();return {template:'fake-only',idioma:'pt_BR'};}}));
import { enviarGuiaPorWhatsapp, enviarParaTodosOsDestinatarios } from '../../whatsapp/EnvioGuiaWhatsappService.js';
jest.mock('nodemailer',()=>({__esModule:true,default:{createTransport:()=>{mockPrepareSmtp();return {sendMail:mockSmtp};}}}));
import { EmailService } from '../../../infrastructure/mail/EmailService.js';
const mockPrepareSmtp=jest.fn(),mockSmtp=jest.fn();

function fixture() {
  const records = new Map();
  const guide = { id: 'g', portalClientId: 'c', competencia: '2026-10', tipo: 'SIMPLES', status: 'PROCESSED', paymentStatus: 'OPEN', valor: 100, hash: 'original', pdfBytes: Buffer.from('%PDF-fixture'), vencimento: new Date('2026-11-20'), updatedAt:new Date('2026-11-03T12:00:00Z'),emailAttempts:0,extracted: { rawPayload: 'SECRET' } };
  const user = { id: 'u', status: 'active', role: 'contador', accountType: 'FIRM' }, link = { status: 'ACTIVE' };
  const destinations = { emails: ['allowed@example.test'], telefones: [{ id: 'contact', telefoneE164: '+5531999991111', vinculoNumeroId: 'v1' }] };
  const db = { user: { findUnique: jest.fn(async()=>user) }, companyFirmAccess: { findUnique: jest.fn(async()=>link) },
    guide: { findFirst: jest.fn(async({where})=>where.id===guide.id && where.portalClientId===guide.portalClientId && where.competencia===guide.competencia ? {...guide} : null), findMany: jest.fn(async()=>[guide]) },
    envioGuia: { findFirst: jest.fn(async()=>null), findMany: jest.fn(async()=>[]) }, envioGuiaTentativa: { findMany: jest.fn(async()=>[]) },
    appSetting: { findUnique: jest.fn(async({where})=>records.has(where.key)?{value:structuredClone(records.get(where.key))}:null), findMany: jest.fn(async({where})=>[...records].filter(([k,v])=>k.startsWith(where.key.startsWith)&&(where.AND||[]).every(c=>c.value.path.reduce((value,part)=>value?.[part],v)===c.value.equals)).map(([key,value])=>({key,value:structuredClone(value)}))),
      create: jest.fn(async({data})=>{if(records.has(data.key))throw Error('duplicate');records.set(data.key,structuredClone(data.value));return data;}),
      update: jest.fn(async({where,data})=>{records.set(where.key,structuredClone(data.value));return data;}) } };
  db.$transaction=async fn=>fn(db);
  db.guide.findUnique=jest.fn(async()=>({...guide}));db.guide.updateMany=jest.fn(async()=>({count:1}));
  db.guide.update=jest.fn(async({data})=>{Object.assign(guide,data,{updatedAt:new Date(guide.updatedAt.getTime()+1)});return {...guide};});
  const service=createOperationsGuideEvidence({db,recipients:async()=>destinations,now:()=>new Date('2026-11-03T12:00:00Z')});
  const input={userId:'u',companyId:'c',competencia:'2026-10',items:[{guideId:'g',reenviarConfirmado:true}],whatsappRequested:true};
  const reserveEmail=guard=>guard.reserveEmail({guide:{...guide},canal:'EMAIL',destino:destinations.emails.join(', ')},tx=>tx.guide.update({where:{id:guide.id},data:{emailStatus:'SENDING',emailAttempts:guide.emailAttempts+1}}));
  return {db,records,guide,user,link,destinations,service,input,reserveEmail};
}
test('preview is local, exact and WhatsApp resend preserves email; replay cannot reserve again', async()=>{
 const f=fixture(),p=await f.service.preview(f.input);
 expect(p.items[0].canais).toEqual(['WHATSAPP']);expect(p.refused).toEqual([]);
 const guard=await f.service.reserve({...f.input,token:p.token});
 await guard.beforeDispatch({guide:f.guide,canal:'WHATSAPP',destino:f.destinations.telefones[0].telefoneE164,pdfBytes:f.guide.pdfBytes});
 await expect(guard.beforeDispatch({guide:f.guide,canal:'EMAIL'})).rejects.toMatchObject({status:409});
 await expect(f.service.reserve({...f.input,token:p.token})).rejects.toMatchObject({status:409});
});
test.each(['document','bytes','recipient','payment','access','actor','claim','stale-object','stale-bytes'])('final guard rejects %s before fictitious transport',async kind=>{
 const f=fixture(),p=await f.service.preview(f.input),guard=await f.service.reserve({...f.input,token:p.token});
 let payload={...f.guide},pdfBytes=f.guide.pdfBytes;
 if(kind==='document')f.guide.valor=101;if(kind==='bytes')f.guide.pdfBytes=Buffer.from('%PDF-changed');
 if(kind==='recipient')f.destinations.telefones[0].vinculoNumeroId='new';if(kind==='payment')f.guide.paymentStatus='PAID';
 if(kind==='access')f.link.status='REMOVED';if(kind==='actor')f.user.status='disabled';
 if(kind==='claim')f.records.get(`operations_guide_preview:${p.token}`).claim='other';
 if(kind==='stale-object')payload.valor=99;if(kind==='stale-bytes')pdfBytes=Buffer.from('%PDF-stale');
 const transport=jest.fn();
 await expect((async()=>{await guard.beforeDispatch({guide:payload,canal:'WHATSAPP',pdfBytes});transport();})()).rejects.toBeDefined();
 expect(transport).not.toHaveBeenCalled();
});
test.each(['company','period','actor','selection','intent'])('reserve refuses divergent %s',async kind=>{
 const f=fixture(),p=await f.service.preview(f.input),input={...f.input,token:p.token};
 if(kind==='company')input.companyId='other';if(kind==='period')input.competencia='2026-09';if(kind==='actor')input.userId='another';
 if(kind==='selection')input.items=[];if(kind==='intent')input.whatsappRequested=false;
 await expect(f.service.reserve(input)).rejects.toMatchObject({status:409});
});
test('uncertain delivery and foreign guide are refused explicitly without token',async()=>{
 const f=fixture();f.db.envioGuia.findFirst.mockResolvedValue({status:'indeterminado'});
 const p=await f.service.preview({...f.input,items:[{guideId:'g'},{guideId:'foreign'}]});
 expect(p.token).toBeNull();expect(p.items).toEqual([]);expect(p.refused).toHaveLength(2);
});
test('DTO keeps actual payment unknown and sanitizes attempts; legacy revision remains unknown',async()=>{
 const f=fixture();f.guide.paymentStatus='PAID';f.guide.paymentStatusSource='MANUAL';
 f.db.envioGuiaTentativa.findMany.mockResolvedValue([{id:'t',status:'falhou',erroCodigo:'secret-code',erroMensagemUsuario:'SECRET',snapshot:null,envioGuia:{canal:'EMAIL',destino:'allowed@example.test'}}]);
 const dto=await f.service.read(f.input),item=dto.items[0];
 expect(item.pagamento).toMatchObject({valorPago:null,dataCivil:null,origem:'MANUAL'});expect(item.valor).toBe(100);
 expect(item.tentativas[0]).toMatchObject({revisaoCompativel:null,causa:expect.any(String)});expect(JSON.stringify(dto)).not.toMatch(/SECRET|secret-code|rawPayload/);
});
test('DTO uses persisted SERPRO receipt paid total and civil date, never nominal',async()=>{
 const f=fixture();Object.assign(f.guide,{paymentStatus:'PAID',paymentStatusSource:'SERPRO',serproLastCheckedAt:new Date('2026-11-03T12:00:00Z'),extracted:{comprovante:{confiavel:true,total:90,principal:80,juros:5,multa:5,dataArrecadacao:'02/11/2026'}}});
 expect((await f.service.read(f.input)).items[0].pagamento).toMatchObject({valorPago:90,dataCivil:'2026-11-02',registradoEm:'2026-11-03T12:00:00.000Z',proveniencia:'COMPROVANTE_SERPRO'});
});
test('DTO accepts identified parcela evidence and rejects foreign relation',async()=>{
 const f=fixture();Object.assign(f.guide,{paymentStatus:'PAID',paymentStatusSource:'SERPRO',parcela:{guiaId:'g',portalClientId:'c',pagamentoStatus:'CONFIRMADO',pagamentoEvidencia:{resultado:'CONFIRMADO',raw:'SECRET'},valorPago:95,pagamentoEm:new Date('2026-11-01'),pagamentoConsultadoEm:new Date('2026-11-03')}});
 expect((await f.service.read(f.input)).items[0].pagamento).toMatchObject({valorPago:95,dataCivil:'2026-11-01',proveniencia:'PARCELA_SERPRO'});
 f.guide.parcela.portalClientId='other';expect((await f.service.read(f.input)).items[0].pagamento.valorPago).toBeNull();
});

test('WhatsApp consumer checks loaded bytes before fake transport and rechecks after provider preparation',async()=>{
 for(const mutation of ['none','bytes','payment']){
  const f=fixture();f.guide.portalClient={razao:'SINTETICO'};
  const p=await f.service.preview(f.input),guard=await f.service.reserve({...f.input,token:p.token});
  const transport=jest.fn();
  const cliente={enviarGuia:async args=>{if(mutation==='payment')f.guide.paymentStatus='PAID';await args.antesDoTemplate();transport();return {wamid:'fake-only'};}};
  const result=await enviarGuiaPorWhatsapp({guide:{...f.guide},contato:{...f.destinations.telefones[0],nome:'Teste'},canal:{nomeMeta:'fake-only'},cliente,
    carregarPdf:async()=>mutation==='bytes'?Buffer.from('%PDF-stale'):f.guide.pdfBytes,operationsGuard:guard,
    automacao:{beforeDispatch:async()=>{},reservation:{envio:{id:'e'},reservado:true,tentativaId:'t'}}});
  if(mutation==='none'){expect(transport).toHaveBeenCalledTimes(1);expect(result.enviada).toBe(true);}
  else {expect(transport).not.toHaveBeenCalled();expect(result.ok).toBe(false);}
 }
});
test('all-recipient consumer propagates internal guard before reservation',async()=>{
 const guard={beforeDispatch:jest.fn(async()=>{throw Error('stop-before-reservation');})};
 await expect(enviarParaTodosOsDestinatarios({guide:fixture().guide,destinatarios:[{telefoneE164:'5531999991111'}],operationsGuard:guard})).rejects.toThrow('stop-before-reservation');
 expect(guard.beforeDispatch).toHaveBeenCalledWith(expect.objectContaining({canal:'WHATSAPP',destino:'5531999991111'}));
});

test('MANUAL persisted payment date is civil payment date, not registration time',async()=>{
 const f=fixture();Object.assign(f.guide,{paymentStatus:'PAID',paymentStatusSource:'MANUAL',paymentConfirmedAt:new Date('2026-10-22T00:00:00Z')});
 expect((await f.service.read(f.input)).items[0].pagamento).toMatchObject({dataCivil:'2026-10-22',registradoEm:null,valorPago:null});
});
test.each(['EMAIL','WHATSAPP'])('uncertainty after preview blocks reservation: %s',async channel=>{
 const f=fixture(),p=await f.service.preview(f.input);
 if(channel==='EMAIL')f.guide.emailStatus='SENDING';else f.db.envioGuia.findFirst.mockResolvedValue({status:'indeterminado'});
 await expect(f.service.reserve({...f.input,token:p.token})).rejects.toMatchObject({status:409});
 expect(f.records.get(`operations_guide_preview:${p.token}`).state).toBe('PREVIEW');
});
test('real SMTP callback checks current permission after transport preparation',async()=>{
 const f=fixture();f.input.whatsappRequested=false;const p=await f.service.preview(f.input),guard=await f.service.reserve({...f.input,token:p.token});
 await f.reserveEmail(guard);
 mockPrepareSmtp.mockImplementationOnce(()=>{f.link.status='REMOVED';});mockSmtp.mockClear();
 await expect(new EmailService().sendViaSmtp({to:'allowed@example.test',subject:'SINTETICO',html:'local',attachments:[],
  beforeDispatch:()=>guard.beginDispatch({guide:f.guide,canal:'EMAIL',destino:'allowed@example.test',pdfBytes:f.guide.pdfBytes})})).rejects.toMatchObject({status:403});
 expect(mockSmtp).not.toHaveBeenCalled();
 expect(f.records.get(`operations_guide_preview:${p.token}`).dispatches).toBeUndefined();
});
test('unfinished dispatch blocks another preexisting token and a fresh preview; success evidence closes only the own dispatch',async()=>{
 const f=fixture();f.input.whatsappRequested=false;
 const p1=await f.service.preview(f.input),p2=await f.service.preview(f.input);
 const first=await f.service.reserve({...f.input,token:p1.token}),second=await f.service.reserve({...f.input,token:p2.token});
 await f.reserveEmail(first);
 const args={guide:f.guide,canal:'EMAIL',destino:'allowed@example.test',pdfBytes:f.guide.pdfBytes};
 await first.beginDispatch(args);
 await expect(second.beginDispatch(args)).rejects.toMatchObject({status:409});
 expect((await f.service.preview(f.input)).token).toBeNull();
 await expect(first.completeDispatch({guideId:'g',receipt:{}})).rejects.toMatchObject({status:409});
 f.guide.emailStatus='ERROR';
 expect((await f.service.preview(f.input)).token).toBeNull();
 await first.completeDispatch({guideId:'g',receipt:{messageId:'fake',accepted:['allowed@example.test'],rejected:[]}});
 f.guide.emailStatus='SENT';
 expect(f.records.get(`operations_guide_preview:${p1.token}`).dispatches.g.EMAIL.status).toBe('ACEITO');
 expect((await f.service.preview(f.input)).token).toBeTruthy();
 await expect(first.beginDispatch(args)).rejects.toMatchObject({status:409});
});
test('provider accepted but persistence failed remains uncertain without erasing history',async()=>{
 const f=fixture();f.input.whatsappRequested=false;const p=await f.service.preview(f.input),guard=await f.service.reserve({...f.input,token:p.token});
 await f.reserveEmail(guard);
 await guard.beginDispatch({guide:f.guide,canal:'EMAIL',destino:'allowed@example.test',pdfBytes:f.guide.pdfBytes});
 f.db.appSetting.update.mockRejectedValueOnce(Error('synthetic database unavailable'));
 await expect(guard.completeDispatch({guideId:'g',receipt:{id:'synthetic-accepted'}})).rejects.toThrow('synthetic database unavailable');
 expect(f.records.get(`operations_guide_preview:${p.token}`).dispatches.g.EMAIL.status).toBe('INICIADO');
 f.guide.emailStatus='ERROR';
 expect((await f.service.preview(f.input)).token).toBeNull();
});

test.each(['SENDING','indeterminado'])('legacy uncertainty after token reserve is rejected before own email reservation: %s',async status=>{
 const f=fixture();f.input.whatsappRequested=false;const p=await f.service.preview(f.input),guard=await f.service.reserve({...f.input,token:p.token});
 if(status==='SENDING')f.guide.emailStatus=status;else f.db.envioGuia.findFirst.mockResolvedValue({status});
 await expect(f.reserveEmail(guard)).rejects.toBeDefined();
 expect(f.db.guide.update).not.toHaveBeenCalled();expect(f.records.get(`operations_guide_preview:${p.token}`).emailReservations).toBeUndefined();
});
test('own persisted SENDING is accepted; another owner changing its timestamp or attempts is not',async()=>{
 const f=fixture();f.input.whatsappRequested=false;const p=await f.service.preview(f.input),guard=await f.service.reserve({...f.input,token:p.token});
 const source=await f.reserveEmail(guard);
 await guard.beforeDispatch({guide:source,canal:'EMAIL',pdfBytes:source.pdfBytes});
 f.guide.emailAttempts++;
 await expect(guard.beginDispatch({guide:source,canal:'EMAIL',pdfBytes:source.pdfBytes})).rejects.toMatchObject({status:409});
});
