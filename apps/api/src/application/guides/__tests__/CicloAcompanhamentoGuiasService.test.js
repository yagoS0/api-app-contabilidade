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

test('D+2 consulta somente a guia, preserva revisão e não esconde negativa com aviso enviado', async () => {
  const f = fixture(); const r = await run(f);
  expect(r).toMatchObject({ status: 'PENDENTE', consulta: { resultado: 'NAO_LOCALIZADO' } });
  expect(f.consultar).toHaveBeenCalledTimes(1); expect(f.consultar.mock.calls[0][0].guideId).toBe('g'); expect(f.avisar).toHaveBeenCalledTimes(1);
  expect(f.ledger.get(chaveConsultaAutomatica({ guideId: 'g' }))).toMatchObject({ companyId: 'c', politica, fase: 'DEPOIS', status: 'REVISAO' });
  await run(f); expect(f.consultar).toHaveBeenCalledTimes(1); expect(f.avisar).toHaveBeenCalledTimes(1);
});
test.each(['clienteConfirmouEm', 'baixada', 'paymentConfirmedAt'])('confirmação %s impede consulta e aviso', async campo => {
  const f = fixture(); f.g[campo] = true; expect((await run(f)).status).toBe('ENCERRADO'); expect(f.consultar).not.toHaveBeenCalled(); expect(f.avisar).not.toHaveBeenCalled();
});
test.each(['cliente', 'revisao', 'empresa', 'destino', 'selecao', 'agenda', 'pausaGeral', 'pausaEmpresa'])('mudança %s durante autenticação impede despacho', async mudanca => {
  const f = fixture(); const http = jest.fn();
  f.consultar.mockImplementation(async () => {
    if (mudanca === 'pausaGeral') f.ledger.set('automacao_ciclo_fiscal', { paused: true, version: 1, reason: 'teste', actor: { id: 'u' }, changedAt: scheduledAt, resumedAt: null });
    if (mudanca === 'pausaEmpresa') f.ledger.set('company_automation_policy:c', { paused: true, version: 1, reason: 'teste', updatedBy: 'u', updatedAt: scheduledAt, resumedAt: null });
    if (mudanca === 'cliente') f.g.clienteConfirmouEm = new Date();
    if (mudanca === 'revisao') f.g.hash = 'novo-pdf';
    if (mudanca === 'empresa') f.g.portalClientId = 'outra';
    if (mudanca === 'destino') f.contato.telefoneE164 = '+5531999992222';
    if (mudanca === 'selecao') f.db.companyRotina.findUnique.mockResolvedValue({ enabled: false });
    if (mudanca === 'agenda') f.ledger.get('serpro_runtime_settings').rotinas.avisos_guias_whatsapp.enabled = false;
    await conferirTentativaAutomaticaDespacho(f.db, { portalClientId: 'c' }); http(); return { pago: true };
  });
  expect((await run(f)).status).toBe('PENDENTE'); expect(http).not.toHaveBeenCalled(); expect(f.avisar).not.toHaveBeenCalled();
  await run(f); expect(f.consultar).toHaveBeenCalledTimes(1);
});
test('pago suspende aviso; erro encerra tentativa e permanece visível', async () => {
  const f = fixture(); f.consultar.mockResolvedValue({ pago: true }); expect((await run(f)).status).toBe('ENCERRADO'); expect(f.avisar).not.toHaveBeenCalled();
  const e = fixture(); e.consultar.mockRejectedValue(Error('timeout privado')); expect((await run(e)).status).toBe('PENDENTE');
  await run(e); expect(e.consultar).toHaveBeenCalledTimes(1); expect(e.ledger.get(chaveConsultaAutomatica({ guideId: 'g' })).resultado).toBe('ERRO');
});
test.each(['prova', 'recalculo', 'limite', 'municipio'])('sem elegibilidade %s não transporta', async motivo => {
  const f = fixture();
  if (motivo === 'prova') f.prova.snapshot.revisaoDocumento = 'antiga';
  if (motivo === 'recalculo') f.g.extracted = { recalculoGuia: { guiaId: 'g', recalculadoEm: scheduledAt } };
  if (motivo === 'limite') f.ledger.get('acompanhamento_guias_config:c').limiteConsultas = 0;
  if (motivo === 'municipio') f.g.portalClient.municipio = null;
  await run(f); expect(f.consultar).not.toHaveBeenCalled(); expect(f.avisar).not.toHaveBeenCalled();
});
test('concorrência e reserva órfã não repetem; guia diferente é independente', async () => {
  const f = fixture(), http = jest.fn(async () => ({ pago: false }));
  const input = { companyId: 'c', guideId: 'a', revisao: 'r', politica, fase: 'DEPOIS', scheduledAt };
  await Promise.all([executarConsultaAutomatica(input, http, f.db), executarConsultaAutomatica(input, http, f.db)]);
  expect(http).toHaveBeenCalledTimes(1);
  await executarConsultaAutomatica({ ...input, guideId: 'b' }, http, f.db); expect(http).toHaveBeenCalledTimes(2);
  f.ledger.set(chaveConsultaAutomatica({ guideId: 'a' }), { status: 'INICIADA', claim: 'orfao' });
  await executarConsultaAutomatica({ ...input, revisao: 'pdf-novo' }, http, f.db); expect(http).toHaveBeenCalledTimes(2);
});
test('negativa legada encerra e entrada fiscal não rouba guia aderida ao novo ciclo', async () => {
  const f = fixture(), http = jest.fn(); f.ledger.set('pagamento_auto_negativo:guia:g', { status: 'CONFERENCIA_MANUAL' });
  await run(f); expect(f.consultar).not.toHaveBeenCalled();
  expect(await executarConsultaAutomatica({ companyId: 'c', guideId: 'outra', scheduledAt }, http, f.db)).toMatchObject({ skipped: 'acompanhamento_exclusivo' }); expect(http).not.toHaveBeenCalled();
});
test('claim persistido alterado não é dispensado pelo contexto interno', async () => {
  const f = fixture(), input = { companyId: 'c', guideId: 'x', scheduledAt, politica };
  await expect(executarConsultaAutomatica(input, async () => {
    expect(await conferirReservaConsulta(input, f.db)).toBe(true);
    f.ledger.get(chaveConsultaAutomatica(input)).claim = 'outro';
    expect(await conferirReservaConsulta(input, f.db)).toBe(false); return { pago: false };
  }, f.db)).rejects.toThrow('reserva');
});
test('GET usa somente leitura e conserva erro junto à pausa', async () => {
  const f = fixture(); await run(f); const dto = await lerAcompanhamentoGuias({ portalClientId: 'c', competencia: '2026-10' }, f);
  expect(dto.items[0]).toMatchObject({ guideId: 'g', consulta: { status: 'REVISAO' }, calendario: { vencimentoNominal: '2026-11-20' } });
  expect(f.consultar).toHaveBeenCalledTimes(1); expect(JSON.stringify(dto)).not.toContain('claim'); expect(JSON.stringify(dto)).not.toContain(f.contato.telefoneE164);
});

