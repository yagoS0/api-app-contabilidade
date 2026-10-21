jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { PrismaClient } from '@prisma/client';
import { randomUUID, createHash } from 'node:crypto';
import { criarDocumentosChatComercial } from '../DocumentosChatComercialService.js';
import { criarCobrancaEnvio } from '../CobrancaEnvioService.js';
import { contextoContrato } from '../../../../../../packages/shared/src/onboarding/contratacaoComercial.js';

test('PostgreSQL: vínculo documental e cobrança externa atômicos, concorrentes e sem pagamento', async () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('Configure PostgreSQL descartável loopback em ALTAN_GOVERNANCE_TEST_DATABASE_URL.');
  const url = new URL(raw);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname) || url.searchParams.has('host')) throw Error('Banco de teste não autorizado.');
  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const ids = [], conversas = [], recursos = [];
  const user = { id: 'contador-sintetico-' + randomUUID(), role: 'contador' };
  const redeProibida = jest.fn(async () => { throw Error('Envio externo proibido neste ensaio.'); });
  function falharAuditoria() {
    return new Proxy(db, { get(target, k) { return k === '$transaction' ? fn => db.$transaction(tx => fn(new Proxy(tx, {
      get(t, key) { return key === 'onboardingEvento' ? new Proxy(t.onboardingEvento, { get(delegate, nome) { return nome === 'create' ? async () => { throw Error('auditoria sintética indisponível'); } : delegate[nome]; } }) : t[key]; },
    }))) : target[k]; } });
  }
  async function criarCaso() {
    const id = randomUUID(); ids.push(id);
    await db.onboarding.create({ data: { id, origem: 'TRANSFERENCIA', cnpj: '11222333000181', versao: 3 } });
    const conversa = await db.conversaWhatsapp.create({ data: { telefoneE164: '5511999990000', chaveEscopo: 'sem-empresa:teste-' + id } }); conversas.push(conversa.id);
    const caso = await db.atendimentoLead.create({ data: { onboardingId: id, conversaId: conversa.id, createdAt: new Date('2026-10-21T10:00:00Z') } });
    const mensagem = await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', tipo: 'document', providerMessageId: 'mock-' + randomUUID(), registradaEm: new Date('2026-10-21T11:00:00Z') } });
    const bytes = Buffer.from('%PDF-documento-exclusivamente-sintetico');
    const arquivo = await db.arquivoWhatsapp.create({ data: { mensagemId: mensagem.id, midiaProvedorId: 'sintetico', mimeType: 'application/pdf', nomeArquivo: 'teste.pdf', tamanho: bytes.length,
      conteudo: bytes, estado: 'DISPONIVEL', sha256: createHash('sha256').update(bytes).digest('hex'), expiraEm: new Date('2099-01-01') } });
    return { id, caso, conversa, arquivo, bytes };
  }
  async function criarCobranca(id) {
    const modelo = await db.recursoComercial.create({ data: { tipo: 'CONTRATO', chave: 'teste-' + randomUUID(), versao: 1, titulo: 'Modelo sintético', aprovadoEm: new Date() } }); recursos.push(modelo.id);
    const proposta = await db.propostaComercial.create({ data: { onboardingId: id, versao: 1, fichaVersao: 3, status: 'ACEITA', opcaoAceita: 'mensal', expiraEm: new Date('2099-01-01'), snapshot: {} } });
    const contrato = await db.contratoComercial.create({ data: { onboardingId: id, propostaId: proposta.id, modeloId: modelo.id, texto: 'Somente teste local', aprovadoEm: new Date(), status: 'AGUARDANDO_ASSINATURA', dados: { modeloVersao: 1, opcao: { chave: 'mensal' } } } });
    const cobranca = await db.onboardingEvento.create({ data: { onboardingId: id, tipo: 'COBRANCA_EXTERNA_REGISTRADA', atorId: user.id,
      dados: { contratoId: contrato.id, propostaId: proposta.id, propostaVersao: 1, contextoContrato: contextoContrato(proposta, contrato), url: 'https://asaas.com/cobranca-sintetica', pagamentoConfirmado: false } } });
    return { contrato, body: { versao: 3, contratoId: contrato.id, cobrancaId: cobranca.id, modo: 'EXTERNO', canal: 'WHATSAPP' } };
  }
  try {
    const t = await criarCaso();
    const documentos = criarDocumentosChatComercial({ db, cifrar: async v => 'cifra-sintetica:' + v });
    const body = { arquivoId: t.arquivo.id, versao: 3 };
    const [a, b] = await Promise.all([documentos.vincular(t.id, user, body), documentos.vincular(t.id, user, body)]);
    expect(a.documento.id).toBe(b.documento.id);
    expect(await db.documentoOnboarding.count({ where: { onboardingId: t.id } })).toBe(1);
    expect(await db.onboardingEvento.count({ where: { onboardingId: t.id, tipo: 'DOCUMENTO_CHAT_VINCULADO' } })).toBe(1);
    const original = await db.arquivoWhatsapp.findUnique({ where: { id: t.arquivo.id } });
    expect(Buffer.from(original.conteudo)).toEqual(t.bytes); expect(original.portalClientId).toBeNull();
    const f = await criarCaso();
    await expect(criarDocumentosChatComercial({ db: falharAuditoria(), cifrar: async () => 'cifra-teste' }).vincular(f.id, user, { arquivoId: f.arquivo.id, versao: 3 })).rejects.toThrow('auditoria sintética');
    expect(await db.documentoOnboarding.count({ where: { onboardingId: f.id } })).toBe(0);
    expect(await db.onboardingEvento.count({ where: { onboardingId: f.id } })).toBe(0);
    await expect(documentos.vincular(t.id, user, { arquivoId: f.arquivo.id, versao: 3 })).rejects.toMatchObject({ code: 'arquivo_indisponivel' });
    const c = await criarCobranca(t.id);
    const cobrancas = criarCobrancaEnvio({ db, transportePara: redeProibida });
    const [e1, e2] = await Promise.all([cobrancas.enviar(t.id, user, c.body), cobrancas.enviar(t.id, user, c.body)]);
    expect(e1.registro.id).toBe(e2.registro.id);
    expect(e1).toMatchObject({ pagamentoConfirmado: false, envio: { estado: 'INFORMADO_EXTERNAMENTE' } });
    expect(await db.onboardingEvento.count({ where: { onboardingId: t.id, tipo: 'COBRANCA_ENVIO_EXTERNO_REGISTRADO' } })).toBe(1);
    expect(await db.onboardingEvento.count({ where: { onboardingId: t.id, tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO' } })).toBe(0);
    expect(await db.onboarding.findUnique({ where: { id: t.id } })).toMatchObject({ faseComercial: 'LEAD', portalClientId: null, versao: 3 });
    expect(await db.contratoComercial.findUnique({ where: { id: c.contrato.id } })).toMatchObject({ status: 'AGUARDANDO_ASSINATURA', assinaturaConferidaEm: null });
    const cf = await criarCobranca(f.id);
    await expect(criarCobrancaEnvio({ db: falharAuditoria(), transportePara: redeProibida }).enviar(f.id, user, cf.body)).rejects.toThrow('auditoria sintética');
    expect(await db.onboardingEvento.count({ where: { onboardingId: f.id, tipo: 'COBRANCA_ENVIO_EXTERNO_REGISTRADO' } })).toBe(0);
    expect(redeProibida).not.toHaveBeenCalled();
  } finally {
    await db.onboardingEvento.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.contratoComercial.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.propostaComercial.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.documentoOnboarding.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.atendimentoLead.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.arquivoWhatsapp.deleteMany({ where: { mensagem: { conversaId: { in: conversas } } } });
    await db.mensagemWhatsapp.deleteMany({ where: { conversaId: { in: conversas } } });
    await db.conversaWhatsapp.deleteMany({ where: { id: { in: conversas } } });
    await db.recursoComercial.deleteMany({ where: { id: { in: recursos } } });
    await db.onboarding.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}, 30000);
