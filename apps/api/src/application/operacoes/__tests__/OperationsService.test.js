jest.mock('../../notas/apuracao/v2/RecuperacaoCalculo.js', () => ({ contextoOrigemCalculo: jest.fn(async () => ({ hash: 'original', contribuinteCnpj: '123', regimeApuracao: 'COMPETENCIA' })), recuperarCalculo: jest.fn(() => ({ calculoRecuperavel: { dasValor: 120 } })) }));
import { contextoOrigemCalculo } from '../../notas/apuracao/v2/RecuperacaoCalculo.js';
import { lerOperacao, salvarOperacao } from '../OperationsService.js';

function database() {
  const settings = new Map();
  const db = {
    portalClient: { findUnique: jest.fn(async () => ({ id: 'a', companyId: 'legacy' })) },
    regimeHistorico: { findMany: jest.fn(async () => [{ regime: 'SIMPLES', vigenciaInicio: new Date('2020-01-01') }]) },
    cadastroFiscal: { findUnique: jest.fn(async () => ({ regime: 'SIMPLES_NACIONAL', regimeApuracao: 'COMPETENCIA', dataOpcaoSN: new Date('2020-01-01') })) },
    company: { findUnique: jest.fn(async () => ({ id: 'legacy', regimeTributario: 'SIMPLES' })) },
    apuracaoSnapshot: { findUnique: jest.fn(async () => ({ estado: 'calculada' })) },
    pendenciaPosFechamento: { findMany: jest.fn(async () => []) },
    companyFirmAccess: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', role: 'ACCOUNTANT' })) },
    appSetting: { findUnique: jest.fn(async ({ where }) => settings.get(where.key)), upsert: jest.fn(async ({ create }) => settings.set(create.key, create)), create: jest.fn(async ({ data }) => settings.set(data.key, data)) },
    $queryRaw: jest.fn(),
  };
  db.$transaction = fn => fn(db);
  return db;
}
const save = async (db, action, extra = {}) => salvarOperacao(db, 'a', '2026-09', 'user', { action, requestId: `request-${Math.random()}`.replace('.', '-'), expectedRevision: (await lerOperacao(db, 'a', '2026-09')).revision, ...extra });
beforeEach(() => contextoOrigemCalculo.mockResolvedValue({ hash: 'original', contribuinteCnpj: '123', regimeApuracao: 'COMPETENCIA' }));
test('confirma, libera e salva programação sem alterar estado fiscal; replay idempotente', async () => {
  const db = database();
  await expect(save(db, 'release')).rejects.toThrow('Confirme');
  const before = await lerOperacao(db, 'a', '2026-09');
  const input = { action: 'confirm', requestId: 'pedido-123', expectedRevision: before.revision };
  const confirmed = await salvarOperacao(db, 'a', '2026-09', 'user', input);
  expect(confirmed.status).toBe('CONFIRMED');
  expect(await salvarOperacao(db, 'a', '2026-09', 'user', input)).toEqual(confirmed);
  expect(db.appSetting.create).toHaveBeenCalledTimes(1);
  expect((await save(db, 'schedule', { schedule: '2026-10-16T08:30' })).status).toBe('CONFIRMED');
  expect((await save(db, 'release')).status).toBe('RELEASED');
  expect((await lerOperacao(db, 'a', '2026-09')).schedule).toBe('2026-10-16T08:30');
});
test('nota nova invalida confirmação e bloqueia liberação da revisão antiga', async () => {
  const db = database(), confirmed = await save(db, 'confirm');
  contextoOrigemCalculo.mockResolvedValue({ hash: 'nota-nova' });
  expect((await lerOperacao(db, 'a', '2026-09')).status).toBe('INVALIDATED');
  await expect(save(db, 'release', { expectedRevision: confirmed.revision })).rejects.toThrow('mudaram');
  db.pendenciaPosFechamento.findMany.mockResolvedValue([{ id: 'nota-setembro-emitida-outubro' }]);
  await expect(save(db, 'confirm')).rejects.toThrow('posteriores');
});
test('acesso revogado, datas impossíveis e colisão de idempotência são bloqueados', async () => {
  const db = database();
  for (const schedule of ['2026-02-31T08:00', '2026-10-00T08:00', '2026-10-16T25:00']) await expect(save(db, 'schedule', { schedule })).rejects.toMatchObject({ status: 422 });
  await save(db, 'confirm', { requestId: 'mesmo-pedido' });
  await expect(save(db, 'review', { requestId: 'mesmo-pedido' })).rejects.toThrow('outra alteração');
  db.companyFirmAccess.findUnique.mockResolvedValue({ status: 'REVOKED' });
  await expect(save(db, 'review')).rejects.toMatchObject({ status: 403 });
});

