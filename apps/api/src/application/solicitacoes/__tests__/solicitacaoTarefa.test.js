jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { SolicitacaoTarefaService } from '../SolicitacaoTarefaService.js';
import { SolicitacoesService } from '../SolicitacoesService.js';
import { versao } from '../solicitacoesProjection.js';
import { obterTarefaUnificada, acaoTarefaUnificada, projetarTarefas, projetarVinculosSolicitacoes, listarTarefasUnificadas, criarTarefaUnificada } from '../../calendario/TarefasUnificadasService.js';

function fixture() {
  const now = new Date('2026-10-26T12:00:00Z');
  let state = { rows: [{ id: 's', portalClientId: 'a', contratoVersao: 1, revisao: 1, updatedAt: now,
    createdAt: now, estado: 'AGUARDANDO', responsavelId: null, resolvidoEm: null, titulo: 'Pedido', resumo: 'Resumo' }], tarefas: [], links: [], events: [], commands: [] };
  const users = { u: { id: 'u', status: 'active', accountType: 'FIRM', role: 'contador' }, r: { id: 'r', status: 'active', accountType: 'FIRM', role: 'user' } };
  let acesso = ['a'];
  let acessoResponsavel = null;
  const tx = {
    $queryRaw: jest.fn(),
    user: { findUnique: async ({ where }) => users[where.id] },
    portalClient: { findMany: async () => acesso.map(id => ({ id })) },
    companyFirmAccess: { findMany: async ({ where }) => (where.userId === 'r' ? acessoResponsavel ?? acesso : acesso).map(companyId => ({ companyId })) },
    encaminhamentoSuporte: {
      fields: {}, findMany: async () => state.rows.map(r => ({ ...r, conversa: null, mensagens: [] })),
      findFirst: async ({ where }) => state.rows.find(r => r.id === where.AND[0].id && where.AND[1].AND[0].id.in.includes(r.id)),
      findUnique: async ({ where }) => state.rows.find(r => r.id === where.id),
      updateMany: async ({ where, data }) => { const r = state.rows.find(r => r.id === where.id && r.revisao === where.revisao); if (!r) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
    },
    solicitacaoComando: { findUnique: async ({ where }) => state.commands.find(c => c.chave === where.atorId_chave.chave && c.atorId === where.atorId_chave.atorId), create: jest.fn(async ({ data }) => { state.commands.push(data); return data; }) },
    solicitacaoEvento: { findMany: async () => state.events, create: jest.fn(async ({ data }) => { state.events.push(data); return data; }) },
    solicitacaoMensagem: { findMany: async () => [] },
    solicitacaoTarefa: {
      findUnique: async ({ where }) => { const l = state.links.find(l => where.solicitacaoId ? l.solicitacaoId === where.solicitacaoId : l.tarefaId === where.tarefaId); return l ? { ...l, tarefa: state.tarefas.find(t => t.id === l.tarefaId) } : null; },
      findMany: async ({ where }) => state.links.filter(l => where.solicitacaoId ? where.solicitacaoId.in.includes(l.solicitacaoId) : where.tarefaId.in.includes(l.tarefaId)).map(l => ({ ...l, tarefa: state.tarefas.find(t => t.id === l.tarefaId) })),
      create: async ({ data }) => { state.links.push(data); return data; },
    },
    tarefaCalendario: {
      findMany: async () => state.tarefas,
      create: jest.fn(async ({ data }) => { const t = { id: `t${state.tarefas.length}`, estados: {}, versoes: [], ...data }; state.tarefas.push(t); return t; }),
      findUnique: async ({ where }) => state.tarefas.find(t => t.id === where.id),
      findFirst: async ({ where }) => state.tarefas.find(t => t.id === where.id && !t.excluidaEm),
      update: async ({ where, data }) => { const t = state.tarefas.find(t => t.id === where.id); Object.assign(t, data); return t; },
    },
  };
  const clone = x => x instanceof Date ? new Date(x) : Array.isArray(x) ? x.map(clone) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k,v]) => [k,clone(v)])) : x;
  const db = { ...tx, $transaction: async fn => { const backup = clone(state); try { return await fn(tx); } catch (e) { state = backup; throw e; } } };
  const service = new SolicitacaoTarefaService({ client: db, agora: () => now });
  const args = { contexto: { canal: 'INTERNO', atorId: 'u' }, id: 's', chave: 'k', versao: versao(state.rows[0]), dados: { titulo: 'Tarefa', empresasIds: ['a'], responsavelId: 'r', config: { dataInicio: '2026-10-27' } } };
  return { service, args, tx, db, users, state: () => state, revoke: () => { acesso = []; }, revokeResponsible: () => { acessoResponsavel = []; } };
}