test('verificador pós-auth aceita transaction client distinto e lê exclusivamente o banco dono', async () => {
 const f=fixture(), http=jest.fn();
 f.consultar.mockImplementation(async()=>{
   const tx={appSetting:{findUnique:jest.fn(()=>{throw Error('não usar argumento como origem');})}};
   await conferirTentativaAutomaticaDespacho(tx,{portalClientId:'c',requireAttempt:true});
   expect(tx.appSetting.findUnique).not.toHaveBeenCalled();http();return {pago:true};
 });
 expect((await run(f)).status).toBe('ENCERRADO');expect(http).toHaveBeenCalledTimes(1);
});

test.each(['numeroDocumento','numeroDoc','numeroDas','anoMesParcela','numeroParcela','numeroParcelamento','tipoContrato'])('mudança da identidade fiscal %s após autenticação impede HTTP', async campo => {
 const f=fixture(), http=jest.fn();
 if(['anoMesParcela','numeroParcela','numeroParcelamento','tipoContrato'].includes(campo)) {
  f.g.parcelamentoId='contrato';f.g.parcelamento={id:'contrato',portalClientId:'c',tipo:'PARCSN',numeroParcelamento:'1'};
  f.g.parcela={id:'parcela',portalClientId:'c',guiaId:'g',parcelamentoId:'contrato',anoMesParcela:'202611',numeroParcela:1,parcelamento:f.g.parcelamento};
  f.prova.snapshot.revisaoDocumento=revisaoDocumentoGuia(f.g);
 }
 f.consultar.mockImplementation(async()=>{
  if(['numeroDocumento','numeroDoc','numeroDas'].includes(campo))f.g.extracted={...(f.g.extracted||{}),[campo]:'alterado'};
  if(campo==='anoMesParcela')f.g.parcela.anoMesParcela='202612';if(campo==='numeroParcela')f.g.parcela.numeroParcela=2;
  if(campo==='numeroParcelamento')f.g.parcelamento.numeroParcelamento='2';if(campo==='tipoContrato')f.g.parcelamento.tipo='PARCMEI';
  await conferirTentativaAutomaticaDespacho({...f.db},{portalClientId:'c',requireAttempt:true});http();return {pago:true};
 });
 expect((await run(f)).status).toBe('PENDENTE');expect(f.consultar).toHaveBeenCalledTimes(1);expect(http).not.toHaveBeenCalled();
});
test('competência de apuração fechada não suspende guia com vencimento posterior sem confirmação', async()=>{
 const f=fixture();f.db.companyMonthlyCircular.findUnique.mockResolvedValue({fechadoContabilEm:new Date()});
 await run(f);expect(f.consultar).toHaveBeenCalledTimes(1);expect(f.avisar).toHaveBeenCalledTimes(1);
});

