import { executarCicloSimples, lerCicloSimples, revisarCicloSimples } from '../CicloSimplesService.js';

const args = { portalClientId: 'empresa-a', competencia: '2026-10', scheduledAt: '2026-11-08T10:00:00.000Z' };
function fixture() {
  const rows = new Map([['ciclo_simples_config:empresa-a', { enabled: true, fontes: ['NFSE'] }]]);
  let queue = Promise.resolve();
  const db = {
    appSetting: {
      findUnique: jest.fn(async ({ where }) => rows.has(where.key) ? { key: where.key, value: structuredClone(rows.get(where.key)) } : null),
      upsert: jest.fn(async ({ where, create, update }) => { const value = structuredClone(rows.has(where.key) ? update.value : create.value); rows.set(where.key, value); return { key: where.key, value }; }),
      create: jest.fn(async ({ data }) => { if (rows.has(data.key)) throw Object.assign(new Error('duplicate'), { code: 'P2002' }); rows.set(data.key, structuredClone(data.value)); return data; }),
    },
    portalClient: { findUnique: jest.fn(async ({ where }) => ({ id: where.id, cnpj: '11222333000181', status: 'ACTIVE', companyId: 'legacy-a' })) },
    cadastroFiscal: { findUnique: jest.fn(async () => ({ regime: 'SIMPLES_NACIONAL', regimeApuracao: 'COMPETENCIA', cnaePrincipal: '6201501', usaFatorR: false, dataOpcaoSN: '2020-01-01' })) },
    regimeHistorico: { findMany: jest.fn(async () => []) },
    company: { findUnique: jest.fn(async () => ({ regimeTributario: 'SIMPLES', tipoTributario: null })) },
    user: { findUnique: jest.fn(async () => ({ status: 'active', role: 'user', accountType: 'FIRM' })) },
    companyFirmAccess: { findUnique: jest.fn(async () => ({ status: 'ACTIVE', role: 'ACCOUNTANT' })) },
    $queryRaw: jest.fn(async () => []),
  };
  db.$transaction = run => { const promise = queue.then(() => run(db)); queue = promise.catch(() => {}); return promise; };
  const dados = { estado: 'aberta', rbt12: 12000, rbt12Origem: 'EXTRATO_PGDAS', origemAtividades: 'notas', semClassificacao: 0, atividades: [{ idAtividade: 1, valorInterno: 100, valorExterno: 0, sujeitoFatorR: false }], faturamento: { total: 100 }, disparidades: [] };
  const deps = { db, now: () => new Date(args.scheduledAt), conferir: jest.fn(async () => ({ version: 1 })),
    contexto: jest.fn(async ({ portalClientId, competencia }) => ({ versao: 1, hash: `${portalClientId}:${competencia}:notas-v1` })),
    coletarAdn: jest.fn(async () => ({ ok: true, complete: true, totalDocs: 2, newCursor: '20' })),
    coletarDfe: jest.fn(async () => ({ ok: true, complete: true, totalDocs: 1, newCursor: '30' })),
    getDados: jest.fn(async () => dados), calcular: jest.fn(async () => ({ ok: true, calculoId: 'calc-v1', dasValor: 6 })),
  };
  return { rows, db, deps, dados };
}
test('coleta final completa calcula uma vez e retorna vínculo do snapshot aguardando contador', async () => {
  const { deps } = fixture();
  const result = await executarCicloSimples(args, deps);
  expect(result).toMatchObject({ status: 'CALCULADO', revision: 1, canRevise: true, calculo: { calculoId: 'calc-v1', dasValor: '6' } });
  expect(deps.calcular).toHaveBeenCalledWith(expect.objectContaining({ portalClientId: args.portalClientId, competencia: args.competencia, regimeApuracao: 'COMPETENCIA', semMovimento: false, expectedAutomaticContextHash: expect.any(String) }));
  await executarCicloSimples(args, deps);
  expect(deps.calcular).toHaveBeenCalledTimes(1);
  expect(deps.coletarAdn).toHaveBeenCalledTimes(1);
});
test('duas execuções concorrentes compartilham uma reserva durável', async () => {
  const { deps, rows } = fixture();
  await Promise.all([executarCicloSimples(args, deps), executarCicloSimples(args, deps)]);
  expect(deps.calcular).toHaveBeenCalledTimes(1);
  expect(rows.get('ciclo_simples:empresa-a:2026-10').calculo.attemptId).toBeTruthy();
});
test('coleta diária antes do dia8 não simula; janela repetida não consulta novamente', async () => {
  const { deps } = fixture();
  deps.now = () => new Date('2026-11-07T10:00:00Z');
  const input = { ...args, scheduledAt: deps.now().toISOString() };
  expect(await executarCicloSimples(input, deps)).toMatchObject({ status: 'AGUARDANDO_COLETA_FINAL' });
  await executarCicloSimples(input, deps);
  expect(deps.coletarAdn).toHaveBeenCalledTimes(1);
  expect(deps.calcular).not.toHaveBeenCalled();
});
test.each([{ ok: true, partial: true, complete: false }, { ok: true }, { ok: false, complete: false }])('resposta incompleta não prova completude: %j', async response => {
  const { deps } = fixture();
  deps.coletarAdn.mockResolvedValue(response);
  expect(await executarCicloSimples(args, deps)).toMatchObject({ status: 'COLETA_PARCIAL', canRevise: true });
  expect(deps.calcular).not.toHaveBeenCalled();
});
test('erro após reserva é incerto; revisão e reinício não repetem chamada', async () => {
  const { deps } = fixture();
  deps.calcular.mockRejectedValue(Object.assign(new Error('Resposta perdida'), { code: 'TIMEOUT' }));
  expect(await executarCicloSimples(args, deps)).toMatchObject({ status: 'INCERTO', canRevise: false });
  await executarCicloSimples(args, deps);
  await expect(revisarCicloSimples({ ...args, expectedRevision: 1, userId: 'contador', motivo: 'Conferir resultado' }, deps)).rejects.toMatchObject({ code: 'CICLO_RESULTADO_PENDENTE' });
  expect(deps.calcular).toHaveBeenCalledTimes(1);
});
test('revisão de recusa local é auditada, sem chamada; perda de acesso impede nova revisão', async () => {
  const { deps, db, rows, dados } = fixture();
  dados.semClassificacao = 100;
  expect(await executarCicloSimples(args, deps)).toMatchObject({ status: 'REVISAO_NECESSARIA' });
  const request = { ...args, expectedRevision: 1, userId: 'contador', motivo: 'Classificação corrigida' };
  db.companyFirmAccess.findUnique.mockResolvedValueOnce(null);
  await expect(revisarCicloSimples(request, deps)).rejects.toMatchObject({ status: 403 });
  expect(await revisarCicloSimples(request, deps)).toMatchObject({ revision: 2, status: 'AGUARDANDO_COLETA_FINAL' });
  expect(rows.get('ciclo_simples:empresa-a:2026-10:revisao:1')).toMatchObject({ userId: 'contador', motivo: request.motivo, before: { revision: 1 } });
  expect(deps.calcular).not.toHaveBeenCalled();
});
test('cadastro fiscal ausente produz motivo persistido sem consulta', async () => {
  const { deps, db } = fixture(); db.cadastroFiscal.findUnique.mockResolvedValue(null);
  expect(await executarCicloSimples(args, deps)).toMatchObject({ status: 'REVISAO_NECESSARIA', errorCode: 'CICLO_CONFIGURACAO_FISCAL' });
  expect(await lerCicloSimples(args, deps)).toMatchObject({ reason: expect.stringContaining('cadastro fiscal') });
  expect(deps.coletarAdn).not.toHaveBeenCalled();
});
test('histórico de outro regime impede usar cadastro atual para competência passada', async () => {
  const { deps, db } = fixture(); db.regimeHistorico.findMany.mockResolvedValue([{ regime: 'LUCRO_PRESUMIDO', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-10-31' }]);
  expect(await executarCicloSimples(args, deps)).toMatchObject({ errorCode: 'CICLO_REGIME_HISTORICO' });
  expect(deps.calcular).not.toHaveBeenCalled();
});
test.each([{ regimeTributario: 'LUCRO_PRESUMIDO' }, { regimeTributario: 'LUCRO_REAL' }, { regimeTributario: null, tipoTributario: null }, null])('sem histórico, Company incoerente não permite usar cadastro fiscal antigo: %j', async company => {
  const { deps, db } = fixture();
  db.company.findUnique.mockResolvedValue(company);
  expect(await executarCicloSimples(args, deps)).toMatchObject({ status: 'REVISAO_NECESSARIA', errorCode: 'CICLO_REGIME_ATUAL_DIVERGENTE' });
  expect(deps.coletarAdn).not.toHaveBeenCalled();
  expect(deps.coletarDfe).not.toHaveBeenCalled();
  expect(deps.calcular).not.toHaveBeenCalled();
});
test('histórico Simples de toda a competência prevalece sobre Company atual em outro regime', async () => {
  const { deps, db } = fixture();
  db.company.findUnique.mockResolvedValue({ regimeTributario: 'LUCRO_PRESUMIDO' });
  db.regimeHistorico.findMany.mockResolvedValue([{ regime: 'SIMPLES', vigenciaInicio: '2026-01-01', vigenciaFim: '2026-10-31' }]);
  expect(await executarCicloSimples(args, deps)).toMatchObject({ status: 'CALCULADO' });
  expect(db.company.findUnique).not.toHaveBeenCalled();
  expect(deps.coletarAdn).toHaveBeenCalledTimes(1);
  expect(deps.calcular).toHaveBeenCalledTimes(1);
});
test('mudança do Company atual entre fontes interrompe a próxima coleta quando não há histórico', async () => {
  const { deps, db, rows } = fixture();
  rows.set('ciclo_simples_config:empresa-a', { enabled: true, fontes: ['NFSE', 'NFE'] });
  deps.coletarAdn.mockImplementation(async () => { db.company.findUnique.mockResolvedValue({ regimeTributario: 'LUCRO_PRESUMIDO' }); return { ok: true, complete: true }; });
  expect(await executarCicloSimples(args, deps)).toMatchObject({ status: 'REVISAO_NECESSARIA', errorCode: 'CICLO_REGIME_ATUAL_DIVERGENTE' });
  expect(deps.coletarDfe).not.toHaveBeenCalled();
  expect(deps.calcular).not.toHaveBeenCalled();
});
test('pausa empresarial durante preparo interrompe antes da simulação', async () => {
  const { deps } = fixture();
  deps.getDados.mockImplementation(async () => { deps.conferir.mockRejectedValue(Object.assign(new Error('Empresa pausada'), { code: 'AUTOMACAO_EMPRESA_PAUSADA' })); return fixture().dados; });
  expect(await executarCicloSimples(args, deps)).toMatchObject({ status: 'REVISAO_NECESSARIA', errorCode: 'AUTOMACAO_EMPRESA_PAUSADA' });
  expect(deps.calcular).not.toHaveBeenCalled();
});
test('empresa B não herda config ou reserva da A', async () => {
  const { deps } = fixture();
  await executarCicloSimples(args, deps);
  expect(await executarCicloSimples({ ...args, portalClientId: 'empresa-b' }, deps)).toMatchObject({ errorCode: 'CICLO_FONTES_NAO_CONFIGURADAS' });
  expect(deps.calcular).toHaveBeenCalledTimes(1);
});
test('desativar fonte durante a primeira coleta impede a próxima', async () => {
  const { deps, rows } = fixture();
  rows.set('ciclo_simples_config:empresa-a', { enabled: true, fontes: ['NFSE', 'NFE'] });
  deps.coletarAdn.mockImplementation(async () => { rows.set('ciclo_simples_config:empresa-a', { enabled: false, fontes: ['NFSE'] }); return { ok: true, complete: true }; });
  expect(await executarCicloSimples(args, deps)).toMatchObject({ status: 'REVISAO_NECESSARIA' });
  expect(deps.coletarDfe).not.toHaveBeenCalled();
  expect(deps.calcular).not.toHaveBeenCalled();
});
test('mudança relevante após cálculo sinaliza revisão sem nova consulta ou cálculo', async () => {
  const { deps } = fixture(); await executarCicloSimples(args, deps);
  deps.contexto.mockResolvedValue({ versao: 1, hash: 'notas-v2' });
  expect(await lerCicloSimples(args, deps)).toMatchObject({ status: 'REVISAO_NECESSARIA', canRevise: true });
  expect(deps.calcular).toHaveBeenCalledTimes(1);
});
test('coleta órfã permite revisão auditada, mas reserva de cálculo órfã continua incerta', async () => {
  const { deps, rows } = fixture();
  const key = 'ciclo_simples:empresa-a:2026-10';
  rows.set(key, { ...args, revision: 1, status: 'COLETANDO', updatedAt: '2026-11-08T08:00:00Z', calculo: null });
  expect(await lerCicloSimples(args, deps)).toMatchObject({ status: 'REVISAO_NECESSARIA', canRevise: true });
  await revisarCicloSimples({ ...args, userId: 'contador', expectedRevision: 1, motivo: 'Documentos conferidos após interrupção' }, deps);
  expect(rows.get(key)).toMatchObject({ revision: 2 });
  rows.set(key, { ...args, revision: 2, status: 'CALCULANDO', updatedAt: '2026-11-08T08:00:00Z', calculo: { attemptId: 'tentativa' } });
  expect(await lerCicloSimples(args, deps)).toMatchObject({ status: 'INCERTO', canRevise: false });
  await expect(revisarCicloSimples({ ...args, userId: 'contador', expectedRevision: 2, motivo: 'Conferir tentativa' }, deps)).rejects.toMatchObject({ code: 'CICLO_RESULTADO_PENDENTE' });
  expect(deps.calcular).not.toHaveBeenCalled();
});
test.each(['2026-11-09T10:00:00Z', '2026-12-08T10:00:00Z'])('fora da competência/janela não consulta: %s', async scheduledAt => {
  const { deps } = fixture(); deps.now = () => new Date(scheduledAt);
  await expect(executarCicloSimples({ ...args, scheduledAt }, deps)).rejects.toMatchObject({ code: 'CICLO_FORA_DA_JANELA' });
  expect(deps.coletarAdn).not.toHaveBeenCalled();
});
