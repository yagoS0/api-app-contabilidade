// Chaves novas têm contrato próprio; nunca reutilizar modelos antigos com outra ordem de variáveis.
export async function templateOperacional(chave, client) {
  const t = await client.templateWhatsapp.findUnique({ where: { chave } });
  if (!t?.nomeMeta || t.statusAprovacao !== 'APROVADO' || t.temDocumento) {
    throw Object.assign(new Error(`Modelo WhatsApp ${chave} ainda não aprovado; envio pendente.`), { code: 'WHATSAPP_TEMPLATE_PENDENTE' });
  }
  return t;
}
