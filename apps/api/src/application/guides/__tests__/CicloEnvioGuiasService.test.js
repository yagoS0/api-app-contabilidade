jest.mock('../../operacoes/OperationsManualInss.js', () => ({ lerInssManual: jest.fn() }));
import { lerInssManual } from '../../operacoes/OperationsManualInss.js';
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../fiscal/serpro/CompanyAutomationService.js', () => ({ lerAutomacaoEmpresa: jest.fn() }));
jest.mock('../guideCompliance.js', () => ({ computeGuideComplianceMap: jest.fn() }));
jest.mock('../../whatsapp/ContatoWhatsappService.js', () => ({ destinatariosDeEnvio: jest.fn() }));
jest.mock('../../whatsapp/EnvioGuiaWhatsappService.js', () => ({ carregarCanal: jest.fn(), enviarGuiaPorWhatsapp: jest.fn() }));
jest.mock('../GuideCompanyEmailService.js', () => ({ enviarGuiasExatasDoCiclo: jest.fn() }));
import { createCicloEnvioGuiasService } from '../CicloEnvioGuiasService.js';
import { lerAutomacaoEmpresa } from '../../fiscal/serpro/CompanyAutomationService.js';
import { comAutomacaoCicloFiscal, comAutomacaoEmpresa } from '../../fiscal/automacaoCicloFiscalContext.js';
const scheduledAt = '2026-11-13T11:00:00Z';
function fixture({ time = scheduledAt, complete = true, folha = false, history = true } = {}) {
 const settings = new Map([['operations_manual_inss:v1:a:2026-10', { fixture: true }],['envio_guias_config:a', { enabled: true, selectionToken: 'v1' }], ['serpro_runtime_settings', { rotinas: { simples_envio_guias: { enabled: true, frequency: 'DAILY', hour: 8 } } }]]);
 lerInssManual.mockImplementation(async()=>({applicabilitySource:'month',changedBy:'contador-ficticio',changedAt:time,applicable:!complete,status:complete?'NOT_APPLICABLE':'PENDING_DOCUMENT'}));
 const guides = [{ id: 'g', portalClientId: 'a', competencia: '2026-10', tipo: 'SIMPLES', status: 'PROCESSED', valor: '100', hash: 'hash', pdfBytes: Buffer.from('%PDF-sintetico'), vencimento: new Date('2026-11-20T00:00:00Z'), updatedAt: new Date(time), paymentStatus: 'PENDING', emailStatus: 'PENDING' }];
 const destinations = { emails: ['contador@example.test'], telefones: [] };
 const projection = { das: { required: true, ok: true }, inss: { required: !complete, ok: complete }, parcDas: { required: false, ok: true }, guiasParcelamentoMes: [] };
 const db = { portalClient: { findUnique: jest.fn(async () => ({ id: 'a', companyId: 'legacy', status: 'ATIVA', temFolha: folha, hasProlabore: false })) }, company: { findUnique: jest.fn(async () => ({ regimeTributario: 'SIMPLES' })) }, regimeHistorico: { findMany: jest.fn(async () => history ? [{ regime: 'SIMPLES', vigenciaInicio: '2020-01-01', vigenciaFim: null }] : []) }, feriado: { findMany: jest.fn(async () => []) }, guide: { findMany: jest.fn(async () => guides) }, envioGuia: { findMany: jest.fn(async () => []) }, appSetting: {
  findUnique: jest.fn(async ({where}) => settings.has(where.key) ? { key: where.key, value: structuredClone(settings.get(where.key)) } : null),
  upsert: jest.fn(async ({where,create}) => { if (!settings.has(where.key)) settings.set(where.key, structuredClone(create.value)); }),
  updateMany: jest.fn(async ({where}) => ({ count: JSON.stringify(settings.get(where.key)) === JSON.stringify(where.value.equals) ? 1 : 0 })),
  update: jest.fn(async ({where,data}) => { settings.set(where.key, structuredClone(data.value)); }),
 } };
 db.$transaction = async fn => fn(db);
 lerAutomacaoEmpresa.mockImplementation(async () => ({ automationPolicy: { paused: false }, globalAutomationPolicy: { paused: false } }));
 const email = jest.fn(async input => { await input.beforeDispatch(); return { status: 'sent', providerReference: 'fake-message' }; });
 const deps = { db, now: () => new Date(time), compliance: jest.fn(async () => new Map([['a', projection]])), contatos: async () => destinations, canal: async () => ({ disponivel: false }), email, whatsapp: jest.fn() };
 const service = createCicloEnvioGuiasService(deps);
 const execute = (input = {}) => comAutomacaoCicloFiscal({ version: 0, scheduledAt }, () => comAutomacaoEmpresa('a', () => service.executar({ portalClientId: 'a', competencia: '2026-10', scheduledAt, assertActive() {}, ...input }), db, { scheduledAt }), db);
 return { settings, guides, destinations, projection, db, deps, email, service, execute };
}
beforeEach(() => jest.clearAllMocks());
test('leitura não reserva, envia ou ativa e não expõe bytes, token ou credenciais', async () => {
 const f = fixture(); const dto = await f.service.ler({portalClientId:'a', competencia:'2026-10'});
 expect(dto.status).toBe('COMPLETE'); expect(dto.items).toHaveLength(1);
 expect(JSON.stringify(dto)).not.toMatch(/%PDF|selectionToken|v1/);
 expect(f.db.appSetting.upsert).not.toHaveBeenCalled(); expect(f.email).not.toHaveBeenCalled();
});
test('envio completo persiste identidade antes do transporte e próximo tick não repete', async () => {
 const f = fixture();
 f.email.mockImplementation(async input => {
  expect(f.settings.get('envio_guias_ciclo:a:2026-10').attempts[0]).toMatchObject({ status: 'STARTED', guideId:'g', channel:'EMAIL', destination:'contador@example.test', documentRevision:expect.any(String) });
  await input.beforeDispatch(); return { status:'sent', providerReference:'fake' };
 });
 await f.execute(); await f.execute();
 expect(f.email).toHaveBeenCalledTimes(1);
 expect(f.settings.get('envio_guias_ciclo:a:2026-10').attempts[0]).toMatchObject({ status:'SENT', proof:'fake' });
});
test('não executa sem contexto reservado', async () => {
 const f=fixture(); await expect(f.service.executar({portalClientId:'a',competencia:'2026-10',scheduledAt,assertActive(){}})).rejects.toMatchObject({code:'ENVIO_GUIAS_AGENDA_OBRIGATORIA'}); expect(f.email).not.toHaveBeenCalled();
});
test.each(['company','agenda','globalPause','companyPause'])('desligado ou pausa %s impede transporte', async scope => {
 const f=fixture();
 if(scope==='company') f.settings.set('envio_guias_config:a',{enabled:false});
 else if(scope==='agenda') f.settings.get('serpro_runtime_settings').rotinas.simples_envio_guias.enabled=false;
 else lerAutomacaoEmpresa.mockResolvedValue({automationPolicy:{paused:scope==='companyPause'},globalAutomationPolicy:{paused:scope==='globalPause'}});
 await f.execute(); expect(f.email).not.toHaveBeenCalled(); expect(f.db.appSetting.update).not.toHaveBeenCalled();
});
test.each(['document','destination','selection','agenda','paid'])('mudança de %s durante preparo interrompe sem nova tentativa automática', async change => {
 const f=fixture(); let externalCalls=0;
 f.email.mockImplementation(async input => {
  if(change==='document') f.guides[0].hash='changed';
  if(change==='destination') f.destinations.emails=[];
  if(change==='selection') f.settings.set('envio_guias_config:a',{enabled:true,selectionToken:'changed'});
  if(change==='agenda') f.settings.get('serpro_runtime_settings').rotinas.simples_envio_guias.hour=9;
  if(change==='paid') f.guides[0].paymentStatus='PAID';
  await input.beforeDispatch(); externalCalls++; return {status:'sent'};
 });
 await f.execute(); await f.execute(); expect(externalCalls).toBe(0); expect(f.email).toHaveBeenCalledTimes(1);
 expect(f.settings.get('envio_guias_ciclo:a:2026-10').attempts[0].status).toBe('REVIEW');
});
test('resultado incerto conserva prova e reinício não repete', async()=>{
 const f=fixture(); f.email.mockRejectedValue(Object.assign(new Error('timeout'),{dispatched:true}));
 await f.execute(); await createCicloEnvioGuiasService(f.deps).ler({portalClientId:'a',competencia:'2026-10'}); await f.execute();
 expect(f.email).toHaveBeenCalledTimes(1); expect(f.settings.get('envio_guias_ciclo:a:2026-10').attempts[0].status).toBe('UNCERTAIN');
});
test('parcial só no prazo; complemento envia apenas documento novo e resolve aviso quando cobertura chega', async()=>{
 const f=fixture({complete:false}); await f.execute(); expect(f.email).toHaveBeenCalledTimes(1);
 f.guides.push({...f.guides[0],id:'inss',tipo:'INSS'}); f.projection.inss.ok=true; lerInssManual.mockResolvedValue({applicabilitySource:'month',changedBy:'contador-ficticio',changedAt:scheduledAt,applicable:true,status:'DOCUMENT_AVAILABLE'});
 await f.execute(); expect(f.email).toHaveBeenCalledTimes(2); expect(f.email.mock.calls[1][0].guides.map(g=>g.id)).toEqual(['inss']);
 expect(f.settings.get('envio_guias_ciclo:a:2026-10').warnings.find(w=>w.code==='PARTIAL_DEADLINE').resolvedAt).toBeTruthy();
});
test('antes do corte só guia com vencimento antecipado é enviada, inclusive em complemento', async()=>{
 const f=fixture({complete:false,time:'2026-11-09T11:00:00Z'}); f.guides[0].vencimento=new Date('2026-11-11T00:00:00Z');
 f.guides.push({...f.guides[0],id:'inss',tipo:'INSS',vencimento:new Date('2026-11-20T00:00:00Z')});
 await f.execute(); await f.execute(); expect(f.email).toHaveBeenCalledTimes(1); expect(f.email.mock.calls[0][0].guides.map(g=>g.id)).toEqual(['g']);
});
test('folha sem matriz confirmada permanece revisão e libera apenas parcial no prazo', async()=>{
 const f=fixture({folha:true,time:'2026-11-08T11:00:00Z'}); await f.execute(); expect(f.email).not.toHaveBeenCalled();
 expect((await f.service.ler({portalClientId:'a',competencia:'2026-10'})).expectation.state).toBe('REVIEW');
});
test('cadastro atual sem história não presume cobertura e não autoriza competência antiga', async()=>{
 const f=fixture({history:false}); const dto=await f.service.ler({portalClientId:'a',competencia:'2026-10'}); expect(dto.expectation.state).toBe('REVIEW');
 await f.execute({competencia:'2026-09'}); expect(f.email).not.toHaveBeenCalled();
});
test('e-mail parcial conserva destinatário aceito e nunca repete recusado ou incerto', async()=>{
 const f=fixture(); f.destinations.emails.push('segundo@example.test'); f.email.mockImplementation(async input=>{await input.beforeDispatch();return {status:'partial',outcomes:[{destination:'contador@example.test',status:'SENT'},{destination:'segundo@example.test',status:'UNCERTAIN'}]};});
 await f.execute(); await f.execute(); expect(f.email).toHaveBeenCalledTimes(1);
 expect(f.settings.get('envio_guias_ciclo:a:2026-10').attempts.map(a=>a.status)).toEqual(['SENT','UNCERTAIN']);
});
test.each(['ERROR','SENDING','SENT'])('histórico legado %s nunca é promovido a nova tentativa', async status=>{
 const f=fixture(); f.guides[0].emailStatus=status; await f.execute(); expect(f.email).not.toHaveBeenCalled();
});
test('PDF inválido, revisão pendente e duas versões não são enviados',async()=>{
 const f=fixture(); f.guides[0].pdfBytes=Buffer.from('not pdf'); await f.execute(); expect(f.email).not.toHaveBeenCalled();
 f.guides[0].pdfBytes=Buffer.from('%PDF-ok'); f.guides[0].extracted={conferenciaDocumentoPendente:true}; await f.execute(); expect(f.email).not.toHaveBeenCalled();
 f.guides[0].extracted={}; f.guides.push({...f.guides[0],id:'other'}); await f.execute(); expect(f.email).not.toHaveBeenCalled();
});

