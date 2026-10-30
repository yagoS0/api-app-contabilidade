import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SolicitacoesService } from '../SolicitacoesService.js';
import { SolicitacoesRepository } from '../SolicitacoesRepository.js';
import { registrarOrigemWhatsapp } from '../SolicitacoesOrigemWhatsappService.js';
import { arquivarEncaminhamentoLegado, atualizarEncaminhamentosSuporte, listarEncaminhamentosSuporte } from '../../whatsapp/EncaminhamentoSuporteService.js';
import { responderMenuWhatsapp } from '../../whatsapp/MenuWhatsappService.js';
import { responderMensagem } from '../../assistente/AssistenteService.js';
import { chaveOrigemRecalculo } from '../SolicitacoesOrigemWhatsappService.js';
import { versaoPagamentoGuia } from '../../guides/ConfirmacaoPagamentoClienteService.js';

// Only configuration and the transport boundary are simulated. Handoff guards,
// producers, reservation callbacks, repositories and transactions are real.
jest.mock('../../../config.js', () => ({ ...jest.requireActual('../../../config.js'), IA_SUPORTE_OPENAI: true }));
jest.mock('../../whatsapp/ConversaWhatsappService.js', () => ({
  ...jest.requireActual('../../whatsapp/ConversaWhatsappService.js'),
  janelaDaConversa: jest.fn(async () => ({ situacao: 'ABERTA' })),
}));
jest.mock('../../whatsapp/SaidaWhatsappService.js', () => ({
  ...jest.requireActual('../../whatsapp/SaidaWhatsappService.js'),
  enviarMensagemRastreada: jest.fn(async ({ antesDeEnviar, enviar }) => { await antesDeEnviar(); return enviar(); }),
}));

