// Ensaio sobre schema REAL já migrado. Não carrega .env e não chama provedores.
// O legado foi removido: verificar sua barreira e exercitar o calendário unificado.
// node scripts/verify-calendar-series-postgres.js --url "$DATABASE_URL"
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const arg = process.argv.indexOf('--url');
const url = new URL((arg >= 0 ? process.argv[arg + 1] : process.env.DATABASE_URL) || 'invalid:');
if (!['postgresql:', 'postgres:'].includes(url.protocol)
  || !['127.0.0.1', 'localhost'].includes(url.hostname)
  || !/^\/[a-zA-Z0-9_]+_check$/.test(url.pathname)) {
  throw new Error('Use somente PostgreSQL descartável local com nome terminado em _check, via --url ou DATABASE_URL.');
}
url.searchParams.set('connection_limit', '12');
process.env.DATABASE_URL = url.href;
globalThis.fetch = async () => { throw new Error('Provedores externos proibidos neste ensaio.'); };
const { prisma } = await import('../src/infrastructure/db/prisma.js');
const { criarTarefaUnificada, acaoTarefaUnificada, listarTarefasUnificadas } = await import('../src/application/calendario/TarefasUnificadasService.js');
const prefix = `calendar-check-${randomUUID()}`;
const portalIds = [`${prefix}-a`, `${prefix}-b`];
const userId = prefix;
let checks = 0;
const ok = nome => console.log(`PASS ${++checks}: ${nome}`);
const legacyTables = ['obrigacoes', 'ocorrencias_obrigacao', 'regras_obrigacao', 'regras_obrigacao_excecoes', 'tarefas_agenda', 'agenda_ocultacoes', 'calendario_legado_snapshots'];
const removido = error => /CALENDARIO_LEGADO_REMOVIDO/.test(error.message);
try {
  // Identificadores vêm exclusivamente da lista fixa acima, nunca de entrada externa.
  // Triggers por statement bloqueiam inclusive UPDATE sem linhas correspondentes.
  for (const table of legacyTables) {
    await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "${table}" DEFAULT VALUES`), removido);
    await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "${table}" SET "id" = "id" WHERE FALSE`), removido);
    const [{ count }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table}"`);
    assert.equal(count, 0, `${table} deve continuar vazia após a remoção`);
  }
  ok('sete tabelas legadas permanecem vazias e recusam inserts/updates');

  await prisma.portalClient.createMany({ data: portalIds.map((id, index) => ({ id, razao: `Calendário descartável ${index}`, cnpj: id })) });
  // Current calendar commands reload an active internal actor and persisted scope.
  // Staff fixtures exercise membership; no admin/accountant bypass is used.
  const fixtureUserIds = [userId, `${prefix}-outro`];
  await prisma.user.createMany({ data: fixtureUserIds.map(id => ({
    id, email: `${id}@example.invalid`, passwordHash: 'disabled-local-fixture',
    role: 'user', status: 'active', accountType: 'FIRM',
  })) });
  await prisma.companyFirmAccess.createMany({ data: [
    ...portalIds.map(companyId => ({ companyId, userId, role: 'STAFF', status: 'ACTIVE' })),
    { companyId: portalIds[0], userId: `${prefix}-outro`, role: 'STAFF', status: 'ACTIVE' },
  ] });
  const tarefa = await criarTarefaUnificada({ userId, portalIds, dados: {
    titulo: 'Conferência diária', empresasIds: portalIds,
    config: { dataInicio: '2026-10-10', dataFim: '2026-10-10', recorrencia: 'DIARIA', repetirQuantidade: 5, horarioModo: 'FIXO', horaInicio: '09:00' },
  } });
  const listar = (overrides = {}) => listarTarefasUnificadas({ userId, portalIds, inicio: '2026-10-01', fim: '2026-10-31', ...overrides });
  const acao = dados => acaoTarefaUnificada({ userId, portalIds, id: tarefa.id, dados });
  const iniciais = (await listar()).itens;
  assert.equal(iniciais.length, 5);
  assert.ok(iniciais.every(i => i.horaInicio === '09:00' && i.empresas.length === 2));
  ok('tarefa unificada persiste e expande cinco dias com empresas e horário');

  await Promise.all(portalIds.map(companyId => acao({ acao: 'CONCLUIR', cicloChave: '2026-10-10', companyId })));
  const concluida = await prisma.tarefaCalendario.findUnique({ where: { id: tarefa.id } });
  assert.deepEqual(Object.keys(concluida.estados['2026-10-10'].empresas).sort(), [...portalIds].sort());
  assert.ok((await listar()).itens.find(i => i.cicloChave === '2026-10-10').resolvido);
  ok('ações concorrentes preservam progresso das duas empresas com lock PostgreSQL');

  await assert.rejects(acaoTarefaUnificada({ userId: `${prefix}-outro`, portalIds: [portalIds[0]], id: tarefa.id,
    dados: { acao: 'EXCLUIR_SERIE' } }), e => e.status === 404);
  assert.deepEqual((await listar({ portalIds: [portalIds[0]] })).itens, []);
  assert.deepEqual(await prisma.tarefaCalendario.findUnique({ where: { id: tarefa.id } }), concluida);
  ok('carteira parcial não lê nem altera tarefa com empresa fora do escopo');

  await acao({ acao: 'EXCLUIR', cicloChave: '2026-10-11' });
  await acao({ acao: 'EDITAR', cicloChave: '2026-10-12', alteracoes: { config: { horaInicio: '14:00' } } });
  const atualizadas = (await listar()).itens;
  assert.equal(atualizadas.length, 4);
  assert.ok(!atualizadas.some(i => i.cicloChave === '2026-10-11'));
  assert.equal(atualizadas.find(i => i.cicloChave === '2026-10-12').horaInicio, '14:00');
  assert.ok(atualizadas.find(i => i.cicloChave === '2026-10-10').resolvido);
  ok('edição e exclusão pontuais persistem sem alterar outros dias ou conclusão');

  await acao({ acao: 'EDITAR_SERIE', cicloChave: '2026-10-13', alteracoes: { titulo: 'Conferência semanal', config: { recorrencia: 'SEMANAL', repetirQuantidade: 3 } } });
  const versionada = await prisma.tarefaCalendario.findUnique({ where: { id: tarefa.id } });
  assert.equal(versionada.versoes.length, 1);
  assert.equal(versionada.versoes[0].dados.config.recorrencia, 'SEMANAL');
  assert.deepEqual(versionada.estados['2026-10-10'], concluida.estados['2026-10-10']);
  assert.ok(versionada.estados['2026-10-11'].canceladaEm);
  const finais = (await listar()).itens;
  assert.equal(new Set(finais.map(i => i.id)).size, finais.length);
  assert.ok(finais.some(i => i.dataInicio === '2026-10-20'));
  assert.ok(!finais.some(i => i.dataInicio === '2026-10-14'));
  ok('versão futura semanal mantém histórico e tombstone sem duplicar ciclos');
  console.log(`PASS: ${checks} cenários sobre PostgreSQL real com migrations aplicadas.`);
} finally {
  try {
    await prisma.tarefaCalendario.deleteMany({ where: { userId: prefix } });
    await prisma.portalClient.deleteMany({ where: { id: { in: portalIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, `${prefix}-outro`] } } });
  } finally { await prisma.$disconnect(); }
}