test('canal incerto torna a guia revisão mesmo com outro canal enviado',async()=>{
 const f=fixture(); f.destinations.telefones=[{telefoneE164:'+5521999999999'}];
 f.settings.set('envio_guias_ciclo:a:2026-10',{revision:1,attempts:[{id:'a1',guideId:'g',channel:'EMAIL',destination:'contador@example.test',documentRevision:(await f.service.ler({portalClientId:'a',competencia:'2026-10'})).items[0].documentRevision,status:'SENT'},{id:'a2',guideId:'g',channel:'WHATSAPP',destination:'+5521999999999',documentRevision:(await f.service.ler({portalClientId:'a',competencia:'2026-10'})).items[0].documentRevision,status:'UNCERTAIN'}],warnings:[]});
 const dto=await f.service.ler({portalClientId:'a',competencia:'2026-10'});
 expect(dto.items[0].state).toBe('REVIEW'); expect(dto.items[0].channels.map(c=>c.state)).toEqual(['SENT','UNCERTAIN']);
});

test('pró-labore desligado hoje não prova dispensa histórica; sem conferência mensal nunca declara completo',async()=>{
 const f=fixture({time:'2026-11-08T11:00:00Z'});f.settings.delete('operations_manual_inss:v1:a:2026-10');
 await f.execute();expect(f.email).not.toHaveBeenCalled();
 const dto=await f.service.ler({portalClientId:'a',competencia:'2026-10'});expect(dto.expectation.state).toBe('REVIEW');expect(dto.status).toBe('REVIEW');
});

