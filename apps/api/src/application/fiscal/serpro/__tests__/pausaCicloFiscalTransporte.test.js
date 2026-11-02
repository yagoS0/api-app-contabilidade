jest.mock('../../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../CompanySerproPolicy.js', () => ({ empresaDaChamada: jest.fn(), conferirPoliticaSerpro: jest.fn(), bloquearPoliticaEmpresa: jest.fn() }));
jest.mock('../SerproRespostaCache.js', () => ({ chaveResposta: jest.fn(), lerResposta: jest.fn(async () => null), guardarResposta: jest.fn() }));
jest.mock('../SerproRuntimeSettings.js', () => ({ getResolvedSerproCredentials: jest.fn(async () => ({ baseUrl: 'https://invalid.test', timeoutMs: 100 })) }));
jest.mock('axios', () => ({ request: jest.fn(), isAxiosError: () => false }));
import axios from 'axios';
import { prisma } from '../../../../infrastructure/db/prisma.js';
import { autorizarDespacho, concluirChamada } from '../SerproCallGuard.js';
import * as callGuard from '../SerproCallGuard.js';
import { lerResposta } from '../SerproRespostaCache.js';
import { SerproHttpClient } from '../SerproHttpClient.js';
import { comAutomacaoCicloFiscal, comAutomacaoEmpresa, comVerificacaoTentativaAutomatica, conferirContextoCicloFiscal, conferirTentativaAutomaticaDespacho, conferirTentativaAutomaticaAntesSimulacao } from '../../automacaoCicloFiscalContext.js';
const paused = { paused: true, version: 1, reason: 'Pausa', actor: { id: 'u' }, changedAt: '2026-11-01T10:00:00Z', resumedAt: null };
afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  jest.clearAllMocks();
  lerResposta.mockResolvedValue(null);
  prisma.appSetting = { findUnique: jest.fn(async ({ where }) => where.key === 'automacao_ciclo_fiscal' ? { value: paused } : null), create: jest.fn() };
  prisma.serproChamada = { findUnique: jest.fn(async () => ({ id: 'r', status: 'reservada', portalClientId: null })), updateMany: jest.fn(async () => ({ count: 1 })) };
  prisma.$queryRaw = jest.fn(); prisma.$transaction = async run => run(prisma);
});