test('prova automática usa raiz explícita, recusa captura divergente e não aceita tx como raiz', async () => {
  const db = database();
  const snapshot = { estado: 'calculada', idempotencyKey: 'fech:auto:test', simulacaoSerpro: { _portalCalculo: { origemCalculo: 'AUTOMATICO_SIMPLES' } } };
  db.apuracaoSnapshot.findUnique.mockResolvedValue(snapshot);
  const root = { $transaction: jest.fn(), apuracaoSnapshot: { findUnique: jest.fn(async () => snapshot) } };
  const proof = jest.fn(async () => ({ contexto: { hash: 'original' }, hash: 'proof' }));
  expect((await lerOperacao(db, 'a', '2026-09', { rootDb: root, conferirProva: proof })).blocked).toBeNull();
  expect(proof).toHaveBeenCalledWith(snapshot, { portalClientId: 'a', competencia: '2026-09' }, { db: root });
  root.apuracaoSnapshot.findUnique.mockResolvedValue({ ...snapshot, idempotencyKey: 'outra-revisao' });
  expect((await lerOperacao(db, 'a', '2026-09', { rootDb: root, conferirProva: proof })).blocked).toMatch(/prova/);
  proof.mockClear();
  expect((await lerOperacao(db, 'a', '2026-09', { rootDb: {}, conferirProva: proof })).blocked).toMatch(/prova/);
  expect(proof).not.toHaveBeenCalled();
});


test('regime histórico alterado após confirmação recusa liberação sem modificar histórico', async()=>{
 const db=database();await save(db,'confirm');const before=await lerOperacao(db,'a','2026-09');
 db.regimeHistorico.findMany.mockResolvedValue([{regime:'LUCRO_PRESUMIDO',vigenciaInicio:new Date('2020-01-01')}]);
 await expect(save(db,'release')).rejects.toThrow('Simples não comprovado');expect(await lerOperacao(db,'a','2026-09')).toEqual(before);expect(db.appSetting.create).toHaveBeenCalledTimes(1);
});