test.each(['falhou','indeterminado','enviando'])('estado tardio %s do provedor prevalece na tela sem apagar aceite nem repetir',async status=>{
 const f=fixture();await f.execute();
 const before=structuredClone(f.settings.get('envio_guias_ciclo:a:2026-10').attempts);
 f.db.envioGuia.findMany.mockResolvedValue([{guideId:'g',canal:'EMAIL',destino:'contador@example.test',status,erroMensagemUsuario:'Confira o resultado do provedor.'}]);
 const dto=await f.service.ler({portalClientId:'a',competencia:'2026-10'});
 expect(dto.status).toBe('REVIEW');expect(dto.items[0].channels[0].state).toBe(status==='indeterminado'?'UNCERTAIN':status==='enviando'?'STARTED':'REVIEW');
 expect(dto.items[0].channels[0].reason).toBe('Confira o resultado do provedor.');
 expect(dto.items[0].state).toBe(status==='enviando'?'STARTED':'REVIEW');
 await f.execute();expect(f.email).toHaveBeenCalledTimes(1);expect(f.settings.get('envio_guias_ciclo:a:2026-10').attempts).toEqual(before);
});

test('ausência mensal confirmada resolve obrigação sem fabricar PDF ou bloquear envio completo legítimo',async()=>{
 const f=fixture({complete:false,time:'2026-11-08T11:00:00Z'});
 lerInssManual.mockResolvedValue({applicabilitySource:'month',changedBy:'contador-ficticio',changedAt:scheduledAt,applicable:true,status:'DOCUMENT_ABSENT'});
 const dto=await f.service.ler({portalClientId:'a',competencia:'2026-10'});
 expect(dto.expectation).toMatchObject({state:'KNOWN',requiredCount:2,resolvedCount:2,availableCount:1,absenceConfirmedCount:1,missing:[]});
 expect(dto.decision.kind).toBe('COMPLETE');expect(dto.items.map(g=>g.guideId)).toEqual(['g']);
 await f.execute();expect(f.email).toHaveBeenCalledTimes(1);expect(f.email.mock.calls[0][0].guides.map(g=>g.id)).toEqual(['g']);
});
test('dispensa de INSS não vira documento nem obrigação adicional',async()=>{
 const f=fixture();const dto=await f.service.ler({portalClientId:'a',competencia:'2026-10'});
 expect(dto.expectation).toMatchObject({requiredCount:1,resolvedCount:1,availableCount:1,absenceConfirmedCount:0});
});


