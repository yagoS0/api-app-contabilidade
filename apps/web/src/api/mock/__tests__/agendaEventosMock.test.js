import {mockLerAgendaEventos,mockSalvarAgendaEventos,mockValidarAgendaEventosPatch} from '../agendaEventosMock';
import {mockCarregarRotinas,mockSalvarRotinas} from '../rotinasMock';
import {criarCompanyAutomationMock} from '../companyAutomationMock';
test('parâmetros globais preservam agenda e request misto é recusado antes de escrever',()=>{
 const before=mockCarregarRotinas([]),policy=before.agendaEventos;
 expect(()=>mockSalvarRotinas({requestId:'mixed',agenda:{},agendaEventos:{expectedRevision:policy.revision,patch:{tributos:{IRPJ:{captura:{hour:9}}}}}})).toThrow();
 const after=mockSalvarRotinas({requestId:'global-test',agendaEventos:{expectedRevision:policy.revision,patch:{tributos:{IRPJ:{captura:{enabled:false,hour:9}}}}}});
 expect(after.agendaEventos.executionMode).toBe('LEGADO');expect(after.agendaEventos.relativeConsumerReady).toBe(true);expect(after.agendaEventos.capabilities.capture).toBe(false);expect(mockCarregarRotinas([]).agenda).toEqual(before.agenda);
});
test('empresa herda false, personaliza parâmetros e restaura sem mudar adesões',async()=>{
 const api=criarCompanyAutomationMock([{companyId:'fixture',myRole:'ACCOUNTANT',regimeTributario:'SIMPLES'}]);const before=await api.getCompanyAutomation('fixture');
 const input={requestId:'company-test',expectedRevision:before.revision,agendaEventos:{patch:{tributos:{IRPJ:{captura:{hour:10,enabled:false}}}}}};
 const saved=await api.saveCompanyAutomation('fixture',input);expect(saved.agendaEventos.effective.IRPJ.captura.hour).toBe(10);expect(saved.agendaEventos.effective.IRPJ.captura.enabled).toBe(false);expect(saved.rotinas).toEqual(before.rotinas);expect(saved.envioGuias).toEqual(before.envioGuias);expect(saved.lembretes).toEqual(before.lembretes);expect(saved.automationPolicy).toEqual(before.automationPolicy);expect(await api.saveCompanyAutomation('fixture',input)).toEqual(saved);
 const reset=await api.saveCompanyAutomation('fixture',{requestId:'reset-test',expectedRevision:saved.revision,agendaEventos:{patch:{tributos:{IRPJ:{captura:{hour:null}}}}}});expect(reset.agendaEventos.overrides.tributos.IRPJ.captura).not.toHaveProperty('hour');
});
test.each([{executionMode:'RELATIVO_V1'},{enabled:true},{tributos:{IRPJ:null}},{tributos:{IRPJ:{captura:{hour:''}}}},{tributos:{IRPJ:{captura:{businessDaysBefore:0}}}}])('payload inválido não altera configuração %j',patch=>{
 const before=mockLerAgendaEventos();expect(()=>mockValidarAgendaEventosPatch(patch)).toThrow();expect(mockLerAgendaEventos()).toEqual(before);
});
test('alteração global invalida revisão empresarial e replay anterior',()=>{
 const p=mockLerAgendaEventos('revision-fixture');const input={requestId:'rev-company',expectedRevision:p.revision,patch:{tributos:{ISS:{lembretes:{onDue:{enabled:false}}}}}};
 mockSalvarAgendaEventos('revision-fixture',input);const g=mockLerAgendaEventos();mockSalvarAgendaEventos(null,{requestId:'rev-global',expectedRevision:g.revision,patch:{tributos:{ISS:{lembretes:{onDue:{hour:10}}}}}});expect(()=>mockSalvarAgendaEventos('revision-fixture',input)).toThrow();
});

test('inherited remove só folha do tributo e preserva padrão empresarial',()=>{
 const g=mockLerAgendaEventos();mockSalvarAgendaEventos(null,{requestId:'inherited-global',expectedRevision:g.revision,patch:{defaults:{captura:{hour:8,enabled:false}}}});const c=mockLerAgendaEventos('inherit-company');const r=mockSalvarAgendaEventos('inherit-company',{requestId:'inherited-company',expectedRevision:c.revision,patch:{defaults:{captura:{hour:10}},tributos:{IRPJ:{captura:{hour:9}}}}});expect(r.effective.IRPJ.captura.hour).toBe(9);expect(r.inherited.IRPJ.captura.hour).toBe(10);expect(r.inheritedOrigins.IRPJ['captura.hour']).toBe('EMPRESA_DEFAULT');expect(r.inherited.IRPJ.captura.enabled).toBe(false);
});