// Real fiscal composition/B31/B32 policy and ACL; only persistence is a fixture.
function fiscalDatabase() {
 const db=database();
 db.user={findUnique:jest.fn(async()=>({id:'user',role:'accountant',accountType:'FIRM',status:'active'}))};
 db.portalClient.findUnique.mockResolvedValue({id:'a',companyId:'legacy',cnpj:'12345678000199'});
 db.company.findUnique.mockResolvedValue({id:'legacy',dataAbertura:new Date('2020-01-01'),regimeHistorico:[{id:'history',companyId:'legacy',regime:'SIMPLES',vigenciaInicio:new Date('2020-01-01'),vigenciaFim:null,updatedAt:new Date('2026-01-01')} ]});
 db.apuracaoFs12Revisao={findMany:jest.fn(async()=>[]),findFirst:jest.fn(async()=>null)};
 db.companyMonthlyCircular={findUnique:jest.fn(async()=>null)};
 db.guide={findFirst:jest.fn(async()=>null)};
 db.entregaObrigacaoArquivo={findFirst:jest.fn(async()=>null)};
 db.appSetting.findMany=jest.fn(async()=>[]);
 return db;
}
test.each(['2026-11','2026-12','2027-01'])('FS12 real %s não confirma/libera sem capacidade comprovada',async competencia=>{
 const db=fiscalDatabase();
 const before=await lerOperacao(db,'a',competencia,{autorId:'user'});
 expect(before.blocked).toMatch(/Confirme a folha mensal/);
 expect(before.aptidaoFiscal.capacidades.transmitir).toBe(false);
 expect(before.aptidaoFiscal.impedimentos).toEqual(expect.arrayContaining([expect.objectContaining({code:'FS12_CONFIRMACAO_AUSENTE'})]));
 if(competencia==='2027-01')expect(before.aptidaoFiscal.impedimentos).toEqual(expect.arrayContaining([expect.objectContaining({code:'FS12_POLITICA_NAO_HOMOLOGADA'})]));
 for(const action of ['confirm','release'])await expect(salvarOperacao(db,'a',competencia,'user',{action,requestId:'fs12-guard-'+action,expectedRevision:before.revision,autorId:'forged'})).rejects.toThrow(/Confirme a folha mensal/);
 expect(db.user.findUnique.mock.calls.every(([args])=>args.where.id==='user')).toBe(true);
 expect(db.appSetting.upsert).not.toHaveBeenCalled();expect(db.appSetting.create).not.toHaveBeenCalled();
});
test('leitura FS12 sem ator mantém recusa de autenticação real',async()=>{
 const db=fiscalDatabase();await expect(lerOperacao(db,'a','2026-11')).rejects.toMatchObject({code:'FS12_SEM_AUTENTICACAO',status:401});
 expect(db.appSetting.upsert).not.toHaveBeenCalled();expect(db.appSetting.create).not.toHaveBeenCalled();
});
test('acesso revogado impede confirmação sem usar ator enviado no input',async()=>{
 const db=fiscalDatabase();const before=await lerOperacao(db,'a','2026-11',{autorId:'user'});
 db.companyFirmAccess.findUnique.mockResolvedValue({status:'REVOKED',role:'ACCOUNTANT'});
 await expect(salvarOperacao(db,'a','2026-11','user',{action:'confirm',requestId:'revoked-request',expectedRevision:before.revision,autorId:'admin-forged'})).rejects.toMatchObject({status:403});
 expect(db.appSetting.upsert).not.toHaveBeenCalled();expect(db.appSetting.create).not.toHaveBeenCalled();
});
// Presentation contract only: a read-only historical DTO never grants a new command.
test.each([0, 19.75])('confirmed historical result %s remains visible with command block intact',async dasValor=>{
 const db=fiscalDatabase();
 const snapshot={estado:'transmitida',idempotencyKey:'calculo-historico'};
 db.apuracaoSnapshot.findUnique.mockResolvedValue(snapshot);
 const historico={portalClientId:'a',competencia:'2026-12',comandoId:'cmd',calculoId:'calculo-historico',dasValor,somenteLeitura:true,autorizaEfeitoFiscal:false};
 const apt={fiscal:{estado:'CONFIRMADA',comandoId:'cmd',motivo:'Resposta causal preservada.',calculoHistorico:historico},capacidades:{transmitir:false},impedimentos:[],pendencias:['DOCUMENTOS']};
 const out=await lerOperacao(db,'a','2026-12',{autorId:'user',avaliarFiscal:async()=>apt});
 expect(out.calculation).toEqual(historico);expect(out.blocked).toBe('Resposta causal preservada.');
 expect(out.blockingForNewActionOnly).toBe(true);expect(out.aptidaoFiscal.capacidades.transmitir).toBe(false);
 db.pendenciaPosFechamento.findMany.mockResolvedValue([{id:'nota-posterior'}]);
 const pending=await lerOperacao(db,'a','2026-12',{autorId:'user',avaliarFiscal:async()=>apt});
 expect(pending.blockingForNewActionOnly).toBe(false);expect(pending.blocked).toMatch(/posteriores/);
 expect(db.appSetting.upsert).not.toHaveBeenCalled();expect(db.appSetting.create).not.toHaveBeenCalled();
});