test.each(['emailStatus', 'destinoNulo', 'outroDestino', 'mesmoDestinoSemRevisao', 'entregaExterna'])('histórico %s não comprova envio da revisão ao destinatário atual nem libera repetição', async kind => {
 const f=fixture(); const ledger=[];
 if(kind==='emailStatus') f.guides[0].emailStatus='SENT';
 else ledger.push({id:'recibo-legado',guideId:'g',canal:kind==='entregaExterna'?'EXTERNO':'EMAIL',destino:kind==='destinoNulo'?null:kind==='mesmoDestinoSemRevisao'?'contador@example.test':'antigo@example.test',status:'enviado'});
 f.db.envioGuia.findMany.mockResolvedValue(ledger);
 const originalLedger=structuredClone(ledger), originalGuide={...f.guides[0]};
 const dto=await f.service.ler({portalClientId:'a',competencia:'2026-10'});
 expect(dto.items[0].channels[0]).toMatchObject({destinationLabel:'contador@example.test',state:'REVIEW'});
 expect(dto.items[0].channels[0].reason).toMatch(/histórico|Histórico/);
 await f.execute(); await f.execute();
 expect(f.email).not.toHaveBeenCalled(); expect(f.deps.whatsapp).not.toHaveBeenCalled();
 expect(ledger).toEqual(originalLedger); expect(f.guides[0]).toEqual(originalGuide);
 expect(f.settings.get('envio_guias_ciclo:a:2026-10').attempts).toEqual([]);
});

