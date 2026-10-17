jest.mock('../../notas/apuracao/v2/RecuperacaoCalculo.js', () => ({ contextoOrigemCalculo: jest.fn(async () => ({ hash: 'fiscal', contribuinteCnpj: '123' })) }));
jest.mock('../OperationsService.js', () => ({ lerOperacao: jest.fn(async () => ({ status: 'RELEASED', revision: 'rev', calculation: { calculoId: 'calc' } })) }));
import { executarOperacao } from '../OperationsExecution.js';
import { completarDocumentosOperacao } from '../OperationsDocuments.js';

function setup() {
  const values = new Map([
    ['operations:v1:a:2026-09', { releaseId: 'release' }],
    ['serpro_procuration_status:a', { cnpj: '123', procuradorCnpj: '456', status: 'ATIVA', systems: ['PGDAS-D'], checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString() }],
  ]);
  const db = { appSetting: { findUnique: jest.fn(async ({ where }) => values.has(where.key) ? { value: values.get(where.key) } : null), create: jest.fn(async ({ data }) => { if (values.has(data.key)) throw Error('duplicate'); values.set(data.key, data.value); }), update: jest.fn(async ({ where, data }) => values.set(where.key, data.value)) },
    companyMonthlyCircular: { findUnique: jest.fn(async () => null) }, guide: { findFirst: jest.fn(async () => null) },
    pendenciaPosFechamento: { count: jest.fn(async () => 0) }, $queryRaw: jest.fn() };
  db.$transaction = fn => fn(db);
  const transmit = jest.fn(async args => { await args.antesDeTransmitir(); return { ok: true }; });
  const args = { companyId: 'a', competencia: '2026-09', userId: 'u', isAdmin: true, revision: 'rev' };
  const deps = { transmit, credentials: async () => ({ certificate: { document: '456' } }) };
  return { db, values, transmit, args, deps };
}
test('liberação executa uma vez e a tentativa não é reexecutada após resposta perdida', async () => {
  const { db, transmit, args, deps } = setup();
  await executarOperacao(db, args, deps);
  await expect(executarOperacao(db, args, deps)).rejects.toThrow('já teve uma tentativa');
  expect(transmit).toHaveBeenCalledTimes(1);
  expect(transmit.mock.calls[0][0]).toMatchObject({ somenteDocumentosFaltantes: true, calculoId: 'calc' });
});

test.each([null, {}, { ok: false }])('resposta sem confirmação não grava execução concluída: %j', async result => {
  const { db, values, transmit, args, deps } = setup();
  transmit.mockResolvedValue(result);
  await expect(executarOperacao(db, args, deps)).rejects.toThrow('não confirmou');
  expect(values.get('operations_execution:a:2026-09:release').status).toBe('ATTENTION');
  await expect(executarOperacao(db, args, deps)).rejects.toThrow('já teve uma tentativa');
  expect(transmit).toHaveBeenCalledTimes(1);
});
test('procuração ausente ou vencida bloqueia antes da execução; não a consulta automaticamente', async () => {
  const { db, values, transmit, args, deps } = setup();
  values.delete('serpro_procuration_status:a');
  await expect(executarOperacao(db, args, deps)).rejects.toThrow('Procuração');
  expect(transmit).not.toHaveBeenCalled(); expect(db.appSetting.create).not.toHaveBeenCalled();
});
test('nota retroativa entre aceite e transmissão bloqueia callback; resultado incerto não é repetido', async () => {
  const { db, transmit, args, deps } = setup();
  transmit.mockImplementation(async input => { db.pendenciaPosFechamento.count.mockResolvedValue(1); await input.antesDeTransmitir(); throw Error('não deveria chegar aqui'); });
  await expect(executarOperacao(db, args, deps)).rejects.toThrow('posterior');
  await expect(executarOperacao(db, args, deps)).rejects.toThrow('já teve uma tentativa');
  expect(transmit).toHaveBeenCalledTimes(1);
});
test('entrega comprovada com todos os documentos não transmite nem consulta', async () => {
  const { db, transmit, args, deps } = setup();
  db.companyMonthlyCircular.findUnique.mockResolvedValue({ pgdasNumeroDeclaracao: 'n', pgdasDeclaracaoFileId: 'd', pgdasReciboFileId: 'r' });
  db.guide.findFirst.mockResolvedValue({ pdfBytes: Buffer.from('pdf') });
  const sync = jest.fn(), capture = jest.fn(); deps.documents = { sync, capture };
  expect((await executarOperacao(db, args, deps)).jaDeclarado).toBe(true);
  expect(transmit).not.toHaveBeenCalled(); expect(sync).not.toHaveBeenCalled(); expect(capture).not.toHaveBeenCalled();
});
test('extrato salvo e DAS ausente busca somente DAS; guia manual não é substituída', async () => {
  const { db } = setup();
  db.companyMonthlyCircular.findUnique.mockResolvedValue({ pgdasNumeroDeclaracao: 'n', pgdasDeclaracaoFileId: 'd', pgdasReciboFileId: 'r' });
  const sync = jest.fn(), capture = jest.fn(async () => db.guide.findFirst.mockResolvedValue({ pdfBytes: Buffer.from('pdf') }));
  const out = await completarDocumentosOperacao(db, { portalClientId: 'a', competencia: '2026-09' }, { sync, capture });
  expect(out.guia.ok).toBe(true); expect(sync).not.toHaveBeenCalled(); expect(capture).toHaveBeenCalledTimes(1);
  await completarDocumentosOperacao(db, { portalClientId: 'a', competencia: '2026-09' }, { sync, capture });
  expect(capture).toHaveBeenCalledTimes(1);
});

