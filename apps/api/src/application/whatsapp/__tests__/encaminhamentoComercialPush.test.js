jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../InboxWhatsappService.js', () => ({ carregarGrupoIdentidade: jest.fn() }));
import { carregarGrupoIdentidade } from '../InboxWhatsappService.js';
import { registrarEncaminhamentoComercialPush, podeNotificarInscricao, payloadPush } from '../AtendimentoPushService.js';

function estado() {
  const pedido = { estado: 'AGUARDANDO_AUTORIZACAO', cnpj: '11222333000181', mensagemOrigemId: 'm' };
  const pre = { estado: 'ENCAMINHADO', cnpj: pedido.cnpj, autorizacaoFiscal: pedido };
  const lead = { id: 'a', conversaId: 'c', onboarding: { cnpj: pedido.cnpj }, triagem: { preatendimento: pre } };
  const conversa = { id: 'c', chaveEscopo: 'sem-empresa:teste', atendidaDesde: new Date(), lidaAteEm: new Date(Date.now() + 10000) };
  const user = { id: 'u', role: 'contador', accountType: 'FIRM', status: 'active' };
  const evento = { id: 'comercial:a:m', tipo: 'COMERCIAL', conversaId: 'c', expiraEm: new Date(Date.now() + 3600000) };
  const inscricao = { ativa: true, userId: 'u', fila: true, minhas: true, vinculo: 'nonce' };
  const client = { user: { findUnique: jest.fn(async () => user) }, conversaWhatsapp: { findUnique: jest.fn(async () => conversa) },
    atendimentoLead: { findUnique: jest.fn(async () => lead) }, portalClient: { findMany: jest.fn(async () => []) },
    mensagemWhatsapp: { findUnique: jest.fn() } };
  return { pedido, pre, lead, conversa, user, evento, inscricao, client };
}

test('handoff fiscal notifica mesmo com conversa já lida sem consultar mensagem', async () => {
  const s = estado();
  expect(await podeNotificarInscricao(s, s)).toBe(true);
  expect(s.client.mensagemWhatsapp.findUnique).not.toHaveBeenCalled();
  s.pedido.estado = 'REVISAO_NECESSARIA';
  expect(await podeNotificarInscricao(s, s)).toBe(true);
});

test.each(['fechado', 'automacao', 'semHandoff', 'cnpj', 'outraMensagem', 'outraConversa', 'cliente', 'inativo', 'outroDono', 'semFila', 'autorizado', 'idInvalido'])('aviso obsoleto ou sem acesso: %s', async caso => {
  const s = estado();
  if (caso === 'fechado') s.lead.encerradoEm = new Date();
  if (caso === 'automacao') s.pre.estado = 'EM_CONVERSA';
  if (caso === 'semHandoff') s.conversa.atendidaDesde = null;
  if (caso === 'cnpj') s.lead.onboarding.cnpj = '04252011000110';
  if (caso === 'outraMensagem') s.pedido.mensagemOrigemId = 'nova';
  if (caso === 'outraConversa') s.lead.conversaId = 'outra';
  if (caso === 'cliente') s.user.role = 'cliente';
  if (caso === 'inativo') s.user.status = 'inactive';
  if (caso === 'outroDono') s.conversa.atendidaPor = 'outro';
  if (caso === 'semFila') s.inscricao.fila = false;
  if (caso === 'autorizado') s.pedido.estado = 'ATIVA';
  if (caso === 'idInvalido') s.evento.id += ':extra';
  expect(await podeNotificarInscricao(s, s)).toBe(false);
});

test('troca de identidade cancela aviso; atribuição atual restringe ao contador responsável', async () => {
  const s = estado(); s.conversa.vinculoNumeroId = 'v'; s.lead.interlocutorId = 'p';
  const interlocutor = { id: 'outro', atendidaPor: 'u' };
  carregarGrupoIdentidade.mockImplementation(async () => ({ origem: { vinculoNumero: { interlocutor } } }));
  expect(await podeNotificarInscricao(s, s)).toBe(false);
  interlocutor.id = 'p'; s.inscricao.fila = false;
  expect(await podeNotificarInscricao(s, s)).toBe(true);
  s.inscricao.minhas = false;
  expect(await podeNotificarInscricao(s, s)).toBe(false);
});

test('evento determinístico não recria entrega nem limpa processamento em replay', async () => {
  const registros = new Map();
  const upsert = jest.fn(async ({ where, create, update }) => {
    if (!registros.has(where.id)) registros.set(where.id, create);
    Object.assign(registros.get(where.id), update); return registros.get(where.id);
  });
  const args = { atendimentoId: 'a', mensagemId: 'm', conversaId: 'c', client: { eventoPushAtendimento: { upsert } } };
  const evento = await registrarEncaminhamentoComercialPush(args); evento.processadoEm = new Date();
  expect(await registrarEncaminhamentoComercialPush(args)).toBe(evento);
  expect(registros.size).toBe(1); expect(evento.processadoEm).toBeInstanceOf(Date);
  expect(evento).toMatchObject({ id: 'comercial:a:m', tipo: 'COMERCIAL', conversaId: 'c' });
});

test('payload não revela dados fiscais e encaminha à conversa comercial', () => {
  const s = estado(), payload = payloadPush(s);
  expect(payload).toMatchObject({ tipo: 'COMERCIAL', url: '/comercial/conversas?app=atendimento&conversa=c' });
  expect(JSON.stringify(payload)).not.toContain(s.pedido.cnpj);
});
