import { criarSolicitacoesMock } from '../solicitacoesMock.js';

test('leituras têm envelope mínimo consistente e comandos/replay conservam contrato', async () => {
  const empresas = [{ id: 'pc-a', razao: 'Homônima' }, { id: 'pc-b', razao: 'Homônima' }];
  const api = criarSolicitacoesMock(empresas);
  const lista = await api.listarSolicitacoes();
  const primeiro = lista.itens[0];
  expect(primeiro.apresentacao).toEqual({ empresa: { id: 'pc-a', nome: 'Homônima' }, responsavel: null,
    criador: { id: 'mock-contador', nome: 'Contador de demonstração' } });
  expect((await api.detalharSolicitacao(primeiro.id)).item.apresentacao).toEqual(primeiro.apresentacao);
  empresas[0].razao = 'Nome atualizado';
  expect((await api.detalharSolicitacao(primeiro.id)).item.versao).toBe(primeiro.versao);
  const comando = { chave: 'atribuir', versao: primeiro.versao, dados: { responsavelId: 'mock-contador' } };
  const editado = await api.editarSolicitacao(primeiro.id, comando);
  expect(editado.item).not.toHaveProperty('apresentacao');
  expect((await api.editarSolicitacao(primeiro.id, comando)).item).not.toHaveProperty('apresentacao');
  const atual = (await api.detalharSolicitacao(primeiro.id)).item;
  expect(atual.criadorId).toBe(primeiro.criadorId);
  expect(atual.apresentacao.responsavel).toEqual(atual.apresentacao.criador);
  const segundo = await api.criarSolicitacao({ chave: 'b', dados: { portalClientId: 'pc-b', titulo: 'Outro', resumo: 'Outro' } });
  expect(segundo.item).not.toHaveProperty('apresentacao');
  expect((await api.detalharSolicitacao(segundo.item.id)).item.apresentacao.empresa).toEqual({ id: 'pc-b', nome: 'Homônima' });
});

test('triagem, pessoa desconhecida/inativa/externa e referência sem nome não inventam informação', async () => {
  const estado = { tarefas: [], vinculos: new Map(), acesso: { atorId: 'mock', usuarios: [
    { id: 'mock', ativo: true, triagem: true, empresasIds: ['pc-a'] },
    { id: 'mock-contador', ativo: true, empresasIds: [], name: 'Criador' },
    { id: 'inativo', ativo: false, name: 'Nome oculto' },
    { id: 'externo', ativo: true, accountType: 'CLIENT', name: 'Nome oculto' },
    { id: 'sem-nome', ativo: true, email: 'nao-usar' },
  ] } };
  const api = criarSolicitacoesMock([{ id: 'pc-a' }], estado);
  expect((await api.listarSolicitacoes()).itens[0].apresentacao.empresa).toEqual({ id: 'pc-a', nome: null });
  for (const responsavelId of ['uuid-desconhecido', 'inativo', 'externo', 'sem-nome']) {
    const criado = await api.criarSolicitacao({ chave: responsavelId, dados: { portalClientId: null, responsavelId, titulo: 'Triagem', resumo: 'Detalhes' } });
    const detalhe = (await api.detalharSolicitacao(criado.item.id)).item;
    expect(detalhe.responsavelId).toBe(responsavelId);
    expect(detalhe.apresentacao).toEqual({ empresa: null, criador: { id: 'mock-contador', nome: 'Criador' },
      responsavel: responsavelId === 'sem-nome' ? { id: 'sem-nome', nome: null } : null });
    expect(JSON.stringify(detalhe.apresentacao)).not.toMatch(/email|Nome oculto|nao-usar/);
  }
});

test('paginação acima de cem preserva agregados e revogação impede detalhe/replay', async () => {
  const estado = { tarefas: [], vinculos: new Map() };
  const api = criarSolicitacoesMock([{ id: 'pc-a', razao: 'Empresa' }], estado);
  const comandos = Array.from({ length: 150 }, (_, i) => ({ chave: `criar-${i}`, dados: { portalClientId: 'pc-a', titulo: `Pedido ${i}`, resumo: 'Detalhes' } }));
  for (const comando of comandos) await api.criarSolicitacao(comando);
  const primeira = await api.listarSolicitacoes({ limite: 100 });
  const segunda = await api.listarSolicitacoes({ limite: 100, cursor: primeira.proximoCursor });
  expect(primeira.total).toBe(151);
  expect(primeira.porEmpresa).toEqual({ 'pc-a': 151 });
  expect(primeira.resumo.novas).toBe(151);
  expect(primeira.itens).toHaveLength(100);
  expect(segunda.itens).toHaveLength(51);
  expect(new Set([...primeira.itens, ...segunda.itens].map(item => item.id)).size).toBe(151);
  expect(segunda.itens.every(item => item.apresentacao.empresa.id === 'pc-a')).toBe(true);
  estado.acesso = { atorId: 'mock', usuarios: [{ id: 'mock', ativo: true, triagem: false, empresasIds: [] }] };
  expect((await api.listarSolicitacoes()).total).toBe(0);
  await expect(api.detalharSolicitacao(primeira.itens[0].id)).rejects.toThrow('Solicitação não encontrada');
  await expect(api.criarSolicitacao(comandos[0])).rejects.toThrow('Solicitação não encontrada');
});

test('apresentação conserva vínculo de tarefa e não substitui sua ACL bilateral', async () => {
  const tarefa = { id: 't', empresasIds: ['pc-a'], config: { recorrencia: 'AVULSA', dataInicio: '2026-10-27' }, estados: {}, versoes: [] };
  const estado = { tarefas: [tarefa], vinculos: new Map([['t', { solicitacaoId: 'solicitacao-demo-1', empresaOrigemId: 'pc-a' }]]) };
  const api = criarSolicitacoesMock([{ id: 'pc-a', razao: 'Empresa' }], estado);
  const detalhe = (await api.detalharSolicitacao('solicitacao-demo-1')).item;
  expect(detalhe.tarefa).toEqual({ id: 't', podeAbrir: true, estado: 'ATIVA', ciclosCancelados: [] });
  expect((await api.listarSolicitacoes()).itens[0].tarefa).toEqual(detalhe.tarefa);
  tarefa.empresasIds.push('pc-sem-acesso');
  const restrito = (await api.detalharSolicitacao('solicitacao-demo-1')).item;
  expect(restrito).not.toHaveProperty('tarefa');
  expect(restrito.apresentacao).toEqual(detalhe.apresentacao);
  expect(restrito.versao).toBe(detalhe.versao);
});
