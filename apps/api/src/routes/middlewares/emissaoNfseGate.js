// O PORTÃO DOS DOIS ATOS FISCAIS — a ligação entre a regra pura e o banco/HTTP.
//
// ⚠ ISTO É UM SEGUNDO PASSO, DEPOIS de `ensureLegacyCompanyAccess`, e SÓ nos dois atos fiscais
// (`POST /nfse/issue` e `POST /nfse/:chaveAcesso/eventos`).
//
// ⚠ POR QUE FUNÇÃO NOVA, E NÃO UMA MUDANÇA EM `ensureLegacyCompanyAccess`. Aquela função é usada
// em **12 pontos, em 4 arquivos** (`nfse.js`, `adn.js`, `invoices.js`, `portalAccess.js`) — ela
// autoriza LEITURA de notas, sincronização e o ADN inteiro. Apertá-la para resolver a emissão
// mudaria todos esses caminhos junto, e ler nota **não é ato fiscal**: o portal do cliente
// quebraria sem que nada tivesse sido decidido sobre leitura. Por isso o portão é aditivo e
// estreito, e `GET /nfse`, `POST /nfse/consulta`, `adn.js` e `invoices.js` ficam exatamente como
// estão.

import { prisma } from "../../infrastructure/db/prisma.js";
import { getAuthUser, isAdminLike } from "./portalAccess.js";
import {
  decidirEmissaoCliente,
  PAPEL_MINIMO_EMISSAO,
} from "../../application/nfse/emissaoClienteAutorizacao.js";

/**
 * Traduz o código da regra no `error` minúsculo que o resto da API usa no corpo.
 * (`codigo` viaja em CAIXA ALTA junto, como já fazem as recusas de emissão em `routes/nfse.js`.)
 */
function erroHttp(codigo) {
  return String(codigo || "").toLowerCase();
}

/**
 * Autoriza (ou recusa, respondendo) um ATO FISCAL de NFS-e sobre a empresa legada informada.
 *
 * ⚠ CUIDADO COM OS DOIS IDs. O que chega aqui é o id da **`Company` legada** — é o que
 * `resolveLegacyCompanyId` já resolveu na rota de emissão, e o que `NfseRepository` guarda na de
 * eventos. Mas a permissão mora no **`PortalClient`** (é a ele que `CompanyClientUser.companyId` e
 * `CompanyFirmAccess.companyId` apontam). A volta é feita por `PortalClient.companyId`, que é
 * `@unique` — 1:1, sem ambiguidade. **Não** consultar `portalClient.findUnique({ where: { id } })`
 * com o id legado: são PKs de entidades diferentes e uma nunca encontra a outra.
 *
 * @returns {Promise<{ok: boolean}>} `ok:false` já respondeu ao cliente; o chamador só dá `return`.
 */
export async function ensureEmissaoNfseAutorizada(req, res, legacyCompanyId, { log } = {}) {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return { ok: false };
  }

  // Admin / contador do escritório: passa sem tocar no banco. É o caminho por onde a emissão real
  // acontece hoje.
  if (isAdminLike(user)) {
    return { ok: true, via: "ESCRITORIO" };
  }

  const normalizedCompanyId = String(legacyCompanyId || "").trim();
  if (!normalizedCompanyId) {
    res.status(400).json({ error: "company_id_required" });
    return { ok: false };
  }

  const portal = await prisma.portalClient.findUnique({
    where: { companyId: normalizedCompanyId },
    select: { id: true, emissaoClienteLiberada: true },
  });

  // ⚠ EMPRESA LEGADA SEM `PortalClient` NÃO É "LIBERADA POR OMISSÃO". Sem a linha do portal não
  // existe a chave que o contador liga — e não existe nem onde ele a ligaria. O usuário que chega
  // aqui nesse estado passou pelo ramo `Company.clientId` de `listAccessibleLegacyCompanyIds`, que
  // é vínculo legado, não papel. Recusa nomeada, com o mesmo código da empresa não liberada.
  if (!portal?.id) {
    const decisao = decidirEmissaoCliente({ ladoEscritorio: false, empresaLiberada: false, papelCliente: null });
    return responderRecusa(res, decisao, log, { userId: user.id, legacyCompanyId: normalizedCompanyId });
  }

  const [clientLink, firmLink] = await prisma.$transaction([
    prisma.companyClientUser.findUnique({
      where: { companyId_userId: { companyId: portal.id, userId: String(user.id) } },
      select: { role: true, status: true },
    }),
    prisma.companyFirmAccess.findUnique({
      where: { companyId_userId: { companyId: portal.id, userId: String(user.id) } },
      select: { role: true, status: true },
    }),
  ]);

  const decisao = decidirEmissaoCliente({
    // Vínculo de ESCRITÓRIO ativo nesta empresa = o contador da carteira. Passa sem consultar a
    // flag, pelo mesmo motivo do admin-like acima.
    ladoEscritorio: firmLink?.status === "ACTIVE",
    empresaLiberada: Boolean(portal.emissaoClienteLiberada),
    papelCliente: clientLink?.status === "ACTIVE" ? clientLink.role : null,
  });

  if (decisao.ok) return { ok: true, via: decisao.via };

  return responderRecusa(res, decisao, log, {
    userId: user.id,
    legacyCompanyId: normalizedCompanyId,
    portalClientId: portal.id,
  });
}

function responderRecusa(res, decisao, log, contexto) {
  // A recusa é um fato de PERMISSÃO, não um defeito — `info`, não `error`. Registrar é o que
  // permite responder "quem tentou emitir e foi barrado?" sem depender da memória de ninguém.
  log?.info?.(
    { ...contexto, codigo: decisao.codigo, motivos: decisao.motivos, papel: decisao.papel },
    "Ato fiscal de NFS-e recusado pelo portão de emissão do cliente"
  );
  res.status(403).json({
    error: erroHttp(decisao.codigo),
    codigo: decisao.codigo,
    motivos: decisao.motivos,
    papel: decisao.papel,
    papelMinimo: PAPEL_MINIMO_EMISSAO,
    empresaLiberada: decisao.empresaLiberada,
    message: decisao.message,
    correcao: decisao.correcao,
  });
  return { ok: false };
}
