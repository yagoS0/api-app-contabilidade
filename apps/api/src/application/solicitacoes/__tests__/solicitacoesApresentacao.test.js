import { apresentarSolicitacoes } from '../solicitacoesApresentacao.js';
import { projetar, versao } from '../solicitacoesProjection.js';

function fixture() {
  const empresas = [{ id: 'pc-a', razao: 'Homônima', email: 'privado' }, { id: 'pc-b', razao: 'Homônima' }, { id: 'pc-sem-nome' }];
  const pessoas = [
    { id: 'u-a', name: 'Ana', status: 'active', accountType: 'FIRM', email: 'privado', cpf: 'privado', telefone: 'privado' },
    { id: 'u-b', name: 'Ana', status: 'active', accountType: 'FIRM' },
    { id: 'sem-nome', name: ' ', status: 'active', accountType: 'FIRM', email: 'nao-usar' },
    { id: 'inativo', name: 'Inativo', status: 'inactive', accountType: 'FIRM' },
    { id: 'externo', name: 'Cliente', status: 'active', accountType: 'CLIENT' },
    { id: 'admin', name: 'Administrador', status: 'active', accountType: 'CLIENT', role: 'admin' },
  ];
  const tx = {
    portalClient: { findMany: jest.fn(async ({ where }) => empresas.filter(e => where.id.in.includes(e.id))) },
    user: { findMany: jest.fn(async ({ where, select }) => pessoas.filter(u => where.id.in.includes(u.id)
      && u.status === where.status && where.OR.some(clause => Object.entries(clause).every(([key, value]) => u[key] === value)))
      .map(u => Object.fromEntries(Object.keys(select).map(key => [key, u[key]])))) },
  };
  return { tx, empresas, pessoas };
}

test('enriquece por identidade, em lote, sem mutar DTO nem expor cadastros', async () => {
  const { tx } = fixture();
  const tarefa = Object.freeze({ id: 't', podeAbrir: true, estado: 'ATIVA', ciclosCancelados: [] });
  const itens = Object.freeze([
    Object.freeze({ id: 'a', portalClientId: 'pc-a', responsavelId: 'u-a', criadorId: 'u-b', versao: 'original', tarefa }),
    Object.freeze({ id: 'b', portalClientId: 'pc-b', responsavelId: 'u-b', criadorId: 'u-b' }),
  ]);
  const result = await apresentarSolicitacoes(tx, { empresas: ['pc-a', 'pc-b', 'pc-nao-usado'] }, itens);
  expect(result[0].apresentacao).toEqual({ empresa: { id: 'pc-a', nome: 'Homônima' }, responsavel: { id: 'u-a', nome: 'Ana' }, criador: { id: 'u-b', nome: 'Ana' } });
  expect(result[1].apresentacao.empresa).toEqual({ id: 'pc-b', nome: 'Homônima' });
  expect(result[1].apresentacao.responsavel).toEqual(result[1].apresentacao.criador);
  expect(result[0].tarefa).toBe(tarefa);
  expect(result[0].versao).toBe('original');
  expect(itens[0]).not.toHaveProperty('apresentacao');
  expect(tx.portalClient.findMany).toHaveBeenCalledTimes(1);
  expect(tx.portalClient.findMany).toHaveBeenCalledWith({ where: { id: { in: ['pc-a', 'pc-b'] } }, select: { id: true, razao: true } });
  expect(tx.user.findMany).toHaveBeenCalledTimes(1);
  expect(tx.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['u-a', 'u-b'] }, status: 'active', OR: [{ accountType: 'FIRM' }, { role: 'admin' }] }, select: { id: true, name: true } });
  expect(JSON.stringify(result)).not.toMatch(/email|cpf|telefone|accountType|status|privado/);
});

test('ausência, inatividade e escopo indisponível conservam IDs sem inventar rótulos', async () => {
  const { tx } = fixture();
  const result = await apresentarSolicitacoes(tx, { empresas: ['pc-a', 'pc-sem-nome'] }, [
    { portalClientId: 'pc-b', responsavelId: 'inativo', criadorId: 'externo' },
    { portalClientId: null, responsavelId: 'ausente', criadorId: null },
    { portalClientId: 'pc-sem-nome', responsavelId: 'sem-nome', criadorId: 'admin' },
  ]);
  expect(result[0]).toEqual({ portalClientId: 'pc-b', responsavelId: 'inativo', criadorId: 'externo', apresentacao: { empresa: null, responsavel: null, criador: null } });
  expect(result[1]).toMatchObject({ responsavelId: 'ausente', apresentacao: { empresa: null, responsavel: null, criador: null } });
  expect(result[2].apresentacao).toEqual({ empresa: { id: 'pc-sem-nome', nome: null }, responsavel: { id: 'sem-nome', nome: null }, criador: { id: 'admin', nome: 'Administrador' } });
  expect(tx.portalClient.findMany.mock.calls[0][0].where.id.in).toEqual(['pc-sem-nome']);
});

test('conjuntos vazios não consultam diretórios, inclusive detalhe sem pessoas', async () => {
  expect(await apresentarSolicitacoes({}, { empresas: [] }, [])).toEqual([]);
  expect(await apresentarSolicitacoes({}, { empresas: [] }, [{ portalClientId: null, responsavelId: null, criadorId: null }]))
    .toEqual([{ portalClientId: null, responsavelId: null, criadorId: null, apresentacao: { empresa: null, responsavel: null, criador: null } }]);
});

test('legado usa empresa efetiva projetada e nomes atualizados não alteram versão', async () => {
  const { tx, empresas } = fixture();
  const row = Object.freeze({ id: 'legado', portalClientId: null, _empresaEfetiva: 'pc-b', estado: 'AGUARDANDO', criadorId: null });
  const antes = versao(row);
  const [primeiro] = await apresentarSolicitacoes(tx, { empresas: ['pc-b'] }, [projetar(row)]);
  empresas[1].razao = 'Novo nome';
  const [segundo] = await apresentarSolicitacoes(tx, { empresas: ['pc-b'] }, [projetar(row)]);
  expect(primeiro.apresentacao.empresa.id).toBe('pc-b');
  expect(segundo.apresentacao.empresa.nome).toBe('Novo nome');
  expect(segundo.versao).toBe(primeiro.versao);
  expect(versao(row)).toBe(antes);
  expect(row.portalClientId).toBeNull();
});

test('cem itens repetidos usam somente duas consultas de apresentação', async () => {
  const { tx } = fixture();
  const itens = Array.from({ length: 100 }, (_, i) => ({ id: `s-${i}`, portalClientId: 'pc-a', responsavelId: 'u-a', criadorId: 'u-b' }));
  expect(await apresentarSolicitacoes(tx, { empresas: ['pc-a'] }, itens)).toHaveLength(100);
  expect(tx.user.findMany).toHaveBeenCalledTimes(1);
  expect(tx.portalClient.findMany).toHaveBeenCalledTimes(1);
});
