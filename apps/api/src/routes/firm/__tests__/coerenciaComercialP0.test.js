// Ensaio adicional executado pelo Principal/controlador, nunca contra banco padrão.
// ALTAN_P0_DATABASE_URL deve apontar para PostgreSQL descartável já migrado.
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { listar } from '../../../application/onboarding/OnboardingService.js';

const url = process.env.ALTAN_P0_DATABASE_URL;
const testeLocal = url ? test : test.skip;

testeLocal('PostgreSQL: listagem de 1 versus 100 fichas mantém número constante de SELECTs reais', async () => {
  const destino = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(destino.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(destino.hostname) || !destino.pathname.endsWith('_governance_test') || destino.searchParams.has('host')) {
    throw new Error('Use somente PostgreSQL loopback com banco descartável terminado em _governance_test.');
  }
  const db = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  let selects = 0;
  db.$on('query', e => { if (/^\s*SELECT\b/i.test(e.query)) selects++; });
  const prefixo = `p0-${randomUUID()}`;
  const ids = Array.from({ length: 100 }, (_, i) => `${prefixo}-${i}`);
  try {
    await db.onboarding.createMany({ data: ids.map(id => ({ id, origem: 'TRANSFERENCIA', status: 'RECEBIDO', cnpj: '11222333000181', criadoPorId: prefixo })) });
    await db.onboardingEvento.createMany({ data: ids.flatMap(id => [
      { onboardingId: id, tipo: 'JORNADA_DIAGNOSTICO', dados: { contexto: 'histórico sintético desatualizado' } },
      { onboardingId: id, tipo: 'RETORNO_COMERCIAL', dados: { acao: 'Conferir cenário fictício', quando: '2026-10-20T12:00:00Z' } },
    ]) });
    const medidas = [];
    for (const quantidade of [1, 100]) {
      selects = 0;
      const itens = await listar({ escopo: { id: { in: ids.slice(0, quantidade) }, criadoPorId: prefixo } }, db);
      expect(itens).toHaveLength(quantidade);
      expect(itens.every(i => i.comercial.atual === 'publica' && i.retornoComercial.dados.acao === 'Conferir cenário fictício')).toBe(true);
      medidas.push(selects);
    }
    expect(medidas[0]).toBeGreaterThan(0);
    expect(medidas[1]).toBe(medidas[0]);
  } finally {
    // Apenas as entidades sintéticas desta execução, sem truncar tabelas.
    await db.onboardingEvento.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.onboarding.deleteMany({ where: { id: { in: ids }, criadoPorId: prefixo } });
    await db.$disconnect();
  }
}, 30000);
