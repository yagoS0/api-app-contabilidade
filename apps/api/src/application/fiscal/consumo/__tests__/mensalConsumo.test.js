import { randomUUID } from 'node:crypto';
import { lerMensalConsumo, executarAcaoMensalConsumo, listarHistoricoMensalConsumo, centavosExatos } from '../MensalConsumoService.js';
import { carregarGrupo, ultimaConfiguracao, enquadramentos } from '../ApuracaoConsumoService.js';
jest.mock('../ApuracaoConsumoService.js', () => ({ carregarGrupo: jest.fn(), ultimaConfiguracao: jest.fn(), enquadramentos: jest.fn(), transacao: (db, fn) => db.$transaction(fn) }));
const ctx = { tributo: 'CBS', ambiente: 'HOMOLOGACAO', competencia: '2026-10' }, user = { id: 'contador' };
const ev = { referencia: 'arquivo externo/documento.pdf', sha256: 'a'.repeat(64), descricao: 'Documento sintético referenciado' };
const base = (patch = {}) => ({ valoresDeclarados: { debitosCentavos: '10000', creditosCentavos: '100' },
  tratamento: { tipo: 'REGULAR_PADRAO', evidencia: ev },
  cobertura: { inicio: '2026-10-01', fim: '2026-10-31', estabelecimentoIds: ['a'], recursos: ['DEBITOS', 'CREDITOS'], evidencia: ev }, pendencias: [], ...patch });
