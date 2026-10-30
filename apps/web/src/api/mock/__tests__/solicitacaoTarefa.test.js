import { criarSolicitacoesMock } from '../solicitacoesMock';
import { criarMockTarefasCalendario } from '../tarefasCalendarioMock';
import { createMockApi } from '../mockApi';

const janela = { inicio: '2026-10-01', fim: '2026-10-31' };
const proposta = row => ({ chave: 'converter', versao: row.versao,
  dados: { titulo: 'Trabalho', empresasIds: [row.portalClientId], responsavelId: 'mock-contador', config: { dataInicio: '2026-10-27' } } });

test('composed mock reflects conversion in calendar, ID lookup and independent actions', async () => {
  const api = createMockApi({ delay: async () => {} });
  const row = (await api.listarSolicitacoes()).itens[0];
  expect(typeof row.portalClientId).toBe('string');
  expect(row.portalClientId.length).toBeGreaterThan(0);
  expect(row.empresaId).toBe(row.portalClientId);
  const body = proposta(row);
  const result = await api.converterSolicitacaoEmTarefa(row.id, body);
  expect((await api.converterSolicitacaoEmTarefa(row.id, body)).item.tarefa.id).toBe(result.item.tarefa.id);
  const id = result.item.tarefa.id;
  expect((await api.listarTarefasCalendario(janela)).itens.find(i => i.tarefaId === id)).toMatchObject({ responsavelId: 'mock-contador', solicitacaoOrigem: { id: row.id } });
  expect((await api.obterTarefaCalendario(id)).tarefa.solicitacaoOrigem.id).toBe(row.id);
  await api.acaoTarefaCalendario(id, { acao: 'CONCLUIR', cicloChave: '2026-10-27' });
  expect((await api.detalharSolicitacao(row.id)).item.situacao).toBe('NOVA');
  const copy = await api.acaoTarefaCalendario(id, { acao: 'DUPLICAR', cicloChave: '2026-10-27', intencaoId: crypto.randomUUID() });
  expect(copy.tarefa.solicitacaoOrigem).toBeUndefined(); expect(copy.tarefa.estados).toEqual({});
  await api.acaoTarefaCalendario(id, { acao: 'EXCLUIR', cicloChave: '2026-10-27' });
  expect((await api.converterSolicitacaoEmTarefa(row.id, body)).item.tarefa.estado).toBe('CANCELADA');
  expect((await createMockApi().listarTarefasCalendario(janela)).tarefas).toEqual([]);
});

test.each(['id', 'companyId', 'portalClientId'])('standalone factories normalize %s without losing the source company', async key => {
  const empresas = [{ [key]: 'company-a', razao: 'Sintética' }];
  const state = { tarefas: [], vinculos: new Map() };
  const agenda = criarMockTarefasCalendario(empresas, state), sol = criarSolicitacoesMock(empresas, state, agenda);
  const row = (await sol.listarSolicitacoes()).itens[0];
  expect(row).toMatchObject({ portalClientId: 'company-a', empresaId: 'company-a' });
  const converted = await sol.converterSolicitacaoEmTarefa(row.id, proposta(row));
  expect((await agenda.obterTarefaCalendario(converted.item.tarefa.id)).tarefa.empresasIds).toEqual(['company-a']);
  expect((await sol.getPendenciasSuporte('company-a')).itens[0].empresa).toBe('Sintética');
});

test('factories remain independent; explicit shared port supports edits and one conversion under concurrency', async () => {
  const empresas = [{ id: 'a', razao: 'Sintética' }], state = { tarefas: [], vinculos: new Map() };
  const agenda = criarMockTarefasCalendario(empresas, state), sol = criarSolicitacoesMock(empresas, state, agenda);
  const row = (await sol.listarSolicitacoes()).itens[0], body = proposta(row);
  const results = await Promise.all([sol.converterSolicitacaoEmTarefa(row.id, body), sol.converterSolicitacaoEmTarefa(row.id, body)]);
  expect(results[0]).toEqual(results[1]); expect(state.tarefas).toHaveLength(1);
  const id = results[0].item.tarefa.id;
  await agenda.acaoTarefaCalendario(id, { acao: 'EDITAR', cicloChave: '2026-10-27', alteracoes: { descricao: 'Alterada' } });
  expect((await agenda.listarTarefasCalendario(janela)).itens[0].responsavelId).toBe('mock-contador');
  await expect(agenda.acaoTarefaCalendario(id, { acao: 'EDITAR', cicloChave: '2026-10-27', alteracoes: { empresasIds: [] } })).rejects.toThrow('Empresa original');
  expect((await criarMockTarefasCalendario(empresas).listarTarefasCalendario(janela)).tarefas).toEqual([]);
  expect((await criarSolicitacoesMock(empresas).listarSolicitacoes()).itens[0].tarefa).toBeUndefined();
});

