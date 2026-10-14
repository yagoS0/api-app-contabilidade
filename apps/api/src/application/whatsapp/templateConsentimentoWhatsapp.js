export const BOTOES_CONSENTIMENTO = [
  { id: 'altan.consent.authorize.v1', titulo: 'Autorizar envios', status: 'AUTORIZADO' },
  { id: 'altan.consent.decline.v1', titulo: 'Não quero receber', status: 'REVOGADO' },
];

export const TEMPLATE_CONSENTIMENTO = {
  name: 'altan_apresentacao_guias_botoes_v2', language: 'pt_BR', category: 'MARKETING',
  components: [
    { type: 'BODY', text: 'Olá, {{1}}! Este é o WhatsApp de suporte da Altan. Por aqui, enviaremos as guias de {{2}}, com PDF e código de barras para copiar. Você também poderá confirmar o pagamento e solicitar a atualização da guia, quando disponível. Podemos enviar por este número? Toque em uma opção abaixo.', example: { body_text: [['Maria', 'Empresa Exemplo Ltda.']] } },
    { type: 'BUTTONS', buttons: BOTOES_CONSENTIMENTO.map(b => ({ type: 'QUICK_REPLY', text: b.titulo })) },
  ],
};

// Usar estes payloads ao enviar o modelo; rótulos não decidem consentimento.
export function parametrosTemplateConsentimento({ telefone, nome, empresas }) {
  if (!telefone || !nome || !empresas) throw Error('Informe destinatário, nome e empresas.');
  return { telefone, template: TEMPLATE_CONSENTIMENTO.name, idioma: TEMPLATE_CONSENTIMENTO.language,
    variaveis: [nome, empresas], botoesResposta: BOTOES_CONSENTIMENTO.map(b => b.id) };
}
