import { enviarCodigoGuiaWhatsapp } from '../CodigoGuiaWhatsappService.js';
function cenario(aberta = true) {
  const guide = { id: 'g', tipo: 'SIMPLES', competencia: '2026-09', valor: 10, linhaDigitavel: '123456', linhaDigitavelLidaEm: new Date(), linhaDigitavelMotivo: null };
  const client = { mensagemWhatsapp: { findFirst: jest.fn(async () => null) }, templateWhatsapp: { findUnique: jest.fn(async () => ({ nomeMeta: 'codigo', idioma: 'pt_BR', statusAprovacao: 'APROVADO', temDocumento: false })) } };
  const registros = new Map();
  client.appSetting = { create: jest.fn(async ({ data }) => { if (registros.has(data.key)) throw Object.assign(Error(), { code: 'P2002' }); registros.set(data.key, data); }),
    findUnique: jest.fn(async ({ where }) => registros.get(where.key)), update: jest.fn(async ({ where, data }) => registros.set(where.key, data)) };
  const cloud = { enviarBotoes: jest.fn(async () => ({ wamid: 'btn' })), enviarTexto: jest.fn(async () => ({ wamid: 'txt' })), enviarTemplate: jest.fn(async () => ({ wamid: 'tpl' })) };
  const deps = { client, ler: jest.fn(), janela: jest.fn(async () => ({ situacao: aberta ? 'ABERTA' : 'FECHADA' })), enviar: jest.fn(async a => { await a.antesDeEnviar(); return a.enviar(); }) };
  const args = { guide, conversa: { id: 'cv', telefoneE164: '5511999999999' }, cloud, chave: 'codigo:g', conferir: jest.fn() };
  return { guide, client, cloud, args, deps, run: () => enviarCodigoGuiaWhatsapp(args, deps) };
}
test('envia linha copiável em texto dentro da janela', async () => {
  const f = cenario(); expect(await f.run()).toEqual({ status: 'ENVIADO' });
  expect(f.cloud.enviarTexto).toHaveBeenCalledWith(expect.objectContaining({ texto: expect.stringContaining('\n\n123456') }));
  expect(f.args.conferir).toHaveBeenCalled();
});
test('fora da janela usa modelo aprovado com ordem tipo, competência, código', async () => {
  const f = cenario(false); await f.run();
  expect(f.cloud.enviarTemplate).toHaveBeenCalledWith(expect.objectContaining({ variaveis: ['SIMPLES', '2026-09', '123456'] }));
  expect(f.cloud.enviarTexto).not.toHaveBeenCalled();
});
test('não envia código divergente nem inventa linha ausente', async () => {
  const f = cenario(); f.guide.linhaDigitavelMotivo = 'valor_divergente';
  expect(await f.run()).toMatchObject({ status: 'PENDENTE' }); expect(f.deps.enviar).not.toHaveBeenCalled();
});
test('guia antiga extrai e confere a linha usando o PDF e seu valor', async () => {
  const f = cenario(); f.guide.linhaDigitavelLidaEm = null; f.args.conteudoPdf = Buffer.from('PDF');
  f.deps.ler.mockResolvedValue({ linhaDigitavel: '98765' }); await f.run();
  expect(f.deps.ler).toHaveBeenCalledWith(f.args.conteudoPdf, expect.objectContaining({ valorTotal: 10 }));
  expect(f.cloud.enviarTexto.mock.calls[0][0].texto).toContain('98765');
});
test('modelo pendente, janela fechada durante envio e saída incerta não reenviam', async () => {
  const f = cenario(false); f.client.templateWhatsapp.findUnique.mockResolvedValue(null);
  await expect(f.run()).rejects.toMatchObject({ code: 'WHATSAPP_TEMPLATE_PENDENTE' });
  expect(f.cloud.enviarTemplate).not.toHaveBeenCalled();
  const j = cenario(); j.deps.janela.mockResolvedValueOnce({ situacao: 'ABERTA' }).mockResolvedValue({ situacao: 'FECHADA' });
  await expect(j.run()).rejects.toMatchObject({ code: 'WHATSAPP_JANELA_FECHADA' }); expect(j.cloud.enviarTexto).not.toHaveBeenCalled();
  const p = cenario(); p.client.mensagemWhatsapp.findFirst.mockResolvedValue({ statusEnvio: 'indeterminado' });
  expect(await p.run()).toMatchObject({ status: 'PENDENTE' }); expect(p.deps.enviar).not.toHaveBeenCalled();
});
test('pedidos simultâneos completam o código uma única vez', async () => {
  const f = cenario(); await Promise.all([f.run(), f.run()]); expect(f.cloud.enviarTexto).toHaveBeenCalledTimes(1);
});
test('guia recalculada traz confirmação vinculada à versão nova junto ao código', async () => {
  const f = cenario(); f.args.botaoConfirmacao = 'novo-token'; await f.run();
  expect(f.cloud.enviarBotoes).toHaveBeenCalledWith(expect.objectContaining({ texto: expect.stringContaining('123456'), botoes: [{ id: 'novo-token', titulo: 'Confirmar pagamento' }] }));
});
