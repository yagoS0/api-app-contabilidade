import { prepararEventosAcompanhamento } from '../AgendaEventosExecucao.js';
import { versaoPagamentoGuia } from '../ConfirmacaoPagamentoClienteService.js';
import { revisaoDocumentoGuia } from '../../whatsapp/EnvioDocumentoGuiaWhatsappService.js';
import { avisarPagamentoNaoConfirmado } from "../AvisoPagamentoService.js";
beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-09-24T15:00:00Z")));
afterEach(() => jest.useRealTimers());
function setup(patch = {}) {
  const records = new Map();
  // Configuração preexistente fica separada das reservas criadas pelo aviso.
  // Não simular a guarda: o serviço real valida esta política em cada leitura.
  const automationPolicy = { key: 'automacao_ciclo_fiscal', value: {
    paused: false, version: 1, reason: 'Cenário autorizado de teste', actor: { id: 'contador-fixture' },
    changedAt: '2026-09-01T11:00:00Z', resumedAt: null,
  } };
  const guide = { status: "PROCESSED", hash: "pdf-atual", valor: 100, id: "g", portalClientId: "c", competencia: "2026-09", tipo: "INSS", paymentStatus: "OPEN", liberadaCliente: true, vencimento: "2026-09-23", ...patch };
  // Recibo imutável da entrega anterior: a leitura nunca o reconstrói da guia atual.
  const entrega = { arquivoSha256: guide.hash, snapshot: { revisaoDocumento: revisaoDocumentoGuia(guide), guideId:guide.id,portalClientId:guide.portalClientId,telefone:'5511000000000',competencia:guide.competencia,tipo:guide.tipo,valor:guide.valor,vencimento:guide.vencimento} };
  const db = { envioGuiaTentativa: { findMany: jest.fn(async ({where}) => where.envioGuia.destino === entrega.snapshot.telefone ? [entrega] : []) }, feriado: { findMany: jest.fn(async () => []) }, guide: { findUnique: jest.fn(async () => ({ ...guide })) }, portalClient: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, razao: "Empresa sintética" })) },
    appSetting: { create: jest.fn(async ({ data }) => { if (records.has(data.key)) throw Object.assign(Error("duplicado"), { code: "P2002" }); records.set(data.key, data); return data; }),
      findUnique: jest.fn(async ({ where }) => where.key === automationPolicy.key ? automationPolicy : where.key === 'company_automation_policy:c' ? null : records.get(where.key)), update: jest.fn(async ({ where, data }) => { records.set(where.key, { key: where.key, ...data }); return data; }) } };
  db.guide.findFirst = jest.fn(async () => ({ ...guide }));
  db.guide.updateMany = jest.fn(async () => ({ count: 1 }));
  db.$transaction = fn => fn(db);
  const transporte = { canais: jest.fn(async () => ({ escolha: "EMAIL" })), destinatarios: jest.fn(async () => ({ emails: ["fixture@example.invalid"], telefones: [{ id: "contato", telefoneE164: "5511000000000" }] })),
    email: jest.fn(), whatsapp: jest.fn(async ({ conferir }) => { await conferir(); }) };
  const run = extra => avisarPagamentoNaoConfirmado({ guideId: "g", scheduledAt: "2026-09-24T11:00:00Z", ...extra }, { db, transporte, portalUrl: "https://portal.example.invalid/" });
  return { guide, entrega, db, transporte, records, run };
}

function setupRelative(){
 const f=setup({vencimento:'2026-09-25',tipo:'SIMPLES',source:'SERPRO'});
 f.db.guide.findMany=jest.fn(async()=>[{...f.guide}]);
 const put=(key,value)=>f.records.set(key,{key,value});
 put('agenda_eventos_modo:v1:c',{schemaVersion:1,version:1,executionMode:'RELATIVO_V1',updatedAt:'2026-09-01T11:00:00Z',updatedBy:'u'});
 put('agenda_eventos_global:v1',{schemaVersion:1,version:1,updatedAt:'2026-09-01T11:00:00Z',updatedBy:'u',parameters:{schemaVersion:1,defaults:{lembretes:{before:{enabled:true,businessDays:2,hour:8}}}}});
 put('acompanhamento_guias_config:c',{enabled:true,politica:'D2_D0_D2_V1',limiteConsultas:1,selectionToken:'known'});
 put('serpro_runtime_settings',{rotinas:{avisos_guias_whatsapp:{enabled:true,frequency:'DAILY',hour:8}}});
 f.db.portalClient.findUnique.mockImplementation(async({where})=>({id:where.id,razao:'Empresa fictícia',municipio:'Rio de Janeiro'}));
 f.db.companyRotina={findUnique:jest.fn(async()=>({enabled:true}))};
 f.runRelative=async(at)=>{
  const snapshot=await prepararEventosAcompanhamento(f.db,{...f.guide,portalClient:{municipio:'Rio de Janeiro'}},new Date(at));
  const event=snapshot.events.find(e=>e.tipo==='LEMBRETE');
  return f.run({agora:new Date(at),scheduledAt:at,politica:'D2_D0_D2_V1',eventoRelativo:{fingerprint:snapshot.fingerprint,tipo:event.tipo,fase:event.fase}});
 };
 return f;
}
test('transporte real do serviço deduplica concorrência e mudança de offset/revisão de política',async()=>{
 const f=setupRelative();
 await Promise.all([f.runRelative('2026-09-23T11:00:00Z'),f.runRelative('2026-09-23T11:00:00Z')]);
 expect(f.transporte.whatsapp).toHaveBeenCalledTimes(1);
 const keys=[...f.records.keys()].filter(k=>k.startsWith('aviso_pagamento:'));expect(keys).toHaveLength(1);
 const policy=f.records.get('agenda_eventos_global:v1').value;policy.version++;policy.parameters.defaults.lembretes.before.businessDays=1;
 expect(await f.runRelative('2026-09-24T11:00:00Z')).toMatchObject({status:'JA_ENVIADO'});
 expect(f.transporte.whatsapp).toHaveBeenCalledTimes(1);expect([...f.records.keys()].filter(k=>k.startsWith('aviso_pagamento:'))).toEqual(keys);
});
test('modo adotado bloqueia chamada legada e preserva timeout como incerto sem repetição',async()=>{
 const f=setupRelative();await expect(f.run()).rejects.toMatchObject({code:'EVENT_MODE_CHANGED'});expect(f.transporte.whatsapp).not.toHaveBeenCalled();
 f.transporte.whatsapp.mockImplementation(async({conferir})=>{await conferir();throw Error('timeout');});
 await f.runRelative('2026-09-23T11:00:00Z');await f.runRelative('2026-09-23T11:00:00Z');
 expect(f.transporte.whatsapp).toHaveBeenCalledTimes(1);expect([...f.records.values()].find(r=>r.key.startsWith('aviso_pagamento:')).value.status).toBe('INDETERMINADO');
});
