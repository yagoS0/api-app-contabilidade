jest.mock("../ConsentimentoWhatsappService.js", () => ({ conferirEnvioConsentido: jest.fn(async () => {}), lerConsentimentoWhatsapp: jest.fn(async () => null), processarConsentimentoWhatsapp: jest.fn(async () => null) }));
import { WhatsappCloudClient } from '../WhatsappCloudClient.js';
const args = { telefone: '5521994400833', conteudoPdf: Buffer.from('%PDF-teste'), nomeArquivo: 'teste.pdf',
  texto: 'Guia de teste', referencia: 'envio-1', linhaDigitavel: '8' + '0'.repeat(47), valor: 12.34, descricao: 'SIMPLES 09/2026' };
function cenario() {
  const fetchImpl = jest.fn(async url => ({ ok: true, status: 200, json: async () => url.endsWith('/media')
    ? { id: 'media-1' } : { messages: [{ id: 'wamid-1' }], contacts: [{ wa_id: args.telefone }] } }));
  return { fetchImpl, cloud: new WhatsappCloudClient({ fetchImpl, config: { habilitada: true, token: 'TESTE', phoneNumberId: 'P', log: null } }) };
}
test('PDF e 48 dígitos inteiros em um único POST messages, sem URL de portal', async () => {
  const { cloud, fetchImpl } = cenario(); await cloud.enviarGuiaComPagamento(args);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const p = JSON.parse(fetchImpl.mock.calls[1][1].body);
  expect(p.interactive.header.document).toEqual({ id: 'media-1', filename: 'teste.pdf' });
  expect(p.interactive.action.parameters.payment_settings[0].boleto.digitable_line).toBe(args.linhaDigitavel);
  expect(p.interactive.action.parameters.total_amount).toEqual({ value: 1234, offset: 100 });
  expect(JSON.stringify(p)).not.toContain('https://');
});
test('template reúne documento e order_details em uma mensagem', async () => {
  const { cloud, fetchImpl } = cenario(); await cloud.enviarGuiaComPagamento({ ...args, template: 'guia_documento_pagamento_v1', variaveis: ['SIMPLES', '09/2026'] });
  const p = JSON.parse(fetchImpl.mock.calls[1][1].body);
  expect(p.template.components[0].parameters[0].document.id).toBe('media-1');
  expect(p.template.components[2].parameters[0].action.order_details.payment_settings[0].boleto.digitable_line).toBe(args.linhaDigitavel);
});
test.each([{ linhaDigitavel: '123' }, { valor: null }, { valor: -1 }, { valor: 'NaN' }])('dados inválidos recusam antes da rede: %j', async invalido => {
  const { cloud, fetchImpl } = cenario(); await expect(cloud.enviarGuiaComPagamento({ ...args, ...invalido })).rejects.toMatchObject({ code: 'GUIA_PAGAMENTO_INVALIDA' });
  expect(fetchImpl).not.toHaveBeenCalled();
});
test('revogação depois do upload impede mensagem', async () => {
  const { cloud, fetchImpl } = cenario(); const guarda = jest.fn().mockResolvedValueOnce().mockRejectedValueOnce(Error('revogado'));
  await expect(cloud.enviarGuiaComPagamento({ ...args, antesDeEnviar: guarda })).rejects.toThrow('revogado');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test.each([null, 'guia_documento_sem_codigo_v1'])('PDF sem código usa %s sem botão nem parâmetros de pagamento', async template => {
  const { cloud, fetchImpl } = cenario();
  await cloud.enviarGuiaComPagamento({ ...args, linhaDigitavel: null, somenteDocumento: true, template, variaveis: ['Cliente', 'EMPRESA A — DAS', '09/2026', '12,34', '20/10/2026'] });
  const payload = JSON.parse(fetchImpl.mock.calls[1][1].body);
  if (template) {
    expect(payload.template.components.map(c => c.type)).toEqual(['header', 'body']);
  } else {
    expect(payload.type).toBe('document'); expect(payload.document.id).toBe('media-1');
  }
  expect(JSON.stringify(payload)).not.toMatch(/order_details|payment_settings|digitable_line/);
});

test('PDF sem botão também revalida autorização depois do upload', async () => {
  const { cloud, fetchImpl } = cenario(); const guarda = jest.fn().mockResolvedValueOnce().mockRejectedValueOnce(Error('revogado'));
  await expect(cloud.enviarGuiaComPagamento({ ...args, somenteDocumento: true, antesDeEnviar: guarda })).rejects.toThrow('revogado');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
