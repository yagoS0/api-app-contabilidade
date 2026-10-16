import { lerInssManual, listarInssManual, salvarInssManual } from '../OperationsManualInss.js';

function database() {
  const settings = new Map(), companies = [{ id: 'a', companyId: 'legacy-a', razao: 'Empresa A', hasProlabore: true }, { id: 'b', companyId: 'legacy-b', razao: 'Empresa B', hasProlabore: false }];
  const guides = [];
  const db = {
    portalClient: { findMany: jest.fn(async ({ where }) => companies.filter(c => where.id.in.includes(c.id))) },
    company: { findMany: jest.fn(async () => [{ id: 'legacy-a', regimeTributario: 'SIMPLES' }, { id: 'legacy-b', regimeTributario: 'LUCRO_PRESUMIDO' }]) },
    guide: { findMany: jest.fn(async ({ where, select }) => guides.filter(g => where.portalClientId.in.includes(g.portalClientId) && g.competencia === where.competencia && g.tipo === where.tipo && !g.parcelamentoId && (!where.AND || g.pdfBytes?.length)).map(g => Object.fromEntries(Object.keys(select).map(k => [k, g[k]])))) },
    companyFirmAccess: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', role: 'ACCOUNTANT' })) },
    appSetting: { findMany: jest.fn(async ({ where }) => [...settings.values()].filter(s => where.key.in.includes(s.key))), findUnique: jest.fn(async ({ where }) => settings.get(where.key)), upsert: jest.fn(async ({ create }) => settings.set(create.key, create)), create: jest.fn(async ({ data }) => settings.set(data.key, data)) },
    $queryRaw: jest.fn(),
  };
  db.$transaction = jest.fn(fn => fn(db));
  return { db, settings, guides, companies };
}
const state = overrides => ({ applicable: null, responsible: '', dueDate: null, note: '', reason: '', ...overrides });
const inputFor = async (db, overrides = {}) => ({ expectedRevision: (await lerInssManual(db, 'a', '2026-09')).revision, requestId: 'request-123', state: state(), ...overrides });
const guide = overrides => ({ id: 'g1', portalClientId: 'a', competencia: '2026-09', tipo: 'INSS', status: 'PROCESSED', pdfBytes: Buffer.from('%PDF-example'), valor: 100, ...overrides });

test('batch scopes companies and documents; no PDF bodies or document proof of transmission/payment', async () => {
  const { db, guides } = database();
  guides.push(guide(), guide({ id: 'foreign', portalClientId: 'b' }), guide({ id: 'month', competencia: '2026-08' }), guide({ id: 'installment', parcelamentoId: 'parcelamento' }));
  const { items } = await listarInssManual(db, ['a'], '2026-09');
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ status: 'DOCUMENT_AVAILABLE', regime: 'SIMPLES', applicable: true });
  expect(items[0].guides.map(g => g.id)).toEqual(['g1']);
  expect(items[0]).not.toHaveProperty('transmitted');
  expect(items[0]).not.toHaveProperty('paid');
  expect(db.guide.findMany).toHaveBeenCalledTimes(2);
  expect(db.guide.findMany.mock.calls.every(([q]) => !q.select.pdfBytes)).toBe(true);
});

test.each(['VAZIO', 'ERROR', 'NEEDS_REVIEW', 'PENDING', 'PROCESSING'])('status %s never proves a document ready', async status => {
  const { db, guides } = database(); guides.push(guide({ status }));
  const result = await lerInssManual(db, 'a', '2026-09');
  expect(result.status).toBe(status === 'VAZIO' ? 'PENDING_DOCUMENT' : 'DOCUMENT_REVIEW');
  expect(result.guides[0].available).toBe(false);
});

test('missing PDF, external storage and wrong-tax document require review', async () => {
  for (const overrides of [{ pdfBytes: null }, { pdfBytes: Buffer.alloc(0), storageKey: 'old.pdf' }, { extracted: { composicao: [{ codigo: '8109', total: 100 }] } }]) {
    const { db, guides } = database(); guides.push(guide(overrides));
    expect((await lerInssManual(db, 'a', '2026-09')).status).toBe('DOCUMENT_REVIEW');
  }
});

