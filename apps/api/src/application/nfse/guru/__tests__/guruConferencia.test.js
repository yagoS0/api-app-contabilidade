jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../NfseService.js', () => ({ NfseService: { issue: jest.fn() } }));
import { NfseService } from '../../NfseService.js';
import { criarGuruConferencia } from '../GuruConferenciaService.js';

const body = { transacaoId: 'venda-local', referenciaOrigem: 'Evidência sintética', valorCentavos: 100,
  moeda: 'BRL', situacaoPagamento: 'INFORMADO_PAGO' };
const args = { companyId: 'empresa-local', userId: 'contador-local', body };
const env = { NODE_ENV: 'test', GURU_CONFERENCIA_COMPANY_ID: args.companyId, GURU_CONFERENCIA_ACCOUNT_ID: 'conta-local' };

function fixture(config = env) {
  let rows = new Map();
  const user = { id: args.userId, role: 'contador', status: 'active' };
  let falhar = false;
  const db = {
    user: { findUnique: jest.fn(async () => user) },
    company: { findUnique: jest.fn(async () => ({ id: args.companyId })) },
    $transaction: async fn => {
      const copia = new Map(structuredClone([...rows]));
      const tx = { ...db, $queryRaw: jest.fn(async () => []), appSetting: {
        findUnique: async ({ where }) => copia.get(where.key) || null,
        create: async ({ data }) => { if (falhar) throw Error('persistencia_indisponivel'); copia.set(data.key, data); },
        update: async ({ where, data }) => { if (falhar) throw Error('persistencia_indisponivel'); copia.set(where.key, { key: where.key, ...data }); },
      } };
      const result = await fn(tx); rows = copia; return result;
    },
  };
  return { service: criarGuruConferencia({ db, env: config }), db, user, rows: () => rows, falhar: () => { falhar = true; } };
}

afterEach(() => { expect(NfseService.issue).not.toHaveBeenCalled(); });

