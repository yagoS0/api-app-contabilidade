jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
jest.mock('../../whatsapp/IdentidadeComunicacaoService.js', () => ({ garantirIdentidadeWhatsapp: jest.fn() }));
jest.mock('../../whatsapp/ConversaWhatsappService.js', () => ({ garantirConversa: jest.fn() }));
jest.mock('../../whatsapp/InboxWhatsappService.js', () => ({ carregarGrupoIdentidade: jest.fn() }));
import { garantirIdentidadeWhatsapp } from '../../whatsapp/IdentidadeComunicacaoService.js';
import { garantirConversa } from '../../whatsapp/ConversaWhatsappService.js';
import { carregarGrupoIdentidade } from '../../whatsapp/InboxWhatsappService.js';
import { prepararContatoComercial, vincularContatoComercial } from '../ContatoComercialService.js';

const body = { nome: 'Pessoa sintética', telefone: '5521999991234', autorizado: true, evidencia: 'Solicitação sintética', canalId: 'canal' };
function fixture() {
  const conversa = { id: 'conversa', canalId: 'canal', vinculoNumeroId: 'numero', atendidaPor: 'outro', atendidaDesde: new Date(0), automacaoInvalidadaEm: new Date(0) };
  garantirIdentidadeWhatsapp.mockResolvedValue({ interlocutor: { id: 'pessoa', estado: 'ATIVO' }, vinculoNumero: { id: 'numero' } });
  garantirConversa.mockResolvedValue(conversa);
  carregarGrupoIdentidade.mockResolvedValue({ completo: true });
  const db = {
    onboarding: { findUnique: jest.fn(async () => ({ id: 'ficha', status: 'RASCUNHO' })) },
    canalWhatsapp: { findMany: jest.fn(async () => [{ id: 'canal' }]) },
    appSetting: { findUnique: jest.fn(async () => null) },
    contatoWhatsapp: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    conversaWhatsapp: { findMany: jest.fn(async () => [conversa]), findUnique: jest.fn(async () => conversa), update: jest.fn(), create: jest.fn(async () => conversa) },
    atendimentoLead: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({ id: 'lead' })) },
    onboardingEvento: { create: jest.fn(async ({ data }) => data) },
  };
  db.$transaction = jest.fn(fn => fn(db));
  return { db, conversa, args: { onboardingId: 'ficha', user: { id: 'ator', role: 'contador' }, visiveis: [], body, db } };
}
beforeEach(() => jest.clearAllMocks());
test('vínculo preserva conversa e tomada; retry não duplica evento nem atendimento', async () => {
  const t = fixture(), antes = { ...t.conversa };
  const r = await vincularContatoComercial(t.args);
  expect(r).toEqual({ conversaId: 'conversa', atendimentoId: 'lead', existente: false });
  expect(t.conversa).toEqual(antes);
  expect(t.db.conversaWhatsapp.update).not.toHaveBeenCalled();
  expect(t.db.conversaWhatsapp.create).not.toHaveBeenCalled();
  expect(garantirConversa).not.toHaveBeenCalled();
  expect(t.db.onboardingEvento.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tipo: 'CONTATO_COMERCIAL_VINCULADO', atorId: 'ator' }) });
  t.db.atendimentoLead.findFirst.mockResolvedValue({ id: 'lead', onboardingId: 'ficha', interlocutorId: 'pessoa', conversaId: 'conversa' });
  expect(await vincularContatoComercial(t.args)).toEqual({ ...r, existente: true });
  expect(t.db.atendimentoLead.create).toHaveBeenCalledTimes(1);
  expect(t.db.onboardingEvento.create).toHaveBeenCalledTimes(1);
});
test('porta legada preserva tomada e não aceita modo neutro do body', async () => {
  const t = fixture();
  await prepararContatoComercial({ ...t.args, body: { ...body, neutro: true } });
  expect(t.db.conversaWhatsapp.update).toHaveBeenCalledWith({ where: { id: 'conversa' }, data: expect.objectContaining({ atendidaPor: 'ator' }) });
});
test('nova conversa nasce sem tomada, leitura ou mensagem', async () => {
  const t = fixture();
  t.db.conversaWhatsapp.findMany.mockResolvedValue([]);
  await vincularContatoComercial(t.args);
  expect(t.db.conversaWhatsapp.create).toHaveBeenCalledWith({ data: {
    telefoneE164: body.telefone, canalId: 'canal', vinculoNumeroId: 'numero',
    chaveEscopo: `sem-empresa:v2:canal:numero:${body.telefone}`, escopoVerificado: false,
  } });
  expect(t.db.conversaWhatsapp.update).not.toHaveBeenCalled();
});
test('papel revogado é recusado também no serviço antes de escrever', async () => {
  const t = fixture();
  await expect(vincularContatoComercial({ ...t.args, user: { id: 'ator', role: 'cliente' } })).rejects.toMatchObject({ status: 403 });
  expect(t.db.$transaction).not.toHaveBeenCalled();
});
test.each(['autorizacao', 'canal', 'revogacao', 'grupo', 'empresa', 'conflito', 'excluida', 'ambigua'])('recusa %s antes de persistir vínculo/evento', async caso => {
  const t = fixture();
  if (caso === 'autorizacao') t.args.body = { ...body, autorizado: false };
  if (caso === 'canal') t.db.canalWhatsapp.findMany.mockResolvedValue([]);
  if (caso === 'revogacao') t.db.appSetting.findUnique.mockResolvedValue({ value: { status: 'REVOGADO' } });
  if (caso === 'grupo') carregarGrupoIdentidade.mockResolvedValue({ completo: false });
  if (caso === 'empresa') t.db.contatoWhatsapp.count.mockResolvedValue(1);
  if (caso === 'conflito') t.db.atendimentoLead.findFirst.mockResolvedValue({ onboardingId: 'outra', interlocutorId: 'pessoa' });
  if (caso === 'excluida') t.conversa.excluidaEm = new Date();
  if (caso === 'ambigua') t.db.conversaWhatsapp.findMany.mockResolvedValue([t.conversa, { ...t.conversa, id: 'segunda' }]);
  await expect(vincularContatoComercial(t.args)).rejects.toThrow();
  expect(t.db.atendimentoLead.create).not.toHaveBeenCalled();
  expect(t.db.onboardingEvento.create).not.toHaveBeenCalled();
  expect(t.db.conversaWhatsapp.update).not.toHaveBeenCalled();
});
test('repete somente conflito transacional local e propaga falha de auditoria', async () => {
  const t = fixture();
  t.db.$transaction.mockRejectedValueOnce({ code: 'P2034' });
  await expect(vincularContatoComercial(t.args)).resolves.toMatchObject({ existente: false });
  expect(t.db.$transaction).toHaveBeenCalledTimes(2);
  t.db.onboardingEvento.create.mockRejectedValue(new Error('auditoria indisponível'));
  await expect(vincularContatoComercial(t.args)).rejects.toThrow('auditoria indisponível');
});
