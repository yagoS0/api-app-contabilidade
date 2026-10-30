import { recalcularGuiaWhatsapp } from '../RecalcularGuiaWhatsappService.js';
import { revisaoDocumentoGuia } from '../../whatsapp/EnvioDocumentoGuiaWhatsappService.js';
import { versaoPagamentoGuia } from '../ConfirmacaoPagamentoClienteService.js';
const id = 'altan.payment.recalculate.11111111-1111-4111-8111-111111111111';
function setup(patch = {}) {
  let guia = { id: 'g', portalClientId: 'c', tipo: 'SIMPLES', source: 'SERPRO', hash: 'original', valor: 100,
    competencia: '2026-09', vencimento: '2026-10-17', status: 'PROCESSED', liberadaCliente: true, paymentStatus: 'OPEN', ...patch };
  const token = { companyId: 'c', guideId: 'g', hash: guia.hash, competencia: guia.competencia, telefone: '5511000000000', contatoId: 'ct', expiraEm: '2026-10-25', versaoPagamento: versaoPagamentoGuia(guia) };
  const records = new Map([[id, { value: token }]]);
  const client = { appSetting: {
    findUnique: jest.fn(async ({ where }) => records.get(where.key)),
    create: jest.fn(async ({ data }) => { if (records.has(data.key)) throw Object.assign(Error(), { code: 'P2002' }); records.set(data.key, data); }),
    update: jest.fn(async ({ where, data }) => records.set(where.key, data)),
  }, guide: { findFirst: jest.fn(async () => ({ ...guia })) }, contatoWhatsapp: { findFirst: jest.fn(async () => ({ id: 'ct' })) },
    portalClient: { findUnique: jest.fn(async () => ({ razao: 'Empresa sintética' })) }, feriado: { findMany: jest.fn(async () => []) } };
  const cloud = { enviarTexto: jest.fn(async () => ({ wamid: 'texto' })), enviarBotoes: jest.fn(async () => ({ wamid: 'confirmar' })), enviarGuiaComPagamento: jest.fn(async () => ({ wamid: 'pdf' })) };
  const enviar = jest.fn(async ({ chamada }) => chamada()), encaminhar = jest.fn(async (_motivo, options) => options?.aoPersistir?.(client, { id: 'suporte', conversaId: 'cv' }));
  const deps = { recalcular: jest.fn(async () => { guia = { ...guia, hash: 'recalculada', valor: 110 }; return guia; }),
    carregarPdf: jest.fn(async () => Buffer.from('%PDF synthetic')), prepararPagamento: jest.fn(async () => ({ somenteDocumento: true })) };
  const args = { id, conversa: { id: 'cv', portalClientId: 'c', telefoneE164: token.telefone }, mensagem: { id: 'in', direcao: 'in', conversaId: 'cv' },
    client, cloud, enviar, conferirAcesso: jest.fn(), encaminhar, agora: new Date('2026-10-19T12:00:00Z') };
  return { run: () => recalcularGuiaWhatsapp(args, deps), enviar, deps, cloud, encaminhar, guia: () => guia };
}
test.each([{ tipo: 'SIMPLES' }, { tipo: 'OUTRA', sourceFileId: 'serpro:dctfweb:lp:empresa:2026-09' }])('retorno de $tipo passa revisão recalculada ao tracking', async patch => {
  const f = setup(patch); await f.run();
  expect(f.enviar).toHaveBeenCalledWith(expect.objectContaining({ documentoGuia: { guideId: 'g', conteudo: Buffer.from('%PDF synthetic'), nomeArquivo: expect.any(String), revisao: revisaoDocumentoGuia(f.guia()) } }));
  expect(f.cloud.enviarBotoes).toHaveBeenCalledTimes(1);
});
test.each([{ tipo: 'INSS' }, { parcelamentoId: 'acordo' }])('tipo sem automação encaminha ao contador %j', async patch => {
  const f = setup(patch); expect(await f.run()).toMatchObject({ encaminhado: true });
  expect(f.deps.recalcular).not.toHaveBeenCalled(); expect(f.cloud.enviarGuiaComPagamento).not.toHaveBeenCalled(); expect(f.encaminhar).toHaveBeenCalled();
});
test('falha do tracking interrompe confirmação e encaminha conciliação ao contador', async () => {
  const f = setup(); f.enviar.mockImplementation(async ({ documentoGuia, chamada }) => {
    if (documentoGuia) throw Object.assign(Error('timeout'), { indeterminado: true }); return chamada();
  });
  expect(await f.run()).toMatchObject({ pendente: true }); expect(f.cloud.enviarBotoes).not.toHaveBeenCalled(); expect(f.encaminhar).toHaveBeenCalled();
  await f.run(); expect(f.deps.recalcular).toHaveBeenCalledTimes(1);
});
