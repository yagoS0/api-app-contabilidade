import { TEMPLATES_GUIAS_WHATSAPP, validarTemplateGuias } from '../templatesGuiasWhatsapp.js';
test.each(Object.keys(TEMPLATES_GUIAS_WHATSAPP))('valida contrato e aprovação de %s', chave => {
  const c = TEMPLATES_GUIAS_WHATSAPP[chave];
  const t = { name: chave, category: 'UTILITY', language: 'pt_BR', status: 'APPROVED', components: [...(c.documento ? [{ type: 'HEADER', format: 'DOCUMENT' }] : []), { type: 'BODY', text: c.corpo }, { type: 'BUTTONS', buttons: c.botoes.map(text => ({ type: c.pagamento ? 'ORDER_DETAILS' : 'QUICK_REPLY', text })) }] };
  expect(validarTemplateGuias(chave, t)).toMatchObject({ nomeMeta: chave, temDocumento: Boolean(c.documento), statusAprovacao: 'APROVADO' });
  expect(() => validarTemplateGuias(chave, { ...t, status: 'PENDING' })).toThrow();
  expect(() => validarTemplateGuias(chave, { ...t, components: [{ type: 'BODY', text: c.corpo + ' portal' }] })).toThrow();
});

import { templateOperacional } from '../TemplateOperacionalWhatsapp.js';
test.each(['ausente', 'MARKETING', 'REJECTED', 'idioma', 'botoes', 'texto', 'nome'])('consumidor estrito bloqueia contrato %s', async caso => {
  const chave = 'guia_pagamento_antes_v1', contrato = TEMPLATES_GUIAS_WHATSAPP[chave];
  const template = { name: chave, category: 'UTILITY', language: 'pt_BR', status: 'APPROVED', components: [{ type: 'BODY', text: contrato.corpo }, { type: 'BUTTONS', buttons: contrato.botoes.map(text => ({type:'QUICK_REPLY', text})) }] };
  if(caso==='MARKETING')template.category='MARKETING'; if(caso==='REJECTED')template.status='REJECTED'; if(caso==='idioma')template.language='en_US';
  if(caso==='botoes')template.components[1].buttons=[]; if(caso==='texto')template.components[0].text='outro texto'; if(caso==='nome')template.name='outro_modelo';
  const db={templateWhatsapp:{findUnique:async()=>({nomeMeta:chave,statusAprovacao:'APROVADO',idioma:'pt_BR',categoria:'UTILITY',temDocumento:false,conferidoNaMetaEm:new Date()})},appSetting:{findUnique:async()=>caso==='ausente'?null:{value:{nomeMeta:chave,template}}}};
  await expect(templateOperacional(chave,db,{estrito:true})).rejects.toMatchObject({code:'WHATSAPP_TEMPLATE_PENDENTE'});
});