test('preparação, recarga, conferência e replay mantêm pagamento separado e emissão bloqueada', async () => {
  const f = fixture();
  const a = await f.service.preparar(args);
  expect(a.item).toMatchObject({ emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA' });
  expect(a.item).not.toHaveProperty('nota');
  const b = await f.service.preparar(args);
  expect(b).toEqual({ item: a.item, repetida: true });
  expect(f.rows().size).toBe(1);
  const comando = { ...args, id: a.item.id, body: { versao: 1, hash: a.item.hash, confirmada: true } };
  const conferida = await f.service.conferir(comando);
  expect(conferida.item).toMatchObject({ estado: 'CONFERIDA', versao: 2, emissaoBloqueada: true,
    emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA', entrega: 'NAO_REALIZADA', baixaContabil: 'NAO_REALIZADA', conexaoGuru: 'NAO_REALIZADA' });
  expect(conferida.item.historico).toHaveLength(2);
  expect(await f.service.obter({ ...args, id: a.item.id })).toEqual(conferida.item);
  expect(await f.service.conferir(comando)).toEqual({ item: conferida.item, repetida: true });
  await expect(f.service.emitir(args)).rejects.toMatchObject({ code: 'guru_emissao_bloqueada_modo_conferencia', status: 409 });
});
test.each(['nota', 'emissaoAltan', 'situacaoFiscalExterna'])('não aceita %s no body como prova', async campo => {
  const f = fixture();
  await expect(f.service.preparar({ ...args, body: { ...body, [campo]: 'NAO_EMITIDA' } }))
    .rejects.toMatchObject({ code: 'guru_campos_invalidos', status: 400 });
  expect(f.rows().size).toBe(0);
  const { item } = await f.service.preparar(args);
  await expect(f.service.conferir({ ...args, id: item.id,
    body: { versao: 1, hash: item.hash, confirmada: true, [campo]: 'NAO_VERIFICADA' } }))
    .rejects.toMatchObject({ code: 'guru_campos_invalidos', status: 400 });
  expect(await f.service.obter({ ...args, id: item.id })).toEqual(item);
});

test('WIP antigo não afirma ausência de nota na leitura/replay e GET não regrava', async () => {
  const f = fixture();
  const { item } = await f.service.preparar(args);
  const row = [...f.rows().values()][0];
  delete row.value.emissaoAltan;
  delete row.value.situacaoFiscalExterna;
  row.value.nota = 'NAO_EMITIDA';
  const salvo = structuredClone(row.value);
  const consulta = { ...args, id: item.id };
  const projetado = await f.service.obter(consulta);
  expect(projetado).not.toHaveProperty('nota');
  expect(projetado).toMatchObject({ emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA' });
  expect([...f.rows().values()][0].value).toEqual(salvo);
  expect(await f.service.preparar(args)).toEqual({ item: projetado, repetida: true });
  const comando = { ...consulta, body: { versao: 1, hash: item.hash, confirmada: true } };
  const conferida = await f.service.conferir(comando);
  expect(conferida.item).not.toHaveProperty('nota');
  expect(conferida.item).toMatchObject({ emissaoAltan: 'NAO_REALIZADA', situacaoFiscalExterna: 'NAO_VERIFICADA' });
  expect(await f.service.conferir(comando)).toEqual({ ...conferida, repetida: true });
  expect(await f.service.obter(consulta)).toEqual(conferida.item);
});
test('mesma transação divergente não sobrescreve nem duplica a evidência', async () => {
  const f = fixture(); const a = await f.service.preparar(args);
  await expect(f.service.preparar({ ...args, body: { ...body, valorCentavos: 200 } })).rejects.toMatchObject({ status: 409 });
  expect(await f.service.obter({ ...args, id: a.item.id })).toEqual(a.item);
});
test.each([{ NODE_ENV: 'production' },
  ...['false', 'TRUE', '1', '', true].map(flag => ({ NODE_ENV: 'production', GURU_CONFERENCIA_PRODUCTION_ENABLED: flag })),
  ...['GURU_CONFERENCIA_COMPANY_ID', 'GURU_CONFERENCIA_ACCOUNT_ID'].map(campo => ({
    NODE_ENV: 'production', GURU_CONFERENCIA_PRODUCTION_ENABLED: 'true', [campo]: '',
  })),
  { NODE_ENV: undefined, GURU_CONFERENCIA_PRODUCTION_ENABLED: 'true' },
  { NODE_ENV: 'staging', GURU_CONFERENCIA_PRODUCTION_ENABLED: 'true' }, { GURU_CONFERENCIA_COMPANY_ID: '' },
  { GURU_CONFERENCIA_ACCOUNT_ID: '' }])('piloto ausente ou produção recusados antes do banco', async overrides => {
  const db = { $transaction: fn => fn(db), user: { findUnique: jest.fn() } };
  await expect(criarGuruConferencia({ db, env: { ...env, ...overrides } }).preparar(args)).rejects.toMatchObject({ status: 403 });
  expect(db.user.findUnique).not.toHaveBeenCalled();
});

test.each(['admin', 'contador'])('produção opt-in mantém escopo, replay e emissão recusada para %s ativo', async role => {
  const config = { ...env, NODE_ENV: 'production', GURU_CONFERENCIA_PRODUCTION_ENABLED: 'true' };
  const f = fixture(config); f.user.role = role;
  const { item } = await f.service.preparar(args);
  expect(await f.service.preparar(args)).toEqual({ item, repetida: true });
  await expect(f.service.emitir(args)).rejects.toMatchObject({ code: 'guru_emissao_bloqueada_modo_conferencia' });
  await expect(f.service.obter({ ...args, id: item.id, companyId: 'outra' })).rejects.toMatchObject({ status: 403 });
  config.GURU_CONFERENCIA_ACCOUNT_ID = 'outra-conta';
  await expect(f.service.obter({ ...args, id: item.id })).rejects.toMatchObject({ status: 404 });
  config.GURU_CONFERENCIA_ACCOUNT_ID = env.GURU_CONFERENCIA_ACCOUNT_ID;
  f.user.status = 'inactive';
  await expect(f.service.preparar(args)).rejects.toMatchObject({ status: 403 });
  f.user.status = 'active'; f.user.role = 'client';
  await expect(f.service.preparar(args)).rejects.toMatchObject({ status: 403 });
  f.user.role = role; config.GURU_CONFERENCIA_PRODUCTION_ENABLED = 'false';
  await expect(f.service.preparar(args)).rejects.toMatchObject({ code: 'guru_piloto_desabilitado' });
  expect(f.rows().size).toBe(1);
});
test('outra empresa e conta não acessam registros, nem por ID conhecido', async () => {
  const f = fixture(); const a = await f.service.preparar(args);
  await expect(f.service.obter({ ...args, id: a.item.id, companyId: 'outra' })).rejects.toMatchObject({ status: 403 });
  const outraConta = criarGuruConferencia({ db: f.db, env: { ...env, GURU_CONFERENCIA_ACCOUNT_ID: 'outra-conta' } });
  await expect(outraConta.obter({ ...args, id: a.item.id })).rejects.toMatchObject({ status: 404 });
});
test('permissão revogada, cliente e usuário ausente não gravam', async () => {
  const f = fixture();
  f.user.role = 'client';
  await expect(f.service.preparar(args)).rejects.toMatchObject({ status: 403 });
  f.user.role = 'contador'; f.user.status = 'inactive';
  await expect(f.service.preparar(args)).rejects.toMatchObject({ status: 403 });
  await expect(f.service.preparar({ ...args, userId: null })).rejects.toMatchObject({ status: 401 });
  expect(f.rows().size).toBe(0);
});
test('revisão/hash antigos, confirmação ausente e falha de gravação preservam o estado', async () => {
  const f = fixture(); const a = await f.service.preparar(args);
  const comando = { ...args, id: a.item.id, body: { versao: 1, hash: a.item.hash, confirmada: true } };
  await expect(f.service.conferir({ ...comando, body: { ...comando.body, hash: 'a'.repeat(64) } })).rejects.toMatchObject({ status: 409 });
  await expect(f.service.conferir({ ...comando, body: { ...comando.body, versao: 3 } })).rejects.toMatchObject({ status: 409 });
  await expect(f.service.conferir({ ...comando, body: { ...comando.body, confirmada: false } })).rejects.toMatchObject({ status: 400 });
  f.falhar();
  await expect(f.service.conferir(comando)).rejects.toThrow('persistencia_indisponivel');
  expect(await f.service.obter({ ...args, id: a.item.id })).toEqual(a.item);
});
