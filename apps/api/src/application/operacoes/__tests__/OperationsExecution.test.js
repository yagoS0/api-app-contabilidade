jest.mock('../../notas/apuracao/v2/RecuperacaoCalculo.js', () => ({ contextoOrigemCalculo: jest.fn(async () => ({ hash: 'fiscal', contribuinteCnpj: '123' })) }));
jest.mock('../OperationsService.js', () => ({ lerOperacao: jest.fn(async () => ({ status: 'RELEASED', revision: 'rev', calculation: { calculoId: 'calc' } })) }));
import { executarOperacao, conferirEvolucaoDocumental } from '../OperationsExecution.js';
import { completarDocumentosOperacao } from '../OperationsDocuments.js';
import { contextoSerproAtual } from '../../fiscal/serpro/serproCallContext.js';

test.each(['valido', 'empresa', 'cnpj', 'competencia', 'empresa-circular', 'arquivo-declaracao', 'arquivo-recibo'])('retorno documental (%s) exige identidade e preserva extrato na recusa', async mismatch => {
  const { db, values, args, deps, transmit } = setup();
  const originalProof = { calculoId: 'calc', fiscal: 'original' };
  const snapshot = { idempotencyKey: 'calc', estado: 'calculada', simulacaoSerpro: { _portalCalculo: originalProof } };
  db.apuracaoSnapshot = { findUnique: jest.fn(async () => snapshot) };
  db.portalClient = { findUnique: jest.fn(async () => ({ id: 'a', cnpj: '123' })) };
  values.set('operations:v1:a:2026-09', { status: 'RELEASED', releaseId: 'release', contextHash: 'fiscal' });
  const persisted = { id: 'circle', portalClientId: 'a', competencia: '2026-09', pgdasNumeroDeclaracao: 'declaration', pgdasDeclaracaoFileId: 'file-d', pgdasReciboFileId: 'file-r' };
  const sync = jest.fn(async () => {
    // O documento correto foi salvo; somente o retorno da fronteira diverge.
    db.companyMonthlyCircular.findUnique.mockResolvedValue(persisted);
    const result = { company: { id: 'a', cnpj: '123' }, circular: { ...persisted }, dados: { numeroDeclaracao: 'declaration' },
      files: { declaracaoFileId: 'file-d', reciboFileId: 'file-r' } };
    if (mismatch === 'empresa') result.company.id = 'outra';
    if (mismatch === 'cnpj') result.company.cnpj = '999';
    if (mismatch === 'competencia') result.circular.competencia = '2026-08';
    if (mismatch === 'empresa-circular') result.circular.portalClientId = 'outra';
    if (mismatch === 'arquivo-declaracao') result.files.declaracaoFileId = 'outro-arquivo';
    if (mismatch === 'arquivo-recibo') result.files.reciboFileId = 'outro-recibo';
    return result;
  });
  const capture = jest.fn(async () => {
    if (mismatch !== 'valido') throw Error('DAS não pode ser consultado após recusa documental');
    db.guide.findFirst.mockResolvedValue({ pdfBytes: Buffer.from('DAS sintético sem validade fiscal') });
  });
  transmit.mockImplementation(async () => {
    snapshot.estado = 'transmitida';
    return { ok: true, jaDeclarado: true, posTransmissao: await completarDocumentosOperacao(db,
      { portalClientId: 'a', competencia: '2026-09' }, { sync, capture }) };
  });
  const result = await executarOperacao(db, args, deps);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(sync).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: 'a', competencia: '2026-09', somenteDocumentos: true }));
  expect(result.posTransmissao.extrato.ok).toBe(true);
  const saved = values.get('operations_execution:a:2026-09:release');
  expect(saved.status).toBe('DONE');
  if (mismatch === 'valido') {
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith({ portalClientId: 'a', competencia: '2026-09', somenteDocumentos: true });
    expect(saved.evolucaoDocumental.documento).toMatchObject({ numeroDeclaracao: 'declaration', declaracaoFileId: 'file-d', reciboFileId: 'file-r' });
    expect(result.posTransmissao.guia.ok).toBe(true); expect(saved.message).toBeNull();
  } else {
    expect(capture).not.toHaveBeenCalled();
    expect(saved.evolucaoDocumental).toBeUndefined();
    expect(result.posTransmissao.guia).toMatchObject({ ok: false, skipped: true, code: 'AUTOMACAO_EMPRESA_VERIFICACAO_INDISPONIVEL' });
    expect(saved.documentos.guia.ok).toBe(false);
    expect(saved.message).toContain('Liberação não confirmada');
  }
  expect(await db.companyMonthlyCircular.findUnique({})).toEqual(persisted);
  expect(snapshot.simulacaoSerpro._portalCalculo).toEqual(originalProof);
  await expect(executarOperacao(db, args, deps)).rejects.toThrow('já teve uma tentativa');
  expect(transmit).toHaveBeenCalledTimes(1);
  expect(sync).toHaveBeenCalledTimes(1); expect(capture).toHaveBeenCalledTimes(mismatch === 'valido' ? 1 : 0);
});

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

