// Executado somente pelo controlador, em PostgreSQL descartável e sem providers.
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: {} }));
import { PrismaClient } from '@prisma/client';
import { randomUUID, randomInt } from 'node:crypto';
import { vincularContatoComercial } from '../ContatoComercialService.js';
import { chaveConsentimento } from '../../whatsapp/ConsentimentoWhatsappService.js';

test('PostgreSQL: vínculo neutro concorrente, estado integral preservado e rollback de auditoria', async () => {
  const raw = process.env.ALTAN_GOVERNANCE_TEST_DATABASE_URL;
  if (!raw) throw Error('Configure PostgreSQL descartável loopback *_governance_test.');
  const url = new URL(raw);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/^\/[a-zA-Z0-9_]+_governance_test$/.test(url.pathname)) throw Error('Banco de teste não autorizado.');
  const db = new PrismaClient({ datasources: { db: { url: raw } } });
  const tag = randomUUID(), user = { id: `c2a-${tag}`, role: 'contador' };
  const canalId = `c2a-${tag}`, fichas = [], numeros = [], pessoas = [], conversas = [];
  async function fixture() {
    const telefone = '55119' + String(randomInt(10000000, 99999999));
    const ficha = await db.onboarding.create({ data: { origem: 'TRANSFERENCIA' } }); fichas.push(ficha.id);
    const numero = await db.vinculoNumeroInterlocutor.create({ data: { telefoneE164: telefone, origem: 'CONTATO_AUTORIZADO', interlocutor: { create: {} } } });
    numeros.push(numero.id); pessoas.push(numero.interlocutorId);
    const atendimento = await db.atendimentoResponsavelWhatsapp.create({ data: { canal: canalId, canalId, vinculoNumeroId: numero.id, telefoneE164: telefone,
      atendidaPor: user.id, atendidaDesde: new Date('2026-10-01'), automacaoInvalidadaEm: new Date('2026-10-01') } });
    const conversa = await db.conversaWhatsapp.create({ data: { telefoneE164: telefone, canalId, vinculoNumeroId: numero.id,
      chaveEscopo: `sem-empresa:v2:${canalId}:${numero.id}:${telefone}`, atendimentoId: atendimento.id,
      atendidaPor: user.id, atendidaDesde: new Date('2026-10-01'), automacaoInvalidadaEm: new Date('2026-10-01'), lidaAteEm: new Date('2026-09-01') } });
    conversas.push(conversa.id);
    const mensagem = await db.mensagemWhatsapp.create({ data: { conversaId: conversa.id, direcao: 'in', providerMessageId: `wamid.c2a.synthetic.${randomUUID()}`, tipo: 'text', corpo: 'Histórico sintético preservado' } });
    await db.turnoIaWhatsapp.create({ data: { conversaId: conversa.id, mensagemId: mensagem.id, status: 'pendente' } });
    return { ficha, numero, conversa, atendimento, args: { onboardingId: ficha.id, db, user, visiveis: [], body: {
      nome: 'Pessoa sintética', telefone, canalId, autorizado: true, evidencia: 'Solicitação sintética C2A', assumir: true,
    } } };
  }
  async function snapshot(t) {
    return {
      ficha: await db.onboarding.findUnique({ where: { id: t.ficha.id } }),
      conversa: await db.conversaWhatsapp.findUnique({ where: { id: t.conversa.id } }),
      atendimento: await db.atendimentoResponsavelWhatsapp.findUnique({ where: { id: t.atendimento.id } }),
      mensagens: await db.mensagemWhatsapp.findMany({ where: { conversaId: t.conversa.id }, orderBy: { id: 'asc' } }),
      turnos: await db.turnoIaWhatsapp.findMany({ where: { conversaId: t.conversa.id }, orderBy: { id: 'asc' } }),
      acoes: await db.acaoPendenteWhatsapp.findMany({ where: { conversaId: t.conversa.id }, orderBy: { id: 'asc' } }),
      tarefas: await db.manualTask.findMany({ where: { ownerId: user.id }, orderBy: { id: 'asc' } }),
    };
  }
  try {
    await db.user.create({ data: { id: user.id, email: `${tag}@example.invalid`, passwordHash: 'synthetic-not-a-login', role: 'contador', status: 'active', accountType: 'FIRM' } });
    await db.canalWhatsapp.create({ data: { id: canalId, chave: canalId, finalidade: 'COMERCIAL', ativo: true } });
    await db.manualTask.create({ data: { ownerId: user.id, requestKey: tag, kind: 'TESTE_SINTETICO', companyIds: [], status: 'running' } });
    const t = await fixture(), antes = await snapshot(t);
    const resultados = await Promise.all([vincularContatoComercial(t.args), vincularContatoComercial(t.args)]);
    expect(new Set(resultados.map(r => r.atendimentoId)).size).toBe(1);
    expect(resultados.map(r => r.existente).sort()).toEqual([false, true]);
    expect(await snapshot(t)).toEqual(antes);
    expect(await db.atendimentoLead.count({ where: { onboardingId: t.ficha.id } })).toBe(1);
    expect(await db.onboardingEvento.count({ where: { onboardingId: t.ficha.id, tipo: 'CONTATO_COMERCIAL_VINCULADO' } })).toBe(1);
    expect(await vincularContatoComercial(t.args)).toMatchObject({ existente: true, conversaId: t.conversa.id });
    const novaFicha = await db.onboarding.create({ data: { origem: 'TRANSFERENCIA' } }); fichas.push(novaFicha.id);
    const novoTelefone = '55119' + String(randomInt(10000000, 99999999));
    const novosArgs = { ...t.args, onboardingId: novaFicha.id, body: { ...t.args.body, telefone: novoTelefone } };
    let novosResultados;
    try {
      novosResultados = await Promise.all([vincularContatoComercial(novosArgs), vincularContatoComercial(novosArgs)]);
    } finally {
      const criados = await db.vinculoNumeroInterlocutor.findMany({ where: { telefoneE164: novoTelefone } });
      numeros.push(...criados.map(n => n.id)); pessoas.push(...criados.map(n => n.interlocutorId));
      const fios = await db.conversaWhatsapp.findMany({ where: { canalId, telefoneE164: novoTelefone } });
      conversas.push(...fios.map(c => c.id));
    }
    expect(new Set(novosResultados.map(r => r.conversaId)).size).toBe(1);
    const novaConversa = await db.conversaWhatsapp.findUnique({ where: { id: novosResultados[0].conversaId } });
    expect(novaConversa).toMatchObject({ atendidaPor: null, atendidaDesde: null, automacaoInvalidadaEm: null, lidaAteEm: null });
    expect(await db.mensagemWhatsapp.count({ where: { conversaId: novaConversa.id } })).toBe(0);
    expect(await db.onboardingEvento.count({ where: { onboardingId: novaFicha.id } })).toBe(1);
    const rollback = await fixture(), estadoAnterior = await snapshot(rollback);
    for (const body of [{ ...rollback.args.body, autorizado: false }, { ...rollback.args.body, canalId: 'canal-inexistente' }]) {
      await expect(vincularContatoComercial({ ...rollback.args, body })).rejects.toThrow();
      expect(await snapshot(rollback)).toEqual(estadoAnterior);
      expect(await db.atendimentoLead.count({ where: { onboardingId: rollback.ficha.id } })).toBe(0);
    }
    const chave = chaveConsentimento(rollback.args.body.telefone);
    await db.appSetting.create({ data: { key: chave, value: { status: 'REVOGADO' } } });
    try {
      await expect(vincularContatoComercial(rollback.args)).rejects.toMatchObject({ code: 'contato_revogado' });
      expect(await snapshot(rollback)).toEqual(estadoAnterior);
    } finally { await db.appSetting.delete({ where: { key: chave } }); }
    // Falha injetada somente na escrita do evento; transação/SQL reais fazem rollback.
    const falhaDb = { $transaction: (fn, options) => db.$transaction(tx => fn(new Proxy(tx, { get(target, key) {
      if (key === 'onboardingEvento') return { create: async () => { throw Error('auditoria sintética indisponível'); } };
      return target[key];
    } })), options) };
    await expect(vincularContatoComercial({ ...rollback.args, db: falhaDb })).rejects.toThrow('auditoria sintética');
    expect(await snapshot(rollback)).toEqual(estadoAnterior);
    expect(await db.atendimentoLead.count({ where: { onboardingId: rollback.ficha.id } })).toBe(0);
    expect(await db.onboardingEvento.count({ where: { onboardingId: rollback.ficha.id } })).toBe(0);
    const telefoneRollback = '55119' + String(randomInt(10000000, 99999999));
    await expect(vincularContatoComercial({ ...rollback.args, db: falhaDb, body: { ...rollback.args.body, telefone: telefoneRollback } })).rejects.toThrow('auditoria sintética');
    expect(await db.vinculoNumeroInterlocutor.count({ where: { telefoneE164: telefoneRollback } })).toBe(0);
    expect(await db.conversaWhatsapp.count({ where: { canalId, telefoneE164: telefoneRollback } })).toBe(0);
  } finally {
    await db.atendimentoLead.deleteMany({ where: { onboardingId: { in: fichas } } });
    await db.onboardingEvento.deleteMany({ where: { onboardingId: { in: fichas } } });
    await db.turnoIaWhatsapp.deleteMany({ where: { conversaId: { in: conversas } } });
    await db.mensagemWhatsapp.deleteMany({ where: { conversaId: { in: conversas } } });
    await db.conversaWhatsapp.deleteMany({ where: { id: { in: conversas } } });
    await db.atendimentoResponsavelWhatsapp.deleteMany({ where: { canalId } });
    await db.vinculoNumeroInterlocutor.deleteMany({ where: { id: { in: numeros } } });
    await db.interlocutorComunicacao.deleteMany({ where: { id: { in: pessoas } } });
    await db.onboarding.deleteMany({ where: { id: { in: fichas } } });
    await db.manualTask.deleteMany({ where: { ownerId: user.id } });
    await db.canalWhatsapp.deleteMany({ where: { id: canalId } });
    await db.user.deleteMany({ where: { id: user.id } });
    await db.$disconnect();
  }
}, 60000);
