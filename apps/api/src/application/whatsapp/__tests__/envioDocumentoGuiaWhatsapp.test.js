import { createHash } from 'node:crypto';
import { enviarDocumentoGuiaWhatsapp, revisaoDocumentoGuia } from '../EnvioDocumentoGuiaWhatsappService.js';
import { registrarEnvio, marcarEnviando, marcarEnviado, marcarFalhou, marcarIndeterminado } from '../../guides/EnvioGuiaService.js';
jest.mock('../../guides/EnvioGuiaService.js', () => ({
  registrarEnvio: jest.fn(), materializarEnvioDeEmailLegado: jest.fn(), marcarEnviando: jest.fn(),
  marcarEnviado: jest.fn(), marcarFalhou: jest.fn(), marcarIndeterminado: jest.fn(),
}));
const conteudo = Buffer.from('%PDF-1.4 synthetic');
function setup() {
  const records = new Map();
  const guide = { id: 'g', portalClientId: 'c', tipo: 'SIMPLES', competencia: '2026-09', valor: 100,
    vencimento: '2026-10-20', hash: createHash('sha256').update(conteudo).digest('hex'), liberadaCliente: true, status: 'PROCESSED' };
  const conversa = { id: 'conv', portalClientId: 'c', telefoneE164: '5511000000000' };
  const client = { mensagemWhatsapp: { findUnique: jest.fn(async () => ({ id: 'entrada', conversaId: 'conv', direcao: 'in' })) }, guide: { findFirst: jest.fn(async () => guide), findUnique: jest.fn(async () => guide), updateMany: jest.fn(async () => ({ count: 1 })) },
    appSetting: { create: jest.fn(async ({ data }) => { if (records.has(data.key)) throw Object.assign(Error(), { code: 'P2002' }); records.set(data.key, data.value); }),
      update: jest.fn(async ({ where, data }) => { records.set(where.key, data.value); }) } };
  const documento = { guideId: 'g', mensagemEntradaId: 'entrada', conteudo, nomeArquivo: 'guia.pdf', revisao: revisaoDocumentoGuia(guide) };
  const antesDeEnviar = jest.fn();
  const prepararHistorico = jest.fn();
  const transporte = jest.fn(async () => ({ wamid: 'w' }));
  const registrarSaida = jest.fn(async ({ antesDeEnviar: conferir, aoAceitar }) => {
    await conferir(); const r = await transporte(); await aoAceitar(r); return r;
  });
  const run = () => enviarDocumentoGuiaWhatsapp({ conversa, documento, client, antesDeEnviar, registrarSaida }, { prepararHistorico });
  return { run, guide, documento, conversa, client, records, antesDeEnviar, prepararHistorico, registrarSaida, transporte };
}
beforeEach(() => {
  jest.clearAllMocks();
  registrarEnvio.mockResolvedValue({ envio: { id: 'envio' } });
  marcarEnviando.mockResolvedValue({ reservado: true, tentativaId: 'tentativa' });
});
test('congela documento e vincula mensagem/tentativa; não envia aos demais contatos', async () => {
  const f = setup(); await f.run();
  expect(f.prepararHistorico).toHaveBeenCalledWith(expect.objectContaining({ criarMensagem: false, revisaoDocumento: f.documento.revisao, conteudoPdf: conteudo }), { client: f.client });
  expect(f.registrarSaida).toHaveBeenCalledWith(expect.objectContaining({ vinculoGuia: { envioGuiaId: 'envio', envioGuiaTentativaId: 'tentativa' } }));
  expect(registrarEnvio).toHaveBeenCalledWith(expect.objectContaining({ destino: f.conversa.telefoneE164, reenviar: true }));
  expect(marcarEnviado).toHaveBeenCalledWith({ envioId: 'envio', tentativaId: 'tentativa', providerMessageId: 'w' }, f.client);
});
test('replay não envia; entrada nova é intenção distinta', async () => {
  const f = setup(); await f.run(); await expect(f.run()).rejects.toMatchObject({ code: 'GUIA_INTENCAO_JA_RESERVADA' });
  expect(f.transporte).toHaveBeenCalledTimes(1);
  f.documento.mensagemEntradaId = 'entrada-nova'; await f.run(); expect(f.transporte).toHaveBeenCalledTimes(2);
});
test('replay concorrente reserva somente uma saída', async () => {
  const f = setup(); const r = await Promise.allSettled([f.run(), f.run()]);
  expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1); expect(f.transporte).toHaveBeenCalledTimes(1);
});
test('tentativa anterior incerta bloqueia até nova solicitação explícita', async () => {
  const f = setup(); registrarEnvio.mockResolvedValue({ envio: { id: 'envio' }, emAndamento: true });
  await expect(f.run()).rejects.toMatchObject({ code: 'GUIA_ENVIO_EM_ANDAMENTO' }); expect(f.transporte).not.toHaveBeenCalled();
});
test('timeout preserva indeterminação e replay não repete', async () => {
  const f = setup(); f.registrarSaida.mockRejectedValue(Object.assign(Error('timeout'), { indeterminado: true }));
  await expect(f.run()).rejects.toThrow('timeout'); await expect(f.run()).rejects.toMatchObject({ code: 'GUIA_INTENCAO_JA_RESERVADA' });
  expect(marcarIndeterminado).toHaveBeenCalledTimes(1); expect(f.registrarSaida).toHaveBeenCalledTimes(1);
});
test.each(['tipo', 'valor', 'competencia', 'parcelamentoId'])('alteração de %s antes do transporte bloqueia', async campo => {
  const f = setup(); f.prepararHistorico.mockImplementation(async () => { f.guide[campo] = 'alterado'; });
  await expect(f.run()).rejects.toMatchObject({ code: 'GUIA_ALTERADA' }); expect(f.transporte).not.toHaveBeenCalled(); expect(marcarFalhou).toHaveBeenCalled();
});
test('revogação entre preparação e saída impede transporte', async () => {
  const f = setup(); f.antesDeEnviar.mockResolvedValueOnce().mockRejectedValueOnce(Error('acesso revogado'));
  await expect(f.run()).rejects.toThrow('acesso revogado'); expect(f.transporte).not.toHaveBeenCalled();
});
test('PDF divergente e origem fora da conversa não reservam intenção', async () => {
  const f = setup(); f.documento.conteudo = Buffer.from('outro');
  await expect(f.run()).rejects.toMatchObject({ code: 'GUIA_PDF_DIVERGENTE' }); expect(f.records.size).toBe(0);
  f.client.mensagemWhatsapp.findUnique.mockResolvedValue(null);
  await expect(f.run()).rejects.toMatchObject({ code: 'GUIA_ENVIO_SEM_ORIGEM' });
});
test('consulta de guia paga preserva pagamento e não inicia cobrança', async () => {
  const f = setup(); f.guide.paymentStatus = 'PAID'; f.guide.baixada = true;
  await f.run(); expect(f.guide).toMatchObject({ paymentStatus: 'PAID', baixada: true });
});