test.each(['SERPRO_EMPRESA_PAUSADA', 'SERPRO_REGISTRO_INDETERMINADO', 'SERPRO_MEDICAO_INDISPONIVEL', 'SERPRO_CHAMADA_REPETIDA', 'CICLO_FISCAL_PAUSADO', 'CICLO_FISCAL_INDISPONIVEL', 'CICLO_FISCAL_REVISAO_ALTERADA', 'AUTOMACAO_EMPRESA_PAUSADA', 'AUTOMACAO_EMPRESA_INDISPONIVEL', 'AUTOMACAO_EMPRESA_VERIFICACAO_INDISPONIVEL'])('%s não dispara segunda consulta documental', async code => {
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

test.each(['DONE', 'ATTENTION'])('evidência suplementar da claim sobrevive ao terminal %s', async terminal => {
  const { db, values, args, deps, transmit } = setup();
  const proof = { calculoId: 'calc', prova: 'original' };
  const snapshot = { idempotencyKey: 'calc', estado: 'transmitida', simulacaoSerpro: { _portalCalculo: proof } };
  db.apuracaoSnapshot = { findUnique: jest.fn(async () => snapshot) };
  db.portalClient = { findUnique: jest.fn(async () => ({ id: 'a', cnpj: '123' })) };
  const circular = { id: 'circle', portalClientId: 'a', competencia: '2026-09', pgdasNumeroDeclaracao: 'declaration', pgdasDeclaracaoFileId: 'file-d', pgdasReciboFileId: 'file-r' };
  values.set('operations:v1:a:2026-09', { status: 'RELEASED', releaseId: 'release', contextHash: 'fiscal' });
  transmit.mockImplementation(async () => {
    db.companyMonthlyCircular.findUnique.mockResolvedValue(circular);
    await contextoSerproAtual().registrarEvolucaoDocumental({ before: { id: null, numeroDeclaracao: null }, result: {
      company: { id: 'a', cnpj: '123' }, circular, dados: { numeroDeclaracao: 'declaration' }, files: { declaracaoFileId: 'file-d', reciboFileId: 'file-r' },
    } });
    if (terminal === 'ATTENTION') throw Error('Falha posterior à evidência');
    return { ok: true };
  });
  if (terminal === 'ATTENTION') await expect(executarOperacao(db, args, deps)).rejects.toThrow('posterior');
  else await executarOperacao(db, args, deps);
  const saved = values.get('operations_execution:a:2026-09:release');
  expect(saved.status).toBe(terminal);
  expect(saved.evolucaoDocumental).toMatchObject({ releaseId: 'release', calculoId: 'calc', documento: { numeroDeclaracao: 'declaration', declaracaoFileId: 'file-d', reciboFileId: 'file-r' } });
  expect(snapshot.simulacaoSerpro._portalCalculo).toEqual(proof);
  await expect(executarOperacao(db, args, deps)).rejects.toThrow('já teve uma tentativa');
  expect(transmit).toHaveBeenCalledTimes(1);
});

test('releitura JSONB da evidência não depende da ordem das propriedades e preserva os ids', async () => {
  const { db, values, args, deps, transmit } = setup();
  const proof = { z: 'original', a: 'fiscal' };
  const snapshot = { idempotencyKey: 'calc', estado: 'transmitida', simulacaoSerpro: { _portalCalculo: proof } };
  db.apuracaoSnapshot = { findUnique: jest.fn(async () => snapshot) };
  db.portalClient = { findUnique: jest.fn(async () => ({ id: 'a', cnpj: '123' })) };
  const circular = { id: 'circle', portalClientId: 'a', competencia: '2026-09', pgdasNumeroDeclaracao: 'declaration', pgdasDeclaracaoFileId: 'file-d', pgdasReciboFileId: 'file-r' };
  values.set('operations:v1:a:2026-09', { status: 'RELEASED', releaseId: 'release', contextHash: 'fiscal' });
  transmit.mockImplementation(async () => {
    db.companyMonthlyCircular.findUnique.mockResolvedValue(circular);
    await contextoSerproAtual().registrarEvolucaoDocumental({ before: { id: null, numeroDeclaracao: null }, result: {
      company: { id: 'a', cnpj: '123' }, circular, dados: { numeroDeclaracao: 'declaration' }, files: { declaracaoFileId: 'file-d', reciboFileId: 'file-r' },
    } });
    const saved = values.get('operations_execution:a:2026-09:release');
    saved.evolucaoDocumental.documento = Object.fromEntries(Object.entries(saved.evolucaoDocumental.documento).reverse());
    const input = { companyId: 'a', competencia: '2026-09', releaseId: 'release', calculoId: 'calc', calculationProof: { a: 'fiscal', z: 'original' } };
    await expect(conferirEvolucaoDocumental(db, input)).resolves.toMatchObject({ documento: { declaracaoFileId: 'file-d' } });
    saved.evolucaoDocumental.documento.declaracaoFileId = 'other-file';
    await expect(conferirEvolucaoDocumental(db, input)).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_VERIFICACAO_INDISPONIVEL' });
    return { ok: true };
  });
  await executarOperacao(db, args, deps);
});
