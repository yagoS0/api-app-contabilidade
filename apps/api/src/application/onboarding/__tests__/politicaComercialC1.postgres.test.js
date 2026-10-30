// Run only by the controller against a disposable loopback database.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
// Only the storage/encryption boundary is synthetic. The actual archive service,
// source hashes, PDF generators and transactional CompanyDocument writes run here.
jest.mock('../ArquivoConversaoService.js', () => {
  const actual = jest.requireActual('../ArquivoConversaoService.js');
  const objects = new Map();
  return { ...actual, __objects: objects,
    prepararArquivoConversao: jest.fn(args => actual.prepararArquivoConversao({ ...args,
      storage: { upload: async ({ key, buffer }) => { objects.set(key, Buffer.from(buffer)); } },
      decifrar: async value => {
        if (!value.startsWith('synthetic:')) throw Error('Only synthetic test documents are accepted');
        return value.slice('synthetic:'.length);
      },
    })),
  };
});
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomInt, createHash } from 'node:crypto';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { criar, converter, obter, listar } from '../OnboardingService.js';
import { criarDemandaRelacionada } from '../DemandasRelacionadasService.js';
import { criarJornadaLead } from '../JornadaLeadService.js';
import { iniciarAtendimento } from '../LeadService.js';
import { prepararArquivoConversao, __objects } from '../ArquivoConversaoService.js';
import { POLITICA_COMERCIAL_C1, projetarContratacao } from '../../../../../../packages/shared/src/onboarding/contratacaoComercial.js';

