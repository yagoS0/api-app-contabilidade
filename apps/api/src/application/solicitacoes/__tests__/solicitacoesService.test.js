import { SolicitacoesService } from '../SolicitacoesService.js';
import { SolicitacoesRepository } from '../SolicitacoesRepository.js';
import { versao } from '../solicitacoesProjection.js';

function fixture() {
  // Keep Dates in Jest's realm after rollback, like fresh Prisma reads. Native
  // structuredClone creates foreign-realm Dates that fail instanceof Date.
  const clone = value => value instanceof Date ? new Date(value.getTime())
    : Array.isArray(value) ? value.map(clone)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) : value;
  let rows = [], commands = [], events = [];
  const now = new Date('2026-10-25T12:00:00Z');
  const tx = {
    user: { findUnique: jest.fn(async () => ({ id: 'u', role: 'contador', accountType: 'FIRM', status: 'active' })) },
    portalClient: { findMany: async () => [{ id: 'pc1' }] },
    companyFirmAccess: { findUnique: async () => null },
    encaminhamentoSuporte: {
      fields: { concluidoEm: 'concluidoEm' },
      findUnique: jest.fn(async ({ where }) => rows.find(r => where.id ? r.id === where.id : r.mensagemId === where.mensagemId) || null),
      findFirst: jest.fn(async ({ where }) => rows.find(r => r.id === where.AND[0].id) || null),
      create: jest.fn(async ({ data }) => { const row = { concluidoPorId: null, concluidoEm: null, observacaoConclusao: null, resolvidoEm: null, ...data }; rows.push(row); return row; }),
      updateMany: jest.fn(async ({ where, data }) => {
        const i = rows.findIndex(r => r.id === where.id && r.estado === where.estado && r.responsavelId === where.responsavelId && r.revisao === where.revisao);
        if (i < 0) return { count: 0 }; rows[i] = { ...rows[i], ...data }; return { count: 1 };
      }),
    },
    solicitacaoComando: { findUnique: async ({ where }) => commands.find(c => c.atorId === where.atorId_chave.atorId && c.chave === where.atorId_chave.chave) || null,
      create: jest.fn(async ({ data }) => { commands.push(data); return data; }) },
    solicitacaoEvento: { create: jest.fn(async ({ data }) => { events.push(data); return data; }), findMany: async () => events },
    solicitacaoMensagem: { findMany: async () => [] },
  };
  const client = { $transaction: jest.fn(async fn => {
    const backup = clone({ rows, commands, events });
    try { return await fn(tx); } catch (e) { ({ rows, commands, events } = backup); throw e; }
  }) };
  const service = new SolicitacoesService({ client, agora: () => now });
  const contexto = { canal: 'INTERNO', atorId: 'u' };
  const create = { contexto, chave: 'criar', dados: { portalClientId: 'pc1', titulo: 'Pedido', resumo: 'Detalhes', responsavelId: 'u' } };
  return { tx, client, service, contexto, create, rows: () => rows, events: () => events, commands: () => commands };
}
test('criar/concluir sem texto/reabrir auditam individualmente e mantêm criador independente', async () => {
  const f = fixture();
  const a = await f.service.criar(f.create);
  const b = await f.service.criar({ ...f.create, chave: 'segundo', dados: { ...f.create.dados, titulo: 'Outro assunto' } });
  expect(a).toMatchObject({ situacao: 'NOVA', criadorId: 'u', responsavelId: 'u', prazoCivil: null, prioridade: null });
  const done = await f.service.concluir({ contexto: f.contexto, chave: 'fim', id: a.id, versao: a.versao });
  expect(done).toMatchObject({ situacao: 'CONCLUIDA', estadoLegado: 'RESOLVIDO', concluidoPorId: 'u', observacaoConclusao: null });
  expect(f.rows().find(r => r.id === b.id).estado).toBe('AGUARDANDO');
  const open = await f.service.reabrir({ contexto: f.contexto, chave: 'reabrir', id: a.id, versao: done.versao });
  expect(open).toMatchObject({ situacao: 'NOVA', revisao: 3, concluidoPorId: null });
  expect(f.events().filter(e => e.solicitacaoId === a.id).map(e => e.tipo)).toEqual(['CRIADA', 'CONCLUIDA', 'REABERTA']);
  expect(f.events().at(-1).antes.concluidoPorId).toBe('u');
  expect(f.tx.encaminhamentoSuporte.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ estado: 'RESOLVIDO', responsavelId: 'u', updatedAt: expect.any(Date), resolvidoEm: expect.any(Date) }) }));
});
test('replay devolve resultado original; divergência e versão antiga não escrevem', async () => {
  const f = fixture(); const row = await f.service.criar(f.create);
  expect(await f.service.criar(f.create)).toEqual(row); expect(f.events()).toHaveLength(1);
  await expect(f.service.criar({ ...f.create, dados: { ...f.create.dados, titulo: 'Divergente' } })).rejects.toThrow('chave_divergente');
  await f.service.editar({ contexto: f.contexto, id: row.id, versao: row.versao, chave: 'editar', dados: { titulo: 'Novo' } });
  await expect(f.service.concluir({ contexto: f.contexto, id: row.id, versao: row.versao, chave: 'antigo' })).rejects.toThrow('versao_conflitante');
});
test('falha de evento e comando revertem alterações e não anunciam sucesso', async () => {
  const f = fixture(); const row = await f.service.criar(f.create);
  f.tx.solicitacaoEvento.create.mockRejectedValueOnce(new Error('auditoria indisponível'));
  await expect(f.service.concluir({ contexto: f.contexto, id: row.id, versao: row.versao, chave: 'fim' })).rejects.toThrow('auditoria indisponível');
  expect(f.rows()[0].estado).toBe('AGUARDANDO'); expect(f.events()).toHaveLength(1);
  f.tx.solicitacaoComando.create.mockRejectedValueOnce(new Error('comando indisponível'));
  await expect(f.service.concluir({ contexto: f.contexto, id: row.id, versao: row.versao, chave: 'fim' })).rejects.toThrow('comando indisponível');
  expect(f.rows()[0].estado).toBe('AGUARDANDO'); expect(f.commands()).toHaveLength(1);
});
test('legado não é adotado implicitamente e escrita legada invalida token sem incrementar revisão', async () => {
  const f = fixture(); const row = await f.service.criar(f.create);
  f.rows()[0].responsavelId = 'outro';
  await expect(f.service.concluir({ contexto: f.contexto, id: row.id, versao: row.versao, chave: 'fim' })).rejects.toThrow('versao_conflitante');
  f.rows()[0].contratoVersao = null;
  await expect(f.service.concluir({ contexto: f.contexto, id: row.id, versao: versao(f.rows()[0]), chave: 'fim' })).rejects.toThrow('adocao_legado_pendente');
});
test('CAS recusado e serialização são tratados sem retry de efeito externo', async () => {
  const f = fixture(); const row = await f.service.criar(f.create);
  f.tx.encaminhamentoSuporte.updateMany.mockResolvedValueOnce({ count: 0 });
  await expect(f.service.concluir({ contexto: f.contexto, id: row.id, versao: row.versao, chave: 'fim' })).rejects.toThrow('versao_conflitante');
  const client = { $transaction: jest.fn().mockRejectedValueOnce({ code: 'P2034' }).mockResolvedValue('ok') };
  expect(await new SolicitacoesRepository(client).transacao(() => {})).toBe('ok');
  expect(client.$transaction).toHaveBeenCalledTimes(2);
});

