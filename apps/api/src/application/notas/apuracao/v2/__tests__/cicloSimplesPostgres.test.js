import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { executarCicloSimples } from '../CicloSimplesService.js';
import { prepararSimplesConsistente } from '../PreparacaoAutomaticaSimples.js';
import { getDadosFechamento } from '../FechamentoService.js';

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
  const deps = { db, resolverIdentidade: async () => ({ contratanteCnpj: '11111111111111', contribuinteCnpj: cnpj }), envolverTentativa: (_opts, run) => run(), now: () => new Date(args.scheduledAt), conferir: async () => ({ version: 1 }),
    coletarAdn: jest.fn(async () => ({ ok: true, complete: true, totalDocs: 1 })),
    contexto: async () => ({ hash: 'base-fiscal-ficticia', versao: 1 }),
    getDados: async () => ({ rbtPreparado: { rbt12: 12000, origem: 'EXTRATO_PGDAS', detalhePorMes: [] }, estado: 'aberta', rbt12: 12000, rbt12Origem: 'EXTRATO_PGDAS', origemAtividades: 'notas', semClassificacao: 0, faturamento: { total: 100 }, atividades: [{ idAtividade: 1, valorInterno: 100, valorExterno: 0, sujeitoFatorR: false }] }), calcular,
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

(url ? test : test.skip)('PostgreSQL duas conexões: ABA durante getDados não mistura formulário e origem; mudança posterior invalida prova', async () => {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !parsed.pathname.endsWith('_governance_test')) throw new Error('Banco descartável obrigatório.');
  const pg = new PrismaClient({ datasources: { db: { url } } });
  const writer = new PrismaClient({ datasources: { db: { url } } });
  const id = `snapshot-test-${randomUUID()}`, invoiceId = randomUUID();
  const input = { portalClientId: id, competencia: '2026-10' };
  const cnpj = (BigInt(`0x${randomUUID().replace(/-/g, '')}`) % 100000000000000n).toString().padStart(14, '0');
  try {
    await pg.portalClient.create({ data: { id, cnpj, razao: 'SNAPSHOT SINTETICO', status: 'ATIVA' } });
    await pg.portalInvoice.create({ data: { id: invoiceId, clientId: id, type: 'NFSE', papel: 'EMIT', statusEfetivo: 'autorizada', total: 100, itens: { create: { valor: 100 } }, competencia: new Date('2026-10-01T00:00:00Z') } });
    const resolverIdentidade = async () => ({ contratanteCnpj: '11111111111111', contribuinteCnpj: cnpj });
    const before = await prepararSimplesConsistente(input, { db: pg, resolverIdentidade });
    const captured = await prepararSimplesConsistente(input, { db: pg, resolverIdentidade, getDados: async params => {
      // Estabelece a visão A nesta conexão. A segunda conexão confirma B antes
      // da leitura real de notas e volta a A antes da leitura do contexto.
      await params.db.portalClient.findUnique({ where: { id } });
      await writer.portalInvoice.update({ where: { id: invoiceId }, data: { total: 200 } });
      const data = await getDadosFechamento(params);
      await writer.portalInvoice.update({ where: { id: invoiceId }, data: { total: 100 } });
      return data;
    } });
    expect(captured.dados.faturamento.total).toBe(100);
    expect(captured.hash).toBe(before.hash);
    expect(captured.contexto).toEqual(before.contexto);
    await writer.portalInvoice.update({ where: { id: invoiceId }, data: { total: 300 } });
    const changed = await prepararSimplesConsistente(input, { db: pg, resolverIdentidade });
    expect(changed.dados.faturamento.total).toBe(300);
    expect(changed.hash).not.toBe(captured.hash);
    expect(await pg.apuracaoSnapshot.count({ where: { portalClientId: id } })).toBe(0);
    expect(await pg.rbtExtratoCache.count({ where: { portalClientId: id } })).toBe(0);
    expect(await pg.apuracaoConfigMemory.count({ where: { portalClientId: id } })).toBe(0);
  } finally {
    try { await pg.portalInvoice.deleteMany({ where: { id: invoiceId, clientId: id } }); await pg.portalClient.deleteMany({ where: { id, razao: 'SNAPSHOT SINTETICO' } }); }
    finally { await Promise.all([pg.$disconnect(), writer.$disconnect()]); }
  }
}, 30000);
