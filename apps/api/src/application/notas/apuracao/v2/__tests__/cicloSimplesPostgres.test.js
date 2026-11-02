import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { executarCicloSimples } from '../CicloSimplesService.js';

const url = process.env.TEST_CICLO_PG_URL;
(url ? test : test.skip)('PostgreSQL: reserva concorrente, queda e reinício preservam uma única chamada por revisão', async () => {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_governance_test')) throw new Error('Banco descartável loopback obrigatório.');
  const pg = new PrismaClient({ datasources: { db: { url } } });
  const id = `ciclo-test-${randomUUID()}`, key = `ciclo_simples:${id}:2026-10`;
  const clientId = randomUUID(), companyId = randomUUID();
  const cnpj = (BigInt(`0x${randomUUID().replace(/-/g, '')}`) % 100000000000000n).toString().padStart(14, '0');
  const db = pg;
  const args = { portalClientId: id, competencia: '2026-10', scheduledAt: '2026-11-08T10:00:00Z' };
  const calcular = jest.fn(async () => { throw new Error('Resposta interrompida depois do envio simulado'); });
  const deps = { db, now: () => new Date(args.scheduledAt), conferir: async () => ({ version: 1 }),
    coletarAdn: jest.fn(async () => ({ ok: true, complete: true, totalDocs: 1 })),
    contexto: async () => ({ hash: 'base-fiscal-ficticia', versao: 1 }),
    getDados: async () => ({ estado: 'aberta', rbt12: 12000, rbt12Origem: 'EXTRATO_PGDAS', origemAtividades: 'notas', semClassificacao: 0, faturamento: { total: 100 }, atividades: [{ idAtividade: 1, valorInterno: 100, valorExterno: 0, sujeitoFatorR: false }] }), calcular,
  };
  try {
    // Cadastro sintético persistido: a guarda lê Company real, sem promover um mock a prova fiscal.
    await pg.client.create({ data: { id: clientId, name: 'CICLO SINTETICO', email: `${clientId}@example.test`, login: clientId, passwordHash: 'fixture-sem-login' } });
    await pg.company.create({ data: { id: companyId, clientId, cnpj, razaoSocial: 'CICLO SINTETICO', atividades: [], regimeTributario: 'SIMPLES' } });
    await pg.portalClient.create({ data: { id, companyId, cnpj, razao: 'CICLO SINTETICO', status: 'ATIVA' } });
    await pg.cadastroFiscal.create({ data: { portalClientId: id, regime: 'SIMPLES_NACIONAL', regimeApuracao: 'COMPETENCIA', cnaePrincipal: '6201501', dataOpcaoSN: new Date('2020-01-01T00:00:00Z'), usaFatorR: false } });
    await pg.appSetting.create({ data: { key: `ciclo_simples_config:${id}`, value: { enabled: true, fontes: ['NFSE'] } } });
    await Promise.all([executarCicloSimples(args, deps), executarCicloSimples(args, deps)]);
    expect(calcular).toHaveBeenCalledTimes(1);
    const persisted = await pg.appSetting.findUnique({ where: { key } });
    expect(persisted.value).toMatchObject({ status: 'INCERTO', revision: 1, calculo: { attemptId: expect.any(String) } });
    // Nova instância lógica, mesma base: nem a fonte nem a chamada fiscal repetem.
    await executarCicloSimples(args, { ...deps });
    expect(calcular).toHaveBeenCalledTimes(1);
    expect(deps.coletarAdn).toHaveBeenCalledTimes(1);
  } finally {
    try { await pg.appSetting.deleteMany({ where: { key: { in: [key, `ciclo_simples_config:${id}`] } } }); }
    finally {
      try { await pg.portalClient.deleteMany({ where: { id, razao: 'CICLO SINTETICO' } }); }
      finally {
        try { await pg.client.deleteMany({ where: { id: clientId, name: 'CICLO SINTETICO' } }); }
        finally { await pg.$disconnect(); }
      }
    }
  }
});