function comOrigemResolvida() {
  const f = setup(); f.conversa.atendimentoId = 'atendimento';
  const original = { id: 'entrada', conversaId: 'neutra', direcao: 'in' };
  const contexto = { mensagemId: 'entrada', atendimentoId: 'atendimento', estado: 'RESOLVIDA', conversaId: 'conv', portalClientId: 'c', versao: 1 };
  f.client.mensagemWhatsapp.findUnique.mockResolvedValue(original);
  f.client.resolucaoContextoWhatsapp = { findUnique: jest.fn(async () => contexto) };
  return { ...f, original, contexto };
}
test('entrada resolvida autoriza a guia da empresa alvo e preserva segmento original', async () => {
  const f = comOrigemResolvida(); await f.run();
  expect(f.original.conversaId).toBe('neutra'); expect(f.transporte).toHaveBeenCalledTimes(1);
  expect(f.antesDeEnviar).toHaveBeenCalledTimes(2);
});
test.each(['sem_recibo', 'outra_empresa', 'outro_atendimento', 'nao_resolvida', 'outro_segmento'])('origem resolvida inválida %s impede reserva e transporte', async caso => {
  const f = comOrigemResolvida();
  if (caso === 'sem_recibo') f.client.resolucaoContextoWhatsapp.findUnique.mockResolvedValue(null);
  if (caso === 'outra_empresa') f.contexto.portalClientId = 'outra';
  if (caso === 'outro_atendimento') f.contexto.atendimentoId = 'outro';
  if (caso === 'nao_resolvida') f.contexto.estado = 'RECUSADA';
  if (caso === 'outro_segmento') f.contexto.conversaId = 'outro';
  await expect(f.run()).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
  expect(f.records.size).toBe(0); expect(f.transporte).not.toHaveBeenCalled();
});
test('recibo revogado durante preparação não libera a saída já reservada', async () => {
  const f = comOrigemResolvida(); f.prepararHistorico.mockImplementation(async () => { f.contexto.estado = 'RECUSADA'; });
  await expect(f.run()).rejects.toMatchObject({ codigo: 'CONTEXTO_INVALIDO' });
  expect(f.transporte).not.toHaveBeenCalled();
});
test('sem atendimento, mensagem de segmento neutro não autoriza empresa', async () => {
  const f = setup(); f.client.mensagemWhatsapp.findUnique.mockResolvedValue({ id: 'entrada', conversaId: 'neutra', direcao: 'in' });
  await expect(f.run()).rejects.toMatchObject({ code: 'GUIA_ENVIO_SEM_ORIGEM' });
  expect(f.records.size).toBe(0); expect(f.transporte).not.toHaveBeenCalled();
});
