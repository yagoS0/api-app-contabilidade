import { validarCadastroReforma, periodoNaData, resumirCadastroReforma } from '@contabilidade/shared/reforma-cadastro';
import { salvarCadastroReforma, desatualizada, intervaloCompetencia, carteiraReforma, conferirNfse } from '../ReformaFiscalService.js';
import { VERSAO_VERIFICADOR } from '../verificarNfse.js';
const periodo = { inicio: '2027-01-01', fim: '2027-06-30', regime: 'SIMPLES', forma: 'REGULAR', situacao: 'CONFIRMADA', evidencia: 'Protocolo fictício 01' };
const dados = { periodos: [periodo], emissor: 'NAO_VERIFICADO', motivo: 'Conferência da opção' };
const id = 'e8493993-e1d5-4eac-a61f-39e4a2afda1c';
test('vigência e decisão pendente não se tornam fato por passar a data', () => {
  const d = validarCadastroReforma({ ...dados, periodos: [{ ...periodo, situacao: 'SOLICITADA' }] });
  expect(periodoNaData(d, '2026-12-31')).toBeNull();
  expect(periodoNaData(d, '2027-07-01')).toBeNull();
  expect(resumirCadastroReforma(d, '2027-03-01')).toMatchObject({ situacao: 'SOLICITADA', pendente: true });
  expect(resumirCadastroReforma(null, '2027-03-01').situacao).toBe('SEM_CADASTRO');
});
test.each([
  { inicio: '2027-02-30' }, { fim: '2026-12-31' }, { evidencia: '' }, { forma: 'PENDENTE' },
  { regime: 'MEI' }, { regime: 'LUCRO_REAL', forma: 'DAS' }, { inicio: '2026-12-01' },
  { forma: 'NAO_APLICAVEL' },
])('rejeita enquadramento incompatível %j', p => expect(() => validarCadastroReforma({ ...dados, periodos: [{ ...periodo, ...p }] })).toThrow());
test('não aceita sobreposição inclusive no limite do período', () => {
  expect(() => validarCadastroReforma({ ...dados, periodos: [periodo, { ...periodo, inicio: '2027-06-30', fim: null }] })).toThrow(/sobrepostas/);
  expect(validarCadastroReforma({ ...dados, periodos: [periodo, { ...periodo, inicio: '2027-07-01', fim: null }] }).periodos).toHaveLength(2);
});
test('emissor conferido exige evidência própria', () => expect(() => validarCadastroReforma({ ...dados, emissor: 'VALIDADO' })).toThrow(/emissor/));
test.each(['2026-13', '2026-00', null, '2026-10-01'])('recusa competência inválida %s', c => expect(() => intervaloCompetencia(c)).toThrow());
test('revisão é anexada e atribuição vem do servidor', async () => {
  const model = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(async ({ data }) => data) };
  const r = await salvarCadastroReforma({ reformaFiscalRevisao: model }, 'empresa-a', { id, versao: 0, dados, createdBy: 'intruso' }, { id: 'contador', name: 'Pessoa revisora' });
  expect(r).toMatchObject({ portalClientId: 'empresa-a', versao: 1, createdBy: 'contador', createdByName: 'Pessoa revisora' });
  expect(model.update).toBeUndefined();
});
test('idempotência funciona com a ordem de propriedades devolvida pelo JSONB', async () => {
  const normal = validarCadastroReforma(dados);
  const salvo = { id, versao: 1, dados: Object.fromEntries(Object.entries(normal).reverse()) };
  const model = { findFirst: jest.fn().mockResolvedValue(salvo), create: jest.fn() };
  expect(await salvarCadastroReforma({ reformaFiscalRevisao: model }, 'a', { id, versao: 0, dados }, { id: 'u' })).toBe(salvo);
  expect(model.create).not.toHaveBeenCalled();
});
test('versão concorrente não sobrescreve histórico', async () => {
  const model = { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ versao: 2 }), create: jest.fn() };
  await expect(salvarCadastroReforma({ reformaFiscalRevisao: model }, 'a', { id, versao: 1, dados }, { id: 'u' })).rejects.toMatchObject({ status: 409 });
  expect(model.create).not.toHaveBeenCalled();
});
test('conflito na constraint única tem resposta de concorrência', async () => {
  const model = { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockRejectedValue({ code: 'P2002' }) };
  await expect(salvarCadastroReforma({ reformaFiscalRevisao: model }, 'a', { id, versao: 0, dados }, { id: 'u' })).rejects.toMatchObject({ status: 409 });
});
test('mudança de XML, cadastro e regras invalida a última conferência', () => {
  const origem = { total: 1, atualizadaEm: '2026-10-10' }, cadastro = { versao: 2 };
  const v = { origem: { atualizadaEm: '2026-10-10', total: 1 }, cadastroVersao: 2, versaoRegras: VERSAO_VERIFICADOR };
  expect(desatualizada(v, cadastro, origem)).toBe(false);
  expect(desatualizada(v, { versao: 3 }, origem)).toBe(true);
  expect(desatualizada(v, cadastro, { ...origem, total: 2 })).toBe(true);
  expect(desatualizada({ ...v, versaoRegras: 'antiga' }, cadastro, origem)).toBe(true);
});
test('carteira de contador respeita vínculos ativos inclusive lista vazia', async () => {
  const db = { companyFirmAccess: { findMany: jest.fn().mockResolvedValue([]) }, portalClient: { findMany: jest.fn().mockResolvedValue([]) },
    reformaFiscalRevisao: { findMany: jest.fn().mockResolvedValue([]) }, reformaNfseVerificacao: { findMany: jest.fn().mockResolvedValue([]) } };
  expect((await carteiraReforma(db, { id: 'u', role: 'contador' }, '2026-10')).empresas).toEqual([]);
  expect(db.portalClient.findMany.mock.calls[0][0].where).toEqual({ id: { in: [] } });
  expect(db.companyFirmAccess.findMany.mock.calls[0][0].where).toEqual({ userId: 'u', status: 'ACTIVE' });
});
test('alteração de nota durante análise impede persistência de resultado inconsistente', async () => {
  const db = { portalClient: { findUnique: jest.fn().mockResolvedValue({ cnpj: '11111111000111' }) }, reformaFiscalRevisao: { findFirst: jest.fn().mockResolvedValue(null) },
    portalInvoice: { aggregate: jest.fn().mockResolvedValueOnce({ _count: { id: 0 }, _max: { updatedAt: null } }).mockResolvedValueOnce({ _count: { id: 1 }, _max: { updatedAt: new Date() } }) },
    reformaNfseVerificacao: { create: jest.fn() } };
  await expect(conferirNfse(db, 'a', '2026-10', { id: 'u' })).rejects.toMatchObject({ status: 409 });
  expect(db.reformaNfseVerificacao.create).not.toHaveBeenCalled();
});
