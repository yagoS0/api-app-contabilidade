jest.mock('../../whatsapp/InboxWhatsappService.js', () => ({ carregarGrupoIdentidade: jest.fn() }));
import { carregarGrupoIdentidade } from '../../whatsapp/InboxWhatsappService.js';
import { escopoDasSolicitacoes, mensagemNoSegmento, segmentoAutorizado } from '../solicitacoesEscopoWhatsapp.js';

const escopo = { empresas: ['pc1'], triagem: false };
test('grupo parcial permite seu segmento sem exigir controle humano completo', async () => {
  const conversa = { id: 'c1', portalClientId: 'pc1', vinculoNumeroId: 'v1' };
  carregarGrupoIdentidade.mockResolvedValue({ completo: false, segmentos: [conversa] });
  expect(await segmentoAutorizado({}, escopo, conversa)).toBe(true);
  expect(await segmentoAutorizado({}, escopo, { ...conversa, portalClientId: 'pc2' })).toBe(false);
  expect(await segmentoAutorizado({}, escopo, { ...conversa, excluidaEm: new Date() })).toBe(false);
});
test('triagem não é recibo neutro nem empresa com acesso revogado', async () => {
  const gestor = { empresas: [], triagem: true };
  expect(await segmentoAutorizado({}, gestor, { id: 'c', portalClientId: null, chaveEscopo: 'sem-empresa:1' })).toBe(true);
  expect(await segmentoAutorizado({}, gestor, { id: 'c', portalClientId: null, chaveEscopo: 'sem-empresa:1', atendimentoId: 'a' })).toBe(false);
  expect(await segmentoAutorizado({}, gestor, { id: 'c', portalClientId: 'pc1' })).toBe(false);
});
test('resolução vigente prevalece sobre conversa original, inclusive transferência', () => {
  const conversa = { id: 'c1', portalClientId: 'pc1', atendimentoId: 'a' };
  expect(mensagemNoSegmento({ conversaId: 'c1', contexto: { estado: 'RESOLVIDA', conversaId: 'c2', portalClientId: 'pc2', atendimentoId: 'a' } }, conversa)).toBe(false);
  expect(mensagemNoSegmento({ conversaId: 'neutro', contexto: { estado: 'RESOLVIDA', conversaId: 'c1', portalClientId: 'pc1', atendimentoId: 'a' } }, conversa)).toBe(true);
});
test('conjunto completo precede paginação; legado posterior deriva empresa sem escrever', async () => {
  const conversa = { id: 'c1', portalClientId: 'pc1' };
  const rows = Array.from({ length: 151 }, (_, n) => ({ id: `s${n}`, contratoVersao: null, portalClientId: null, conversaId: 'c1', conversa, mensagemId: `m${n}`, mensagens: [] }));
  const tx = { encaminhamentoSuporte: { findMany: jest.fn(async () => rows) }, mensagemWhatsapp: { findMany: jest.fn(async () => rows.map(r => ({ id: r.mensagemId, conversaId: 'c1' }))) } };
  const result = await escopoDasSolicitacoes(tx, escopo);
  expect(result.solicitacaoIds).toHaveLength(151);
  expect(Object.values(result.empresasEfetivas).every(id => id === 'pc1')).toBe(true);
  expect(tx.encaminhamentoSuporte.findMany.mock.calls[0][0]).not.toHaveProperty('take');
  expect(tx.mensagemWhatsapp.findMany).toHaveBeenCalledTimes(1);
  expect((await escopoDasSolicitacoes(tx, { empresas: [], triagem: false })).solicitacaoIds).toEqual([]);
});

test('grupo por atendimento legado preserva escopo parcial e não promove recibo neutro', async () => {
  const conversa = { id: 'c1', portalClientId: 'pc1', atendimentoId: 'a', chaveEscopo: 'empresa:pc1' };
  const fora = { ...conversa, id: 'c2', portalClientId: 'pc2' };
  const tx = {
    atendimentoResponsavelWhatsapp: { findUnique: jest.fn(async () => ({ id: 'a' })) },
    conversaWhatsapp: { findMany: jest.fn(async () => [conversa, fora]), findFirst: jest.fn(async () => fora) },
  };
  expect(await segmentoAutorizado(tx, escopo, conversa)).toBe(true);
  expect(await segmentoAutorizado(tx, escopo, fora)).toBe(false);
  expect(await segmentoAutorizado(tx, { empresas: ['pc1', 'pc2'], triagem: true }, { id: 'receipt', atendimentoId: 'a', chaveEscopo: 'sem-empresa:1' })).toBe(false);
  expect(await segmentoAutorizado(tx, { empresas: [], triagem: true }, conversa)).toBe(false);
  tx.atendimentoResponsavelWhatsapp.findUnique.mockResolvedValue(null);
  expect(await segmentoAutorizado(tx, escopo, conversa)).toBe(false);
});

test('materializa grupo uma vez por snapshot, revalida mensagem e revogação em outra leitura', async () => {
  const c1 = { id: 'c1', portalClientId: 'pc1', vinculoNumeroId: 'v' };
  const c2 = { ...c1, id: 'c2' };
  const rows = [c1, c2].map((conversa, n) => ({ id: `s${n}`, contratoVersao: 1, portalClientId: 'pc1', conversaId: conversa.id, conversa, mensagemId: `m${n}`, mensagens: [] }));
  const mensagens = rows.map(r => ({ id: r.mensagemId, conversaId: r.conversaId }));
  const tx = { encaminhamentoSuporte: { findMany: async () => rows }, mensagemWhatsapp: { findMany: async () => mensagens } };
  carregarGrupoIdentidade.mockClear().mockResolvedValue({ completo: false, segmentos: [c1, c2] });
  expect((await escopoDasSolicitacoes(tx, escopo)).solicitacaoIds).toEqual(['s0', 's1']);
  expect(carregarGrupoIdentidade).toHaveBeenCalledTimes(1);
  mensagens[0].contexto = { estado: 'RESOLVIDA', conversaId: 'outra', portalClientId: 'pc2' };
  expect((await escopoDasSolicitacoes(tx, escopo)).solicitacaoIds).toEqual(['s1']);
  expect((await escopoDasSolicitacoes(tx, { empresas: [], triagem: false })).solicitacaoIds).toEqual([]);
});
