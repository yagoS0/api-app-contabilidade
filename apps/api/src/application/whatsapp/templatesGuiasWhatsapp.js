// Contratos para submissão no WhatsApp Business. Estes nomes não pressupõem aprovação da Meta.
export const TEMPLATES_GUIAS_WHATSAPP = {
  guia_documento_pagamento_v1: {
    documento: true, pagamento: true,
    variaveis: ['nome', 'tipo', 'referencia', 'valor', 'vencimento'], botoes: ['Copy Pix code'],
    corpo: 'Olá {{1}}, a guia de {{2}}, referência {{3}}, está disponível no PDF anexo. Valor: R$ {{4}}. Vencimento: {{5}}. Abra os detalhes para copiar o código de barras. Se já pagou, não pague novamente.',
  },
  guia_codigo_barras_v1: {
    variaveis: ['tipo', 'competencia', 'linha_digitavel'], botoes: [],
    corpo: 'Código de barras da guia {{1}}, referência {{2}}, para copiar:\n\n{{3}}\n\nO PDF foi enviado nesta conversa.',
  },
  guia_pagamento_antes_v1: {
    variaveis: ['empresa', 'tipo', 'referencia', 'vencimento_util'], botoes: ['Confirmar pagamento'],
    corpo: 'Olá! Para {{1}}, a guia de {{2}}, referência {{3}}, vence em {{4}}. Você já pagou? Toque em Confirmar pagamento para informar a data. Se já pagou, não é necessário pagar novamente.',
  },
  guia_pagamento_depois_v1: {
    variaveis: ['empresa', 'tipo', 'referencia', 'vencimento_util'], botoes: ['Confirmar pagamento'],
    corpo: 'Olá! Para {{1}}, ainda não recebemos a confirmação da guia de {{2}}, referência {{3}}, com vencimento em {{4}}. Se já pagou, toque em Confirmar pagamento para informar a data. Não é necessário pagar novamente. Se ainda não pagou, solicite a atualização ao escritório.',
  },
  guia_pagamento_depois_recalculo_v1: {
    variaveis: ['empresa', 'tipo', 'referencia', 'vencimento_util'], botoes: ['Confirmar pagamento', 'Recalcular guia'],
    corpo: 'Olá! Para {{1}}, ainda não recebemos a confirmação da guia de {{2}}, referência {{3}}, com vencimento em {{4}}. Se já pagou, toque em Confirmar pagamento para informar a data. Não é necessário pagar novamente. Se ainda não pagou, toque em Recalcular guia: enviaremos a guia atualizada aqui, com os acréscimos aplicáveis.',
  },
};

// Comparação exata do contrato impede aprovar um modelo com variáveis/botões em outra ordem.
export function validarTemplateGuias(chave, template) {
  const contrato = TEMPLATES_GUIAS_WHATSAPP[chave];
  if (!contrato || template?.status !== 'APPROVED' || template.category !== 'UTILITY' || template.language !== 'pt_BR' || !template.name) throw Error('Template não aprovado ou contrato desconhecido.');
  const componentes = template.components || [];
  const corpo = componentes.find(c => c.type === 'BODY');
  const botoes = componentes.find(c => c.type === 'BUTTONS')?.buttons || [];
  const header = componentes.find(c => c.type === 'HEADER');
  if (corpo?.text !== contrato.corpo || componentes.some(c => !(contrato.documento ? ['HEADER', 'BODY', 'BUTTONS'] : ['BODY', 'BUTTONS']).includes(c.type))
    || (contrato.documento && header?.format !== 'DOCUMENT')
    || botoes.length !== contrato.botoes.length || botoes.some((b, i) => b.type !== (contrato.pagamento ? 'ORDER_DETAILS' : 'QUICK_REPLY') || b.text !== contrato.botoes[i])) throw Error('Texto ou botões diferem do contrato de envio.');
  return { nomeMeta: template.name, idioma: template.language, categoria: 'UTILITY', temDocumento: Boolean(contrato.documento), statusAprovacao: 'APROVADO', conferidoNaMetaEm: new Date() };
}
