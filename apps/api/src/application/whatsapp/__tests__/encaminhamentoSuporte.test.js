import { registrarEncaminhamentoSuporte, listarEncaminhamentosSuporte } from '../EncaminhamentoSuporteService.js';
import { podeNotificarInscricao } from '../AtendimentoPushService.js';

function banco() {
  const fila = [];
  const client = { encaminhamentoSuporte: {
    findFirst: jest.fn(async ({ where }) => fila.find(i => i.conversaId === where.conversaId && i.estado !== 'RESOLVIDO')),
    findUnique: jest.fn(async ({ where }) => fila.find(i => where.mensagemId ? i.mensagemId === where.mensagemId : i.id === where.id)),
    create: jest.fn(async ({ data }) => { const r = { estado: 'AGUARDANDO', ...data }; fila.push(r); return r; }),
    count: jest.fn(async () => fila.length), findMany: jest.fn(async () => fila.map(i => ({ ...i, conversa: {} }))),
  }, eventoPushAtendimento: { create: jest.fn(async () => ({})) } };
  return { client, fila };
}
test('reentrega gera uma pendência e um evento próprio, sem depender de não lidas', async () => {
  const { client } = banco(), args = { conversa: { id: 'cv' }, mensagem: { id: 'm1', corpo: 'Preciso de ajuda' }, client };
  await registrarEncaminhamentoSuporte(args); await registrarEncaminhamentoSuporte(args);
  expect(client.encaminhamentoSuporte.create).toHaveBeenCalledTimes(1);
  expect(client.eventoPushAtendimento.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tipo: 'SUPORTE', id: expect.stringMatching(/^suporte:/) }) });
});
test('mesma mensagem já resolvida não reabre pendência', async () => {
  const { client, fila } = banco(), args = { conversa: { id: 'cv' }, mensagem: { id: 'm1' }, client };
  await registrarEncaminhamentoSuporte(args); fila[0].estado = 'RESOLVIDO'; await registrarEncaminhamentoSuporte(args);
  expect(fila).toHaveLength(1);
});
test('fila aplica carteira e exclusão antes do limite de página', async () => {
  const { client } = banco(); await listarEncaminhamentosSuporte({ visiveis: ['pc1'], client });
  expect(client.encaminhamentoSuporte.count).toHaveBeenCalledWith({ where: expect.objectContaining({ conversa: expect.objectContaining({ portalClientId: { in: ['pc1'] }, excluidaEm: null }) }) });
});
test('push de encaminhamento continua autorizado depois da leitura e cessa ao resolver', async () => {
  const { client, fila } = banco();
  const r = await registrarEncaminhamentoSuporte({ conversa: { id: 'cv' }, mensagem: { id: 'm1' }, client });
  client.user = { findUnique: async () => ({ id: 'u1', role: 'contador', accountType: 'FIRM', status: 'active' }) };
  client.conversaWhatsapp = { findUnique: async () => ({ id: 'cv', portalClientId: 'pc1', chaveEscopo: 'empresa:pc1', lidaAteEm: new Date() }) };
  client.portalClient = { findMany: async () => [{ id: 'pc1' }] };
  const args = { inscricao: { ativa: true, userId: 'u1', fila: true }, evento: { id: `suporte:${r.id}`, tipo: 'SUPORTE', conversaId: 'cv', expiraEm: new Date(Date.now() + 60000) } };
  expect(await podeNotificarInscricao(args, { client })).toBe(true);
  fila[0].estado = 'RESOLVIDO'; expect(await podeNotificarInscricao(args, { client })).toBe(false);
});