test.each(['atual','destinoAlterado','revisaoAlterada'])('prova persistida %s distingue envio vigente de histórico sem reenviar', async kind => {
 const f=fixture();
 const revision=(await f.service.ler({portalClientId:'a',competencia:'2026-10'})).items[0].documentRevision;
 const persisted={revision:1,attempts:[{id:'tentativa-comprovada',guideId:'g',channel:'EMAIL',destination:'contador@example.test',documentRevision:revision,status:'SENT',proof:'provider-ficticio'}],warnings:[]};
 f.settings.set('envio_guias_ciclo:a:2026-10',structuredClone(persisted));
 if(kind==='destinoAlterado') f.destinations.emails=['novo@example.test'];
 if(kind==='revisaoAlterada') f.guides[0].hash='documento-revisado';
 const dto=await f.service.ler({portalClientId:'a',competencia:'2026-10'});
 expect(dto.items[0].channels[0]).toMatchObject({destinationLabel:f.destinations.emails[0],state:kind==='atual'?'SENT':'REVIEW'});
 await f.execute(); await f.execute();
 expect(f.email).not.toHaveBeenCalled(); expect(f.deps.whatsapp).not.toHaveBeenCalled();
 expect(f.settings.get('envio_guias_ciclo:a:2026-10').attempts).toEqual(persisted.attempts);
});


