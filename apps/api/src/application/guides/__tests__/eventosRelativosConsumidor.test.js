jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { acompanharGuia, lerAcompanhamentoGuias } from '../CicloAcompanhamentoGuiasService.js';
import { executarConsultaAutomatica, conferirReservaConsulta, chaveConsultaAutomatica } from '../../fiscal/serpro/ConsultaPagamentoAutomaticaService.js';
import { conferirTentativaAutomaticaDespacho } from '../../fiscal/automacaoCicloFiscalContext.js';
import { revisaoDocumentoGuia } from '../../whatsapp/EnvioDocumentoGuiaWhatsappService.js';
import { POLITICA_ACOMPANHAMENTO_GUIAS as politica } from '../calendarioAvisosGuia.js';

const scheduledAt = '2026-11-24T11:00:00.000Z';
function fixture() {
  const g = { id: 'g', portalClientId: 'c', competencia: '2026-10', tipo: 'SIMPLES', source: 'SERPRO', status: 'PROCESSED',
    liberadaCliente: true, hash: 'pdf', valor: 100, vencimento: new Date('2026-11-20'), portalClient: { municipio: 'Contagem' } };
  const contato = { id: 'd', telefoneE164: '+5531999991111', vinculoNumeroId: 'v' };
  const ledger = new Map([
    ['acompanhamento_guias_config:c', { enabled: true, politica, limiteConsultas: 1, selectionToken: 'selection' }],
    ['serpro_runtime_settings', { rotinas: { avisos_guias_whatsapp: { enabled: true, frequency: 'DAILY', hour: 8 } } }],
  ]);
  const prova = { arquivoSha256: g.hash, snapshot: { revisaoDocumento: revisaoDocumentoGuia(g), guideId: g.id, portalClientId: g.portalClientId,
    telefone: contato.telefoneE164, vinculoNumeroId: contato.vinculoNumeroId, competencia: g.competencia, valor: g.valor, vencimento: g.vencimento } };
  const db = { appSetting: {
    findUnique: jest.fn(async ({ where }) => ledger.has(where.key) ? { key: where.key, value: ledger.get(where.key) } : null),
    findMany: jest.fn(async () => []),
    create: jest.fn(async ({ data }) => { if (ledger.has(data.key)) throw Object.assign(Error('duplicate'), { code: 'P2002' }); ledger.set(data.key, data.value); return data; }),
    update: jest.fn(async ({ where, data }) => { ledger.set(where.key, data.value); return data; }),
  }, guide: { findUnique: jest.fn(async () => g), findMany: jest.fn(async () => [g]) },
    portalClient: { findUnique: jest.fn(async ({where}) => ({id: where.id})) }, companyMonthlyCircular: { findUnique: jest.fn(async () => null) }, companyRotina: { findUnique: jest.fn(async () => ({ enabled: true })) },
    feriado: { findMany: jest.fn(async () => []) }, envioGuiaTentativa: { findMany: jest.fn(async () => [prova]) } };
  let pending = Promise.resolve();
  db.$transaction = run => { const next = pending.then(() => run(db)); pending = next.catch(() => {}); return next; };
  const destinatarios = jest.fn(async () => ({ telefones: [contato] }));
  const consultar = jest.fn(async () => { await conferirTentativaAutomaticaDespacho(db, { portalClientId: 'c', requireAttempt: true }); return { pago: false, negativaConfirmada: true }; });
  const avisar = jest.fn(async ({ assertActive }) => { await assertActive(); return { status: 'ENVIADO' }; });
  return { g, contato, prova, ledger, db, destinatarios, consultar, avisar };
}
const run = f => acompanharGuia({ guideId: 'g', scheduledAt, agora: new Date(scheduledAt) }, f);