test('replay with original version rehydrates the single task; new stale command fails', async () => {
  const f = fixture(); const first = await f.service.converter(f.args);
  expect(first).toMatchObject({ situacao: 'NOVA', revisao: 2, responsavelId: null, tarefa: { id: 't0', estado: 'ATIVA' } });
  expect(await f.service.converter(f.args)).toEqual(first);
  expect(f.state().tarefas).toHaveLength(1); expect(f.state().tarefas[0]).toMatchObject({ userId: 'u', responsavelId: 'r' });
  await expect(f.service.converter({ ...f.args, chave: 'new' })).rejects.toMatchObject({ code: 'versao_conflitante' });
  await expect(f.service.converter({ ...f.args, dados: { ...f.args.dados, titulo: 'Outra' } })).rejects.toMatchObject({ code: 'chave_divergente' });
  f.revoke(); await expect(f.service.converter(f.args)).rejects.toMatchObject({ status: 404 });
});

test('audit failure rolls back task, link, revision and command', async () => {
  const f = fixture(); f.tx.solicitacaoEvento.create.mockRejectedValue(new Error('audit failed'));
  await expect(f.service.converter(f.args)).rejects.toThrow('audit failed');
  expect(f.state().tarefas).toEqual([]); expect(f.state().links).toEqual([]); expect(f.state().commands).toEqual([]);
  expect(versao(f.state().rows[0])).toBe(f.args.versao);
});

test.each([{}, { dataInicio: '2026-02-29' }, { dataInicio: '2026-04-31' }])('missing/impossible date does not create task: %j', async config => {
  const f = fixture(); await expect(f.service.converter({ ...f.args, dados: { ...f.args.dados, config } })).rejects.toMatchObject({ code: 'tarefa_invalida' });
  expect(f.state().tarefas).toEqual([]);
});

test('inactive actor, unadopted legacy and foreign company cannot convert', async () => {
  const f = fixture(); f.users.u.status = 'inactive';
  await expect(f.service.converter(f.args)).rejects.toMatchObject({ status: 403 });
  f.users.u.status = 'active'; f.state().rows[0].contratoVersao = null;
  await expect(f.service.converter(f.args)).rejects.toMatchObject({ code: 'adocao_legado_pendente' });
  f.state().rows[0].contratoVersao = 1;
  await expect(f.service.converter({ ...f.args, dados: { ...f.args.dados, empresasIds: ['other'] } })).rejects.toMatchObject({ code: 'empresa_original_preservada' });
});

test('partial editing preserves responsible; clearing company is rejected; deletion/replay never recreates', async () => {
  const f = fixture(); await f.service.converter(f.args);
  const ctx = { userId: 'u', portalIds: ['a'], id: 't0' };
  const edited = await acaoTarefaUnificada({ ...ctx, dados: { acao: 'EDITAR', cicloChave: '2026-10-27', alteracoes: { titulo: 'Alterada' } } }, f.db);
  expect(edited.estados['2026-10-27'].alteracoes.responsavelId).toBe('r');
  await expect(acaoTarefaUnificada({ ...ctx, dados: { acao: 'EDITAR_SERIE', cicloChave: '2026-10-27', alteracoes: { empresasIds: [] } } }, f.db)).rejects.toMatchObject({ status: 409 });
  await acaoTarefaUnificada({ ...ctx, dados: { acao: 'EXCLUIR_SERIE' } }, f.db);
  expect((await f.service.converter(f.args)).tarefa.estado).toBe('EXCLUIDA');
  expect(f.state().rows[0].estado).toBe('AGUARDANDO'); expect(f.state().tarefas).toHaveLength(1);
  expect((await obterTarefaUnificada(ctx, f.db)).excluidaEm).toBeTruthy();
});

test('source inaccessible but task visible omits every origin capability', async () => {
  const f = fixture(); await f.service.converter(f.args);
  f.state().rows[0].portalClientId = 'other';
  const rows = await projetarTarefas(f.tx, { userId: 'u', portalIds: ['a'] }, f.state().tarefas);
  expect(rows[0].solicitacaoOrigem).toBeUndefined();
  const projected = await projetarVinculosSolicitacoes(f.tx, { atorId: 'u', empresas: [] }, [{ id: 's' }]);
  expect(projected[0].tarefa).toBeUndefined();
});