test('detalhe sem escopo recusa antes de consultar registros', async () => {
  const f = fixture();
  await expect(new SolicitacoesRepository(f.client).obter(f.tx, { empresas: [], triagem: false }, 's1', '2026-10-25'))
    .rejects.toMatchObject({ code: 'solicitacao_nao_encontrada', status: 404 });
  expect(f.tx.encaminhamentoSuporte.findFirst).not.toHaveBeenCalled();
});
test('repositório agrega conjunto completo, separa cursor e usa snapshot serializável', async () => {
  const rows = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, estado: 'AGUARDANDO', createdAt: new Date('2026-10-25'), updatedAt: new Date('2026-10-25') }));
  const tx = { encaminhamentoSuporte: { fields: { concluidoEm: 'field' }, findMany: jest.fn(async () => rows), count: jest.fn(async () => 151) } };
  const repo = new SolicitacoesRepository({ $transaction: async fn => fn(tx) });
  const first = await repo.listar(tx, { empresas: ['pc1'] }, {}, '2026-10-25', { limite: 2 });
  expect(first.total).toBe(151); expect(first.itens).toHaveLength(2); expect(first.resumo.novas).toBe(151);
  const base = tx.encaminhamentoSuporte.count.mock.calls[0][0].where;
  expect(tx.encaminhamentoSuporte.count.mock.calls[1][0].where.AND[0]).toEqual(base);
  await repo.listar(tx, { empresas: ['pc1'] }, {}, '2026-10-25', { limite: 2, cursor: first.proximoCursor });
  expect(tx.encaminhamentoSuporte.count.mock.calls[9][0].where).toEqual(base);
});
