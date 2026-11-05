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