const url = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (process.env.DATABASE_URL !== url || parsed.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || !parsed.pathname.endsWith('_governance_test')) throw new Error('Banco descartável do controlador obrigatório');
}
(url ? describe : describe.skip)('S2A origem/adaptação em schema real descartável', () => {
  let db, admin, schema;
  const quote = name => `"${name.replaceAll('"', '""')}"`;
  beforeAll(() => { admin = new PrismaClient({ datasources: { db: { url } } }); });
  // Each test gets a private empty copy of the migrated schema. Separate Prisma
  // connections still exercise real concurrent commits. Append-only triggers stay
  // enabled; cleanup drops only this test's random namespace, even after failure.
  beforeEach(async () => {
    schema = `s2a_fixture_${randomUUID().replaceAll('-', '')}`;
    const source = new URL(url).searchParams.get('schema') || 'public';
    await admin.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA ${quote(schema)}`);
      const tables = await tx.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = ${source}`;
      for (const { tablename } of tables) {
        await tx.$executeRawUnsafe(`CREATE TABLE ${quote(schema)}.${quote(tablename)} (LIKE ${quote(source)}.${quote(tablename)} INCLUDING ALL)`);
      }
      // Serial defaults must never consume sequences in the source schema.
      const serials = await tx.$queryRaw`SELECT c.relname AS tabela, a.attname AS coluna, s.relname AS sequencia
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0
        JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
        JOIN pg_depend dep ON dep.classid='pg_attrdef'::regclass AND dep.objid=d.oid
        JOIN pg_class s ON s.oid=dep.refobjid AND s.relkind='S'
        WHERE n.nspname=${source}`;
      for (const r of serials) {
        await tx.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS ${quote(schema)}.${quote(r.sequencia)}`);
        const sequence = `${quote(schema)}.${quote(r.sequencia)}`.replaceAll("'", "''");
        await tx.$executeRawUnsafe(`ALTER TABLE ${quote(schema)}.${quote(r.tabela)} ALTER COLUMN ${quote(r.coluna)} SET DEFAULT nextval('${sequence}'::regclass)`);
      }
      // With only the private schema visible, pg_get_constraintdef qualifies all
      // source references. Remap those references, preserving actual FK actions.
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${quote(schema)}`);
      const fks = await tx.$queryRaw`SELECT c.relname AS tabela, k.conname AS nome, pg_get_constraintdef(k.oid) AS definicao
        FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=${source} AND k.contype='f'`;
      const sourcePrefix = /^[a-z_][a-z0-9_]*$/.test(source) ? `${source}.` : `${quote(source)}.`;
      for (const r of fks) await tx.$executeRawUnsafe(`ALTER TABLE ${quote(schema)}.${quote(r.tabela)} ADD CONSTRAINT ${quote(r.nome)} ${r.definicao.replaceAll(sourcePrefix, `${quote(schema)}.`)}`);
      const triggers = await tx.$queryRaw`SELECT c.relname AS tabela, pg_get_triggerdef(t.oid) AS definicao
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=${source} AND NOT t.tgisinternal
          AND c.relname IN ('solicitacoes_eventos','solicitacoes_comandos','solicitacoes_mensagens')`;
      expect(triggers).toHaveLength(3);
      for (const r of triggers) await tx.$executeRawUnsafe(r.definicao.replace(` ON ${sourcePrefix}`, ` ON ${quote(schema)}.`));
    }, { timeout: 60000 });
    const isolated = new URL(url); isolated.searchParams.set('schema', schema);
    db = new PrismaClient({ datasources: { db: { url: isolated.href } } });
  }, 70000);
  afterEach(async () => {
    try { await db?.$disconnect(); }
    finally {
      if (!/^s2a_fixture_[a-f0-9]{32}$/.test(schema)) throw new Error('Schema de limpeza inválido');
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
      expect(await admin.$queryRaw`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${schema}`).toEqual([]);
      db = null;
    }
  }, 30000);
  afterAll(async () => { await admin.$disconnect(); });
  async function fixture() {
    const suffix = randomUUID();
    const company = await db.portalClient.create({ data: { razao: 'S2A sintética', cnpj: `s2a-${suffix}` } });
    const user = await db.user.create({ data: { email: `${suffix}@example.invalid`, passwordHash: 'sem-acesso', role: 'user', accountType: 'FIRM', status: 'active' } });
    await db.companyFirmAccess.create({ data: { companyId: company.id, userId: user.id, role: 'STAFF' } });
    const conversa = await db.conversaWhatsapp.create({ data: { telefoneE164: '5500000000000', chaveEscopo: `s2a:${suffix}`, portalClientId: company.id } });
    const mensagem = await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, providerMessageId: suffix, direcao: 'in', tipo: 'text', corpo: 'Pedido sintético' } });
    return { company, user, conversa, mensagem, contexto: { canal: 'INTERNO', atorId: user.id }, service: new SolicitacoesService({ client: db }), repo: new SolicitacoesRepository(db), agora: new Date() };
  }
  async function produtores(f) {
    f.conversa = await db.conversaWhatsapp.update({ where: { id: f.conversa.id }, data: { escopoVerificado: true } });
    const cloud = { enviarTexto: jest.fn(async () => ({ wamid: 'simulado-sem-rede' })) };
    const vinculo = { situacao: 'VINCULADO', empresas: [{ portalClientId: f.company.id }] };
    return {
      cloud,
      menu: (client = db, interacao = null) => responderMenuWhatsapp({
        registro: { conversa: f.conversa, mensagem: f.mensagem, vinculo }, client, cloud, interacao,
        texto: 'Falar com a equipe', agora: f.agora, leaseExterno: true, conferirLease: async () => {},
        conferirJanela: async () => ({ situacao: 'ABERTA' }), resolverVinculo: async () => vinculo,
      }),
      assistente: (client = db) => responderMensagem({ conversaId: f.conversa.id, mensagemId: f.mensagem.id,
        deps: { client, cloud, flag: true, piloto: [f.company.id], usarOpenAI: true, leaseExterno: true,
          pilotoSuporte: { enabled: true, telefones: [f.conversa.telefoneE164], canais: ['principal'] },
          agora: f.agora, log: { error: jest.fn() } } }),
    };
  }
  function falharDepoisDasEscritas({ retry = false, observar = async () => {} } = {}) {
    let tentativas = 0;
    const client = new Proxy(db, { get(target, property) {
      if (property !== '$transaction') return Reflect.get(target, property);
      return (work, options) => target.$transaction(async tx => {
        const result = await work(tx);
        tentativas++;
        await observar(tx);
        if (!retry || tentativas === 1) throw Object.assign(new Error('falha injetada após escritas'), { code: retry ? 'P2034' : 'FALHA_TESTE' });
        return result;
      }, options);
    } });
    return { client, tentativas: () => tentativas };
  }
  async function conferirConjunto(f, quantidade) {
    expect(await db.encaminhamentoSuporte.count()).toBe(quantidade);
    expect(await db.solicitacaoEvento.count()).toBe(quantidade);
    expect(await db.solicitacaoComando.count()).toBe(quantidade);
    expect(await db.solicitacaoMensagem.count()).toBe(quantidade);
    expect(await db.eventoPushAtendimento.count()).toBe(quantidade);
    const atual = await db.conversaWhatsapp.findUnique({ where: { id: f.conversa.id } });
    if (quantidade) expect(atual.atendidaDesde).toBeInstanceOf(Date);
    else expect(atual.atendidaDesde).toBeNull();
  }
  test.each(['menu', 'assistente'])('produtor real %s: rollback e retry após todas as escritas, sem repetir transporte', async produtor => {
    const f = await fixture(), p = await produtores(f);
    const observar = async tx => {
      expect(await tx.encaminhamentoSuporte.count()).toBe(1);
      expect(await tx.solicitacaoEvento.count()).toBe(1);
      expect(await tx.solicitacaoComando.count()).toBe(1);
      expect(await tx.solicitacaoMensagem.count()).toBe(1);
      expect(await tx.eventoPushAtendimento.count()).toBe(1);
      expect((await tx.conversaWhatsapp.findUnique({ where: { id: f.conversa.id } })).atendidaDesde).not.toBeNull();
    };
    const failure = falharDepoisDasEscritas({ observar });
    if (produtor === 'menu') await expect(p.menu(failure.client)).rejects.toThrow('falha injetada');
    else expect(await p.assistente(failure.client)).toMatchObject({ feito: false, erro: 'falha injetada após escritas' });
    expect(failure.tentativas()).toBe(1);
    await conferirConjunto(f, 0);
    expect(p.cloud.enviarTexto).not.toHaveBeenCalled();
    const retry = falharDepoisDasEscritas({ retry: true, observar });
    const result = await p[produtor](retry.client);
    expect(result).toMatchObject(produtor === 'menu' ? { tratado: true } : { feito: true });
    expect(retry.tentativas()).toBe(2);
    await conferirConjunto(f, 1);
    expect(p.cloud.enviarTexto).toHaveBeenCalledTimes(1);
    await p[produtor]().catch(() => {});
    await conferirConjunto(f, 1);
    expect(p.cloud.enviarTexto).toHaveBeenCalledTimes(1);
  }, 30000);
  test('Menu e Assistente reais concorrentes preservam uma solicitação e um push', async () => {
    const f = await fixture(), p = await produtores(f);
    const outcomes = await Promise.allSettled([p.menu(), p.assistente()]);
    expect(outcomes.some(r => r.status === 'fulfilled' && (r.value.tratado || r.value.feito))).toBe(true);
    await conferirConjunto(f, 1);
    expect(p.cloud.enviarTexto).toHaveBeenCalledTimes(1);
    const row = await db.encaminhamentoSuporte.findFirst();
    expect(row.origemDados).toMatchObject({ tipo: 'HANDOFF_MENSAGEM', mensagemId: f.mensagem.id, portalClientId: f.company.id });
  }, 30000);
  test.each(['retry', 'concorrencia'])('recálculo manual pelo Menu real: rollback da reserva e %s sem duplicação', async modo => {
    const f = await fixture(), p = await produtores(f);
    const guide = await db.guide.create({ data: { portalClientId: f.company.id, tipo: 'ISS', competencia: '2026-09',
      source: 'LOCAL', status: 'PROCESSED', liberadaCliente: true, hash: randomUUID(), vencimento: new Date('2026-09-10T12:00:00Z') } });
    const contato = await db.contatoWhatsapp.create({ data: { portalClientId: f.company.id, nome: 'Contato sintético',
      telefoneE164: f.conversa.telefoneE164, ativo: true, optInEm: f.agora } });
    const id = `altan.payment.recalculate.${randomUUID()}`;
    await db.appSetting.create({ data: { key: id, value: { companyId: f.company.id, guideId: guide.id,
      competencia: guide.competencia, hash: guide.hash, versaoPagamento: versaoPagamentoGuia(guide),
      telefone: f.conversa.telefoneE164, contatoId: contato.id, expiraEm: new Date(f.agora.getTime() + 86400000).toISOString() } } });
    const key = chaveOrigemRecalculo(guide, true);
    const observar = async tx => {
      const reserva = await tx.appSetting.findUnique({ where: { key } });
      expect(reserva.value).toMatchObject({ status: 'ENCAMINHADO_CONTADOR', guideId: guide.id, versaoPagamento: versaoPagamentoGuia(guide) });
      expect(await tx.encaminhamentoSuporte.findUnique({ where: { id: reserva.value.suporteId } })).toMatchObject({ conversaId: f.conversa.id });
      expect(await tx.solicitacaoEvento.count()).toBe(1); expect(await tx.eventoPushAtendimento.count()).toBe(1);
    };
    const failure = falharDepoisDasEscritas({ observar });
    expect(await p.menu(failure.client, { id })).toMatchObject({ pendente: true });
    expect(failure.tentativas()).toBe(1);
    await conferirConjunto(f, 0);
    expect(await db.appSetting.findUnique({ where: { key } })).toBeNull();
    expect(p.cloud.enviarTexto.mock.calls.every(([args]) => !args.texto.includes('Solicitei ao contador'))).toBe(true);
    p.cloud.enviarTexto.mockClear();
    if (modo === 'retry') {
      const retry = falharDepoisDasEscritas({ retry: true, observar });
      expect(await p.menu(retry.client, { id })).toMatchObject({ encaminhado: true });
      expect(retry.tentativas()).toBe(2);
    } else {
      const results = await Promise.allSettled([p.menu(db, { id }), p.menu(db, { id })]);
      expect(results.filter(r => r.status === 'fulfilled' && r.value.encaminhado)).toHaveLength(1);
    }
    await conferirConjunto(f, 1);
    expect(await db.appSetting.count({ where: { key } })).toBe(1);
    expect(p.cloud.enviarTexto).toHaveBeenCalledTimes(1);
    expect(p.cloud.enviarTexto.mock.calls[0][0].texto).toContain('Solicitei ao contador');
    expect(await db.guide.findUnique({ where: { id: guide.id } })).toEqual(guide);
  }, 30000);
  test('produtores concorrentes, dois assuntos e rollback de pausa/evidência/push', async () => {
    const f = await fixture();
    const registrar = falha => f.repo.transacao(async tx => {
      await tx.conversaWhatsapp.update({ where: { id: f.conversa.id }, data: { atendidaDesde: f.agora } });
      const r = await registrarOrigemWhatsapp({ client: tx, conversaId: f.conversa.id, mensagemId: f.mensagem.id, motivo: 'Ajuda', agora: f.agora });
      if (falha) throw new Error('falha após comando e push');
      return r;
    });
    await expect(registrar(true)).rejects.toThrow('falha após comando');
    expect(await db.encaminhamentoSuporte.count({ where: { conversaId: f.conversa.id } })).toBe(0);
    expect(await db.eventoPushAtendimento.count({ where: { conversaId: f.conversa.id } })).toBe(0);
    expect((await db.conversaWhatsapp.findUnique({ where: { id: f.conversa.id } })).atendidaDesde).toBeNull();
    const [a, replay] = await Promise.all([registrar(), registrar()]);
    expect(a.id).toBe(replay.id);
    expect(await db.eventoPushAtendimento.count({ where: { conversaId: f.conversa.id } })).toBe(1);
    const b = await f.service.criar({ contexto: f.contexto, chave: 'assunto-explicito', dados: { portalClientId: f.company.id, conversaId: f.conversa.id, mensagemId: f.mensagem.id, titulo: 'Outro assunto', resumo: 'Mesmo documento, outro assunto explícito' } });
    expect(b.mensagemId).toBeNull(); expect(b.id).not.toBe(a.id);
    expect(await db.solicitacaoMensagem.count({ where: { mensagemId: f.mensagem.id } })).toBe(2);
    const aDto = await f.service.detalhar({ contexto: f.contexto, id: a.id });
    expect(aDto.criadorId).toBeNull(); expect(aDto.eventos[0]).toMatchObject({ atorId: null, sistemaId: 'WHATSAPP_SUPORTE' });
    await f.service.concluir({ contexto: f.contexto, chave: 'fim', id: a.id, versao: aDto.versao });
    await atualizarEncaminhamentosSuporte({ conversaId: f.conversa.id, estado: 'RESOLVIDO', client: db });
    expect((await f.service.detalhar({ contexto: f.contexto, id: b.id })).situacao).toBe('NOVA');
    expect((await registrar()).estado).toBe('RESOLVIDO');
    expect(await db.eventoPushAtendimento.count({ where: { conversaId: f.conversa.id } })).toBe(1);
  }, 30000);
  test('adoção individual preserva original, legado encerrado e revogação', async () => {
    const f = await fixture();
    const original = await db.encaminhamentoSuporte.create({ data: { conversaId: f.conversa.id, mensagemId: f.mensagem.id, motivo: 'Origem legada', resumo: 'Texto original', estado: 'AGUARDANDO' } });
    const dto = await f.service.detalhar({ contexto: f.contexto, id: original.id });
    expect(dto).toMatchObject({ portalClientId: f.company.id, adocaoPendente: true, criadorId: null });
    const args = { contexto: f.contexto, id: original.id, versao: dto.versao, chave: 'adotar' };
    const adopted = await f.service.adotar(args);
    expect(adopted).toMatchObject({ contratoVersao: 1, criadorId: null, portalClientId: f.company.id });
    const detail = await f.service.detalhar({ contexto: f.contexto, id: original.id });
    expect(detail.eventos[0]).toMatchObject({ tipo: 'ADOTADA', atorId: f.user.id, antes: { portalClientId: null, contratoVersao: null, resumo: 'Texto original' } });
    expect(await f.service.adotar(args)).toEqual(adopted);
    await db.companyFirmAccess.update({ where: { companyId_userId: { companyId: f.company.id, userId: f.user.id } }, data: { status: 'REMOVED' } });
    await expect(f.service.adotar(args)).rejects.toMatchObject({ status: 404 });
    expect((await f.service.listar({ contexto: f.contexto })).total).toBe(0);
  }, 30000);
  test('lista e envelope legado contam mais de cem pelo mesmo conjunto autorizado', async () => {
    const f = await fixture();
    await db.encaminhamentoSuporte.createMany({ data: Array.from({ length: 151 }, (_, n) => ({ id: randomUUID(), portalClientId: f.company.id, contratoVersao: 1, revisao: 1, titulo: `Solicitação ${n}`, motivo: 'Teste', resumo: 'Teste', estado: 'AGUARDANDO' })) });
    const list = await f.service.listar({ contexto: f.contexto, limite: 100 });
    expect(list.itens).toHaveLength(100); expect(list.total).toBe(151); expect(list.resumo.novas).toBe(151); expect(list.porEmpresa).toEqual({ [f.company.id]: 151 });
    const next = await f.service.listar({ contexto: f.contexto, limite: 100, cursor: list.proximoCursor });
    expect(next.itens).toHaveLength(51); expect(new Set([...list.itens, ...next.itens].map(i => i.id)).size).toBe(151);
    const legacy = await listarEncaminhamentosSuporte({ contexto: f.contexto, client: db });
    expect(legacy.total).toBe(151); expect(legacy.porEmpresa).toEqual(list.porEmpresa); expect(legacy.itens[0]).toMatchObject({ empresaId: f.company.id, empresa: f.company.razao, estado: 'AGUARDANDO' });
  }, 30000);
  test('arquivamento legado disputa adoção e auditoria falha desfaz a transição', async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.user.id }, data: { role: 'contador' } });
    const original = await db.encaminhamentoSuporte.create({ data: { conversaId: f.conversa.id, mensagemId: f.mensagem.id, motivo: 'Legado', resumo: 'Original' } });
    const dto = await f.service.detalhar({ contexto: f.contexto, id: original.id });
    const args = { contexto: f.contexto, conversaId: f.conversa.id, id: original.id };
    const auditFailure = new Proxy(db, { get(target, prop) {
      if (prop !== '$transaction') return Reflect.get(target, prop);
      return (work, options) => target.$transaction(tx => work(new Proxy(tx, { get(t, key) {
        if (key === 'solicitacaoEvento') return { create: async () => { throw new Error('auditoria indisponível'); } };
        return Reflect.get(t, key);
      } })), options);
    } });
    await expect(arquivarEncaminhamentoLegado({ ...args, client: auditFailure })).rejects.toThrow('auditoria indisponível');
    expect(await db.encaminhamentoSuporte.findUnique({ where: { id: original.id } })).toEqual(original);
    expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: original.id } })).toBe(0);
    const results = await Promise.allSettled([
      arquivarEncaminhamentoLegado({ ...args, client: db }),
      f.service.adotar({ contexto: f.contexto, id: original.id, versao: dto.versao, chave: 'adocao-concorrente' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const after = await db.encaminhamentoSuporte.findUnique({ where: { id: original.id } });
    expect(after.concluidoPorId).toBeNull(); expect(after.concluidoEm).toBeNull();
    const events = await db.solicitacaoEvento.findMany({ where: { solicitacaoId: original.id } });
    expect(events).toHaveLength(1);
    expect(events[0].antes).toMatchObject({ estado: original.estado, contratoVersao: null, revisao: original.revisao });
    expect(events[0].tipo).toBe(after.contratoVersao === 1 ? 'ADOTADA' : 'LEGADO_ARQUIVADO');
    if (after.contratoVersao == null) {
      await arquivarEncaminhamentoLegado({ ...args, client: db });
      expect((await f.service.detalhar({ contexto: f.contexto, id: original.id })).situacao).toBe('ENCERRADA_LEGADO');
      expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: original.id } })).toBe(1);
    }
  }, 30000);
  test('grupo legado parcial não expõe recibo neutro; contexto vigente revoga detalhe, replay e agregados', async () => {
    const f = await fixture();
    const atendimento = await db.atendimentoResponsavelWhatsapp.create({ data: { telefoneE164: '5500000000000' } });
    await db.conversaWhatsapp.update({ where: { id: f.conversa.id }, data: { atendimentoId: atendimento.id } });
    const outra = await db.portalClient.create({ data: { razao: 'Empresa fora da carteira', cnpj: randomUUID() } });
    const fora = await db.conversaWhatsapp.create({ data: { telefoneE164: '5500000000000', chaveEscopo: `empresa:${outra.id}`, portalClientId: outra.id, atendimentoId: atendimento.id } });
    const neutra = await db.conversaWhatsapp.create({ data: { telefoneE164: '5500000000000', chaveEscopo: 'sem-empresa:5500000000000', atendimentoId: atendimento.id } });
    const recibo = await db.mensagemWhatsapp.create({ data: { conversaId: neutra.id, providerMessageId: randomUUID(), direcao: 'in', tipo: 'text' } });
    const protegido = await db.encaminhamentoSuporte.create({ data: { conversaId: neutra.id, mensagemId: recibo.id, motivo: 'Recibo neutro', resumo: 'Não é triagem' } });
    const legado = await db.encaminhamentoSuporte.create({ data: { conversaId: f.conversa.id, mensagemId: f.mensagem.id, motivo: 'Assunto da empresa', resumo: 'Legado pós-migration' } });
    const lista = await f.service.listar({ contexto: f.contexto });
    expect(lista.itens.map(i => i.id)).toEqual([legado.id]);
    expect(lista.porEmpresa).toEqual({ [f.company.id]: 1 });
    await expect(f.service.detalhar({ contexto: f.contexto, id: protegido.id })).rejects.toMatchObject({ status: 404 });
    const args = { contexto: f.contexto, id: legado.id, chave: 'adotar-grupo', versao: lista.itens[0].versao };
    await f.service.adotar(args);
    // A later persisted resolution takes precedence over the original receipt's
    // conversation; no existing immutable resolution is rewritten for this test.
    await db.resolucaoContextoWhatsapp.create({ data: { mensagemId: f.mensagem.id, atendimentoId: atendimento.id,
      conversaId: fora.id, portalClientId: outra.id, versao: 1, estado: 'RESOLVIDA' } });
    await expect(f.service.detalhar({ contexto: f.contexto, id: legado.id })).rejects.toMatchObject({ status: 404 });
    await expect(f.service.adotar(args)).rejects.toMatchObject({ status: 404 });
    expect(await f.service.listar({ contexto: f.contexto })).toMatchObject({ total: 0, porEmpresa: {}, itens: [] });
    expect((await listarEncaminhamentosSuporte({ contexto: f.contexto, client: db })).total).toBe(0);
    expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: legado.id } })).toBe(1);
  }, 30000);
});
