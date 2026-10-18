jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { marcador: 'principal' } }));
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => ({ $disconnect: jest.fn(async () => {}) })) }));
import { PrismaClient } from '@prisma/client';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { comClientEmissaoLocks, encerrarPoolEmissaoLocks } from '../../../infrastructure/db/prismaEmissaoLocks.js';

test('client injetado nunca constrói pool padrão', async () => {
  const client = { isolado: true };
  expect(await comClientEmissaoLocks({ client, executar: async recebido => recebido })).toBe(client);
  expect(PrismaClient).not.toHaveBeenCalled();
});
test('admissão limitada e liberação após erro sem fila ou falso estado', async () => {
  const lockClient = {}; let soltar;
  const espera = new Promise(resolve => { soltar = resolve; });
  const executar = () => espera;
  const a = comClientEmissaoLocks({ client: {}, lockClient, executar });
  const b = comClientEmissaoLocks({ client: {}, lockClient, executar });
  try { await expect(comClientEmissaoLocks({ client: {}, lockClient, executar: jest.fn() })).rejects.toMatchObject({ code: 'NFSE_CONTROLE_OCUPADO', status: 503 }); }
  finally { soltar(); await Promise.all([a, b]); }
  await expect(comClientEmissaoLocks({ client: {}, lockClient, executar: async () => { throw Error('falha'); } })).rejects.toThrow('falha');
  expect(await comClientEmissaoLocks({ client: {}, lockClient, executar: async () => 'livre' })).toBe('livre');
});
test('singleton usa URL pública preservando destino, limita pool e encerra sem reabrir', async () => {
  const anterior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:55201/isolado_governance_test?schema=public&connection_limit=9&pool_timeout=90';
  try {
    const a = await comClientEmissaoLocks({ client: prisma, executar: async c => c });
    const b = await comClientEmissaoLocks({ client: prisma, executar: async c => c });
    expect(a).toBe(b); expect(PrismaClient).toHaveBeenCalledTimes(1);
    const url = new URL(PrismaClient.mock.calls[0][0].datasources.db.url);
    expect(url.hostname).toBe('127.0.0.1'); expect(url.pathname).toBe('/isolado_governance_test');
    expect(url.searchParams.get('schema')).toBe('public'); expect(url.searchParams.get('connection_limit')).toBe('2'); expect(url.searchParams.get('pool_timeout')).toBe('5');
    await encerrarPoolEmissaoLocks(); expect(a.$disconnect).toHaveBeenCalledTimes(1);
    await expect(comClientEmissaoLocks({ client: prisma, executar: jest.fn() })).rejects.toMatchObject({ code: 'NFSE_CONTROLE_OCUPADO' });
    expect(PrismaClient).toHaveBeenCalledTimes(1);
  } finally { if (anterior === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = anterior; }
});
