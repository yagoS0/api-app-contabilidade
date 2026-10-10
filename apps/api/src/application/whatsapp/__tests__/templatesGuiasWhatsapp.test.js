import { TEMPLATES_GUIAS_WHATSAPP, validarTemplateGuias } from '../templatesGuiasWhatsapp.js';
test.each(Object.keys(TEMPLATES_GUIAS_WHATSAPP))('valida contrato e aprovação de %s', chave => {
  const c = TEMPLATES_GUIAS_WHATSAPP[chave];
  const t = { name: chave, category: 'UTILITY', language: 'pt_BR', status: 'APPROVED', components: [...(c.documento ? [{ type: 'HEADER', format: 'DOCUMENT' }] : []), { type: 'BODY', text: c.corpo }, { type: 'BUTTONS', buttons: c.botoes.map(text => ({ type: c.pagamento ? 'ORDER_DETAILS' : 'QUICK_REPLY', text })) }] };
  expect(validarTemplateGuias(chave, t)).toMatchObject({ nomeMeta: chave, temDocumento: Boolean(c.documento), statusAprovacao: 'APROVADO' });
  expect(() => validarTemplateGuias(chave, { ...t, status: 'PENDING' })).toThrow();
  expect(() => validarTemplateGuias(chave, { ...t, components: [{ type: 'BODY', text: c.corpo + ' portal' }] })).toThrow();
});