test('loading task relation does not alter business version', () => {
  const row = fixture().state().rows[0];
  expect(versao({ ...row, tarefaVinculo: { tarefaId: 't' } })).toBe(versao(row));
});

test.each(['versoes', 'estados'])('source access cannot reveal a task with unauthorized historical companies in %s', async field => {
  const f = fixture(); await f.service.converter(f.args);
  const t = f.state().tarefas[0];
  if (field === 'versoes') t.versoes = [{ aPartirDe: '2026-11-01', dados: { ...t, empresasIds: ['other'] } }];
  else t.estados = { '2026-10-27': { alteracoes: { ...t, empresasIds: ['other'] } } };
  await expect(f.service.converter(f.args)).rejects.toMatchObject({ status: 404 });
  const item = await new SolicitacoesService({ client: f.db }).detalhar({ contexto: f.args.contexto, id: 's' });
  expect(item.tarefa).toBeUndefined();
  await expect(obterTarefaUnificada({ userId: 'u', portalIds: ['a'], id: t.id }, f.db)).rejects.toMatchObject({ status: 404 });
  expect((await listarTarefasUnificadas({ userId: 'u', portalIds: ['a'], inicio: '2026-10-01', fim: '2026-11-30' }, f.db)).tarefas).toEqual([]);
});

test.each(['missing', 'inactive', 'triagem', 'company'])('invalid responsible is rejected atomically: %s', async kind => {
  const f = fixture();
  if (kind === 'missing') f.args.dados.responsavelId = 'unknown';
  if (kind === 'inactive') f.users.r.status = 'inactive';
  if (kind === 'company') f.revokeResponsible();
  if (kind === 'triagem') { f.state().rows[0].portalClientId = null; f.args.dados.empresasIds = []; f.args.versao = versao(f.state().rows[0]); }
  await expect(f.service.converter(f.args)).rejects.toMatchObject({ code: 'tarefa_invalida' });
  expect(f.state().tarefas).toEqual([]); expect(f.state().links).toEqual([]); expect(f.state().events).toEqual([]);
});

test('task-only access can conclude but cannot change the linked responsibility', async () => {
  const f = fixture(); await f.service.converter(f.args);
  f.state().rows[0].portalClientId = 'other';
  const ctx = { userId: 'u', portalIds: ['a'], id: 't0' };
  await expect(acaoTarefaUnificada({ ...ctx, dados: { acao: 'EDITAR', cicloChave: '2026-10-27', alteracoes: { responsavelId: null } } }, f.db)).rejects.toMatchObject({ status: 404 });
  const result = await acaoTarefaUnificada({ ...ctx, dados: { acao: 'CONCLUIR', cicloChave: '2026-10-27' } }, f.db);
  expect(result.solicitacaoOrigem).toBeUndefined();
  expect(f.state().rows[0].estado).toBe('AGUARDANDO');
});

test.each([null, 'u'])('removed/replaced personal recurring responsible cannot read/list/act on the series: %s', async replacement => {
  const f = fixture();
  const t = await criarTarefaUnificada({ userId: 'u', portalIds: ['a'], dados: { titulo: 'Pessoal', responsavelId: 'r', empresasIds: [], config: { dataInicio: '2026-10-27', recorrencia: 'MENSAL' } } }, f.db);
  const owner = { userId: 'u', portalIds: ['a'], id: t.id }, reader = { ...owner, userId: 'r' };
  expect((await obterTarefaUnificada(reader, f.db)).id).toBe(t.id);
  await acaoTarefaUnificada({ ...owner, dados: { acao: 'EDITAR_SERIE', cicloChave: '2026-11', alteracoes: { responsavelId: replacement } } }, f.db);
  expect(f.state().tarefas[0].responsavelId).toBe('r'); // history retained
  await expect(obterTarefaUnificada(reader, f.db)).rejects.toMatchObject({ status: 404 });
  expect((await listarTarefasUnificadas({ ...reader, inicio: '2026-11-01', fim: '2026-11-30' }, f.db)).itens).toEqual([]);
  await expect(acaoTarefaUnificada({ ...reader, dados: { acao: 'CONCLUIR', cicloChave: '2026-11' } }, f.db)).rejects.toMatchObject({ status: 404 });
});