test('historical calculation is not promoted for another snapshot/company/PA or unknown attempt',async()=>{
 const db=fiscalDatabase();db.apuracaoSnapshot.findUnique.mockResolvedValue({estado:'transmitida',idempotencyKey:'calc'});
 const h={portalClientId:'a',competencia:'2026-12',comandoId:'cmd',calculoId:'calc',dasValor:0,somenteLeitura:true,autorizaEfeitoFiscal:false};
 for(const delta of [{portalClientId:'other'},{competencia:'2026-11'},{calculoId:'old'},{comandoId:'other'},{dasValor:null},{autorizaEfeitoFiscal:true}]){
  const out=await lerOperacao(db,'a','2026-12',{autorId:'user',avaliarFiscal:async()=>({fiscal:{estado:'CONFIRMADA',comandoId:'cmd',calculoHistorico:{...h,...delta}},capacidades:{transmitir:false},impedimentos:[]})});
  expect(out.blockingForNewActionOnly).toBe(false);expect(out.calculation?.somenteLeitura).not.toBe(true);
 }
 const unknown=await lerOperacao(db,'a','2026-12',{autorId:'user',avaliarFiscal:async()=>({fiscal:{estado:'DESCONHECIDA',comandoId:'cmd',calculoHistorico:h},capacidades:{transmitir:false},impedimentos:[]})});
 expect(unknown.blockingForNewActionOnly).toBe(false);expect(unknown.calculation?.somenteLeitura).not.toBe(true);
});
import { criarAplicacaoRespostaFs12 } from '../../../modules/fiscal/infrastructure/prisma/aplicacaoRespostaFs12.js';
import { hashCalculo, validarCalculoConfirmado } from '../../notas/apuracao/v2/CalculoConfirmado.js';
// Real projector and snapshot validator; persistence/custody are unit fixtures.
// This does not claim PG, encryption, ACL integration or fiscal authorization.
test('causal historical DTO requires exact B33/B32, immutable calculation and current transmitted snapshot',async()=>{
 const identity={portalClientId:'a',companyId:'legacy',competencia:'2026-12',revisaoFs12:1};
 const dados={portalClientId:'a',competencia:'2026-12',formulario:{atividades:[],folhaMensal12:[],regimeApuracao:'COMPETENCIA'},fs12:{revisao:1}};
 const calculo={...dados,calculoId:'fech:v1:test:'+hashCalculo(dados)};
 const prep={calculoId:calculo.calculoId};
 const command={...identity,id:'cmd',tentativaId:'attempt',cnpj:'12345678000199',intencao:'TRANSMITIR',contextoHash:'context',vinculoOrigemId:'b32',esperado:{custodia:{respostaId:'response'},preparacao:prep,preparoHash:hashCalculo(prep)}};
 const response={id:'response',comandoId:'cmd',reservaId:'reserve',httpStatus:200,corpoHash:'body',corpoCifrado:{},recebidoEm:new Date('2026-11-25T12:00:00Z')};
 const b33={...identity,comandoId:'cmd',respostaId:'response',vinculoId:'b32',intencao:'TRANSMITIR'};
 const b32={...identity,id:'b32',calculoId:calculo.calculoId,contextoHash:'context',calculoConfirmado:calculo,calculoHash:hashCalculo(calculo)};
 const snapshot={portalClientId:'a',competencia:'2026-12',estado:'transmitida',idempotencyKey:calculo.calculoId,numeroDeclaracao:'declaration',dasRetornadoSerpro:0,atividadesEscolhidas:[],folhaMensal12:[],simulacaoSerpro:{_portalCalculo:calculo,_portalTransmissao:{comandoId:'cmd'}}};
 const db={portalClient:{findUnique:async()=>({companyId:'legacy'})},fs12Comando:{findMany:async()=>[command]},appSetting:{findUnique:async()=>null},fs12ComandoResposta:{findUnique:async()=>response},fs12ComandoReserva:{findUnique:async()=>({reservaId:'reserve'})},fs12ComandoCalculo:{findUnique:jest.fn(async()=>b33)},apuracaoFs12Calculo:{findUnique:async()=>b32},apuracaoSnapshot:{findUnique:async()=>snapshot}};
 const raw={status:200,dados:JSON.stringify([{idDeclaracao:'declaration',indicadorTransmissao:true,cnpjCompleto:command.cnpj,pa:202612}])};
 const app=criarAplicacaoRespostaFs12({db,hash:hashCalculo,validarSnapshot:validarCalculoConfirmado,validarEnvelope:async()=>{},custodia:{resolveOrigin:async()=>({})},cifra:{decifrar:async()=>Buffer.from(JSON.stringify(raw))},parseRetorno:()=>({dasValor:0})});
 const read=()=>app.projetar({portalClientId:'a',competencia:'2026-12'});
 expect((await read()).calculoHistorico).toMatchObject({calculoId:calculo.calculoId,dasValor:0,somenteLeitura:true,autorizaEfeitoFiscal:false});
 db.fs12ComandoCalculo.findUnique.mockResolvedValueOnce(null);
 expect(await read()).toMatchObject({estado:'CONFIRMADA',calculoHistorico:null});
 for(const [target,key,value] of [[b33,'respostaId','another'],[b33,'portalClientId','another'],[b32,'calculoHash','invalid'],[snapshot,'idempotencyKey','newer'],[snapshot,'estado','aberta'],[snapshot,'dasRetornadoSerpro',null]]){
  const old=target[key];target[key]=value;
  expect(await read()).toMatchObject({estado:'CONFIRMADA',calculoHistorico:null});target[key]=old;
 }
});