function tentativa(verificar, run, id = 'a') {
  return comAutomacaoCicloFiscal({ version: 0 }, () => comAutomacaoEmpresa(id, () => comVerificacaoTentativaAutomatica({ portalClientId: id, competencia: '2026-10', verificar }, run)));
}
function ativo() {
  prisma.appSetting.findUnique.mockResolvedValue(null);
  prisma.portalClient = { findUnique: jest.fn(async ({ where }) => ({ id: where.id, cnpj: '12345678000190' })) };
  prisma.serproChamada.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, status: 'reservada', portalClientId: where.id === 'b' ? 'b' : 'a' }));
}
test.each(['AUTOMACAO_EMPRESA_SELECAO_ALTERADA', 'AUTOMACAO_EMPRESA_BASE_ALTERADA'])('autenticação altera seleção/prova: guarda final real preserva %s e não despacha', async code => {
  ativo(); let token = 'inicial';
  jest.spyOn(callGuard, 'autorizarChamada').mockResolvedValue({ id: 'a', inicio: Date.now() });
  const verify = jest.fn(async ({ db, portalClientId, competencia }) => {
    expect(db).toBe(prisma); expect(portalClientId).toBe('a'); expect(competencia).toBe('2026-10');
    if (token !== 'inicial') throw Object.assign(new Error('Seleção ou origem mudou'), { code });
  });
  const auth = { authenticate: jest.fn(async () => { token = 'alterado'; return {}; }), buildHttpsAgent: jest.fn(async () => ({})) };
  await expect(tentativa(verify, () => new SerproHttpClient({ authService: auth }).post('/Consultar', { contribuinte: { numero: '12345678000190' } }))).rejects.toMatchObject({ code, recusaAntesDespacho: true });
  expect(auth.authenticate).toHaveBeenCalledTimes(1); expect(verify).toHaveBeenCalledTimes(1);
  expect(axios.request).not.toHaveBeenCalled(); expect(prisma.appSetting.create).not.toHaveBeenCalled();
  expect(prisma.serproChamada.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'abortada_politica', erroCodigo: code }) }));
});
test('erro DB do verificador recusa auditado; ausência e recursão também não despacham', async () => {
  ativo();
  await expect(tentativa(async () => { throw new Error('DB indisponível'); }, () => autorizarDespacho({ id: 'a', inicio: Date.now() }))).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_VERIFICACAO_INDISPONIVEL', recusaAntesDespacho: true });
  await expect(tentativa(undefined, () => autorizarDespacho({ id: 'a', inicio: Date.now() }))).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_VERIFICADOR_AUSENTE' });
  await expect(comAutomacaoCicloFiscal({ version: 0 }, () => comAutomacaoEmpresa('a', () => conferirTentativaAutomaticaDespacho(prisma, { portalClientId: 'a', requireAttempt: true })))).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_VERIFICADOR_AUSENTE' });
  await expect(tentativa(() => conferirContextoCicloFiscal(), () => autorizarDespacho({ id: 'a', inicio: Date.now() }))).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_VERIFICADOR_RECURSIVO', recusaAntesDespacho: true });
  expect(axios.request).not.toHaveBeenCalled(); expect(prisma.appSetting.create).not.toHaveBeenCalled();
});
test('verificadores paralelos isolados por empresa não vazam para manual', async () => {
  ativo(); const seen = [];
  const verifier = id => async ({ portalClientId }) => { await Promise.resolve(); expect(portalClientId).toBe(id); seen.push(id); };
  await Promise.all(['a', 'b'].map(id => tentativa(verifier(id), () => autorizarDespacho({ id, inicio: Date.now() }), id)));
  expect(seen.sort()).toEqual(['a', 'b']);
  await autorizarDespacho({ id: 'manual', inicio: Date.now() });
  expect(seen).toHaveLength(2); expect(prisma.appSetting.create).toHaveBeenCalledTimes(3);
});
test('falha depois de autorização anterior nunca recebe classificação de pré-envio', async () => {
  ativo(); let reject = false;
  await tentativa(async () => { if (reject) throw Object.assign(new Error('Base mudou depois'), { code: 'AUTOMACAO_EMPRESA_BASE_ALTERADA', recusaAntesDespacho: true }); }, async () => {
    await autorizarDespacho({ id: 'a', inicio: Date.now() }); reject = true;
    await expect(autorizarDespacho({ id: 'segunda', inicio: Date.now() })).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_BASE_ALTERADA', recusaAntesDespacho: false });
  });
  expect(prisma.appSetting.create).toHaveBeenCalledTimes(1);
});
test('conferência local classifica somente recusa comprovada antes de qualquer despacho', async () => {
  ativo();
  const original = Object.assign(new Error('Origem alterada'), { code: 'AUTOMACAO_EMPRESA_BASE_ALTERADA' });
  const verifier = jest.fn(async () => { throw original; });
  await expect(tentativa(verifier, () => conferirTentativaAutomaticaAntesSimulacao(prisma, { portalClientId: 'a' }))).rejects.toMatchObject({ code: original.code, recusaAntesDespacho: true });
  expect(original).not.toHaveProperty('recusaAntesDespacho');
  expect(verifier).toHaveBeenCalledTimes(1);
  expect(prisma.appSetting.create).not.toHaveBeenCalled(); expect(prisma.serproChamada.updateMany).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
  await expect(conferirTentativaAutomaticaAntesSimulacao(prisma, { portalClientId: 'a' })).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_VERIFICADOR_AUSENTE', recusaAntesDespacho: false });
});
test('conferência local não marca como pré-envio depois de autorização real na mesma tentativa', async () => {
  ativo(); let reject = false;
  await tentativa(async () => { if (reject) throw Object.assign(new Error('Mudou depois'), { code: 'AUTOMACAO_EMPRESA_BASE_ALTERADA' }); }, async () => {
    await autorizarDespacho({ id: 'a', inicio: Date.now() }); reject = true;
    await expect(conferirTentativaAutomaticaAntesSimulacao(prisma, { portalClientId: 'a' })).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_BASE_ALTERADA', recusaAntesDespacho: false });
  });
  expect(prisma.appSetting.create).toHaveBeenCalledTimes(1); expect(prisma.serproChamada.updateMany).not.toHaveBeenCalled();
});

test.each([false, true])('cache exige identidade empresarial antes da leitura; contribuinte correto=%s', async matches => {
  prisma.appSetting.findUnique.mockResolvedValue(null);
  prisma.portalClient = { findUnique: jest.fn(async () => ({ id: 'a', cnpj: '12345678000190' })) };
  const cached = { documento: 'somente empresa da chamada' };
  lerResposta.mockResolvedValue(cached);
  const auth = { authenticate: jest.fn(), buildHttpsAgent: jest.fn() };
  const request = () => new SerproHttpClient({ authService: auth }).post('/Consultar', {
    contribuinte: { numero: matches ? '12345678000190' : '98765432000100' },
  });
  const result = comAutomacaoCicloFiscal({ version: 0 }, () => comAutomacaoEmpresa('a', request));
  if (matches) {
    await expect(result).resolves.toEqual(cached);
    expect(lerResposta).toHaveBeenCalledTimes(1);
  } else {
    await expect(result).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_IDENTIDADE_INVALIDA' });
    expect(lerResposta).not.toHaveBeenCalled();
  }
  expect(auth.authenticate).not.toHaveBeenCalled();
  expect(axios.request).not.toHaveBeenCalled();
  expect(prisma.serproChamada.updateMany).not.toHaveBeenCalled();
});