function relativeFixture() {
  const f=fixture();
  f.ledger.set('agenda_eventos_modo:v1:c',{schemaVersion:1,version:1,executionMode:'RELATIVO_V1',updatedAt:scheduledAt,updatedBy:'u'});
  f.ledger.set('agenda_eventos_global:v1',{schemaVersion:1,version:1,updatedAt:scheduledAt,updatedBy:'u',parameters:{schemaVersion:1,defaults:{lembretes:{before:{enabled:true,businessDays:3,hour:8},onDue:{enabled:true,hour:8},after:{enabled:true,businessDays:3,hour:8}}}}});
  return f;
}
const relativeRun=(f,at)=>acompanharGuia({guideId:'g',scheduledAt:at,agora:new Date(at),executionMode:'RELATIVO_V1'},f);
test('D+2 consulta uma vez sem esperar AFTER personalizado D+3; D+3 só avisa',async()=>{
 const f=relativeFixture();
 await relativeRun(f,'2026-11-24T11:00:00Z');
 expect(f.consultar).toHaveBeenCalledTimes(1);expect(f.avisar).not.toHaveBeenCalled();
 await relativeRun(f,'2026-11-24T11:00:00Z');expect(f.consultar).toHaveBeenCalledTimes(1);
 await relativeRun(f,'2026-11-25T11:00:00Z');expect(f.consultar).toHaveBeenCalledTimes(1);expect(f.avisar).toHaveBeenCalledTimes(1);
 expect(f.avisar.mock.calls[0][0].eventoRelativo).toMatchObject({fase:'DEPOIS',tipo:'LEMBRETE'});
 expect(f.ledger.has('pagamento_auto_tentativa:guia:g')).toBe(true);
});
test('legado e relativo são exclusivos mesmo na consulta fiscal mensal',async()=>{
 const f=relativeFixture(),http=jest.fn();
 expect(await executarConsultaAutomatica({companyId:'c',guideId:'g',scheduledAt,politica},http,f.db)).toMatchObject({skipped:'acompanhamento_exclusivo'});
 expect(http).not.toHaveBeenCalled();
 expect(await acompanharGuia({guideId:'g',scheduledAt,agora:new Date(scheduledAt),executionMode:'LEGADO'},f)).toMatchObject({motivo:'EVENT_MODE_CHANGED'});
 expect(f.consultar).not.toHaveBeenCalled();
});
test('mudança da política após preparo bloqueia transporte sem mudar chave do aviso',async()=>{
 const f=relativeFixture(),http=jest.fn();
 f.avisar.mockImplementation(async({assertActive})=>{
   f.ledger.get('agenda_eventos_global:v1').version++;
   await assertActive();http();return {status:'ENVIADO'};
 });
 const r=await relativeRun(f,'2026-11-17T11:00:00Z');
 expect(r).toMatchObject({status:'PENDENTE',motivo:'CONFIGURACAO_ALTERADA'});expect(http).not.toHaveBeenCalled();
});
test('guia atual recalculada continua aviso; consulta D+2 é suprimida',async()=>{
 const f=relativeFixture();f.g.extracted={recalculoGuia:{guiaId:'g',recalculadoEm:scheduledAt}};
 f.prova.snapshot.revisaoDocumento=revisaoDocumentoGuia(f.g);
 await relativeRun(f,'2026-11-24T11:00:00Z');expect(f.consultar).not.toHaveBeenCalled();expect(f.avisar).not.toHaveBeenCalled();
 await relativeRun(f,'2026-11-25T11:00:00Z');expect(f.consultar).not.toHaveBeenCalled();expect(f.avisar).toHaveBeenCalledTimes(1);
});
test.each(['2026-11-17T11:01:00Z','2026-11-18T11:00:00Z'])('sem catchup em %s',async at=>{
 const f=relativeFixture();await relativeRun(f,at);expect(f.consultar).not.toHaveBeenCalled();expect(f.avisar).not.toHaveBeenCalled();
});
test('confirmação e pausa conservam bloqueios no modo relativo',async()=>{
 const f=relativeFixture();f.g.clienteConfirmouEm=new Date(scheduledAt);
 await relativeRun(f,'2026-11-17T11:00:00Z');expect(f.avisar).not.toHaveBeenCalled();expect(f.consultar).not.toHaveBeenCalled();
 const p=relativeFixture();p.ledger.set('automacao_ciclo_fiscal',{paused:true,version:1,reason:'teste',actor:{id:'u'},changedAt:scheduledAt,resumedAt:null});
 await relativeRun(p,'2026-11-17T11:00:00Z');expect(p.avisar).not.toHaveBeenCalled();expect(p.consultar).not.toHaveBeenCalled();
});

test('documento concorrente durante preparo bloqueia aviso da guia antiga',async()=>{
 const f=relativeFixture(),network=jest.fn();
 f.avisar.mockImplementation(async({assertActive})=>{
   f.db.guide.findMany.mockResolvedValue([f.g,{...f.g,id:'nova',hash:'pdf-novo'}]);
   await assertActive();network();return {status:'ENVIADO'};
 });
 expect(await relativeRun(f,'2026-11-17T11:00:00Z')).toMatchObject({status:'PENDENTE',motivo:'DOCUMENTO_AMBIGUO'});expect(network).not.toHaveBeenCalled();
});
