import { recalcularGuiaWhatsapp } from '../RecalcularGuiaWhatsappService.js';

const ID = 'altan.payment.recalculate.11111111-1111-4111-8111-111111111111';
function cenario() {
  const guia = { id: 'g', portalClientId: 'c', competencia: '2026-09', hash: 'original', source: 'SERPRO', tipo: 'SIMPLES', paymentStatus: 'OPEN', liberadaCliente: true, status: 'PROCESSED', vencimento: '2026-10-17' };
  const token = { companyId: 'c', guideId: 'g', competencia: '2026-09', hash: 'original', telefone: '5511999999999', contatoId: 'ct', expiraEm: '2026-10-25' };
  const records = new Map([[ID, { value: token }]]);
  const client = {
    appSetting: { findUnique: jest.fn(async ({ where }) => records.get(where.key)),
      create: jest.fn(async ({ data }) => { if (records.has(data.key)) throw Object.assign(Error(), { code: 'P2002' }); records.set(data.key, data); return data; }),
      update: jest.fn(async ({ where, data }) => { records.set(where.key, data); return data; }) },
    guide: { findFirst: jest.fn(async ({ where }) => where.portalClientId === guia.portalClientId ? { ...guia } : null) },
    contatoWhatsapp: { findFirst: jest.fn(async () => ({ id: 'ct', userId: 'u' })) },
    portalClient: { findUnique: jest.fn(async () => ({ municipio: 'Contagem' })) },
    feriado: { findMany: jest.fn(async () => []) },
  };
  const ordem = [];
  const cloud = { enviarBotoes: jest.fn(async () => ({ wamid: 'botoes' })), enviarTexto: jest.fn(async ({ texto }) => { ordem.push(texto); return { wamid: 'text' }; }),
    enviarGuiaComPagamento: jest.fn(async () => { ordem.push('PDF_E_CODIGO'); return { wamid: 'pdf' }; }) };
  const deps = { recalcular: jest.fn(async () => { ordem.push('RECALCULO'); return { ...guia }; }), carregarPdf: jest.fn(async () => Buffer.from('PDF')), prepararPagamento: jest.fn(async () => ({ linhaDigitavel: '8' + '0'.repeat(47) })) };
  const args = { id: ID, conversa: { id: 'cv', portalClientId: 'c', telefoneE164: token.telefone }, mensagem: { id: 'm', direcao: 'in', conversaId: 'cv' }, client, cloud,
    enviar: jest.fn(async ({ chamada }) => chamada()), conferirAcesso: jest.fn(async () => {}), agora: new Date('2026-10-19T12:00:00Z') };
  return { guia, token, records, client, cloud, deps, args, ordem, run: () => recalcularGuiaWhatsapp(args, deps) };
}

test('clique envia aguarde, recalcula e entrega PDF e código em sequência, sem portal', async () => {
  const f = cenario(); expect(await f.run()).toMatchObject({ tratado: true, acao: 'RECALCULAR_GUIA', codigo: { status: 'ENVIADO' } });
  expect(f.ordem).toEqual(['Aguarde em quanto recalculamos.', 'RECALCULO', 'PDF_E_CODIGO']);
  expect(f.cloud.enviarGuiaComPagamento).toHaveBeenCalledWith(expect.objectContaining({ telefone: f.token.telefone, conteudoPdf: Buffer.from('PDF') }));
  expect(f.cloud.enviarTexto.mock.calls.some(([a]) => /https?:|portal/i.test(a.texto))).toBe(false);
  const tokenNovo = f.records.get(f.cloud.enviarBotoes.mock.calls[0][0].botoes[0].id).value;
  expect(tokenNovo).toMatchObject({ hash: 'original', guideId: 'g', companyId: 'c' });
});
test('dois cliques concorrentes executam um único recálculo e envio', async () => {
  const f = cenario(); await Promise.all([f.run(), f.run()]);
  expect(f.deps.recalcular).toHaveBeenCalledTimes(1); expect(f.cloud.enviarGuiaComPagamento).toHaveBeenCalledTimes(1);
});
test.each(['outra_empresa', 'outro_telefone', 'expirado', 'hash_alterado', 'paga', 'contato_revogado', 'nao_recalculavel', 'nao_vencida'])('recusa %s antes de custo ou PDF', async caso => {
  const f = cenario();
  if (caso === 'outra_empresa') f.token.companyId = 'outra';
  if (caso === 'outro_telefone') f.token.telefone = '5500000000000';
  if (caso === 'expirado') f.token.expiraEm = '2026-10-01';
  if (caso === 'hash_alterado') f.guia.hash = 'novo';
  if (caso === 'paga') f.guia.paymentStatus = 'PAID';
  if (caso === 'contato_revogado') f.client.contatoWhatsapp.findFirst.mockResolvedValue(null);
  if (caso === 'nao_recalculavel') f.guia.tipo = 'FGTS';
  if (caso === 'nao_vencida') f.guia.vencimento = '2026-11-20';
  expect(await f.run()).toMatchObject({ pendente: true });
  expect(f.deps.recalcular).not.toHaveBeenCalled(); expect(f.cloud.enviarGuiaComPagamento).not.toHaveBeenCalled();
});
test('pagamento informado durante recálculo impede enviar guia para pagar', async () => {
  const f = cenario(); f.deps.recalcular.mockImplementation(async () => { f.guia.paymentStatus = 'PAID'; return f.guia; });
  await f.run(); expect(f.cloud.enviarGuiaComPagamento).not.toHaveBeenCalled(); expect(f.deps.prepararPagamento).not.toHaveBeenCalled();
});
test('timeout não executa novamente o pedido', async () => {
  const f = cenario(); f.deps.recalcular.mockRejectedValue(Error('timeout'));
  await f.run(); await f.run(); expect(f.deps.recalcular).toHaveBeenCalledTimes(1);
  expect([...f.records.values()].some(r => r.value.status === 'CONFERENCIA_NECESSARIA')).toBe(true);
});
test('falha do PDF não afirma entrega; código ausente é parcial', async () => {
  const f = cenario(); f.deps.carregarPdf.mockResolvedValue(null); expect(await f.run()).toMatchObject({ pendente: true });
  expect(f.cloud.enviarGuiaComPagamento).not.toHaveBeenCalled();
  const p = cenario(); p.deps.prepararPagamento.mockRejectedValue(Object.assign(Error('sem código'), { code: 'LINHA_DIGITAVEL_INDISPONIVEL' }));
  expect(await p.run()).toMatchObject({ pendente: true }); expect(p.cloud.enviarGuiaComPagamento).not.toHaveBeenCalled();
});