test('cache manual permanece disponível sem leitura de identidade automática', async () => {
  prisma.portalClient = { findUnique: jest.fn() };
  lerResposta.mockResolvedValue({ documento: 'manual' });
  const auth = { authenticate: jest.fn(), buildHttpsAgent: jest.fn() };
  await expect(new SerproHttpClient({ authService: auth }).post('/Consultar', {})).resolves.toEqual({ documento: 'manual' });
  expect(prisma.portalClient.findUnique).not.toHaveBeenCalled();
  expect(auth.authenticate).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
});

test.each(['AUTOMACAO_EMPRESA_PAUSADA', 'AUTOMACAO_EMPRESA_REVISAO_ALTERADA', 'AUTOMACAO_EMPRESA_INDISPONIVEL', 'AUTOMACAO_EMPRESA_IDENTIDADE_INVALIDA', 'CICLO_FISCAL_PAUSADO'])('auth preserva %s e encerra reserva sem despacho', async code => {
  const error = Object.assign(new Error('Política interrompeu autenticação'), { code });
  const reservation = { id: 'reserva-auth', inicio: Date.now() };
  jest.spyOn(callGuard, 'autorizarChamada').mockResolvedValue(reservation);
  const conclude = jest.spyOn(callGuard, 'concluirChamada').mockResolvedValue(undefined);
  const dispatch = jest.spyOn(callGuard, 'autorizarDespacho');
  const auth = { authenticate: jest.fn().mockRejectedValue(error), buildHttpsAgent: jest.fn().mockResolvedValue({}) };
  await expect(new SerproHttpClient({ authService: auth }).post('/Consultar', {})).rejects.toBe(error);
  expect(conclude).toHaveBeenCalledTimes(1);
  expect(conclude).toHaveBeenCalledWith(reservation, expect.objectContaining({ abortadaAuth: true, erroCodigo: code }));
  expect(dispatch).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
});
test('pausa depois da reserva aborta antes do despacho, sem resultado fiscal incerto', async () => {
  await expect(comAutomacaoCicloFiscal({ version: 0 }, () => autorizarDespacho({ id: 'r', inicio: Date.now() }))).rejects.toMatchObject({ code: 'CICLO_FISCAL_PAUSADO' });
  expect(prisma.serproChamada.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'abortada_politica' }) }));
  expect(prisma.appSetting.create).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
});
test('manual conserva despacho e retorno iniciado pode concluir após pausa', async () => {
  await autorizarDespacho({ id: 'r', inicio: Date.now() });
  expect(prisma.appSetting.create).toHaveBeenCalledTimes(1);
  await comAutomacaoCicloFiscal({ version: 0 }, () => concluirChamada({ id: 'r', inicio: Date.now() }, { httpStatus: 200 }));
  expect(prisma.serproChamada.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ok', httpStatus: 200 }) }));
});
test('HTTP automático pausado não autentica nem consulta cache/provedor', async () => {
  const auth = { authenticate: jest.fn(), buildHttpsAgent: jest.fn() };
  await expect(comAutomacaoCicloFiscal({ version: 0 }, () => new SerproHttpClient({ authService: auth }).post('/Consultar', {}))).rejects.toMatchObject({ code: 'CICLO_FISCAL_PAUSADO' });
  expect(auth.authenticate).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
});
test('falha na política impede despacho', async () => {
  prisma.appSetting.findUnique.mockImplementation(async ({ where }) => { if (where.key === 'automacao_ciclo_fiscal') throw new Error('offline'); return null; });
  await expect(comAutomacaoCicloFiscal({ version: 0 }, () => autorizarDespacho({ id: 'r', inicio: Date.now() }))).rejects.toMatchObject({ code: 'CICLO_FISCAL_INDISPONIVEL' });
  expect(prisma.appSetting.create).not.toHaveBeenCalled();
});

test('pausa empresarial entre reserva e despacho aborta reserva e conserva retorno já iniciado', async () => {
  let companyPolicy = null;
  prisma.portalClient = { findUnique: jest.fn(async () => ({ id: 'a' })) };
  prisma.appSetting.findUnique.mockImplementation(async ({ where }) => where.key === 'company_automation_policy:a' ? companyPolicy : null);
  prisma.serproChamada.findUnique.mockResolvedValue({ id: 'r', status: 'reservada', portalClientId: 'a' });
  await comAutomacaoCicloFiscal({ version: 0 }, () => comAutomacaoEmpresa('a', async () => {
    companyPolicy = { value: { paused: true, version: 1, reason: 'Conferência', updatedBy: 'u', updatedAt: '2026-11-01T10:00:00Z', resumedAt: null } };
    await expect(autorizarDespacho({ id: 'r', inicio: Date.now() })).rejects.toMatchObject({ code: 'AUTOMACAO_EMPRESA_PAUSADA' });
    await concluirChamada({ id: 'anterior', inicio: Date.now() }, { httpStatus: 200 });
  }));
  expect(prisma.serproChamada.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r', status: 'reservada' }, data: expect.objectContaining({ status: 'abortada_politica' }) }));
  expect(prisma.serproChamada.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'anterior', status: 'reservada' }, data: expect.objectContaining({ status: 'ok' }) }));
  expect(prisma.appSetting.create).not.toHaveBeenCalled(); expect(axios.request).not.toHaveBeenCalled();
});
