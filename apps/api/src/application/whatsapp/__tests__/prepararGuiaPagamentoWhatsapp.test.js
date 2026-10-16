import { prepararGuiaPagamentoWhatsapp, TEMPLATE_GUIA_CLARA, TEMPLATE_GUIA_SEM_CODIGO } from '../PrepararGuiaPagamentoWhatsapp.js';
import { MOTIVOS } from '../../guides/linhaDigitavelArrecadacao.js';
const guide = { portalClient: { razao: 'EMPRESA A' }, tipo: 'SIMPLES', competencia: '2026-09', valor: 10, linhaDigitavel: '8' + '0'.repeat(47), linhaDigitavelLidaEm: new Date() };
function cenario() {
  const args = { guide: { ...guide }, conteudoPdf: Buffer.from('PDF'), referencia: 'tentativa-1', conversa: { id: 'cv' }, conferir: jest.fn() };
  const deps = { client: { templateWhatsapp: { findUnique: jest.fn(async () => ({ nomeMeta: 'guia_documento_pagamento_v1', idioma: 'pt_BR', statusAprovacao: 'APROVADO', temDocumento: true })) } }, ler: jest.fn(), janela: jest.fn(async () => ({ situacao: 'ABERTA' })) };
  return { args, deps, run: () => prepararGuiaPagamentoWhatsapp(args, deps) };
}
test('recálculo na janela usa mensagem conjunta e repete acesso antes da rede', async () => {
  const f = cenario(); const p = await f.run(); expect(p.template).toBeNull(); expect(p.linhaDigitavel).toBe(guide.linhaDigitavel);
  expect(p.texto).toContain('EMPRESA A — SIMPLES'); expect(p.descricao).toContain('EMPRESA A');
  await p.antesDeEnviar(); expect(f.args.conferir).toHaveBeenCalledTimes(2);
  f.deps.janela.mockResolvedValue({ situacao: 'FECHADA' }); await expect(p.antesDeEnviar()).rejects.toMatchObject({ code: 'WHATSAPP_JANELA_FECHADA' });
});
test('envio ativo só aceita modelo conjunto aprovado e revalida aprovação', async () => {
  const f = cenario(); f.args.templateOnly = true; const p = await f.run(); expect(p.template).toBe('guia_documento_pagamento_v1');
  f.deps.client.templateWhatsapp.findUnique.mockResolvedValue(null); await expect(p.antesDeEnviar()).rejects.toMatchObject({ code: 'WHATSAPP_TEMPLATE_PENDENTE' });
});
test('não contorna divergência enviando PDF sozinho', async () => {
  const f = cenario(); f.args.guide.linhaDigitavelMotivo = 'valor_divergente'; await expect(f.run()).rejects.toMatchObject({ code: 'LINHA_DIGITAVEL_INDISPONIVEL' });
  expect(f.args.conferir).not.toHaveBeenCalled();
});
test('guia sem leitura passa pela validação do PDF e valor antes de montar pagamento', async () => {
  const f = cenario(); f.args.guide.linhaDigitavelLidaEm = null; f.deps.ler.mockResolvedValue({ linhaDigitavel: guide.linhaDigitavel }); await f.run();
  expect(f.deps.ler).toHaveBeenCalledWith(f.args.conteudoPdf, expect.objectContaining({ valorTotal: 10 }), { distinguirAusencia: true });
});

test.each([MOTIVOS.NAO_ENCONTRADA, 'pdf_sem_texto_extraivel'])('PDF sem código copiável (%s) não oferece botão de pagamento', async motivo => {
  const f = cenario(); f.args.templateOnly = true;
  Object.assign(f.args.guide, { linhaDigitavel: null, linhaDigitavelMotivo: MOTIVOS.NAO_ENCONTRADA });
  f.deps.ler.mockResolvedValue({ linhaDigitavel: null, linhaDigitavelLidaEm: new Date(), linhaDigitavelMotivo: motivo });
  f.deps.client.templateWhatsapp.findUnique.mockImplementation(async ({ where }) => ({ nomeMeta: where.chave, temDocumento: true, statusAprovacao: 'APROVADO' }));
  const p = await f.run();
  expect(p).toMatchObject({ somenteDocumento: true, template: TEMPLATE_GUIA_SEM_CODIGO });
  expect(p.texto).toContain('ABRIR PDF'); expect(p.texto).not.toContain('COPIAR CÓDIGO');
  expect(f.deps.ler).toHaveBeenCalledTimes(1);
  f.deps.client.templateWhatsapp.findUnique.mockResolvedValue({ statusAprovacao: 'EM_ANALISE' });
  await expect(p.antesDeEnviar()).rejects.toMatchObject({ code: 'WHATSAPP_TEMPLATE_PENDENTE' });
});

test.each(['pdf_ilegivel', 'codigo_divergente_no_documento', 'dv_bloco_invalido', 'valor_divergente', null])('leitura recusada %s não ativa modelo sem código', async motivo => {
  const f = cenario(); f.args.guide.linhaDigitavel = null;
  f.deps.ler.mockResolvedValue({ linhaDigitavel: null, linhaDigitavelLidaEm: new Date(), linhaDigitavelMotivo: motivo });
  await expect(f.run()).rejects.toMatchObject({ code: 'LINHA_DIGITAVEL_INDISPONIVEL' });
  expect(f.args.conferir).not.toHaveBeenCalled();
});

test('modelo com PDF destacado só é escolhido após aprovação e é revalidado antes da rede', async () => {
  const f = cenario(); f.args.templateOnly = true;
  f.deps.client.templateWhatsapp.findUnique.mockImplementation(async ({ where }) => ({ nomeMeta: where.chave, temDocumento: true, statusAprovacao: 'APROVADO' }));
  const p = await f.run(); expect(p.template).toBe(TEMPLATE_GUIA_CLARA);
  f.deps.client.templateWhatsapp.findUnique.mockResolvedValue(null);
  await expect(p.antesDeEnviar()).rejects.toMatchObject({ code: 'WHATSAPP_TEMPLATE_PENDENTE' });
});
