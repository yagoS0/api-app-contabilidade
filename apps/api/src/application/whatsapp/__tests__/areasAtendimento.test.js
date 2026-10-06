import { segmentosDaArea, listarInboxWhatsapp, registrarLeituraIdentidade, buscarMensagensIdentidade } from '../InboxWhatsappService.js';

const segmentos = [
  { id: 'suporte', canalWhatsapp: { finalidade: 'PRINCIPAL' } },
  { id: 'vendas', canalWhatsapp: { finalidade: 'COMERCIAL' } },
  { id: 'legado', canalWhatsapp: null },
];
test('área é definida pelo canal, inclusive para um cliente que também negocia', () => {
  expect(segmentosDaArea(segmentos, 'comercial').map(s => s.id)).toEqual(['vendas']);
  expect(segmentosDaArea(segmentos, 'suporte').map(s => s.id)).toEqual(['suporte', 'legado']);
  expect(() => segmentosDaArea(segmentos, 'todos')).toThrow();
});
test('área entra na consulta antes da paginação e no cursor', async () => {
  const client = { $queryRaw: jest.fn(async () => []), conversaWhatsapp: { findMany: jest.fn() } };
  await listarInboxWhatsapp({ visiveis: ['e1'], operadorId: 'u', area: 'comercial', client });
  const query = client.$queryRaw.mock.calls[0][0].sql;
  expect(query).toContain("canal.finalidade='COMERCIAL'");
  expect(query.indexOf("canal.finalidade='COMERCIAL'")).toBeLessThan(query.indexOf('GROUP BY grupo'));
  await expect(listarInboxWhatsapp({ visiveis: [], area: 'invalida', client })).rejects.toMatchObject({ code: 'area_invalida' });
});
function cliente() {
  const numero = { interlocutorId: 'p', interlocutor: { id: 'p' } };
  const ambos = segmentos.slice(0, 2).map(s => ({ ...s, portalClientId: 'e1', chaveEscopo: 'empresa:e1', vinculoNumeroId: 'v', vinculoNumero: numero }));
  return {
    conversaWhatsapp: { findUnique: jest.fn(async () => ambos[1]), findMany: jest.fn(async () => ambos), count: jest.fn(async () => 0), updateMany: jest.fn(async () => ({ count: 1 })) },
    contatoWhatsapp: { count: jest.fn(async () => 0) },
    mensagemWhatsapp: { findFirst: jest.fn(async () => ({ id: 'm', registradaEm: new Date() })), findMany: jest.fn(async () => []) },
  };
}
test('ler comercial não marca suporte da mesma pessoa como lido', async () => {
  const client = cliente();
  await registrarLeituraIdentidade({ conversaId: 'vendas', mensagemId: 'm', visiveis: ['e1'], area: 'comercial', client });
  expect(client.conversaWhatsapp.updateMany.mock.calls[0][0].where.id.in).toEqual(['vendas']);
});
test('busca restringe o histórico e recusa conversa de outra área', async () => {
  const client = cliente();
  await buscarMensagensIdentidade({ conversaId: 'vendas', visiveis: ['e1'], q: 'proposta', area: 'comercial', client });
  expect(client.mensagemWhatsapp.findMany.mock.calls[0][0].where.AND[0].OR[0].conversaId.in).toEqual(['vendas']);
  await expect(buscarMensagensIdentidade({ conversaId: 'vendas', visiveis: ['e1'], q: 'proposta', area: 'suporte', client })).rejects.toMatchObject({ status: 404 });
});
