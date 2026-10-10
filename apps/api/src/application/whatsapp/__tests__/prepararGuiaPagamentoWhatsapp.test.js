import { prepararGuiaPagamentoWhatsapp } from '../PrepararGuiaPagamentoWhatsapp.js';
const guide = { tipo: 'SIMPLES', competencia: '2026-09', valor: 10, linhaDigitavel: '8' + '0'.repeat(47), linhaDigitavelLidaEm: new Date() };
function cenario() {
  const args = { guide: { ...guide }, conteudoPdf: Buffer.from('PDF'), referencia: 'tentativa-1', conversa: { id: 'cv' }, conferir: jest.fn() };
  const deps = { client: { templateWhatsapp: { findUnique: jest.fn(async () => ({ nomeMeta: 'guia_documento_pagamento_v1', idioma: 'pt_BR', statusAprovacao: 'APROVADO', temDocumento: true })) } }, ler: jest.fn(), janela: jest.fn(async () => ({ situacao: 'ABERTA' })) };
  return { args, deps, run: () => prepararGuiaPagamentoWhatsapp(args, deps) };
}
test('recálculo na janela usa mensagem conjunta e repete acesso antes da rede', async () => {
  const f = cenario(); const p = await f.run(); expect(p.template).toBeNull(); expect(p.linhaDigitavel).toBe(guide.linhaDigitavel);
  await p.antesDeEnviar(); expect(f.args.conferir).toHaveBeenCalledTimes(2);
  f.deps.janela.mockResolvedValue({ situacao: 'FECHADA' }); await expect(p.antesDeEnviar()).rejects.toMatchObject({ code: 'WHATSAPP_JANELA_FECHADA' });
});
test('envio ativo só aceita modelo conjunto aprovado e revalida aprovação', async () => {
  const f = cenario(); f.args.templateOnly = true; const p = await f.run(); expect(p.template).toBe('guia_documento_pagamento_v1');
  f.deps.client.templateWhatsapp.findUnique.mockResolvedValue(null); await expect(p.antesDeEnviar()).rejects.toMatchObject({ code: 'WHATSAPP_TEMPLATE_PENDENTE' });
});
test('não entrega PDF sozinho quando a linha está ausente ou divergente', async () => {
  const f = cenario(); f.args.guide.linhaDigitavelMotivo = 'valor_divergente'; await expect(f.run()).rejects.toMatchObject({ code: 'LINHA_DIGITAVEL_INDISPONIVEL' });
  expect(f.args.conferir).not.toHaveBeenCalled();
});
test('guia sem leitura passa pela validação do PDF e valor antes de montar pagamento', async () => {
  const f = cenario(); f.args.guide.linhaDigitavelLidaEm = null; f.deps.ler.mockResolvedValue({ linhaDigitavel: guide.linhaDigitavel }); await f.run();
  expect(f.deps.ler).toHaveBeenCalledWith(f.args.conteudoPdf, expect.objectContaining({ valorTotal: 10 }));
});
