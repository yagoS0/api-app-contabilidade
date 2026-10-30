import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { SolicitacoesService } from '../SolicitacoesService.js';

const url = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (process.env.DATABASE_URL !== url || parsed.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    || !parsed.pathname.endsWith('_governance_test')) throw new Error('Banco descartável do controlador obrigatório');
}
const suite = url ? describe : describe.skip;
suite('Solicitações S1 — PostgreSQL descartável, sem transporte', () => {
  let db;
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { await db.$disconnect(); });
  async function fixture() {
    const suffix = randomUUID();
    const company = await db.portalClient.create({ data: { razao: 'S1 sintética', cnpj: `s1-${suffix}` } });
    const other = await db.portalClient.create({ data: { razao: 'S1 outra', cnpj: `s1-other-${suffix}` } });
    const makeUser = (name, extra = {}) => db.user.create({ data: { email: `${name}-${suffix}@example.invalid`, passwordHash: 'sem-acesso', role: 'user', accountType: 'FIRM', status: 'active', ...extra } });
    const admin = await makeUser('contador', { role: 'contador' });
    const staff = await makeUser('staff');
    const outside = await makeUser('fora');
    const publicUser = await makeUser('publico', { accountType: 'CLIENT' });
    await db.companyFirmAccess.create({ data: { companyId: company.id, userId: staff.id, role: 'STAFF' } });
    await db.companyFirmAccess.create({ data: { companyId: other.id, userId: outside.id, role: 'STAFF' } });
    const cv = await db.conversaWhatsapp.create({ data: { telefoneE164: '5500000000000', chaveEscopo: `s1-${suffix}`, portalClientId: company.id, atendidaPor: admin.id, atendidaDesde: new Date() } });
    const message = body => db.mensagemWhatsapp.create({ data: { conversaId: cv.id, providerMessageId: `s1-${randomUUID()}`, direcao: 'in', tipo: 'text', corpo: body } });
    const contexto = { canal: 'INTERNO', atorId: admin.id };
    const service = new SolicitacoesService({ client: db, agora: () => new Date('2026-10-25T12:00:00Z') });
    const args = (key, data = {}) => ({ contexto, chave: `${suffix}-${key}`, dados: { portalClientId: company.id, titulo: 'Assunto', resumo: 'Descrição sintética', ...data } });
    return { company, other, admin, staff, outside, publicUser, cv, message, contexto, service, args, suffix };
  }
  test('dois assuntos, mensagem repetida/complemento, anotação preservada e zero efeito em conversa/IA/push', async () => {
    const f = await fixture(); const m1 = await f.message('Primeiro'); const m2 = await f.message('Segundo'); const m3 = await f.message('Complemento');
    const originalConversation = await db.conversaWhatsapp.findUnique({ where: { id: f.cv.id } });
    const note = await db.companyNote.create({ data: { portalClientId: f.company.id, texto: 'Anotação original', fixada: true, importancia: 'ALTA', autorId: f.admin.id } });
    const a = await f.service.criar(f.args('a', { conversaId: f.cv.id, mensagemId: m1.id, anotacaoId: note.id }));
    const b = await f.service.criar(f.args('b', { conversaId: f.cv.id, mensagemId: m2.id, titulo: 'Outro assunto' }));
    expect(a.id).not.toBe(b.id);
    expect(await f.service.criar(f.args('a', { conversaId: f.cv.id, mensagemId: m1.id, anotacaoId: note.id }))).toEqual(a);
    const outroAssunto = await f.service.criar(f.args('repetida', { conversaId: f.cv.id, mensagemId: m1.id }));
    expect(outroAssunto.id).not.toBe(a.id); expect(outroAssunto.mensagemId).toBeNull();
    expect(await db.solicitacaoMensagem.count({ where: { mensagemId: m1.id } })).toBe(2);
    const extended = await f.service.editar({ contexto: f.contexto, id: a.id, versao: a.versao, chave: 'complemento', dados: { mensagemComplementarId: m3.id } });
    expect(extended.mensagemId).toBe(m1.id);
    await expect(f.service.editar({ contexto: f.contexto, id: b.id, versao: b.versao, chave: 'complemento-indevido', dados: { mensagemComplementarId: 'mensagem-fora-da-conversa' } })).rejects.toThrow('vinculo_mensagem_invalido');
    expect(await db.solicitacaoMensagem.count({ where: { solicitacaoId: b.id, mensagemId: m3.id } })).toBe(0);
    const done = await f.service.concluir({ contexto: f.contexto, id: a.id, versao: extended.versao, chave: 'fim' });
    expect(done).toMatchObject({ situacao: 'CONCLUIDA', observacaoConclusao: null, concluidoPorId: f.admin.id });
    expect((await db.encaminhamentoSuporte.findUnique({ where: { id: b.id } })).estado).toBe('AGUARDANDO');
    expect((await db.encaminhamentoSuporte.findMany({ where: { conversaId: f.cv.id, estado: { not: 'RESOLVIDO' } } })).map(r => r.id).sort()).toEqual([b.id, outroAssunto.id].sort());
    const reopened = await f.service.reabrir({ contexto: f.contexto, id: a.id, versao: done.versao, chave: 'abrir' });
    expect(reopened.situacao).toBe('NOVA');
    const detail = await f.service.detalhar({ contexto: f.contexto, id: a.id });
    expect(detail.eventos.map(e => e.tipo)).toEqual(['CRIADA', 'EDITADA', 'CONCLUIDA', 'REABERTA']);
    expect(detail.mensagens.map(m => m.mensagemId).sort()).toEqual([m1.id, m3.id].sort());
    expect(await db.companyNote.findUnique({ where: { id: note.id } })).toEqual(note);
    expect(await db.conversaWhatsapp.findUnique({ where: { id: f.cv.id } })).toEqual(originalConversation);
    expect(await db.mensagemWhatsapp.count({ where: { conversaId: f.cv.id } })).toBe(3);
    expect(await db.eventoPushAtendimento.count({ where: { conversaId: f.cv.id } })).toBe(0);
  }, 30000);

  test('replay concorrente, payload divergente e conflito simultâneo de versão', async () => {
    const f = await fixture();
    const args = f.args('replay');
    const [a, b] = await Promise.all([f.service.criar(args), f.service.criar(args)]);
    expect(a).toEqual(b);
    expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: a.id } })).toBe(1);
    await expect(f.service.criar({ ...args, dados: { ...args.dados, titulo: 'Divergente' } })).rejects.toThrow('chave_divergente');
    const results = await Promise.allSettled(['um', 'dois'].map(chave => f.service.editar({ contexto: f.contexto, id: a.id, versao: a.versao, chave, dados: { titulo: chave } })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected').reason.code).toBe('versao_conflitante');
    expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: a.id } })).toBe(2);
    const message = await f.message('Identidade repetida em comandos diferentes');
    const duplicates = await Promise.allSettled(['m1', 'm2'].map(key => f.service.criar(f.args(key, { conversaId: f.cv.id, mensagemId: message.id }))));
    expect(duplicates.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    expect(await db.solicitacaoMensagem.count({ where: { mensagemId: message.id } })).toBe(2);
    expect(await db.encaminhamentoSuporte.count({ where: { mensagemId: message.id } })).toBe(1);
  }, 30000);

  test('falha real após escrita da auditoria e do comando reverte toda a transação', async () => {
    const f = await fixture(); const a = await f.service.criar(f.args('rollback'));
    for (const modelName of ['solicitacaoEvento', 'solicitacaoComando']) {
      const injected = { $transaction: (fn, opts) => db.$transaction(tx => fn(new Proxy(tx, { get(target, prop) {
        if (prop !== modelName) return target[prop];
        return new Proxy(target[prop], { get(model, method) {
          if (method !== 'create') return model[method];
          return async input => { await model.create(input); throw new Error('falha injetada após persistir'); };
        } });
      } })), opts) };
      const service = new SolicitacoesService({ client: injected });
      await expect(service.concluir({ contexto: f.contexto, id: a.id, versao: a.versao, chave: 'falha' })).rejects.toThrow('falha injetada');
      expect((await f.service.detalhar({ contexto: f.contexto, id: a.id })).versao).toBe(a.versao);
      expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: a.id } })).toBe(1);
      expect(await db.solicitacaoComando.count({ where: { solicitacaoId: a.id } })).toBe(1);
    }
    await expect(db.solicitacaoEvento.updateMany({ where: { solicitacaoId: a.id }, data: { tipo: 'FORJADO' } })).rejects.toThrow('solicitacoes_evidencia_imutavel');
  }, 30000);

  test('escopo interno, triagem protegida, vínculo de origem e responsável são validados no banco', async () => {
    const f = await fixture(); const staffContext = { canal: 'INTERNO', atorId: f.staff.id };
    const a = await f.service.criar({ ...f.args('staff', { responsavelId: f.staff.id }), contexto: staffContext });
    expect(a.criadorId).toBe(a.responsavelId);
    await expect(f.service.criar({ ...f.args('fora', { portalClientId: f.other.id }), contexto: staffContext })).rejects.toMatchObject({ status: 404 });
    await expect(f.service.detalhar({ contexto: { ...staffContext, atorId: f.outside.id }, id: a.id })).rejects.toMatchObject({ status: 404 });
    await expect(f.service.criar({ ...f.args('publico'), contexto: { ...staffContext, atorId: f.publicUser.id } })).rejects.toMatchObject({ status: 403 });
    await expect(f.service.criar(f.args('responsavel', { responsavelId: f.outside.id }))).rejects.toThrow('responsavel_fora_escopo');
    await db.user.update({ where: { id: f.outside.id }, data: { status: 'pending' } });
    await expect(f.service.criar(f.args('responsavel-inativo', { responsavelId: f.outside.id }))).rejects.toThrow('responsavel_invalido');
    const otherNote = await db.companyNote.create({ data: { portalClientId: f.other.id, texto: 'Outra' } });
    await expect(f.service.criar(f.args('nota', { anotacaoId: otherNote.id }))).rejects.toThrow('vinculo_anotacao_invalido');
    await expect(f.service.criar(f.args('conversa', { portalClientId: f.other.id, conversaId: f.cv.id }))).rejects.toThrow('vinculo_conversa_invalido');
    await expect(f.service.criar({ ...f.args('triagem-negada', { portalClientId: null }), contexto: staffContext })).rejects.toMatchObject({ status: 404 });
    const triage = await f.service.criar(f.args('triagem', { portalClientId: null }));
    expect(triage.triagem).toBe(true);
    const classified = await f.service.editar({ contexto: f.contexto, id: triage.id, versao: triage.versao, chave: 'classificar', dados: { portalClientId: f.company.id } });
    expect(classified).toMatchObject({ portalClientId: f.company.id, triagem: false });
    await expect(f.service.editar({ contexto: f.contexto, id: classified.id, versao: classified.versao, chave: 'mover', dados: { portalClientId: f.other.id } })).rejects.toThrow('empresa_original_preservada');
    const neutral = await db.conversaWhatsapp.create({ data: { telefoneE164: '5500000000000', chaveEscopo: `neutral-${f.suffix}`, portalClientId: null, atendimentoId: null } });
    // A linked person/group is excluded even when the request's company is null.
    // Deleted/legacy conversations are also unavailable to the new reader.
    await db.conversaWhatsapp.update({ where: { id: neutral.id }, data: { excluidaEm: new Date() } });
    await expect(f.service.criar(f.args('protegida', { portalClientId: null, conversaId: neutral.id }))).rejects.toThrow('vinculo_conversa_invalido');
    await db.companyFirmAccess.update({ where: { companyId_userId: { companyId: f.company.id, userId: f.staff.id } }, data: { status: 'REMOVED' } });
    await expect(f.service.criar({ ...f.args('staff', { responsavelId: f.staff.id }), contexto: staffContext })).rejects.toMatchObject({ status: 404 });
    await expect(f.service.detalhar({ contexto: staffContext, id: a.id })).rejects.toMatchObject({ status: 404 });
    await expect(f.service.concluir({ contexto: staffContext, id: a.id, versao: a.versao, chave: 'revogado' })).rejects.toMatchObject({ status: 404 });
    for (const filtros of [{}, { portalClientId: f.company.id }, { triagem: true }]) {
      expect(await f.service.listar({ contexto: staffContext, filtros })).toMatchObject({
        itens: [], total: 0, proximoCursor: null,
        resumo: { novas: 0, prioritarias: 0, atrasadas: 0, semResponsavel: 0 },
        porPrioridade: { ALTA: 0, MEDIA: 0, BAIXA: 0, NAO_CLASSIFICADA: 0 },
      });
    }
  }, 30000);

  test('legado preservado e escritor sem revisão detectado antes e durante CAS', async () => {
    const f = await fixture();
    const legacy = await db.encaminhamentoSuporte.create({ data: { conversaId: f.cv.id, mensagemId: `legacy-${f.suffix}`, portalClientId: f.company.id,
      motivo: 'Original', resumo: 'Preservar', estado: 'RESOLVIDO', responsavelId: 'autor-desconhecido', resolvidoEm: new Date('2025-01-01') } });
    const projected = await f.service.detalhar({ contexto: f.contexto, id: legacy.id });
    expect(projected).toMatchObject({ situacao: 'ENCERRADA_LEGADO', concluidoPorId: null, adocaoPendente: true });
    await expect(f.service.reabrir({ contexto: f.contexto, id: legacy.id, versao: projected.versao, chave: 'legado' })).rejects.toThrow('adocao_legado_pendente');
    expect(await db.encaminhamentoSuporte.findUnique({ where: { id: legacy.id } })).toEqual(legacy);
    const a = await f.service.criar(f.args('novo'));
    await db.encaminhamentoSuporte.update({ where: { id: a.id }, data: { responsavelId: f.staff.id } });
    await expect(f.service.concluir({ contexto: f.contexto, id: a.id, versao: a.versao, chave: 'obsoleto' })).rejects.toThrow('versao_conflitante');
    const current = await f.service.detalhar({ contexto: f.contexto, id: a.id });
    let injected = false;
    const racing = { $transaction: (fn, opts) => db.$transaction(tx => fn(new Proxy(tx, { get(target, prop) {
      if (prop !== 'encaminhamentoSuporte') return target[prop];
      return new Proxy(target[prop], { get(model, method) {
        if (method !== 'updateMany') return model[method];
        return async input => {
          if (!injected) { injected = true; await db.encaminhamentoSuporte.update({ where: { id: a.id }, data: { estado: 'RESOLVIDO', resolvidoEm: new Date() } }); }
          return model.updateMany(input);
        };
      } });
    } })), opts) };
    await expect(new SolicitacoesService({ client: racing }).concluir({ contexto: f.contexto, id: a.id, versao: current.versao, chave: 'durante' })).rejects.toMatchObject({ code: 'versao_conflitante' });
    expect((await f.service.detalhar({ contexto: f.contexto, id: a.id })).situacao).toBe('ENCERRADA_LEGADO');
    expect(await db.solicitacaoEvento.count({ where: { solicitacaoId: a.id } })).toBe(1);
  }, 30000);

  test('151 registros, filtros e agregados completos; cursor estável em empates e datas estritas', async () => {
    const f = await fixture();
    await db.encaminhamentoSuporte.createMany({ data: Array.from({ length: 151 }, (_, i) => ({
      id: randomUUID(), portalClientId: f.company.id, motivo: 'Fixture sintética', resumo: 'Filtro único', estado: 'AGUARDANDO',
      contratoVersao: 1, revisao: 1, criadorId: f.admin.id, origem: 'MANUAL', titulo: 'Fixture de paginação',
      createdAt: new Date('2026-10-01'), updatedAt: new Date('2026-10-01'), prioridade: i < 110 ? 'ALTA' : null,
      prazoCivil: i < 120 ? '2026-10-24' : null,
    })) });
    const args = { contexto: f.contexto, filtros: { portalClientId: f.company.id }, limite: 100 };
    const first = await f.service.listar(args);
    expect(first).toMatchObject({ total: 151, resumo: { novas: 151, prioritarias: 110, atrasadas: 120, semResponsavel: 151 } });
    expect(first.porPrioridade).toEqual({ ALTA: 110, MEDIA: 0, BAIXA: 0, NAO_CLASSIFICADA: 41 });
    expect(first.itens).toHaveLength(100);
    const second = await f.service.listar({ ...args, cursor: first.proximoCursor });
    expect(second.itens).toHaveLength(51); expect(second.total).toBe(151); expect(second.proximoCursor).toBeNull();
    expect(new Set([...first.itens, ...second.itens].map(r => r.id)).size).toBe(151);
    const high = await f.service.listar({ ...args, filtros: { ...args.filtros, recorte: 'prioritarias' } });
    expect(high).toMatchObject({ total: 110, resumo: { atrasadas: 110, novas: 110 } });
    await expect(f.service.listar({ ...args, filtros: { ...args.filtros, prioridade: 'ALTA' }, cursor: first.proximoCursor })).rejects.toThrow('cursor_invalido');
    await expect(f.service.criar(f.args('data', { prazoCivil: '2026-02-30' }))).rejects.toThrow('prazo_invalido');
    const done = await f.service.criar(f.args('concluir'));
    await f.service.concluir({ contexto: f.contexto, id: done.id, versao: done.versao, chave: 'fim-contar' });
    expect((await f.service.listar({ ...args, filtros: { ...args.filtros, situacao: 'CONCLUIDA' } })).total).toBe(1);
    expect((await f.service.listar({ ...args, filtros: { ...args.filtros, situacao: 'ENCERRADA_LEGADO' } })).total).toBe(0);
  }, 30000);

  test('encerramentos legados e comprovados concordam com filtro e total, inclusive provas nulas ou divergentes', async () => {
    const f = await fixture();
    const instant = new Date('2026-10-25T12:00:00Z');
    const variants = [
      { contratoVersao: null, conversaId: f.cv.id, mensagemId: `legacy-${f.suffix}` },
      { concluidoPorId: null }, { concluidoEm: null }, { resolvidoEm: null },
      { resolvidoEm: new Date('2026-10-24T12:00:00Z') }, {},
    ];
    const records = [];
    for (const variant of variants) records.push(await db.encaminhamentoSuporte.create({ data: {
      portalClientId: f.company.id, motivo: 'Fixture', resumo: 'Prova de encerramento', estado: 'RESOLVIDO',
      contratoVersao: 1, concluidoPorId: f.admin.id, concluidoEm: instant, resolvidoEm: instant, ...variant,
    } }));
    for (const situacao of ['CONCLUIDA', 'ENCERRADA_LEGADO']) {
      const details = await Promise.all(records.map(row => f.service.detalhar({ contexto: f.contexto, id: row.id })));
      const expected = details.filter(row => row.situacao === situacao).map(row => row.id).sort();
      const list = await f.service.listar({ contexto: f.contexto, filtros: { portalClientId: f.company.id, situacao } });
      expect(list.itens.map(row => row.id).sort()).toEqual(expected);
      expect(list.total).toBe(situacao === 'CONCLUIDA' ? 1 : 5);
      expect(list.total).toBe(expected.length);
      expect(list.resumo).toEqual({ novas: 0, prioritarias: 0, atrasadas: 0, semResponsavel: 0 });
    }
  }, 30000);
});
