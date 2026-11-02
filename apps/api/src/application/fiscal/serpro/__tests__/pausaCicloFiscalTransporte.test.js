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
import { comAutomacaoCicloFiscal, comAutomacaoEmpresa } from '../../automacaoCicloFiscalContext.js';
const paused = { paused: true, version: 1, reason: 'Pausa', actor: { id: 'u' }, changedAt: '2026-11-01T10:00:00Z', resumedAt: null };
afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  jest.clearAllMocks();
  lerResposta.mockResolvedValue(null);
  prisma.appSetting = { findUnique: jest.fn(async ({ where }) => where.key === 'automacao_ciclo_fiscal' ? { value: paused } : null), create: jest.fn() };
  prisma.serproChamada = { findUnique: jest.fn(async () => ({ id: 'r', status: 'reservada', portalClientId: null })), updateMany: jest.fn(async () => ({ count: 1 })) };
  prisma.$queryRaw = jest.fn(); prisma.$transaction = async run => run(prisma);
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
