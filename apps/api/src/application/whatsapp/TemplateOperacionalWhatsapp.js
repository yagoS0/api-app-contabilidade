import { validarTemplateGuias } from './templatesGuiasWhatsapp.js';
// Chaves novas têm contrato próprio; nunca reutilizar modelos antigos com outra ordem de variáveis.
export async function templateOperacional(chave, client, { estrito = false } = {}) {
  const t = await client.templateWhatsapp.findUnique({ where: { chave } });
  if (!t?.nomeMeta || t.statusAprovacao !== 'APROVADO' || t.temDocumento) {
    throw Object.assign(new Error(`Modelo WhatsApp ${chave} ainda não aprovado; envio pendente.`), { code: 'WHATSAPP_TEMPLATE_PENDENTE' });
  }
  if (estrito) {
    try {
      const evidencia = (await client.appSetting.findUnique({ where: { key: `template_whatsapp_contrato:${chave}` } }))?.value;
      if (!t.conferidoNaMetaEm || !evidencia?.template || evidencia.nomeMeta !== t.nomeMeta) throw new Error('Contrato ausente.');
      const contrato = validarTemplateGuias(chave, evidencia.template);
      if (contrato.nomeMeta !== t.nomeMeta || contrato.idioma !== t.idioma || t.categoria !== 'UTILITY') throw new Error('Contrato divergente.');
    } catch {
      throw Object.assign(new Error('Modelo Utility sem contrato compatível comprovado; aviso pendente.'), { code: 'WHATSAPP_TEMPLATE_PENDENTE' });
    }
  }
  return t;
}
