// "LIBERAR AO CLIENTE" COM OS DOIS CANAIS — a ligação, num lugar só.
//
// Dois chamadores fazem a mesma coisa (o botão da aba Guias e o chip do dashboard), e antes cada um
// chamava `api.liberarGuiaCliente` por conta própria. Com o WhatsApp entrando como terceiro passo,
// duas cópias divergiriam na primeira correção — uma tela perguntaria, a outra não.
//
// A REGRA (`decidirCanaisAoLiberar`, `resumirDesfechoDosCanais`) mora em `canalDeEnvio.js`, pura;
// aqui é só a sequência de chamadas.
//
// ⚠ O E-MAIL SAI PRIMEIRO E SEMPRE — é o comportamento que existia. O WhatsApp é tentado DEPOIS, só
// quando o canal padrão da empresa manda (ou quando o contador respondeu sim ao PERGUNTAR), e a
// recusa dele (422 com motivo: sem opt-in, template não aprovado, já enviada) vira frase no
// desfecho — nunca um erro que esconda que o e-mail saiu.

import { decidirCanaisAoLiberar, resumirDesfechoDosCanais, PERGUNTA_WHATSAPP } from "./canalDeEnvio";

/**
 * @param {object} p
 * @param {object} p.api
 * @param {string} p.companyId  o `PortalClient.id`
 * @param {string} p.guideId
 * @param {(pergunta:string)=>boolean} [p.perguntar]  como perguntar ao contador (default: `window.confirm`)
 * @returns {Promise<{ok:boolean, tom:"ok"|"erro", texto:string, email:object, whatsapp:object|null}>}
 */
export async function liberarComCanais({ api, companyId, guideId, perguntar }) {
  const email = await api.liberarGuiaCliente(guideId);
  const emailDesfecho = { feito: Boolean(email?.sent), message: email?.message || null };

  let whatsapp = null;
  let canalPadraoEnvio = "EMAIL";
  if (companyId && typeof api.listarContatosWhatsapp === "function") {
    try {
      const r = await api.listarContatosWhatsapp(companyId);
      canalPadraoEnvio = r?.canalPadraoEnvio || "EMAIL";
    } catch {
      // Sem a leitura do canal, o comportamento é o de antes: só e-mail. Não se pergunta nada.
      canalPadraoEnvio = "EMAIL";
    }
  }
  const decisao = decidirCanaisAoLiberar({ canalPadraoEnvio });
  const quer = decisao.whatsapp || (decisao.perguntar && (perguntar || ((p) => window.confirm(p)))(PERGUNTA_WHATSAPP));

  if (quer && companyId && typeof api.enviarGuiaWhatsapp === "function") {
    try {
      const r = await api.enviarGuiaWhatsapp(companyId, guideId);
      whatsapp = { tentado: true, ok: r?.ok !== false, message: r?.message || null, motivo: r?.error || r?.motivo || null };
    } catch (err) {
      // ⚠ A recusa nomeada do servidor (422) chega como erro do `request`; ela é DESFECHO, não exceção.
      whatsapp = { tentado: true, ok: false, message: err?.message || null, motivo: err?.code || null };
    }
  }

  const resumo = resumirDesfechoDosCanais({ email: emailDesfecho, whatsapp });
  return { ok: resumo.tom === "ok", ...resumo, email, whatsapp };
}