test('pausa durante extrato interrompe a operação composta e preserva DAS manual', async () => {
  const { db } = setup();
  db.guide.findFirst.mockResolvedValue({ pdfBytes: Buffer.from('manual') });
  const sync = jest.fn(async () => { throw Object.assign(new Error('interno'), { code: 'SERPRO_EMPRESA_PAUSADA' }); });
  const capture = jest.fn();
  const out = await completarDocumentosOperacao(db, { portalClientId: 'a', competencia: '2026-09' }, { sync, capture });
  expect(out.extrato).toMatchObject({ ok: false, skipped: true, code: 'SERPRO_EMPRESA_PAUSADA', reason: expect.stringContaining('Automação') });
  expect(out.guia).toEqual({ ok: true, reutilizado: true });
  expect(capture).not.toHaveBeenCalled();
});

test.each(['SERPRO_EMPRESA_PAUSADA', 'SERPRO_REGISTRO_INDETERMINADO', 'SERPRO_MEDICAO_INDISPONIVEL', 'SERPRO_CHAMADA_REPETIDA'])('%s não dispara segunda consulta documental', async code => {
  const { db } = setup();
  const sync = jest.fn(async () => { throw Object.assign(new Error('texto sensível'), { code }); });
  const capture = jest.fn();
  const out = await completarDocumentosOperacao(db, { portalClientId: 'a', competencia: '2026-09' }, { sync, capture });
  expect(out.extrato.code).toBe(code); expect(out.guia.code).toBe(code);
  expect(JSON.stringify(out)).not.toContain('texto sensível');
  expect(capture).not.toHaveBeenCalled();
});

test('documentos completos não chegam aos conectores mesmo quando eles recusariam por pausa', async () => {
  const { db } = setup();
  db.companyMonthlyCircular.findUnique.mockResolvedValue({ pgdasNumeroDeclaracao: 'n', pgdasDeclaracaoFileId: 'd', pgdasReciboFileId: 'r' });
  db.guide.findFirst.mockResolvedValue({ pdfBytes: Buffer.from('pdf') });
  const forbidden = jest.fn(async () => { throw Error('Nenhuma chamada é permitida'); });
  expect(await completarDocumentosOperacao(db, { portalClientId: 'a', competencia: '2026-09' }, { sync: forbidden, capture: forbidden }))
    .toEqual({ extrato: { ok: true, reutilizado: true }, guia: { ok: true, reutilizado: true } });
  expect(forbidden).not.toHaveBeenCalled();
});

test('motivo da pausa documental persiste na conferência sem rebaixar entrega comprovada', async () => {
  const { db, values, args, deps, transmit } = setup();
  db.companyMonthlyCircular.findUnique.mockResolvedValue({ pgdasNumeroDeclaracao: 'n' });
  deps.documents = { sync: jest.fn(async () => { throw Object.assign(new Error('pausada'), { code: 'SERPRO_EMPRESA_PAUSADA' }); }), capture: jest.fn() };
  const result = await executarOperacao(db, args, deps);
  expect(result.jaDeclarado).toBe(true); expect(transmit).not.toHaveBeenCalled();
  const execution = values.get('operations_execution:a:2026-09:release');
  expect(execution.message).toContain('pausadas');
  expect(execution.documentos.guia.code).toBe('SERPRO_EMPRESA_PAUSADA');
  expect(deps.documents.capture).not.toHaveBeenCalled();
});