test('leap civil date and modified occurrence copy preserve time and explicit null, never origin', async () => {
  const f = fixture(); f.args.dados.config = { dataInicio: '2028-02-29', horarioModo: 'FIXO', horaInicio: '23:00', horaFim: '23:59' };
  await f.service.converter(f.args);
  const ctx = { userId: 'u', portalIds: ['a'], id: 't0' };
  await acaoTarefaUnificada({ ...ctx, dados: { acao: 'EDITAR', cicloChave: '2028-02-29', alteracoes: { responsavelId: null, titulo: 'Modificada' } } }, f.db);
  const copy = await acaoTarefaUnificada({ ...ctx, dados: { acao: 'DUPLICAR', cicloChave: '2028-02-29', intencaoId: '12345678-1234-4123-8123-123456789abc' } }, f.db);
  expect(copy).toMatchObject({ responsavelId: null, titulo: 'Modificada (cópia)', userId: 'u', estados: {}, versoes: [], config: { dataInicio: '2028-02-29', horaInicio: '23:00', horaFim: '23:59' } });
  expect(copy.solicitacaoOrigem).toBeUndefined(); expect(f.state().links).toHaveLength(1);
});

test.each(['partial-group', 'revoked-binding'])('real S2a identity resolver filters bilateral returns after %s', async reason => {
  const f = fixture();
  let partial = false;
  const cv = { id: 'neutral', portalClientId: null, atendimentoId: 'attendance', vinculoNumeroId: 'number',
    vinculoNumero: { interlocutorId: 'person' }, chaveEscopo: 'sem-empresa:number' };
  const foreign = { id: 'foreign', portalClientId: 'outside', vinculoNumeroId: 'number', vinculoNumero: cv.vinculoNumero };
  const row = f.state().rows[0];
  Object.assign(row, { portalClientId: null, conversaId: cv.id });
  // Model ports only: segmentoAutorizado/carregarGrupoIdentidade are not mocked.
  f.tx.encaminhamentoSuporte.findMany = async () => f.state().rows.map(r => ({ ...r, conversa: cv, mensagens: [] }));
  f.tx.conversaWhatsapp = {
    findUnique: async () => cv,
    findMany: async () => partial ? [cv, foreign] : [cv],
    count: async () => partial ? 1 : 0,
  };
  f.tx.contatoWhatsapp = { count: async () => 0 };
  // The transaction port and direct read port share the same model fixtures.
  Object.assign(f.db, { conversaWhatsapp: f.tx.conversaWhatsapp, contatoWhatsapp: f.tx.contatoWhatsapp });
  f.args.versao = versao(row); f.args.dados.empresasIds = []; f.args.dados.responsavelId = 'u';
  const converted = await f.service.converter(f.args);
  expect((await f.service.converter(f.args)).tarefa).toEqual(converted.tarefa);
  const ctx = { userId: 'u', portalIds: ['a'], id: converted.tarefa.id };
  expect((await obterTarefaUnificada(ctx, f.db)).solicitacaoOrigem.id).toBe('s');
  if (reason === 'partial-group') partial = true;
  else cv.vinculoNumeroId = null;
  const before = JSON.stringify(f.state().rows), events = f.state().events.length, commands = f.state().commands.length;
  await expect(f.service.converter(f.args)).rejects.toMatchObject({ status: 404 });
  await expect(f.service.converter({ ...f.args, chave: 'new-denied', versao: converted.versao })).rejects.toMatchObject({ status: 404 });
  await expect(new SolicitacoesService({ client: f.db }).detalhar({ contexto: f.args.contexto, id: 's' })).rejects.toMatchObject({ status: 404 });
  expect((await obterTarefaUnificada(ctx, f.db)).solicitacaoOrigem).toBeUndefined();
  const list = await listarTarefasUnificadas({ ...ctx, inicio: '2026-10-01', fim: '2026-10-31' }, f.db);
  expect(list.tarefas[0].solicitacaoOrigem).toBeUndefined();
  expect(list.itens[0].solicitacaoOrigem).toBeUndefined();
  await expect(acaoTarefaUnificada({ ...ctx, dados: { acao: 'EDITAR', cicloChave: '2026-10-27', alteracoes: { responsavelId: null } } }, f.db)).rejects.toMatchObject({ status: 404 });
  expect((await acaoTarefaUnificada({ ...ctx, dados: { acao: 'CONCLUIR', cicloChave: '2026-10-27' } }, f.db)).solicitacaoOrigem).toBeUndefined();
  expect(JSON.stringify(f.state().rows)).toBe(before);
  expect(f.state().events).toHaveLength(events); expect(f.state().commands).toHaveLength(commands);
  expect(f.state().tarefas).toHaveLength(1); expect(f.state().links).toHaveLength(1);
});