let db, rows, docs, versao;
const matches = (r, q = {}) => Object.entries(q).every(([k, v]) => r[k] === v);
beforeEach(() => {
  rows = []; docs = []; versao = 0;
  carregarGrupo.mockResolvedValue({ id: 'grupo', estabelecimentos: [{ id: 'a', razao: 'Sintética', cnpj: '12345678000195' }] });
  ultimaConfiguracao.mockResolvedValue({ id: 'config', habilitado: true }); enquadramentos.mockResolvedValue([{ regularConfirmado: true, periodo: { regime: 'LUCRO_REAL' } }]);
  const model = list => ({
    findFirst: jest.fn(async ({ where }) => list().filter(r => matches(r, where)).sort((a, b) => b.versao - a.versao)[0] || null),
    findMany: jest.fn(async ({ where, take, select }) => list().filter(r => matches(r, where)).sort((a, b) => b.versao - a.versao).slice(0, take).map(r => select ? Object.fromEntries(Object.keys(select).map(k => [k, r[k]])) : r)),
    create: jest.fn(async ({ data }) => { const row = { id: randomUUID(), createdAt: new Date(), ...data }; list().push(structuredClone(row)); return row; }),
  });
  db = { apuracaoConsumoMesLocal: model(() => rows), apuracaoConsumoDocumentoLocal: model(() => docs) };
  db.$transaction = async fn => { const oldRows = structuredClone(rows), oldDocs = structuredClone(docs); try { return await fn(db); } catch (e) { rows = oldRows; docs = oldDocs; throw e; } };
});
async function agir(acao, dados, extra = {}) {
  const contextoHash = acao === 'REGISTRAR_BASE' ? (await lerMensalConsumo(db, 'a', { ...ctx, ...Object.fromEntries(Object.entries(extra).filter(([k]) => ['tributo', 'ambiente', 'competencia'].includes(k))) }, user)).contextoHash : undefined;
  const result = await executarAcaoMensalConsumo(db, 'a', { id: randomUUID(), versao, ...ctx, contextoHash, acao, dados, ...extra }, user);
  versao = result.versao; return result;
}
const guia = (patch = {}) => agir('REGISTRAR_GUIA', { referencia: 'GUIA-1', valorCentavos: '10000', vencimento: '2026-11-20', evidencia: ev, ...patch });
const pagar = (patch = {}) => agir('REGISTRAR_PAGAMENTO', { referencia: 'PAG-1', valorCentavos: '6000', data: '2026-11-20', tipo: 'PAGAMENTO_MANUAL', evidencia: ev, ...patch });
test('GET é local, sem escrita, com oficiais desconhecidos e capacidades externas OFF', async () => {
  const r = await lerMensalConsumo(db, 'a', ctx, user);
  expect(r).toMatchObject({ versao: 0, estado: 'EM_CONFERENCIA', podeConferir: false, valoresOficiais: null, capacidades: { emitirGuia: false, confirmarOficial: false, consultarPagamento: false } });
  expect(rows).toHaveLength(0); expect(docs).toHaveLength(0); expect(carregarGrupo).toHaveBeenCalledWith(db, 'a', user, true);
});
test.each([1, 1.1, '-1', '0.10', '1e2', '01', '1000000000000000000', ' 1'])('valor não exato é recusado: %s', value => expect(() => centavosExatos(value)).toThrow());
test('conferência incompleta é bloqueada; zero declarado com cobertura permite somente CONFERIDA_LOCAL', async () => {
  await expect(agir('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Teste', evidencia: ev })).rejects.toMatchObject({ status: 409 });
  await agir('REGISTRAR_BASE', base({ valoresDeclarados: { debitosCentavos: '0', creditosCentavos: '0' } }));
  const r = await agir('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Documentos conferidos', evidencia: ev });
  expect(r.estado).toBe('CONFERIDA_LOCAL'); expect(r.valoresOficiais).toBeNull();
  expect(r.dados.conferencia.confirmacaoOficial).toBe(false); expect(r.dados.cobertura.coberturaOficial).toBe(false);
});
test('cobertura parcial, recurso ausente e cadastro/config desabilitados bloqueiam conferência', async () => {
  await agir('REGISTRAR_BASE', base({ cobertura: { ...base().cobertura, fim: '2026-10-30', recursos: ['DEBITOS'] } }));
  expect((await lerMensalConsumo(db, 'a', ctx, user)).pendenciasCalculadas.map(p => p.codigo)).toContain('COBERTURA_INCOMPLETA');
  ultimaConfiguracao.mockResolvedValue({ id: 'config', habilitado: false }); enquadramentos.mockResolvedValue([{ regularConfirmado: false }]);
  await expect(agir('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Teste', evidencia: ev })).rejects.toMatchObject({ status: 409 });
});
test('pendência exige resolução com evidência e nova base reinicia resoluções', async () => {
  const pendencia = { id: randomUUID(), descricao: 'Documento divergente' };
  await agir('REGISTRAR_BASE', base({ pendencias: [pendencia] }));
  await expect(agir('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Teste', evidencia: ev })).rejects.toMatchObject({ status: 409 });
  await agir('RESOLVER_PENDENCIA', { pendenciaId: pendencia.id, resolucao: 'Revisado', evidencia: ev });
  expect((await agir('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Teste', evidencia: ev })).estado).toBe('CONFERIDA_LOCAL');
  const r = await agir('REGISTRAR_BASE', base({ pendencias: [pendencia] }));
  expect(r.dados.pendencias[0].resolvida).toBe(false); expect(r.estado).toBe('EM_CONFERENCIA');
  expect(rows[1].dados.pendencias[0].resolvida).toBe(true);
});
test('mudança cadastral invalida conferência mesmo após registrar guia', async () => {
  await agir('REGISTRAR_BASE', base()); await agir('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Teste', evidencia: ev });
  ultimaConfiguracao.mockResolvedValue({ id: 'nova-config', habilitado: true });
  const r = await guia(); expect(r.desatualizada).toBe(true); expect(r.estado).toBe('EM_CONFERENCIA');
  await expect(agir('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Teste', evidencia: ev })).rejects.toMatchObject({ status: 409 });
});
test('guia não cria pagamento; alocação parcial respeita ambos saldos', async () => {
  const g = (await guia()).dados.guias[0]; expect(rows[0].dados.pagamentos).toHaveLength(0);
  const p = (await pagar()).dados.pagamentos[0];
  const r = await agir('ALOCAR', { guiaId: g.id, pagamentoId: p.id, valorCentavos: '4000' });
  expect(r.dados.guias[0]).toMatchObject({ saldoCentavos: '6000', estadoLocal: 'PARCIAL_LOCALMENTE' });
  expect(r.dados.pagamentos[0].saldoCentavos).toBe('2000');
  await expect(agir('ALOCAR', { guiaId: g.id, pagamentoId: p.id, valorCentavos: '3000' })).rejects.toMatchObject({ status: 409 });
  expect(rows).toHaveLength(3);
});
test('alocação de valor além da precisão Number preserva cada centavo', async () => {
  const g = (await guia({ valorCentavos: '999999999999999999' })).dados.guias[0];
  const p = (await pagar({ valorCentavos: '999999999999999998' })).dados.pagamentos[0];
  const r = await agir('ALOCAR', { guiaId: g.id, pagamentoId: p.id, valorCentavos: '999999999999999998' });
  expect(r.dados.guias[0].saldoCentavos).toBe('1'); expect(r.dados.pagamentos[0].saldoCentavos).toBe('0');
});
test('intenção repetida não duplica pagamento nem regride estado, conteúdo divergente recusa', async () => {
  const id = randomUUID(), dados = { referencia: 'PAG-1', valorCentavos: '6000', data: '2026-11-20', tipo: 'PAGAMENTO_MANUAL', evidencia: ev };
  const entrada = { id, versao: 0, ...ctx, acao: 'REGISTRAR_PAGAMENTO', dados };
  await executarAcaoMensalConsumo(db, 'a', entrada, user); versao = 1; await guia();
  const r = await executarAcaoMensalConsumo(db, 'a', entrada, user); expect(r.versao).toBe(2); expect(r.dados.pagamentos).toHaveLength(1); expect(docs).toHaveLength(2);
  await expect(executarAcaoMensalConsumo(db, 'a', { ...entrada, dados: { ...dados, valorCentavos: '1' } }, user)).rejects.toMatchObject({ status: 409 });
});
test('referência normalizada não pode duplicar em outro mês; ambiente/tributo são isolados', async () => {
  await pagar();
  await expect(agir('REGISTRAR_PAGAMENTO', { referencia: ' pag-1 ', valorCentavos: '1', data: '2026-11-20', tipo: 'EXTINCAO_MANUAL', evidencia: ev }, { competencia: '2026-11', versao: 0 })).rejects.toMatchObject({ status: 409 });
  const r = await agir('REGISTRAR_PAGAMENTO', { referencia: 'PAG-1', valorCentavos: '1', data: '2026-11-20', tipo: 'EXTINCAO_MANUAL', evidencia: ev }, { tributo: 'IBS', versao: 0 });
  expect(r.dados.pagamentos).toHaveLength(1); expect(docs).toHaveLength(2);
});
test('cancelamento exige estorno; estorno único recompõe saldos sem apagar histórico', async () => {
  const g = (await guia()).dados.guias[0], p = (await pagar()).dados.pagamentos[0];
  const alocacao = (await agir('ALOCAR', { guiaId: g.id, pagamentoId: p.id, valorCentavos: '6000' })).dados.alocacoes[0];
  await expect(agir('CANCELAR_PAGAMENTO', { pagamentoId: p.id, motivo: 'Erro', evidencia: ev })).rejects.toMatchObject({ status: 409 });
  const r = await agir('ESTORNAR_ALOCACAO', { alocacaoId: alocacao.id, motivo: 'Erro', evidencia: ev });
  expect(r.dados.guias[0].saldoCentavos).toBe('10000'); expect(r.dados.pagamentos[0].saldoCentavos).toBe('6000');
  await expect(agir('ESTORNAR_ALOCACAO', { alocacaoId: alocacao.id, motivo: 'Erro', evidencia: ev })).rejects.toMatchObject({ status: 409 });
  expect((await agir('CANCELAR_GUIA', { guiaId: g.id, motivo: 'Erro', evidencia: ev })).dados.guias[0].cancelada).toBe(true);
  expect((await agir('CANCELAR_PAGAMENTO', { pagamentoId: p.id, motivo: 'Erro', evidencia: ev })).dados.pagamentos[0].cancelado).toBe(true);
  expect(rows[2].dados.alocacoes[0].estornada).toBe(false);
});
test('IDs de outro contexto e versão obsoleta não alocam', async () => {
  await guia();
  await expect(agir('ALOCAR', { guiaId: randomUUID(), pagamentoId: randomUUID(), valorCentavos: '1' })).rejects.toMatchObject({ status: 409 });
  await expect(agir('REGISTRAR_BASE', base(), { versao: 0 })).rejects.toMatchObject({ status: 409 });
});
test('datas inválidas, hashes falsos e campo oficial injetado são recusados', async () => {
  await expect(guia({ vencimento: '2026-02-30' })).rejects.toMatchObject({ status: 400 });
  await expect(guia({ evidencia: { ...ev, sha256: 'curto' } })).rejects.toMatchObject({ status: 400 });
  await expect(guia({ confirmadoOficial: true })).rejects.toMatchObject({ status: 400 });
  expect(rows).toHaveLength(0); expect(docs).toHaveLength(0);
});
test('histórico é auditável, sem mutar registro antigo', async () => {
  await guia(); await pagar();
  const historico = await listarHistoricoMensalConsumo(db, 'a', ctx, user);
  expect(historico.historico.map(r => r.versao)).toEqual([2, 1]);
  expect(historico.historico[0]).toMatchObject({ criadoPorId: user.id, acao: 'REGISTRAR_PAGAMENTO' });
  expect(rows[0].dados.pagamentos).toHaveLength(0);
});
test.each(['ESPECIFICO', 'DERE', 'NAO_DEFINIDO'])('tratamento %s permanece não conferível', async tipo => {
  const r = await agir('REGISTRAR_BASE', base({ tratamento: { tipo, evidencia: ev } }));
  expect(r.podeConferir).toBe(false);
  await expect(agir('CONFERIR_LOCAL', { documentosConferidos: true, motivo: 'Teste', evidencia: ev })).rejects.toMatchObject({ status: 409 });
});
test.each(['MEI', 'OUTRO', 'SIMPLES'])('regime %s em 2026 não libera conferência regular', async regime => {
  enquadramentos.mockResolvedValue([{ regularConfirmado: true, periodo: { regime } }]);
  const r = await agir('REGISTRAR_BASE', base()); expect(r.pendenciasCalculadas.map(p => p.codigo)).toContain('REGIME_INCOMPATIVEL');
});
test('nova base não remove nem reescreve pendência aberta para contornar conferência', async () => {
  const p = { id: randomUUID(), descricao: 'Documento ausente' };
  await agir('REGISTRAR_BASE', base({ pendencias: [p] }));
  await expect(agir('REGISTRAR_BASE', base())).rejects.toMatchObject({ status: 409 });
  await expect(agir('REGISTRAR_BASE', base({ pendencias: [{ ...p, descricao: 'Tudo certo' }] }))).rejects.toMatchObject({ status: 409 });
  expect(rows).toHaveLength(1);
});
test.each(['configuracao', 'cadastro', 'estabelecimentos'])('contexto %s alterado com mesma versão mensal rejeita formulário antigo', async tipo => {
  const lido = await lerMensalConsumo(db, 'a', ctx, user);
  if (tipo === 'configuracao') ultimaConfiguracao.mockResolvedValue({ id: 'config-nova', habilitado: true });
  if (tipo === 'cadastro') enquadramentos.mockResolvedValue([{ regularConfirmado: true, cadastroId: 'revisao-nova', periodo: { regime: 'LUCRO_REAL' } }]);
  if (tipo === 'estabelecimentos') carregarGrupo.mockResolvedValue({ id: 'grupo', estabelecimentos: [{ id: 'a', cnpj: '12345678000195' }, { id: 'b', cnpj: '12345678000276' }] });
  await expect(agir('REGISTRAR_BASE', base(), { contextoHash: lido.contextoHash })).rejects.toMatchObject({ status: 409 });
  expect(rows).toHaveLength(0);
  expect((await lerMensalConsumo(db, 'a', ctx, user)).versao).toBe(lido.versao);
});
test('base exige contextoHash; nova leitura permite gravar e hash integra identidade da intenção', async () => {
  await expect(agir('REGISTRAR_BASE', base(), { contextoHash: undefined })).rejects.toMatchObject({ status: 400 });
  const leitura = await lerMensalConsumo(db, 'a', ctx, user), id = randomUUID();
  const entrada = { id, versao: 0, ...ctx, contextoHash: leitura.contextoHash, acao: 'REGISTRAR_BASE', dados: base() };
  const salvo = await executarAcaoMensalConsumo(db, 'a', entrada, user); expect(salvo.versao).toBe(1);
  ultimaConfiguracao.mockResolvedValue({ id: 'config-alterada', habilitado: true });
  const replay = await executarAcaoMensalConsumo(db, 'a', entrada, user);
  expect(replay.desatualizada).toBe(true); expect(rows).toHaveLength(1);
  await expect(executarAcaoMensalConsumo(db, 'a', { ...entrada, contextoHash: replay.contextoHash }, user)).rejects.toMatchObject({ status: 409 });
  const novo = await executarAcaoMensalConsumo(db, 'a', { ...entrada, id: randomUUID(), versao: 1, contextoHash: replay.contextoHash }, user);
  expect(novo.desatualizada).toBe(false); expect(novo.versao).toBe(2);
});
