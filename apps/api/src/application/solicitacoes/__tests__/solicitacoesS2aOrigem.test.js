import { chaveOrigemRecalculo, clienteHandoffSuporte, registrarOrigemWhatsapp } from '../SolicitacoesOrigemWhatsappService.js';
import { versaoPagamentoGuia } from '../../guides/ConfirmacaoPagamentoClienteService.js';

function fixture() {
  const rows = [], commands = [], links = [], events = [], pushes = [];
  const conversa = { id: 'cv', portalClientId: 'pc', atendimentoId: null };
  const mensagens = ['m1', 'm2'].map(id => ({ id, conversaId: 'cv', direcao: 'in', corpo: 'Ajuda' }));
  const tx = {
    conversaWhatsapp: { findUnique: async () => conversa },
    mensagemWhatsapp: { findUnique: async ({ where }) => mensagens.find(m => m.id === where.id) },
    encaminhamentoSuporte: { findUnique: async ({ where }) => rows.find(r => where.id ? r.id === where.id : r.mensagemId === where.mensagemId), create: async ({ data }) => { rows.push(data); return data; } },
    solicitacaoComando: { findUnique: async ({ where }) => commands.find(c => c.sistemaId === where.sistemaId_chave.sistemaId && c.chave === where.sistemaId_chave.chave), create: async ({ data }) => { commands.push(data); return data; } },
    solicitacaoEvento: { create: async ({ data }) => events.push(data) },
    solicitacaoMensagem: { findMany: async ({ where }) => links.filter(l => l.solicitacaoId === where.solicitacaoId), create: async ({ data }) => links.push(data) },
    eventoPushAtendimento: { create: async ({ data }) => pushes.push(data) },
  };
  const args = { client: tx, conversaId: 'cv', mensagemId: 'm1', motivo: 'Ajuda', agora: new Date('2026-10-25T12:00:00Z') };
  return { tx, args, rows, commands, events, links, pushes, conversa, mensagens };
}
test('handoff deduplica por entrada, preserva autoria sistema e não funde outra mensagem', async () => {
  const f = fixture();
  const a = await registrarOrigemWhatsapp(f.args);
  expect(await registrarOrigemWhatsapp({ ...f.args, motivo: 'Texto corrigido' })).toEqual(a);
  const b = await registrarOrigemWhatsapp({ ...f.args, mensagemId: 'm2' });
  expect(a.id).not.toBe(b.id); expect(f.rows).toHaveLength(2); expect(f.pushes).toHaveLength(2);
  for (const evidence of [...f.events, ...f.commands, ...f.links]) { expect(evidence.sistemaId).toBe('WHATSAPP_SUPORTE'); expect(evidence.atorId).toBeUndefined(); }
  expect(a.criadorId).toBeUndefined();
  a.estado = 'RESOLVIDO'; await registrarOrigemWhatsapp(f.args);
  expect(a.estado).toBe('RESOLVIDO'); expect(f.pushes).toHaveLength(2);
});
test('segundo assunto explícito de documento usa vínculo adicional da mesma mensagem', async () => {
  const f = fixture(); const a = await registrarOrigemWhatsapp(f.args);
  const b = await registrarOrigemWhatsapp({ ...f.args, origem: { tipo: 'DOCUMENTO_INDISPONIVEL', documentId: 'doc1' } });
  expect(a.mensagemId).toBe('m1'); expect(b.mensagemId).toBeNull();
  expect(f.links.map(m => m.mensagemId)).toEqual(['m1', 'm1']);
  expect(b.origemDados.documentId).toBe('doc1');
});
test('origem sem identidade ou resolução transferida recusa antes de produzir evidência', async () => {
  const f = fixture();
  await expect(registrarOrigemWhatsapp({ ...f.args, origem: { tipo: 'DOCUMENTO_INDISPONIVEL' } })).rejects.toThrow('documento_invalido');
  f.mensagens[0].contexto = { estado: 'RESOLVIDA', conversaId: 'outro', portalClientId: 'outra' };
  await expect(registrarOrigemWhatsapp(f.args)).rejects.toThrow('origem_mensagem_invalida');
  expect(f.rows).toEqual([]); expect(f.events).toEqual([]); expect(f.pushes).toEqual([]);
});