test('mock rejects unknown/inactive responsible and rechecks both sides after revocation', async () => {
  const empresas = [{ id: 'a' }];
  let origemVisivel = true;
  const state = { tarefas: [], vinculos: new Map(), acesso: { atorId: 'mock',
    usuarios: [{ id: 'mock', ativo: true, triagem: true, empresasIds: ['a'] }, { id: 'r', ativo: false, triagem: false, empresasIds: ['a'] }],
    podeVerSolicitacao: () => origemVisivel } };
  const agenda = criarMockTarefasCalendario(empresas, state), sol = criarSolicitacoesMock(empresas, state, agenda);
  const row = (await sol.listarSolicitacoes()).itens[0], body = proposta(row);
  await expect(sol.converterSolicitacaoEmTarefa(row.id, body)).rejects.toThrow('Responsável inválido');
  body.dados.responsavelId = 'r';
  await expect(sol.converterSolicitacaoEmTarefa(row.id, body)).rejects.toThrow('Responsável inválido');
  expect(state.tarefas).toEqual([]);
  body.dados.responsavelId = 'mock';
  const id = (await sol.converterSolicitacaoEmTarefa(row.id, body)).item.tarefa.id;
  origemVisivel = false;
  expect((await agenda.obterTarefaCalendario(id)).tarefa.solicitacaoOrigem).toBeUndefined();
  expect((await agenda.listarTarefasCalendario(janela)).itens[0].solicitacaoOrigem).toBeUndefined();
  expect((await agenda.acaoTarefaCalendario(id, { acao: 'CONCLUIR', cicloChave: '2026-10-27' })).tarefa.solicitacaoOrigem).toBeUndefined();
  await expect(sol.converterSolicitacaoEmTarefa(row.id, body)).rejects.toThrow('Solicitação não encontrada');
  await expect(agenda.acaoTarefaCalendario(id, { acao: 'EDITAR', cicloChave: '2026-10-27', alteracoes: { responsavelId: null } })).rejects.toThrow('Alteração indisponível');
  origemVisivel = true;
  state.tarefas[0].versoes = [{ aPartirDe: '2026-11-01', dados: { ...state.tarefas[0], empresasIds: ['revogada'] } }];
  expect((await sol.detalharSolicitacao(row.id)).item.tarefa).toBeUndefined();
  await expect(sol.converterSolicitacaoEmTarefa(row.id, body)).rejects.toThrow('Tarefa não encontrada');
  await expect(agenda.obterTarefaCalendario(id)).rejects.toThrow('Tarefa não encontrada');
  expect((await agenda.listarTarefasCalendario(janela)).tarefas).toEqual([]);
});

test.each(['EDITAR', 'EDITAR_SERIE'])('%s exposes company added in history without leaking unrelated occurrences or revoked access', async acao => {
  const empresas = [{ id: 'a', razao: 'Empresa A fictícia' }, { id: 'b', razao: 'Empresa B fictícia' }, { id: 'c', razao: 'Empresa C fictícia' }];
  const ator = { id: 'mock', ativo: true, triagem: true, empresasIds: ['a', 'b', 'c'] };
  const state = { tarefas: [], vinculos: new Map(), acesso: { atorId: 'mock', usuarios: [ator] } };
  const agenda = criarMockTarefasCalendario(empresas, state);
  const id = (await agenda.criarTarefaCalendario({ titulo: 'Tarefa comum', empresasIds: ['a'],
    config: { dataInicio: '2026-10-05', dataFim: '2026-10-05', recorrencia: 'MENSAL' } })).tarefa.id;
  const periodo = { inicio: '2026-10-01', fim: '2026-12-31' };
  expect((await agenda.listarTarefasCalendario({ ...periodo, companyId: 'b' })).tarefas).toEqual([]);
  await agenda.acaoTarefaCalendario(id, { acao, cicloChave: '2026-11', alteracoes: { empresasIds: ['a', 'b'] } });
  expect(state.tarefas[0].empresasIds).toEqual(['a']);
  const b = await agenda.listarTarefasCalendario({ ...periodo, companyId: 'b' });
  expect(b.tarefas.map(t => t.id)).toEqual([id]);
  expect(b.itens.map(i => i.cicloChave)).toEqual(acao === 'EDITAR' ? ['2026-11'] : ['2026-11', '2026-12']);
  expect(b.itens.every(i => i.empresasIds.includes('b'))).toBe(true);
  expect(b.tarefas[0].solicitacaoOrigem).toBeUndefined();
  const a = await agenda.listarTarefasCalendario({ ...periodo, companyId: 'a' });
  expect(a.itens.map(i => i.cicloChave)).toEqual(['2026-10', '2026-11', '2026-12']);
  expect((await agenda.listarTarefasCalendario({ ...periodo, companyId: 'c' }))).toMatchObject({ tarefas: [], itens: [] });
  ator.empresasIds = ['a', 'c'];
  expect((await agenda.listarTarefasCalendario(periodo))).toMatchObject({ tarefas: [], itens: [] });
  expect((await agenda.listarTarefasCalendario({ ...periodo, companyId: 'b' }))).toMatchObject({ tarefas: [], itens: [] });
  await expect(agenda.obterTarefaCalendario(id)).rejects.toThrow('Tarefa não encontrada');
});

test.each(['EDITAR', 'EDITAR_SERIE'])('%s cannot add a company to a request-linked task', async acao => {
  const empresas = [{ id: 'a' }, { id: 'b' }], state = { tarefas: [], vinculos: new Map() };
  const agenda = criarMockTarefasCalendario(empresas, state), sol = criarSolicitacoesMock(empresas, state, agenda);
  const row = (await sol.listarSolicitacoes()).itens.find(i => i.portalClientId === 'a');
  const id = (await sol.converterSolicitacaoEmTarefa(row.id, proposta(row))).item.tarefa.id;
  const before = JSON.stringify(state.tarefas);
  await expect(agenda.acaoTarefaCalendario(id, { acao, cicloChave: '2026-10-27', alteracoes: { empresasIds: ['a', 'b'] } })).rejects.toThrow('Empresa original');
  expect(JSON.stringify(state.tarefas)).toBe(before);
  expect((await agenda.obterTarefaCalendario(id)).tarefa.solicitacaoOrigem.id).toBe(row.id);
  expect((await agenda.listarTarefasCalendario({ ...janela, companyId: 'b' }))).toMatchObject({ tarefas: [], itens: [] });
});