test('unknown regime still supports manual INSS without enabling fiscal routines; document conflict stays visible', async () => {
  const { db, guides } = database(); db.company.findMany.mockResolvedValue([]);
  expect(await lerInssManual(db, 'a', '2026-09')).toMatchObject({ regime: null, status: 'PENDING_DOCUMENT' });
  expect(await lerInssManual(db, 'b', '2026-09')).toMatchObject({ applicable: false, status: 'NOT_APPLICABLE' });
  guides.push(guide({ portalClientId: 'b' }));
  expect(await lerInssManual(db, 'b', '2026-09')).toMatchObject({ applicable: false, applicabilityConflict: true, status: 'DOCUMENT_REVIEW' });
});

test('save is monthly, audited, idempotent and does not change company or guide', async () => {
  const { db, settings, companies } = database();
  const input = await inputFor(db, { state: state({ applicable: false, reason: 'Sem retirada nesta competência', responsible: 'Equipe', dueDate: '2026-10-20' }) });
  const saved = await salvarInssManual(db, 'a', '2026-09', 'user', input);
  expect(saved).toMatchObject({ applicable: false, applicabilitySource: 'month', status: 'NOT_APPLICABLE', changedBy: 'user' });
  expect(await salvarInssManual(db, 'a', '2026-09', 'user', input)).toEqual(saved);
  expect(db.appSetting.create).toHaveBeenCalledTimes(1);
  expect(settings.get('operations_manual_inss_request:user:request-123').value.before.applicable).toBe(true);
  expect(companies[0].hasProlabore).toBe(true);
  expect((await lerInssManual(db, 'a', '2026-10')).applicable).toBe(true);
  expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable', timeout: 20000 });
});

test('access is rechecked before replay and request reuse with different input fails', async () => {
  const { db } = database(), input = await inputFor(db);
  await salvarInssManual(db, 'a', '2026-09', 'user', input);
  await expect(salvarInssManual(db, 'a', '2026-09', 'user', { ...input, state: state({ note: 'Changed' }) })).rejects.toMatchObject({ status: 409 });
  db.companyFirmAccess.findUnique.mockResolvedValue({ status: 'REVOKED' });
  await expect(salvarInssManual(db, 'a', '2026-09', 'user', input)).rejects.toMatchObject({ status: 403 });
});

test('new document and changed company invalidate stale revisions', async () => {
  const { db, guides, companies } = database(), input = await inputFor(db);
  guides.push(guide());
  await expect(salvarInssManual(db, 'a', '2026-09', 'user', input)).rejects.toMatchObject({ status: 409 });
  const fresh = await inputFor(db); companies[0].hasProlabore = false;
  await expect(salvarInssManual(db, 'a', '2026-09', 'user', fresh)).rejects.toMatchObject({ status: 409 });
  expect(db.appSetting.upsert).not.toHaveBeenCalled();
});

test.each([{ dueDate: '2026-02-30' }, { dueDate: '2026-10-00' }, { applicable: false }, { responsible: 'a'.repeat(121) }, { note: 12 }, { extra: true }])('invalid state rejected before writes: %j', async invalid => {
  const { db } = database();
  await expect(salvarInssManual(db, 'a', '2026-09', 'user', await inputFor(db, { state: state(invalid) }))).rejects.toMatchObject({ status: 422 });
  expect(db.appSetting.upsert).not.toHaveBeenCalled();
});

test('missing state differs from corrupt persisted state; no fallback overwrites corruption', async () => {
  const { db, settings } = database();
  expect((await lerInssManual(db, 'a', '2026-09')).state).toEqual(state());
  settings.set('operations_manual_inss:v1:a:2026-09', { key: 'operations_manual_inss:v1:a:2026-09', value: null });
  await expect(lerInssManual(db, 'a', '2026-09')).rejects.toMatchObject({ status: 503 });
  expect(db.appSetting.upsert).not.toHaveBeenCalled();
});

test('a second stale save preserves conflict and return-to-company override requires reason', async () => {
  const { db } = database(), input = await inputFor(db, { state: state({ applicable: false, reason: 'Dispensa operacional' }) });
  await salvarInssManual(db, 'a', '2026-09', 'user', input);
  await expect(salvarInssManual(db, 'a', '2026-09', 'user', { ...input, requestId: 'request-other' })).rejects.toMatchObject({ status: 409 });
  await expect(salvarInssManual(db, 'a', '2026-09', 'user', await inputFor(db, { requestId: 'request-return' }))).rejects.toMatchObject({ status: 422 });
});
