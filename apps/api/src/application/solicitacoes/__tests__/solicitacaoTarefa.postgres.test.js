import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SolicitacoesService } from '../SolicitacoesService.js';
import { SolicitacaoTarefaService } from '../SolicitacaoTarefaService.js';
import { obterTarefaUnificada, listarTarefasUnificadas, acaoTarefaUnificada } from '../../calendario/TarefasUnificadasService.js';

const url = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (process.env.DATABASE_URL !== url || parsed.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || !parsed.pathname.endsWith('_governance_test')) throw new Error('Banco descartável do controlador obrigatório');
}
const suite = url ? describe : describe.skip;
suite('Solicitação/tarefa S2b — PostgreSQL descartável sem transporte', () => {
  let db, admin, schema;
  const usuariosCriados = [], empresasCriadas = [];
  const quote = name => `"${name.replaceAll('"', '""')}"`;
  beforeAll(() => { admin = new PrismaClient({ datasources: { db: { url } } }); });
  // Each test gets a private empty copy of the migrated schema. Separate Prisma
  // connections still exercise real concurrent commits. Append-only triggers stay
  // enabled; cleanup drops only this test's random namespace, even after failure.
  beforeEach(async () => {
    schema = `s2b_fixture_${randomUUID().replaceAll('-', '')}`;
    const source = new URL(url).searchParams.get('schema') || 'public';
    await admin.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${quote(schema)}`);
      const tables = await tx.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = ${source}`;
      for (const { tablename } of tables) {
        await tx.$executeRawUnsafe(`CREATE TABLE ${quote(schema)}.${quote(tablename)} (LIKE ${quote(source)}.${quote(tablename)} INCLUDING ALL)`);
      }
      // Serial defaults must never consume sequences in the source schema.
      const serials = await tx.$queryRaw`SELECT c.relname AS tabela, a.attname AS coluna, s.relname AS sequencia
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0
        JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid
        JOIN pg_class s ON s.oid=dep.refobjid AND s.relkind='S'
        WHERE n.nspname=${source}`;
      for (const r of serials) {
        await tx.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS ${quote(schema)}.${quote(r.sequencia)}`);
        const sequence = `${quote(schema)}.${quote(r.sequencia)}`.replaceAll("'", "''");
        await tx.$executeRawUnsafe(`ALTER TABLE ${quote(schema)}.${quote(r.tabela)} ALTER COLUMN ${quote(r.coluna)} SET DEFAULT nextval('${sequence}'::regclass)`);
      }
      // With only the private schema visible, pg_get_constraintdef qualifies all
      // source references. Remap those references, preserving actual FK actions.
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quote(schema)}`);
      const fks = await tx.$queryRaw`SELECT c.relname AS tabela, k.conname AS nome, pg_get_constraintdef(k.oid) AS definicao
        FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=${source} AND k.contype='f'`;
      const sourcePrefix = /^[a-z_][a-z0-9_]*$/.test(source) ? `${source}.` : `${quote(source)}.`;
      for (const r of fks) await tx.$executeRawUnsafe(`ALTER TABLE ${quote(schema)}.${quote(r.tabela)} ADD CONSTRAINT ${quote(r.nome)} ${r.definicao.replaceAll(sourcePrefix, `${quote(schema)}.`)}`);
      const triggers = await tx.$queryRaw`SELECT c.relname AS tabela, pg_get_triggerdef(t.oid) AS definicao
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=${source} AND NOT t.tgisinternal
          AND c.relname IN ('solicitacoes_eventos','solicitacoes_comandos','solicitacoes_mensagens')`;
      expect(triggers).toHaveLength(3);
      for (const r of triggers) await tx.$executeRawUnsafe(r.definicao.replace(` ON ${sourcePrefix}`, ` ON ${quote(schema)}.`));
      const installed = await tx.$queryRaw`SELECT c.relname AS tabela, t.tgenabled AS habilitado
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=${schema} AND NOT t.tgisinternal
          AND c.relname IN ('solicitacoes_eventos','solicitacoes_comandos','solicitacoes_mensagens')`;
      expect(installed.map(r => r.tabela).sort()).toEqual(['solicitacoes_comandos', 'solicitacoes_eventos', 'solicitacoes_mensagens']);
      expect(installed.every(r => ['O', 'A'].includes(r.habilitado))).toBe(true);
    }, { timeout: 60000 });
    const isolated = new URL(url); isolated.searchParams.set('schema', schema);
    db = new PrismaClient({ datasources: { db: { url: isolated.href } } });
  }, 70000);
  afterEach(async () => {
    try { await db?.$disconnect(); }
    finally {
      if (!/^s2b_fixture_[a-f0-9]{32}$/.test(schema)) throw new Error('Schema de limpeza inválido');
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
      expect(await admin.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}`).toEqual([]);
      db = null;
    }
  }, 30000);
  afterAll(async () => { await admin.$disconnect(); });
  async function fixture() {
    const suffix = randomUUID();
    const empresa = await db.portalClient.create({ data: { razao: 'S2b sintética', cnpj: `s2b-${suffix}` } });
    empresasCriadas.push(empresa.id);
    const makeUser = async role => { const u = await db.user.create({ data: { email: `${role}-${suffix}@example.invalid`, passwordHash: 'sem-acesso', role, accountType: 'FIRM', status: 'active' } }); usuariosCriados.push(u.id); return u; };
    const admin = await makeUser('contador'), staff = await makeUser('user');
    await db.companyFirmAccess.create({ data: { companyId: empresa.id, userId: staff.id, role: 'STAFF' } });
    const contexto = { canal: 'INTERNO', atorId: admin.id };
    const solicitacoes = new SolicitacoesService({ client: db });
    const service = new SolicitacaoTarefaService({ client: db });
    const criar = dados => solicitacoes.criar({ contexto, chave: randomUUID(), dados: { titulo: 'Pedido', resumo: 'Descrição sintética', portalClientId: empresa.id, ...dados } });
    const proposta = row => ({ contexto, id: row.id, chave: randomUUID(), versao: row.versao,
      dados: { titulo: 'Trabalho', responsavelId: staff.id, empresasIds: [empresa.id], config: { dataInicio: '2026-10-27' } } });
    const agenda = id => ({ userId: admin.id, portalIds: [empresa.id], id });
    return { empresa, admin, staff, contexto, solicitacoes, service, criar, proposta, agenda };
  }
  test('concurrent different keys create one task; original-key replay survives revision change', async () => {
    const f = await fixture(), row = await f.criar({}), a = f.proposta(row), b = { ...a, chave: randomUUID() };
    const results = await Promise.allSettled([f.service.converter(a), f.service.converter(b)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.code).toBe('versao_conflitante');
    const winner = results[0].status === 'fulfilled' ? a : b;
    const first = results.find(r => r.status === 'fulfilled').value;
    expect(await f.service.converter(winner)).toEqual(first);
    expect(await db.solicitacaoTarefa.count({ where: { solicitacaoId: row.id } })).toBe(1);
    expect(await db.tarefaCalendario.count({ where: { userId: f.admin.id } })).toBe(1);
    expect((await f.solicitacoes.detalhar({ contexto: f.contexto, id: row.id })).tarefa).toEqual(first.tarefa);
    expect((await obterTarefaUnificada(f.agenda(first.tarefa.id), db)).solicitacaoOrigem).toEqual({ id: row.id, podeAbrir: true });
    await expect(db.solicitacaoTarefa.create({ data: { solicitacaoId: row.id, tarefaId: first.tarefa.id, criadoPorId: f.admin.id } })).rejects.toMatchObject({ code: 'P2002' });
    const other = await f.criar({});
    // Different PK isolates the unique(tarefaId) constraint.
    await expect(db.solicitacaoTarefa.create({ data: { solicitacaoId: other.id, tarefaId: first.tarefa.id, criadoPorId: f.admin.id } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(db.solicitacaoTarefa.create({ data: { solicitacaoId: other.id, tarefaId: randomUUID(), criadoPorId: f.admin.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(db.tarefaCalendario.delete({ where: { id: first.tarefa.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(db.encaminhamentoSuporte.delete({ where: { id: row.id } })).rejects.toMatchObject({ code: 'P2003' });
  }, 30000);

  test('failure after real task creation/audit/command rolls back all local effects', async () => {
    const f = await fixture(), row = await f.criar({});
    const eventos = await db.solicitacaoEvento.count({ where: { solicitacaoId: row.id } });
    const comandos = await db.solicitacaoComando.count({ where: { solicitacaoId: row.id } });
    for (const modelName of ['solicitacaoTarefa', 'solicitacaoEvento', 'solicitacaoComando']) {
      const injected = { $transaction: (fn, opts) => db.$transaction(tx => fn(new Proxy(tx, { get(target, prop) {
        if (prop !== modelName) return target[prop];
        return new Proxy(target[prop], { get(model, method) {
          if (method !== 'create') return model[method];
          return async args => { await model.create(args); throw new Error('S2b injected failure'); };
        } });
      } })), opts) };
      await expect(new SolicitacaoTarefaService({ client: injected }).converter(f.proposta(row))).rejects.toThrow('S2b injected failure');
      expect(await db.tarefaCalendario.count({ where: { userId: f.admin.id } })).toBe(0);
      expect(await db.solicitacaoTarefa.count({ where: { solicitacaoId: row.id } })).toBe(0);
      expect((await f.solicitacoes.detalhar({ contexto: f.contexto, id: row.id })).versao).toBe(row.versao);
      expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: row.id } })).toBe(eventos);
      expect(await db.solicitacaoComando.count({ where: { solicitacaoId: row.id } })).toBe(comandos);
    }
  }, 30000);

  test('same key concurrent replay is unique; divergent payload cannot replace it', async () => {
    const f = await fixture(), row = await f.criar({}), args = f.proposta(row);
    const results = await Promise.all([f.service.converter(args), f.service.converter(args)]);
    expect(results[0]).toEqual(results[1]);
    await expect(f.service.converter({ ...args, dados: { ...args.dados, titulo: 'Divergente' } })).rejects.toMatchObject({ code: 'chave_divergente' });
    expect(await db.tarefaCalendario.count({ where: { userId: f.admin.id } })).toBe(1);
    expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: row.id, tipo: 'TAREFA_VINCULADA' } })).toBe(1);
    expect(await db.solicitacaoComando.count({ where: { atorId: f.admin.id, chave: args.chave } })).toBe(1);
  }, 30000);

  test('source remains authorized while historical task company revokes replay/detail/list navigation', async () => {
    const f = await fixture(), other = await fixture(), row = await f.criar({});
    const contexto = { canal: 'INTERNO', atorId: f.staff.id };
    const args = { ...f.proposta(row), contexto };
    const result = await f.service.converter(args), tarefaId = result.tarefa.id;
    const task = await db.tarefaCalendario.findUnique({ where: { id: tarefaId } });
    await db.tarefaCalendario.update({ where: { id: tarefaId }, data: { versoes: [{ aPartirDe: '2026-11-01', dados: {
      titulo: task.titulo, descricao: task.descricao, config: task.config, subtarefas: task.subtarefas,
      responsavelId: task.responsavelId, empresasIds: [other.empresa.id],
    } }] } });
    await expect(f.service.converter(args)).rejects.toMatchObject({ status: 404 });
    expect((await f.solicitacoes.detalhar({ contexto, id: row.id })).tarefa).toBeUndefined();
    const list = await f.solicitacoes.listar({ contexto });
    expect(list.itens.find(r => r.id === row.id).tarefa).toBeUndefined();
    await expect(obterTarefaUnificada({ userId: f.staff.id, portalIds: [f.empresa.id], id: tarefaId }, db)).rejects.toMatchObject({ status: 404 });
  }, 30000);

  test('personal series reassignment revokes the previous responsible without erasing history', async () => {
    const f = await fixture(), row = await f.criar({ portalClientId: null });
    // Both managers can access triage, but only creator/current responsible can
    // access a personal task. Losing responsibility must not grant future access.
    await db.user.update({ where: { id: f.staff.id }, data: { role: 'contador' } });
    const args = f.proposta(row); args.dados.empresasIds = []; args.dados.config.recorrencia = 'MENSAL';
    const result = await f.service.converter(args), ctx = f.agenda(result.tarefa.id);
    const reader = { ...ctx, userId: f.staff.id };
    expect((await obterTarefaUnificada(reader, db)).responsavelId).toBe(f.staff.id);
    await acaoTarefaUnificada({ ...ctx, dados: { acao: 'EDITAR_SERIE', cicloChave: '2026-11', alteracoes: { responsavelId: null } } }, db);
    await expect(obterTarefaUnificada(reader, db)).rejects.toMatchObject({ status: 404 });
    await expect(acaoTarefaUnificada({ ...reader, dados: { acao: 'CONCLUIR', cicloChave: '2026-11' } }, db)).rejects.toMatchObject({ status: 404 });
    expect((await listarTarefasUnificadas({ ...reader, inicio: '2026-11-01', fim: '2026-11-30' }, db)).tarefas).toEqual([]);
    expect((await db.tarefaCalendario.findUnique({ where: { id: ctx.id } })).responsavelId).toBe(f.staff.id);
    expect((await f.solicitacoes.detalhar({ contexto: { canal: 'INTERNO', atorId: f.staff.id }, id: row.id })).tarefa).toBeUndefined();
  }, 30000);

  test('editing and converting the same revision cannot both commit', async () => {
    const f = await fixture(), row = await f.criar({});
    const results = await Promise.allSettled([
      f.service.converter(f.proposta(row)),
      f.solicitacoes.editar({ contexto: f.contexto, id: row.id, chave: randomUUID(), versao: row.versao, dados: { titulo: 'Editada' } }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.code).toBe('versao_conflitante');
    const final = await f.solicitacoes.detalhar({ contexto: f.contexto, id: row.id });
    expect(final.revisao).toBe(2);
    expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: row.id } })).toBe(2);
    expect(await db.solicitacaoComando.count({ where: { solicitacaoId: row.id } })).toBe(2);
  }, 30000);

  test('concurrent divergent payloads sharing a key have one winner and one clear conflict', async () => {
    const f = await fixture(), row = await f.criar({}), a = f.proposta(row);
    const b = { ...a, dados: { ...a.dados, titulo: 'Outro payload' } };
    const results = await Promise.allSettled([f.service.converter(a), f.service.converter(b)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.code).toBe('chave_divergente');
    expect(await db.solicitacaoTarefa.count({ where: { solicitacaoId: row.id } })).toBe(1);
    expect(await db.tarefaCalendario.count({ where: { userId: f.admin.id } })).toBe(1);
  }, 30000);

  test('two subjects in same segment stay separate; source reclassification hides origin in GET/list/action and replay', async () => {
    const f = await fixture();
    const cv = await db.conversaWhatsapp.create({ data: { telefoneE164: '5500000000000', chaveEscopo: `s2b-${randomUUID()}`, portalClientId: f.empresa.id } });
    const message = await db.mensagemWhatsapp.create({ data: { conversaId: cv.id, providerMessageId: randomUUID(), direcao: 'in', tipo: 'text', corpo: 'Sintética' } });
    const before = await db.conversaWhatsapp.findUnique({ where: { id: cv.id } });
    const row = await f.criar({ conversaId: cv.id, mensagemId: message.id }), row2 = await f.criar({ conversaId: cv.id, mensagemId: message.id });
    const args = f.proposta(row), first = await f.service.converter(args), second = await f.service.converter(f.proposta(row2));
    expect(first.tarefa.id).not.toBe(second.tarefa.id);
    expect(await db.conversaWhatsapp.findUnique({ where: { id: cv.id } })).toEqual(before);
    // Persisted source is now inaccessible; task company itself remains authorized.
    const outroSegmento = await db.conversaWhatsapp.create({ data: { telefoneE164: '5500000000000', chaveEscopo: `s2b-outro-${randomUUID()}`, portalClientId: f.empresa.id } });
    await db.mensagemWhatsapp.update({ where: { id: message.id }, data: { conversaId: outroSegmento.id } });
    const ctx = f.agenda(first.tarefa.id);
    expect((await obterTarefaUnificada(ctx, db)).solicitacaoOrigem).toBeUndefined();
    const list = await listarTarefasUnificadas({ ...ctx, inicio: '2026-10-01', fim: '2026-10-31' }, db);
    expect(list.tarefas.find(t => t.id === ctx.id).solicitacaoOrigem).toBeUndefined();
    expect(list.itens.find(t => t.tarefaId === ctx.id).solicitacaoOrigem).toBeUndefined();
    expect((await acaoTarefaUnificada({ ...ctx, dados: { acao: 'CONCLUIR', cicloChave: '2026-10-27' } }, db)).solicitacaoOrigem).toBeUndefined();
    await expect(f.service.converter(args)).rejects.toMatchObject({ status: 404 });
    expect((await db.encaminhamentoSuporte.findUnique({ where: { id: row.id } })).estado).toBe('AGUARDANDO');
  }, 30000);

  test('responsible personal task readable by ID; copy has no source; deletion never frees original link', async () => {
    const f = await fixture(), row = await f.criar({ portalClientId: null });
    const args = f.proposta(row); args.dados.empresasIds = []; args.dados.responsavelId = f.admin.id;
    const result = await f.service.converter(args), ctx = { ...f.agenda(result.tarefa.id), portalIds: [] };
    expect((await obterTarefaUnificada(ctx, db)).responsavelId).toBe(f.admin.id);
    const copy = await acaoTarefaUnificada({ ...ctx, dados: { acao: 'DUPLICAR', cicloChave: '2026-10-27', intencaoId: randomUUID() } }, db);
    expect(copy.solicitacaoOrigem).toBeUndefined();
    expect(await db.solicitacaoTarefa.count({ where: { tarefaId: copy.id } })).toBe(0);
    await acaoTarefaUnificada({ ...ctx, dados: { acao: 'EXCLUIR', cicloChave: '2026-10-27' } }, db);
    expect((await obterTarefaUnificada({ ...ctx, cicloChave: '2026-10-27' }, db)).ciclo.estado).toBe('CANCELADA');
    await acaoTarefaUnificada({ ...ctx, dados: { acao: 'EXCLUIR_SERIE' } }, db);
    expect((await f.service.converter(args)).tarefa.estado).toBe('EXCLUIDA');
    expect(await db.solicitacaoTarefa.count({ where: { solicitacaoId: row.id } })).toBe(1);
    await db.user.update({ where: { id: f.admin.id }, data: { status: 'inactive' } });
    await expect(f.service.converter(args)).rejects.toMatchObject({ status: 403 });
  }, 30000);

  test('partial identity group exposes only the authorized company in conversion, replay, lists and actions', async () => {
    const f = await fixture(), other = await fixture();
    const pessoa = await db.interlocutorComunicacao.create({ data: { nome: 'Grupo sintético' } });
    const numero = await db.vinculoNumeroInterlocutor.create({ data: { interlocutorId: pessoa.id, telefoneE164: `s2b-${randomUUID()}` } });
    const segment = portalClientId => db.conversaWhatsapp.create({ data: {
      telefoneE164: numero.telefoneE164, vinculoNumeroId: numero.id, portalClientId,
      chaveEscopo: portalClientId ? `empresa:${portalClientId}` : `sem-empresa:${numero.id}`,
    } });
    const own = await segment(f.empresa.id), foreign = await segment(other.empresa.id), neutral = await segment(null);
    const row = await f.criar({ conversaId: own.id });
    const hidden = await f.criar({ portalClientId: other.empresa.id, conversaId: foreign.id });
    const triage = await f.criar({ portalClientId: null, conversaId: neutral.id });
    const hiddenResult = await f.service.converter({ ...f.proposta(hidden), dados: {
      ...f.proposta(hidden).dados, empresasIds: [other.empresa.id], responsavelId: f.admin.id,
    } });
    const contexto = { canal: 'INTERNO', atorId: f.staff.id };
    const args = { ...f.proposta(row), contexto };
    const converted = await f.service.converter(args), ctx = { ...f.agenda(converted.tarefa.id), userId: f.staff.id };
    expect(await f.service.converter(args)).toEqual(converted);
    expect((await f.solicitacoes.detalhar({ contexto, id: row.id })).tarefa.id).toBe(ctx.id);
    const list = await f.solicitacoes.listar({ contexto });
    expect(list.itens.map(i => i.id)).toEqual([row.id]);
    expect(JSON.stringify(list)).not.toContain(hidden.id);
    expect(JSON.stringify(list)).not.toContain(triage.id);
    expect((await obterTarefaUnificada(ctx, db)).solicitacaoOrigem).toEqual({ id: row.id, podeAbrir: true });
    const tasks = await listarTarefasUnificadas({ ...ctx, inicio: '2026-10-01', fim: '2026-10-31' }, db);
    expect(tasks.tarefas.map(t => t.id)).toEqual([ctx.id]);
    expect(tasks.itens.every(t => t.solicitacaoOrigem?.id === row.id)).toBe(true);
    expect((await acaoTarefaUnificada({ ...ctx, dados: { acao: 'CONCLUIR', cicloChave: '2026-10-27' } }, db)).solicitacaoOrigem.id).toBe(row.id);
    const before = await db.encaminhamentoSuporte.findMany({ where: { id: { in: [row.id, hidden.id, triage.id] } }, orderBy: { id: 'asc' } });
    const commandCount = await db.solicitacaoComando.count({ where: { atorId: f.staff.id } });
    for (const denied of [hidden, triage]) {
      await expect(f.solicitacoes.detalhar({ contexto, id: denied.id })).rejects.toMatchObject({ status: 404 });
      await expect(f.service.converter({ ...f.proposta(denied), contexto })).rejects.toMatchObject({ status: 404 });
    }
    await expect(obterTarefaUnificada({ ...ctx, id: hiddenResult.tarefa.id }, db)).rejects.toMatchObject({ status: 404 });
    await expect(acaoTarefaUnificada({ ...ctx, id: hiddenResult.tarefa.id, dados: { acao: 'CONCLUIR', cicloChave: '2026-10-27' } }, db)).rejects.toMatchObject({ status: 404 });
    expect(await db.encaminhamentoSuporte.findMany({ where: { id: { in: [row.id, hidden.id, triage.id] } }, orderBy: { id: 'asc' } })).toEqual(before);
    expect(await db.solicitacaoComando.count({ where: { atorId: f.staff.id } })).toBe(commandCount);
  }, 30000);

  test('revoked conversation identity binding hides neutral origin while the personal task remains accessible', async () => {
    const f = await fixture();
    const pessoa = await db.interlocutorComunicacao.create({ data: { nome: 'Identidade sintética' } });
    const numero = await db.vinculoNumeroInterlocutor.create({ data: { interlocutorId: pessoa.id, telefoneE164: `s2b-${randomUUID()}` } });
    const atendimento = await db.atendimentoResponsavelWhatsapp.create({ data: { telefoneE164: numero.telefoneE164, vinculoNumeroId: numero.id } });
    const cv = await db.conversaWhatsapp.create({ data: { telefoneE164: numero.telefoneE164, vinculoNumeroId: numero.id,
      atendimentoId: atendimento.id, chaveEscopo: `sem-empresa:${numero.id}` } });
    const row = await f.criar({ portalClientId: null, conversaId: cv.id });
    const args = f.proposta(row); args.dados.empresasIds = []; args.dados.responsavelId = f.admin.id;
    const result = await f.service.converter(args), ctx = f.agenda(result.tarefa.id);
    expect((await obterTarefaUnificada(ctx, db)).solicitacaoOrigem.id).toBe(row.id);
    // Explicitly revoke the segment's identity association, retaining attendance
    // and historical identity rows. This is not merely an expired phone number.
    await db.conversaWhatsapp.update({ where: { id: cv.id }, data: { vinculoNumeroId: null } });
    const snapshot = await db.encaminhamentoSuporte.findUnique({ where: { id: row.id } });
    const events = await db.solicitacaoEvento.findMany({ where: { solicitacaoId: row.id }, orderBy: { revisao: 'asc' } });
    const commands = await db.solicitacaoComando.count({ where: { solicitacaoId: row.id } });
    await expect(f.service.converter(args)).rejects.toMatchObject({ status: 404 });
    await expect(f.service.converter({ ...args, chave: randomUUID(), versao: result.versao })).rejects.toMatchObject({ status: 404 });
    await expect(f.solicitacoes.detalhar({ contexto: f.contexto, id: row.id })).rejects.toMatchObject({ status: 404 });
    expect((await f.solicitacoes.listar({ contexto: f.contexto })).itens.some(r => r.id === row.id)).toBe(false);
    expect((await obterTarefaUnificada(ctx, db)).solicitacaoOrigem).toBeUndefined();
    const list = await listarTarefasUnificadas({ ...ctx, inicio: '2026-10-01', fim: '2026-10-31' }, db);
    expect(list.tarefas.find(t => t.id === ctx.id).solicitacaoOrigem).toBeUndefined();
    expect(list.itens.find(t => t.tarefaId === ctx.id).solicitacaoOrigem).toBeUndefined();
    await expect(acaoTarefaUnificada({ ...ctx, dados: { acao: 'EDITAR', cicloChave: '2026-10-27', alteracoes: { responsavelId: null } } }, db)).rejects.toMatchObject({ status: 404 });
    expect((await acaoTarefaUnificada({ ...ctx, dados: { acao: 'CONCLUIR', cicloChave: '2026-10-27' } }, db)).solicitacaoOrigem).toBeUndefined();
    expect(await db.encaminhamentoSuporte.findUnique({ where: { id: row.id } })).toEqual(snapshot);
    expect(await db.solicitacaoEvento.findMany({ where: { solicitacaoId: row.id }, orderBy: { revisao: 'asc' } })).toEqual(events);
    expect(await db.solicitacaoComando.count({ where: { solicitacaoId: row.id } })).toBe(commands);
    expect(await db.solicitacaoTarefa.count({ where: { solicitacaoId: row.id } })).toBe(1);
    // Audit protection remains enabled; disposal is a database-owner operation.
    await expect(db.solicitacaoEvento.deleteMany({ where: { solicitacaoId: row.id } })).rejects.toThrow('solicitacoes_evidencia_imutavel');
    expect(await db.solicitacaoEvento.findMany({ where: { solicitacaoId: row.id }, orderBy: { revisao: 'asc' } })).toEqual(events);
  }, 30000);
});