function prepararWhatsAppCobertura(f) {
 f.destinations.emails=[]; f.destinations.telefones=[{telefoneE164:'+5521999999999'}];
 f.deps.canal=async()=>({disponivel:true,id:'canal-ficticio'});
 const ledger=[];
 f.db.guide.findFirst=jest.fn(async()=>f.guides[0]);
 f.db.guide.findUnique=jest.fn(async()=>f.guides[0]);
 f.db.guide.updateMany=jest.fn(async()=>({count:1}));
 f.db.envioGuia.findFirst=jest.fn(async({where})=>ledger.find(e=>Object.entries(where).every(([k,v])=>e[k]===v))||null);
 f.db.envioGuia.create=jest.fn(async({data})=>{const e={id:'envio-ficticio',...data};ledger.push(e);return e;});
 f.db.envioGuia.updateMany=jest.fn(async({where,data})=>{const e=ledger.find(e=>Object.entries(where).every(([k,v])=>e[k]===v));if(!e)return {count:0};Object.assign(e,data);return {count:1};});
 f.db.envioGuiaTentativa={create:jest.fn(async({data})=>data)};
 const tx={...f.db};delete tx.$transaction;f.db.$transaction=async fn=>fn(tx);
 return ledger;
}
test.each(['EMAIL','WHATSAPP'].flatMap(channel=>['inss','unknown','parcelamento','unchanged'].map(change=>[channel,change])))('cobertura %s/%s é reconferida no transporte sem invalidar a própria reserva',async(channel,change)=>{
 const f=fixture({time:'2026-11-09T11:00:00Z'});
 if(channel==='WHATSAPP')prepararWhatsAppCobertura(f);
 let externalCalls=0; const errors=[];
 const dispatch=async input=>{
  expect(f.settings.get('envio_guias_ciclo:a:2026-10').attempts[0]).toMatchObject({status:'STARTED',guideId:'g',channel});
  if(change==='inss')lerInssManual.mockResolvedValue({applicabilitySource:'month',changedBy:'contador-ficticio',changedAt:'2026-11-09T11:00:01Z',applicable:true,status:'PENDING_DOCUMENT'});
  if(change==='unknown')f.settings.delete('operations_manual_inss:v1:a:2026-10');
  if(change==='parcelamento')f.projection.guiasParcelamentoMes=[{id:'parcela-faltante'}];
  try{await (channel==='EMAIL'?input.beforeDispatch():input.automacao.beforeDispatch());}catch(e){errors.push(e.code);throw e;}
  externalCalls++; return channel==='EMAIL'?{status:'sent',providerReference:'ficticio'}:{enviada:true,envioId:'envio-ficticio'};
 };
 if(channel==='EMAIL')f.email.mockImplementation(dispatch);else f.deps.whatsapp.mockImplementation(dispatch);
 const service=createCicloEnvioGuiasService(f.deps);
 const before=await service.ler({portalClientId:'a',competencia:'2026-10'});
 expect(before.decision.kind).toBe('COMPLETE');expect(before.expectation.missing).toEqual([]);
 const execute=()=>comAutomacaoCicloFiscal({version:0,scheduledAt},()=>comAutomacaoEmpresa('a',()=>service.executar({portalClientId:'a',competencia:'2026-10',scheduledAt,assertActive(){}}),f.db,{scheduledAt}),f.db);
 await execute();await execute();
 expect(channel==='EMAIL'?f.email:f.deps.whatsapp).toHaveBeenCalledTimes(1);
 expect(externalCalls).toBe(change==='unchanged'?1:0);
 expect(errors).toEqual(change==='unchanged'?[]:['ENVIO_GUIAS_COBERTURA_ALTERADA']);
 const attempts=f.settings.get('envio_guias_ciclo:a:2026-10').attempts;
 expect(attempts).toHaveLength(1);expect(attempts[0]).toMatchObject({guideId:'g',channel,status:change==='unchanged'?'SENT':channel==='EMAIL'?'REVIEW':'UNCERTAIN'});
 expect(f.guides[0]).toMatchObject({paymentStatus:'PENDING',hash:'hash',status:'PROCESSED'});
});
