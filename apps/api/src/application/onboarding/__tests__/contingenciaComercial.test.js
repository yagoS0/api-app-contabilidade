jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../ContextoComercialService.js', () => ({
  ...jest.requireActual('../ContextoComercialService.js'), identidadeDoCaso: jest.fn(async () => null), exigirConversaDoCaso: jest.fn(async () => null),
}));
jest.mock('../LeadService.js', () => ({ ...jest.requireActual('../LeadService.js'), iniciarAtendimento: jest.fn() }));
import { identidadeDoCaso } from '../ContextoComercialService.js';
import { iniciarAtendimento } from '../LeadService.js';
import { dadosContingenciaIa, encaminharContingenciaComercial } from '../ContingenciaComercialService.js';

function estado() {
  const conversa = { id: 'c', canalId: 'comercial', chaveEscopo: 'sem-empresa:x', canalWhatsapp: { finalidade: 'COMERCIAL', ativo: true } };
  const mensagem = { id: 'm', conversaId: 'c', direcao: 'in', registradaEm: new Date('2026-10-13T12:00:00Z') };
  const caso = { id: 'a', conversaId: 'c', triagem: { preatendimento: { nome: 'Ana', necessidade: 'regularizar' } } };
  const db = {
    conversaWhatsapp: { findUnique: jest.fn(async () => conversa), updateMany: jest.fn(async () => ({ count: 1 })), update: jest.fn(async ({ data }) => Object.assign(conversa, data)) },
    mensagemWhatsapp: { findUnique: jest.fn(async () => mensagem), findFirst: jest.fn(async ({ where }) => where.direcao === 'in' ? mensagem : null) },
    atendimentoLead: { findFirst: jest.fn(async () => caso), update: jest.fn(async ({ data }) => Object.assign(caso, data)) },
    eventoPushAtendimento: { upsert: jest.fn(async () => ({})) },
  };
  db.$transaction = fn => fn(db);
  iniciarAtendimento.mockResolvedValue(caso);
  const chamar = (args = {}) => encaminharContingenciaComercial({ conversaId: 'c', mensagemId: 'm', motivo: 'RESPOSTA_ATRASADA', exigirSemResposta: true, client: db, ...args });
  return { conversa, mensagem, caso, db, chamar };
}
beforeEach(() => { jest.clearAllMocks(); identidadeDoCaso.mockResolvedValue(null); });

test('watchdog preserva resumo e cria aviso idempotente sem enviar mensagem', async () => {
  const t = estado(); expect(await t.chamar()).toMatchObject({ encaminhado: true });
  expect(t.caso.triagem).toMatchObject({ contingenciaIa: { estado: 'PENDENTE', mensagemId: 'm' }, preatendimento: { nome: 'Ana', necessidade: 'regularizar', estado: 'ENCAMINHADO' } });
  expect(t.conversa.atendidaDesde).toBeTruthy();
  expect(await t.chamar()).toMatchObject({ repetido: true });
  expect(t.db.eventoPushAtendimento.upsert).toHaveBeenCalledTimes(1);
});
test('falha antes da criação da ficha cria caso sem presumir intenção', async () => {
  const t = estado(); t.db.atendimentoLead.findFirst.mockResolvedValue(null);
  expect(await t.chamar()).toMatchObject({ encaminhado: true });
  expect(iniciarAtendimento).toHaveBeenCalledWith({ conversaId: 'c', client: t.db });
});
test.each(['suporte', 'humano', 'encerrado', 'outro-canal', 'invalidada', 'respondida', 'nova-mensagem'])('não encaminha candidato %s', async tipo => {
  const t = estado();
  if (tipo === 'suporte') t.conversa.canalWhatsapp.finalidade = 'SUPORTE';
  if (tipo === 'humano') t.conversa.atendidaPor = 'contador';
  if (tipo === 'encerrado') t.caso.onboarding = { status: 'DESISTIU' };
  if (tipo === 'outro-canal') t.caso.conversaId = 'outra';
  if (tipo === 'invalidada') t.conversa.automacaoInvalidadaEm = new Date('2026-10-14');
  if (tipo === 'respondida') t.db.mensagemWhatsapp.findFirst.mockResolvedValue(t.mensagem);
  if (tipo === 'nova-mensagem') t.db.mensagemWhatsapp.findFirst.mockImplementation(async ({ where }) => where.direcao === 'in' ? { id: 'nova' } : null);
  expect(await t.chamar()).toMatchObject({ encaminhado: false });
  expect(t.db.eventoPushAtendimento.upsert).not.toHaveBeenCalled();
});
test('identidade alterada interrompe antes de persistir', async () => {
  const t = estado(); identidadeDoCaso.mockRejectedValue(Object.assign(new Error('mudou'), { code: 'identidade_alterada' }));
  await expect(t.chamar()).rejects.toMatchObject({ code: 'identidade_alterada' });
  expect(t.db.atendimentoLead.update).not.toHaveBeenCalled();
});
test('erro bruto não vira conteúdo do alerta', () => {
  expect(dadosContingenciaIa({ motivo: 'https://secret:key@example.com', mensagemId: 'm' }).motivo).toBe('IA_INDISPONIVEL');
});