test('C1 PostgreSQL: legado nullable, produtores, conversão concorrente, pagamento posterior e rollback', async () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('Configure PostgreSQL descartável loopback *_governance_test.');
  const url = new URL(raw);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname)) throw Error('Banco de teste não autorizado.');
  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  // Imported singleton is only a local test adapter, never the production client.
  for (const key of ['onboarding', 'onboardingEvento', 'onboardingEtapa', 'propostaComercial', 'contratoComercial', 'portalClient', 'atendimentoLead', 'companyDocument', 'documentoOnboarding', 'onboardingAnalise', 'mensagemWhatsapp', 'chartOfAccount'])
    prisma[key] = db[key];
  prisma.$transaction = db.$transaction.bind(db);
  const ids = [], portals = [], conversas = [], cnpjs = [], emails = [], contas = [];
  const user = { id: 'contador-c1-' + randomUUID(), role: 'contador' };
  function novoCnpj() {
    let value = Array.from({ length: 12 }, () => randomInt(10)).join('');
    for (const weights of [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
      const remainder = [...value].reduce((sum, digit, i) => sum + Number(digit) * weights[i], 0) % 11;
      value += remainder < 2 ? '0' : String(11 - remainder);
    }
    return value;
  }
  async function fixture({ provisionar = false, origem = 'TRANSFERENCIA' } = {}) {
    const o = await criar({ origem, criadoPorId: user.id, politicaComercial: 'forjada' }); ids.push(o.id);
    const cnpj = novoCnpj(); cnpjs.push(cnpj);
    const portal = provisionar ? null : await db.portalClient.create({ data: { razao: 'Empresa exclusivamente sintética C1', cnpj } });
    if (portal) portals.push(portal.id);
    await db.onboarding.update({ where: { id: o.id }, data: { cnpj } });
    o.cnpj = cnpj;
    const p = await db.propostaComercial.create({ data: { onboardingId: o.id, versao: 1, fichaVersao: 0, status: 'ACEITA',
      opcaoAceita: 'mensal', expiraEm: new Date('2099-01-01'), snapshot: {} } });
    const c = await db.contratoComercial.create({ data: { onboardingId: o.id, propostaId: p.id, modeloId: 'sintetico', texto: 'Pagamento futuro previsto no contrato sintético.',
      status: 'AGUARDANDO_ASSINATURA', aprovadoPor: user.id, aprovadoEm: new Date('2026-10-25T12:00:00Z'),
      dados: { politicaContratacao: 'R35', opcao: { chave: 'mensal', recorrente: true },
        condicaoPagamento: { versao: 1, tipo: 'PAGAMENTO_FUTURO', carteiraAntesDoPagamento: true, vencimento: '2099-01-01',
          clausula: 'Pagamento futuro previsto no contrato sintético.', propostaId: p.id, propostaVersao: p.versao } } } });
    const buffer = Buffer.from('%PDF-1.4\nDocumento exclusivamente sintético\n%%EOF');
    const fonte = await db.documentoOnboarding.create({ data: { onboardingId: o.id, nome: 'Original sintético.pdf', mime: 'application/pdf', criadoPor: user.id,
      conteudoCifrado: 'synthetic:' + buffer.toString('base64'), sha256: createHash('sha256').update(buffer).digest('hex') } });
    const ownerEmail = 'c1-' + randomUUID() + '@example.invalid'; emails.push(ownerEmail);
    const payload = { ownerEmail, ownerName: 'Pessoa sintética', ownerPassword: 'Senha@Sintetica123', company: {
      cnpj, razaoSocial: 'Empresa exclusivamente sintética C1', regimeTributario: 'SIMPLES', cnaePrincipal: '6201501',
      endereco: { rua: 'Rua Sintética', numero: '1', bairro: 'Centro', cidade: 'São Paulo', uf: 'SP', cep: '01001000' },
    } };
    return { o, p, c, portal, fonte, payload };
  }
  try {
    await db.user.create({ data: { id: user.id, email: user.id + '@example.invalid', passwordHash: 'synthetic-not-a-login', role: 'contador', status: 'active', accountType: 'FIRM' } });
    for (const tipo of ['ATIVO', 'PASSIVO', 'RECEITA', 'DESPESA', 'PATRIMONIO']) {
      const conta = await db.chartOfAccount.create({ data: { codigo: 'c1-' + randomUUID(), nome: 'Conta sintética C1', tipo } }); contas.push(conta.id);
    }
    const conversa = await db.conversaWhatsapp.create({ data: { telefoneE164: '5511999990000', chaveEscopo: 'c1-sintetico:' + randomUUID() } });
    conversas.push(conversa.id);
    await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', tipo: 'text', corpo: 'Entrada exclusivamente sintética', providerMessageId: 'c1-' + randomUUID() } });
    const lead = await iniciarAtendimento({ conversaId: conversa.id, origem: 'TRANSFERENCIA', client: db });
    ids.push(lead.onboardingId);
    expect(lead.onboarding.politicaComercial).toBe(POLITICA_COMERCIAL_C1);
    const legado = await db.onboarding.create({ data: { origem: 'TRANSFERENCIA' } }); ids.push(legado.id);
    expect(legado.politicaComercial).toBeNull();
    const coluna = await db.$queryRawUnsafe("SELECT column_default, is_nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'onboardings' AND column_name = 'politicaComercial'");
    expect(coluna).toEqual([{ column_default: null, is_nullable: 'YES' }]);
    const relacionada = await criarDemandaRelacionada(legado.id, { origem: 'PESSOA_FISICA', versao: 0, politicaComercial: 'forjada' }, user, db); ids.push(relacionada.id);
    expect(relacionada.politicaComercial).toBe(POLITICA_COMERCIAL_C1);
    expect((await db.onboarding.findUnique({ where: { id: legado.id } })).politicaComercial).toBeNull();
    const t = await fixture();
    expect(t.o.politicaComercial).toBe(POLITICA_COMERCIAL_C1);
    const estado = { onboarding: t.o, propostas: [t.p], contratos: [t.c], marcos: [] };
    expect(projetarContratacao(estado)).toMatchObject({ carteiraPermitida: true, ganha: false });
    const converterCaso = x => converter(x.o.id, { vincularPortalClientId: x.portal.id }, { atorId: user.id, portalIds: [x.portal.id] });
    const conversoes = await Promise.allSettled([converterCaso(t), converterCaso(t)]);
    expect(conversoes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.onboardingEvento.count({ where: { onboardingId: t.o.id, tipo: 'CONVERTIDO' } })).toBe(1);
    expect(await db.portalClient.count({ where: { id: t.portal.id } })).toBe(1);
    const ficha = await db.onboarding.findUnique({ where: { id: t.o.id } });
    const body = { versao: ficha.versao, propostaVersao: 1, contratoId: t.c.id, contratoRevisao: t.c.aprovadoEm.toISOString(), confirmado: true, valorCentavos: 10000, referencia: 'Recebimento sintético C1' };
    const service = criarJornadaLead({ db });
    const [a,b] = await Promise.all([service.confirmarPagamento(t.o.id, user, body), service.confirmarPagamento(t.o.id, user, body)]);
    expect(a.id).toBe(b.id);
    expect(await db.onboarding.findUnique({ where: { id: t.o.id } })).toMatchObject({ status: 'CONVERTIDO', portalClientId: t.portal.id, versao: ficha.versao + 1 });
    expect(await db.onboardingEtapa.count({ where: { onboardingId: t.o.id } })).toBe(0);
    await expect(service.confirmarPagamento(t.o.id, user, { ...body, valorCentavos: 1 })).rejects.toMatchObject({ code: 'pagamento_divergente' });
    // Parity: the same future contract permits the read and the real command.
    const nova = await fixture({ provisionar: true });
    const detalhe = await obter(nova.o.id, user);
    expect(detalhe.conversao.contratoConferido).toBe(true);
    expect(detalhe.comercial.contratacao).toMatchObject({ carteiraPermitida: true, ganha: false, pagamentoConferido: false });
    const lista = await listar({ incluirRascunhos: true });
    expect(lista.find(item => item.id === nova.o.id).comercial.contratacao).toEqual(detalhe.comercial.contratacao);
    expect(await db.company.count({ where: { cnpj: nova.o.cnpj } })).toBe(0);
    expect(await db.portalClient.count({ where: { cnpj: nova.o.cnpj } })).toBe(0);
    const prepararReal = prepararArquivoConversao.getMockImplementation();
    let preparados = 0, liberarPreparacao;
    const ambosPreparados = new Promise(resolve => { liberarPreparacao = resolve; });
    prepararArquivoConversao.mockImplementation(async args => {
      const arquivo = await prepararReal(args);
      preparados++;
      if (preparados === 2) liberarPreparacao();
      await ambosPreparados;
      return arquivo;
    });
    let criacoes;
    try {
      criacoes = await Promise.allSettled([
        converter(nova.o.id, nova.payload, { atorId: user.id }),
        converter(nova.o.id, nova.payload, { atorId: user.id }),
      ]);
    } finally { prepararArquivoConversao.mockImplementation(prepararReal); }
    expect(preparados).toBe(2);
    expect(criacoes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(criacoes.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(criacoes.find(r => r.status === 'rejected').reason.status).toBe(409);
    const criada = criacoes.find(r => r.status === 'fulfilled').value;
    expect(criada).toMatchObject({ vinculado: false, onboarding: { status: 'CONVERTIDO', portalClientId: criada.portalClientId } });
    portals.push(criada.portalClientId);
    expect(await db.company.count({ where: { cnpj: nova.o.cnpj } })).toBe(1);
    expect(await db.portalClient.count({ where: { cnpj: nova.o.cnpj } })).toBe(1);
    expect(await db.companyClientUser.count({ where: { companyId: criada.portalClientId } })).toBe(1);
    expect(await db.companyFirmAccess.count({ where: { companyId: criada.portalClientId, userId: user.id } })).toBe(1);
    const docs = await db.companyDocument.findMany({ where: { portalClientId: criada.portalClientId } });
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      expect(__objects.get(doc.fileKey).subarray(0, 5).toString()).toBe('%PDF-');
      expect(__objects.get(doc.fileKey).length).toBe(doc.bytes);
    }
    const auditoria = await db.onboardingEvento.findMany({ where: { onboardingId: nova.o.id, tipo: 'CONVERTIDO' } });
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0].dados.documentos.sort()).toEqual(docs.map(d => d.id).sort());
    expect((await obter(nova.o.id, user)).comercial.contratacao).toMatchObject({ naCarteira: true, ganha: false, pagamentoConferido: false });
    expect(await db.onboardingEtapa.count({ where: { onboardingId: nova.o.id } })).toBe(0);

    const abertura = await fixture({ provisionar: true, origem: 'ABERTURA' });
    const previaAbertura = await obter(abertura.o.id, user);
    expect(previaAbertura.conversao).toMatchObject({ contratoConferido: false });
    expect(previaAbertura.conversao.motivo).toMatch(/registro e o CNPJ definitivo/);
    expect(previaAbertura.comercial.contratacao).toMatchObject({ carteiraPermitida: false, implantacaoPermitida: false });
    await expect(converter(abertura.o.id, abertura.payload, { atorId: user.id })).rejects.toMatchObject({ code: 'constituicao_pendente' });
    expect(await db.company.count({ where: { cnpj: abertura.o.cnpj } })).toBe(0);

    // Inject AFTER real SQL writes: verify rows exist inside the transaction,
    // then abort it. Both archive persistence and nested audit must roll back.
    for (const falha of ['documentos', 'auditoria']) {
      const caso = await fixture({ provisionar: true });
      let atingiu = false, portalTransacional;
      prisma.$transaction = fn => db.$transaction(tx => fn(new Proxy(tx, {
        get(target, model) {
          if (model !== (falha === 'documentos' ? 'companyDocument' : 'onboarding')) return target[model];
          return new Proxy(target[model], { get(delegate, method) {
            const interceptar = method === (falha === 'documentos' ? 'createMany' : 'update');
            if (!interceptar) return delegate[method];
            return async args => {
              const result = await delegate[method](args);
              if (falha === 'auditoria' && !args.data.eventos?.create) return result;
              portalTransacional = (await tx.portalClient.findUnique({ where: { cnpj: caso.o.cnpj } })).id;
              expect(await tx.companyDocument.count({ where: { portalClientId: portalTransacional } })).toBe(3);
              expect(await tx.companyFirmAccess.count({ where: { companyId: portalTransacional } })).toBe(1);
              if (falha === 'auditoria') expect(await tx.onboardingEvento.count({ where: { onboardingId: caso.o.id, tipo: 'CONVERTIDO' } })).toBe(1);
              atingiu = true;
              throw Error('falha transacional sintética: ' + falha);
            };
          } });
        },
      })));
      try {
        await expect(converter(caso.o.id, caso.payload, { atorId: user.id })).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'falha transacional sintética: ' + falha }) });
      } finally { prisma.$transaction = db.$transaction.bind(db); }
      expect(atingiu).toBe(true);
      expect(await db.company.count({ where: { cnpj: caso.o.cnpj } })).toBe(0);
      expect(await db.portalClient.count({ where: { cnpj: caso.o.cnpj } })).toBe(0);
      expect(await db.user.count({ where: { email: caso.payload.ownerEmail } })).toBe(0);
      expect(await db.client.count({ where: { email: caso.payload.ownerEmail } })).toBe(0);
      expect(await db.companyDocument.count({ where: { portalClientId: portalTransacional } })).toBe(0);
      expect(await db.companyClientUser.count({ where: { companyId: portalTransacional } })).toBe(0);
      expect(await db.companyFirmAccess.count({ where: { companyId: portalTransacional } })).toBe(0);
      expect(await db.onboardingEvento.count({ where: { onboardingId: caso.o.id, tipo: 'CONVERTIDO' } })).toBe(0);
      expect(await db.onboarding.findUnique({ where: { id: caso.o.id } })).toMatchObject({ status: 'RASCUNHO', versao: 0, portalClientId: null });
      expect(await db.documentoOnboarding.findUnique({ where: { id: caso.fonte.id } })).toEqual(caso.fonte);
    }
    const f = await fixture();
    prepararArquivoConversao.mockRejectedValueOnce(Error('arquivo sintético indisponível'));
    await expect(converterCaso(f)).rejects.toThrow('arquivo sintético');
    expect(await db.onboarding.findUnique({ where: { id: f.o.id } })).toMatchObject({ status: 'RASCUNHO', portalClientId: null, versao: 0 });
    await converterCaso(f);
    const antes = await db.onboarding.findUnique({ where: { id: f.o.id } });
    const falhando = { ...db, $transaction: fn => db.$transaction(tx => fn(new Proxy(tx, {
      get(target, key) { return key === 'onboardingEvento' ? new Proxy(target[key], {
        get(delegate, method) { return method === 'create' ? async () => { throw Error('auditoria sintética indisponível'); } : delegate[method]; },
      }) : target[key]; },
    }))) };
    await expect(criarJornadaLead({ db: falhando }).confirmarPagamento(f.o.id, user, { ...body, versao: antes.versao, contratoId: f.c.id })).rejects.toThrow('auditoria sintética');
    expect(await db.onboarding.findUnique({ where: { id: f.o.id } })).toMatchObject({ versao: antes.versao, status: 'CONVERTIDO' });
    expect(await db.onboardingEvento.count({ where: { onboardingId: f.o.id, tipo: 'PAGAMENTO_HONORARIOS_CONFERIDO' } })).toBe(0);
  } finally {
    prisma.$transaction = db.$transaction.bind(db);
    await db.atendimentoLead.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.onboardingEvento.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.onboardingEtapa.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.contratoComercial.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.propostaComercial.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.documentoOnboarding.deleteMany({ where: { onboardingId: { in: ids } } });
    await db.onboarding.deleteMany({ where: { id: { in: ids } } });
    await db.portalClient.deleteMany({ where: { OR: [{ id: { in: portals } }, { cnpj: { in: cnpjs } }] } });
    await db.company.deleteMany({ where: { cnpj: { in: cnpjs } } });
    await db.client.deleteMany({ where: { email: { in: emails } } });
    await db.user.deleteMany({ where: { OR: [{ id: user.id }, { email: { in: emails } }] } });
    await db.chartOfAccount.deleteMany({ where: { id: { in: contas } } });
    __objects.clear();
    await db.mensagemWhatsapp.deleteMany({ where: { conversaId: { in: conversas } } });
    await db.conversaWhatsapp.deleteMany({ where: { id: { in: conversas } } });
    await db.$disconnect();
  }
}, 30000);
