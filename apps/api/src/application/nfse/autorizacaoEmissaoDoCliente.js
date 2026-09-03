// A AUTORIZAÇÃO DO ATO FISCAL DO CLIENTE — a MESMA decisão do portão, sem `req`/`res`.
//
// ⚠ POR QUE EXISTE. `routes/middlewares/emissaoNfseGate.js` (`ensureEmissaoNfseAutorizada`) é a
// porta dos dois atos fiscais nas rotas HTTP, e ela RESPONDE a recusa direto no `res`. O assistente
// do WhatsApp (F4, 02/09/2026) precisa da mesma decisão sem HTTP — e escrever uma segunda regra lá
// seria o defeito que o portão existe para impedir. Esta função faz as MESMAS consultas e chama a
// MESMA regra pura (`decidirEmissaoCliente`); o portão HTTP continua intacto (ele também trata a
// visita do escritório e o admin-like, que não existem no WhatsApp: quem fala é sempre uma pessoa
// do CLIENTE, identificada por `contatos_whatsapp.userId`).
//
// ⚠ NÃO HÁ `ladoEscritorio: true` POR AQUI, DE PROPÓSITO. Um usuário do escritório que também
// esteja cadastrado como contato de WhatsApp da empresa NÃO ganha o bypass do escritório pelo
// WhatsApp: o bypass existe para o caminho `/firm`, com o certificado e a autorização do
// escritório. Pelo WhatsApp ele é tratado como o papel de CLIENTE que tiver (ou nenhum).
//
// ⚠ O id que entra é o `PortalClient.id` (é o que o fio de conversa tem). O portão HTTP recebe o
// legado e volta pelo `companyId @unique`; aqui a volta não é necessária.

import { prisma } from "../../infrastructure/db/prisma.js";
import { decidirEmissaoCliente } from "./emissaoClienteAutorizacao.js";

/**
 * @param {object} p
 * @param {string} p.portalClientId
 * @param {string|null} p.userId
 * @param {object} [p.client]
 * @returns {Promise<{ok:boolean, via?:string, codigo?:string, motivos?:string[], papel?:string|null, message?:string, correcao?:string, empresaLiberada?:boolean}>}
 */
export async function autorizarEmissaoDoCliente({ portalClientId, userId, client = prisma } = {}) {
  const pid = String(portalClientId || "").trim();
  const uid = String(userId || "").trim();
  if (!pid || !uid) {
    return { ok: false, ...decidirEmissaoCliente({ ladoEscritorio: false, empresaLiberada: false, papelCliente: null }) };
  }
  const portal = await client.portalClient.findUnique({ where: { id: pid }, select: { id: true, emissaoClienteLiberada: true } });
  if (!portal) {
    return { ok: false, ...decidirEmissaoCliente({ ladoEscritorio: false, empresaLiberada: false, papelCliente: null }) };
  }
  const vinculo = await client.companyClientUser.findUnique({
    where: { companyId_userId: { companyId: portal.id, userId: uid } },
    select: { role: true, status: true },
  });
  const decisao = decidirEmissaoCliente({
    ladoEscritorio: false,
    empresaLiberada: Boolean(portal.emissaoClienteLiberada),
    papelCliente: vinculo?.status === "ACTIVE" ? vinculo.role : null,
  });
  return decisao.ok ? { ok: true, via: decisao.via } : { ok: false, ...decisao };
}