test('DTO conserva política histórica e traduz somente motivos conhecidos sem ecoar mensagem externa', async()=>{
 const f=fixture();
 const registros=[
  {fase:'ANTES',status:'ENVIADO'},
  {fase:'DEPOIS',status:'PENDENTE',politica:'D2_D0_D2_V1',motivo:'WHATSAPP_TEMPLATE_PENDENTE',mensagem:'segredo-token-externo'},
  {fase:'DEPOIS',status:'PENDENTE',politica:'OUTRA',motivo:'DESTINATARIO_ALTERADO',mensagem:'segredo-cnpj-externo'},
  {fase:'DEPOIS',status:'INDETERMINADO',motivo:'__proto__',mensagem:'segredo-payload-externo'},
  {fase:'DEPOIS',status:'PENDENTE',motivo:'codigo-com-segredo-token'},
 ].map(value=>({value:{companyId:'c',guideId:'g',...value}}));
 f.db.appSetting.findMany.mockImplementation(async({where})=>where.key.startsWith==='aviso_pagamento:'?registros:[]);
 const dto=await lerAcompanhamentoGuias({portalClientId:'c',competencia:'2026-10'},f),h=dto.items[0].historico;
 expect(h[0]).toMatchObject({politica:null,motivo:null});expect(h[1].politica).toBe('D2_D0_D2_V1');expect(h[2].politica).toBeNull();
 expect(h[1].motivo).toContain('aprovação Utility');expect(h[2].motivo).toContain('contato autorizado');
 expect(h[3].motivo).toContain('Não repita');expect(h[4].motivo).toContain('Não repita');
 expect(JSON.stringify(dto)).not.toMatch(/segredo|__proto__|WHATSAPP_TEMPLATE_PENDENTE|DESTINATARIO_ALTERADO/);
});
