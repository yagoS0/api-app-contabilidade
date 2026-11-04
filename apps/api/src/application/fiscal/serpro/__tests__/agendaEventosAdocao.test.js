const cloneSetting = value => JSON.parse(JSON.stringify(value));
jest.mock('../SerproRuntimeSettings.js', () => ({ ROTINA_KEYS: ['das', 'inss'] }));
jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../CompanyRotinasService.js', () => ({ ROTINA_LABELS: { das: 'DAS', inss: 'INSS' } }));
import { lerAutomacaoEmpresa, salvarAutomacaoEmpresa } from '../CompanyAutomationService.js';
import { lerAgendaEventosGlobal, salvarAgendaEventosGlobal } from '../AgendaEventosService.js';
function database() {
  let settings = new Map([['serpro_runtime_settings', { key: 'serpro_runtime_settings', value: { clientSecret: 'kept-secret', rotinas: { das: { enabled: false, day: 5, hour: 7 } } } }], ['ciclo_simples_config:a', { key: 'ciclo_simples_config:a', value: { enabled: false, fontes: ['NFSE'], selectionToken: '11111111-1111-4111-8111-111111111111' } }]]);
  const db = {
    user: { findUnique: jest.fn(async()=>({role:'contador',status:'active',accountType:'FIRM'})) },
    portalClient: { findUnique: jest.fn(async () => ({ id: 'a', companyId: 'legacy', razao: 'Empresa de teste' })) },
    company: { findUnique: jest.fn(async () => ({ regimeTributario: 'SIMPLES' })) },
    companyFirmAccess: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', role: 'ACCOUNTANT' })) },
    companyRotina: { findMany: jest.fn(async () => []), upsert: jest.fn() }, $queryRaw: jest.fn(),
    appSetting: {
      findUnique: jest.fn(async ({ where }) => cloneSetting(settings.get(where.key) || null)),
      create: jest.fn(async ({ data }) => { if (settings.has(data.key)) throw Object.assign(Error('duplicate'), { code: 'P2002' }); settings.set(data.key, cloneSetting(data)); }),
      updateMany: jest.fn(async ({ where, data }) => { const r = settings.get(where.key); if (!r || JSON.stringify(r.value) !== JSON.stringify(where.value.equals)) return { count: 0 }; settings.set(where.key, { key: where.key, value: cloneSetting(data.value) }); return { count: 1 }; }),
      upsert: jest.fn(async ({ create }) => settings.set(create.key, cloneSetting(create))),
    },
  };
  db.$transaction = jest.fn(async fn => { const snapshot = new Map([...settings].map(([key,value]) => [key,cloneSetting(value)])); try { return await fn(db); } catch (e) { settings = snapshot; throw e; } }); return db;
}

test('adoção explícita preserva flags, credenciais, pausa e replay',async()=>{
 const db=database(),before=await lerAutomacaoEmpresa(db,'a');
 expect(before.agendaEventos.executionMode).toBe('LEGADO');
 const input={expectedRevision:before.revision,requestId:'adocao-relativa-001',agendaEventos:{executionMode:'RELATIVO_V1'}};
 const result=await salvarAutomacaoEmpresa(db,'a','u',input);
 expect(result.agendaEventos.executionMode).toBe('RELATIVO_V1');expect(result.agendaEventos.capabilities.capture).toBe(false);
 expect(result.lembretes).toEqual(before.lembretes);expect(result.cicloSimples).toEqual(before.cicloSimples);
 expect(db.companyRotina.upsert).not.toHaveBeenCalled();expect(db.appSetting.upsert).not.toHaveBeenCalled();
 expect(await salvarAutomacaoEmpresa(db,'a','u',input)).toEqual(result);
 expect(await db.appSetting.findUnique({where:{key:'agenda_eventos_empresa:v1:a'}})).toBeNull();
 expect(JSON.stringify(result)).not.toContain('kept-secret');
});
test('modo inválido e ativação embutida são recusados antes da escrita',async()=>{
 const db=database(),before=await lerAutomacaoEmpresa(db,'a');
 for(const agendaEventos of [{executionMode:'AUTO'},{executionMode:'RELATIVO_V1',enabled:true}])
  await expect(salvarAutomacaoEmpresa(db,'a','u',{expectedRevision:before.revision,requestId:'adocao-invalida-01',agendaEventos})).rejects.toBeDefined();
 expect(db.appSetting.create).not.toHaveBeenCalled();
});
test('revisão antiga não reverte adoção; idempotência rejeita payload divergente',async()=>{
 const db=database(),before=await lerAutomacaoEmpresa(db,'a');
 const input={expectedRevision:before.revision,requestId:'adocao-versao-001',agendaEventos:{executionMode:'RELATIVO_V1'}};
 await salvarAutomacaoEmpresa(db,'a','u',input);
 await expect(salvarAutomacaoEmpresa(db,'a','u',{...input,agendaEventos:{executionMode:'LEGADO'}})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
 await expect(salvarAutomacaoEmpresa(db,'a','u',{...input,requestId:'adocao-versao-002',agendaEventos:{executionMode:'LEGADO'}})).rejects.toMatchObject({code:'AUTOMATION_CHANGED'});
});

test('Herdar remove só a folha empresarial, preservando default da empresa e origem',async()=>{
 const db=database();
 await salvarAgendaEventosGlobal(db,{id:'u',role:'admin'},{requestId:'herdado-global-01',agendaEventos:{expectedRevision:(await lerAgendaEventosGlobal(db)).revision,patch:{defaults:{captura:{hour:8}}}}});
 let before=await lerAutomacaoEmpresa(db,'a');
 const saved=await salvarAutomacaoEmpresa(db,'a','u',{expectedRevision:before.revision,requestId:'herdado-local-001',agendaEventos:{patch:{defaults:{captura:{hour:10}},tributos:{IRPJ:{captura:{hour:9}}}}}});
 expect(saved.agendaEventos.effective.IRPJ.captura.hour).toBe(9);
 expect(saved.agendaEventos.inherited.IRPJ.captura.hour).toBe(10);
 expect(saved.agendaEventos.inheritedOrigins.IRPJ['captura.hour']).toBe('EMPRESA_DEFAULT');
 const reset=await salvarAutomacaoEmpresa(db,'a','u',{expectedRevision:saved.revision,requestId:'herdado-local-002',agendaEventos:{patch:{tributos:{IRPJ:{captura:{hour:null}}}}}});
 expect(reset.agendaEventos.effective.IRPJ.captura.hour).toBe(10);
});
