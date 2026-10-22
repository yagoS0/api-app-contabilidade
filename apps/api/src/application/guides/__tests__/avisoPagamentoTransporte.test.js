jest.mock('../../../config.js', () => ({ INTEGRACAO_WHATSAPP: true }));
jest.mock('../../../infrastructure/db/prisma.js', () => ({ prisma: { templateWhatsapp: { findUnique: jest.fn() } } }));
jest.mock('../../whatsapp/ContatoWhatsappService.js', () => ({ destinatariosDeEnvio: jest.fn() }));
jest.mock('../../whatsapp/ConversaWhatsappService.js', () => ({ garantirConversa: jest.fn(async () => ({ id: 'cv' })), janelaDaConversa: jest.fn() }));
jest.mock('../../whatsapp/CanalWhatsappService.js', () => ({ whatsappPorCanal: jest.fn() }));
jest.mock('../../whatsapp/SaidaWhatsappService.js', () => ({ enviarMensagemRastreada: jest.fn(async a => { await a.antesDeEnviar(); return a.enviar(); }) }));
import { transportePadrao } from '../AvisoPagamentoService.js';
import { prisma } from '../../../infrastructure/db/prisma.js';
import { janelaDaConversa } from '../../whatsapp/ConversaWhatsappService.js';
import { whatsappPorCanal } from '../../whatsapp/CanalWhatsappService.js';
import { TEMPLATES_GUIAS_WHATSAPP, validarTemplateGuias } from '../../whatsapp/templatesGuiasWhatsapp.js';

function cenario(aberta = true) {
  janelaDaConversa.mockResolvedValue({ situacao: aberta ? 'ABERTA' : 'FECHADA' });
  prisma.templateWhatsapp.findUnique.mockImplementation(async ({ where }) => ({ nomeMeta: where.chave, statusAprovacao: 'APROVADO', idioma: 'pt_BR', temDocumento: false }));
  const cloud = { enviarBotoes: jest.fn(async () => ({})), enviarTemplate: jest.fn(async () => ({})) };
  whatsappPorCanal.mockResolvedValue(cloud);
  const args = { companyId: 'c', contato: { telefoneE164: '5511999999999' }, texto: 'Já pagou?', acoes: [{ label: 'Recalcular guia', id: 'recalcular' }], botaoId: 'confirmar', key: 'aviso', conferir: jest.fn(), fase: 'DEPOIS', variaveis: ['Empresa', 'SIMPLES', '2026-09', '16/10/2026'] };
  return { cloud, args, run: async () => (await transportePadrao()).whatsapp(args) };
}
test('janela aberta envia dois botões de resposta sem links', async () => {
  const f = cenario(); await f.run(); expect(f.cloud.enviarBotoes).toHaveBeenCalledWith({ telefone: f.args.contato.telefoneE164, texto: 'Já pagou?', botoes: [{ id: 'confirmar', titulo: 'Confirmar pagamento' }, { id: 'recalcular', titulo: 'Recalcular guia' }] });
});
test.each(['ANTES', 'NO_VENCIMENTO', 'DEPOIS'])('janela fechada envia template %s com os payloads dos botões', async fase => {
  const f = cenario(false); f.args.fase = fase; if (fase !== 'DEPOIS') f.args.acoes = [];
  await f.run(); expect(f.cloud.enviarTemplate).toHaveBeenCalledWith(expect.objectContaining({ template: { ANTES: 'guia_pagamento_antes_v1', NO_VENCIMENTO: 'guia_pagamento_no_vencimento_v1', DEPOIS: 'guia_pagamento_depois_atualizacao_v2' }[fase], variaveis: f.args.variaveis, botoesResposta: fase !== 'DEPOIS' ? ['confirmar'] : ['confirmar', 'recalcular'] }));
  expect(f.cloud.enviarBotoes).not.toHaveBeenCalled();
});
test.each(['ANTES', 'NO_VENCIMENTO', 'DEPOIS'])('modelo %s não aprovado fica pendente sem envio livre fora da janela', async fase => {
  const f = cenario(false); f.args.fase = fase; if (fase !== 'DEPOIS') f.args.acoes = []; prisma.templateWhatsapp.findUnique.mockResolvedValue(null);
  await expect(f.run()).rejects.toMatchObject({ code: 'WHATSAPP_TEMPLATE_PENDENTE' }); expect(f.cloud.enviarBotoes).not.toHaveBeenCalled(); expect(f.cloud.enviarTemplate).not.toHaveBeenCalled();
});

test('contrato D0 tem um botão, texto próprio e recusa corpo de DEPOIS', () => {
  const contrato = TEMPLATES_GUIAS_WHATSAPP.guia_pagamento_no_vencimento_v1;
  expect(contrato.corpo).toContain('vence hoje');
  expect(contrato.corpo).not.toMatch(/atras|acréscimos|atualizar|recalcular/i);
  const template = { status: 'APPROVED', category: 'UTILITY', language: 'pt_BR', name: 'guia_pagamento_no_vencimento_v1', components: [
    { type: 'BODY', text: contrato.corpo }, { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Confirmar pagamento' }] },
  ] };
  expect(validarTemplateGuias(template.name, template).statusAprovacao).toBe('APROVADO');
  template.components[0].text = TEMPLATES_GUIAS_WHATSAPP.guia_pagamento_depois_v1.corpo;
  expect(() => validarTemplateGuias(template.name, template)).toThrow('Texto ou botões diferem');
});

test.each([true, false])('revogação da seleção no callback bloqueia transporte (janela aberta %s)', async aberta => {
 const f=cenario(aberta);f.args.conferir.mockRejectedValue(Object.assign(new Error('Seleção revogada'),{code:'ROTINA_EMPRESA_DESABILITADA'}));
 await expect(f.run()).rejects.toMatchObject({code:'ROTINA_EMPRESA_DESABILITADA'});
 expect(f.cloud.enviarBotoes).not.toHaveBeenCalled();expect(f.cloud.enviarTemplate).not.toHaveBeenCalled();
});
