import { WHATSAPP_TOKEN, WHATSAPP_WABA_ID, WHATSAPP_GRAPH_VERSION, INTEGRACAO_WHATSAPP } from '../../config.js';
import { erroComunicado } from './comunicados.js';

// Acesso de gestão separado do transporte. Nunca inclui token em URL, erro ou retorno.
export function criarModelosMeta({ token = WHATSAPP_TOKEN, waba = WHATSAPP_WABA_ID, version = WHATSAPP_GRAPH_VERSION,
  habilitada = INTEGRACAO_WHATSAPP, fetchImpl = globalThis.fetch } = {}) {
  async function chamar(method, parametros) {
    if (!habilitada || !token || !/^\d+$/.test(waba || '') || !/^v\d+\.\d+$/.test(version || '')) throw erroComunicado('A gestão de modelos do WhatsApp não está configurada.', 503);
    const url = new URL(`https://graph.facebook.com/${version}/${waba}/message_templates`);
    if (method === 'GET') for (const [k, v] of Object.entries(parametros)) url.searchParams.set(k, v);
    let res, json;
    try {
      res = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(parametros) } : {}), signal: AbortSignal.timeout(20000) });
      json = await res.json();
    } catch { throw erroComunicado('Não foi possível confirmar a resposta da Meta. Consulte o status antes de tentar novamente.', 502); }
    if (!res.ok) throw erroComunicado(`A Meta recusou a operação (código ${json?.error?.code || res.status}). Confira as permissões da conta ou o texto do modelo.`, 502);
    return json;
  }
  return {
    async consultar(nome) {
      const r = await chamar('GET', { name: nome, fields: 'id,name,status,category,language,components', limit: '100' });
      return (r.data || []).find(t => t.name === nome && t.language === 'pt_BR') || null;
    },
    criar: modelo => chamar('POST', modelo),
  };
}