test('recálculo exige revisão comprovada, separa guias e não usa o motivo como identidade', async () => {
  const f = fixture();
  const guia = { id: 'g1', portalClientId: 'pc', hash: 'pdf', vencimento: '2026-10-20', status: 'PROCESSED', liberadaCliente: true, paymentStatus: 'OPEN' };
  f.tx.guide = { findFirst: async ({ where }) => where.id === guia.id ? { ...guia } : null };
  f.tx.appSetting = { findUnique: async () => null };
  const args = { ...f.args, origem: { tipo: 'RECALCULO_GUIA', guideId: guia.id, chave: chaveOrigemRecalculo(guia, true) } };
  const a = await registrarOrigemWhatsapp(args);
  expect(await registrarOrigemWhatsapp({ ...args, motivo: 'Outro texto' })).toEqual(a);
  guia.hash = 'nova-revisao';
  await expect(registrarOrigemWhatsapp(args)).rejects.toThrow('origem_revisao_nao_comprovada');
  const b = await registrarOrigemWhatsapp({ ...args, origem: { ...args.origem, chave: chaveOrigemRecalculo(guia, true) } });
  expect(b.id).not.toBe(a.id);
  guia.id = 'g2';
  const c = await registrarOrigemWhatsapp({ ...args, origem: { tipo: 'RECALCULO_GUIA', guideId: guia.id, chave: chaveOrigemRecalculo(guia, true) } });
  expect(new Set([a.id, b.id, c.id]).size).toBe(3);
  expect(f.pushes).toHaveLength(3);
});

test('falha automática usa snapshot persistido anterior, nunca chave arbitrária', async () => {
  const f = fixture();
  const anterior = { id: 'g', portalClientId: 'pc', hash: 'antes', vencimento: '2026-10-20' };
  const chave = chaveOrigemRecalculo(anterior);
  const reserva = { status: 'CONFERENCIA_NECESSARIA', guideId: 'g', companyId: 'pc', mensagemId: 'm1', hash: 'antes', vencimento: anterior.vencimento, versaoPagamento: versaoPagamentoGuia(anterior) };
  f.tx.guide = { findFirst: async () => ({ ...anterior, hash: 'depois' }) };
  f.tx.appSetting = { findUnique: async () => ({ value: reserva }) };
  const args = { ...f.args, origem: { tipo: 'RECALCULO_GUIA', guideId: 'g', chave } };
  expect((await registrarOrigemWhatsapp(args)).origemDados.chave).toBe(chave);
  reserva.hash = 'sem-prova';
  await expect(registrarOrigemWhatsapp(args)).rejects.toThrow('origem_revisao_nao_comprovada');
  expect(f.pushes).toHaveLength(1);
});

test('retry é limitado às transações DB e não repete efeito posterior ao commit', async () => {
  const client = { $transaction: jest.fn() };
  const dbCallback = jest.fn(async () => 'persistido');
  client.$transaction.mockRejectedValueOnce({ code: 'P2034' }).mockImplementation(work => work({}));
  const efeitoPosterior = jest.fn();
  const resultado = await clienteHandoffSuporte(client).$transaction(dbCallback);
  efeitoPosterior(resultado);
  expect(client.$transaction).toHaveBeenCalledTimes(2);
  expect(client.$transaction).toHaveBeenLastCalledWith(dbCallback, { isolationLevel: 'Serializable' });
  expect(efeitoPosterior).toHaveBeenCalledTimes(1);
  client.$transaction.mockRejectedValue({ code: 'FALHA_NAO_REPETIVEL' });
  await expect(clienteHandoffSuporte(client).$transaction(dbCallback)).rejects.toMatchObject({ code: 'FALHA_NAO_REPETIVEL' });
  expect(client.$transaction).toHaveBeenCalledTimes(3);
});
