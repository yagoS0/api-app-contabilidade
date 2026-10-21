jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { criarDocumentosChatComercial } from '../DocumentosChatComercialService.js';
const user = { id: 'contador', role: 'contador' };
function setup() {
  const ficha = { id: 'o', versao: 3, status: 'RASCUNHO' };
  const conversa = { id: 'c', telefoneE164: '5511999990000', vinculoNumeroId: null };
  const caso = { id: 'caso', conversaId: 'c', createdAt: new Date('2026-10-21T10:00:00Z') };
  const arquivo = { id: 'a', mensagemId: 'm', portalClientId: null, estado: 'DISPONIVEL', mimeType: 'application/pdf', tamanho: 13, nomeArquivo: 'teste.pdf', conteudo: Buffer.from('%PDF-fixture'), expiraEm: new Date('2099-01-01') };
  const documentos = [], eventos = [];
  const db = {
    onboarding: { findUnique: jest.fn(async () => ({ ...ficha })), updateMany: jest.fn(async ({ where }) => ({ count: where.versao === ficha.versao ? 1 : 0 })) },
    atendimentoLead: { findFirst: jest.fn(async () => ({ ...caso })) }, conversaWhatsapp: { findUnique: jest.fn(async () => ({ ...conversa })) },
    arquivoWhatsapp: { findMany: jest.fn(async () => [{ id: 'a', nomeArquivo: 'teste.pdf' }]), findFirst: jest.fn(async ({ where }) => where.id === arquivo.id && arquivo.portalClientId === null ? { ...arquivo } : null) },
    documentoOnboarding: { findFirst: jest.fn(async ({ where }) => documentos.find(d => d.id === where.id) || null), create: jest.fn(async ({ data }) => { const d = { id: data.id, nome: data.nome, sha256: data.sha256 }; documentos.push(d); return d; }) },
    onboardingEvento: { create: jest.fn(async ({ data }) => { eventos.push(data); return data; }) },
  };
  db.$transaction = async fn => { const d = documentos.slice(), e = eventos.slice(); try { return await fn(db); } catch (error) { documentos.splice(0, documentos.length, ...d); eventos.splice(0, eventos.length, ...e); throw error; } };
  const deps = { db, cifrar: jest.fn(async () => 'cifrado'), agora: () => new Date('2026-10-21T12:00:00Z') };
  return { ficha, caso, conversa, arquivo, documentos, eventos, db, deps, s: criarDocumentosChatComercial(deps) };
}
test('listagem só considera PDF recebido no caso atual, não arquivos de outra empresa', async () => {
  const t = setup(); expect(await t.s.listar('o', user)).toMatchObject({ arquivos: [{ id: 'a' }], versao: 3 });
  expect(t.db.arquivoWhatsapp.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ portalClientId: null, mimeType: 'application/pdf', tamanho: { lte: 5242880 }, mensagem: { conversaId: 'c', direcao: 'in', registradaEm: { gte: t.caso.createdAt } } }) }));
  expect(t.deps.cifrar).not.toHaveBeenCalled();
});
test('vínculo explícito cifra e preserva origem; repetição não duplica documento nem evento', async () => {
  const t = setup(); const body = { arquivoId: 'a', versao: 3 };
  expect(await t.s.vincular('o', user, body)).toMatchObject({ jaVinculado: false });
  expect(await t.s.vincular('o', user, body)).toMatchObject({ jaVinculado: true });
  expect(t.documentos).toHaveLength(1); expect(t.eventos).toHaveLength(1);
  expect(t.eventos[0]).toMatchObject({ tipo: 'DOCUMENTO_CHAT_VINCULADO', dados: { origem: 'WHATSAPP', arquivoWhatsappId: 'a', mensagemId: 'm', atendimentoId: 'caso' } });
  expect(t.db.documentoOnboarding.create.mock.calls[0][0].data.conteudoCifrado).toBe('cifrado'); expect(t.arquivo.portalClientId).toBeNull();
});
test.each(['outroArquivo', 'outraEmpresa', 'conteudo', 'hash', 'versao'])('recusa %s sem persistência', async alvo => {
  const t = setup(); const body = { arquivoId: 'a', versao: 3 };
  if (alvo === 'outroArquivo') body.arquivoId = 'outro';
  if (alvo === 'outraEmpresa') t.arquivo.portalClientId = 'empresa-real';
  if (alvo === 'conteudo') t.arquivo.conteudo = Buffer.from('<script>');
  if (alvo === 'hash') t.arquivo.sha256 = 'divergente';
  if (alvo === 'versao') body.versao = 2;
  await expect(t.s.vincular('o', user, body)).rejects.toMatchObject({ status: 409 }); expect(t.documentos).toHaveLength(0);
});
test('troca de atendimento durante cifragem bloqueia vínculo', async () => {
  const t = setup(); t.deps.cifrar.mockImplementation(async () => { t.caso.id = 'outro'; return 'cifrado'; });
  await expect(t.s.vincular('o', user, { arquivoId: 'a', versao: 3 })).rejects.toMatchObject({ code: 'atendimento_alterado' }); expect(t.documentos).toHaveLength(0);
});
test('falha de auditoria desfaz documento na mesma transação', async () => {
  const t = setup(); t.db.onboardingEvento.create.mockRejectedValue(new Error('falha de banco'));
  await expect(t.s.vincular('o', user, { arquivoId: 'a', versao: 3 })).rejects.toThrow('falha de banco'); expect(t.documentos).toHaveLength(0);
});
test('cliente e conversa de outro caso não autorizam leitura', async () => {
  const t = setup(); await expect(t.s.listar('o', { id: 'cliente', role: 'cliente' })).rejects.toMatchObject({ status: 403 });
  t.caso.conversaId = 'outra'; await expect(t.s.listar('o', user)).rejects.toMatchObject({ code: 'atendimento_alterado' });
});
