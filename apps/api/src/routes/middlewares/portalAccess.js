import { prisma } from "../../infrastructure/db/prisma.js";

export function getAuthUser(req) {
  return req?.auth?.user || null;
}

export function isAdminLike(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "admin" || role === "contador";
}

export function isCliente(user) {
  const role = String(user?.role || "").toLowerCase();
  return role === "client" || role === "cliente";
}

export async function ensurePortalClientAccess(req, res, portalClientId) {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return { ok: false };
  }

  if (isAdminLike(user)) return { ok: true, user, access: { kind: "admin" } };

  const targetClientId = String(portalClientId);
  const [clientLink, firmLink] = await prisma.$transaction([
    prisma.companyClientUser.findUnique({
      where: { companyId_userId: { companyId: targetClientId, userId: String(user.id) } },
      select: { role: true, status: true },
    }),
    prisma.companyFirmAccess.findUnique({
      where: { companyId_userId: { companyId: targetClientId, userId: String(user.id) } },
      select: { role: true, status: true, scopes: true },
    }),
  ]);

  if (clientLink?.status === "ACTIVE") {
    return { ok: true, user, access: { kind: "client", ...clientLink } };
  }
  if (firmLink?.status === "ACTIVE") {
    return { ok: true, user, access: { kind: "firm", ...firmLink } };
  }

  if (!isCliente(user)) {
    res.status(403).json({ error: "forbidden" });
    return { ok: false };
  }

  const portal = await prisma.portalClient.findUnique({
    where: { id: targetClientId },
    select: { id: true, companyId: true },
  });
  if (!portal) {
    res.status(404).json({ error: "not_found" });
    return { ok: false };
  }
  if (!portal.companyId) {
    res.status(403).json({ error: "forbidden" });
    return { ok: false };
  }

  const company = await prisma.company.findFirst({
    where: { id: portal.companyId, clientId: String(user.id) },
    select: { id: true },
  });
  if (!company) {
    res.status(403).json({ error: "forbidden" });
    return { ok: false };
  }

  return { ok: true, user, access: { kind: "legacy_client_owner" } };
}

export async function buildPortalClientWhereForUser(req) {
  const user = getAuthUser(req);
  if (!user) return null;
  if (isAdminLike(user)) return {};
  const [clientLinks, firmLinks] = await prisma.$transaction([
    prisma.companyClientUser.findMany({
      where: { userId: String(user.id), status: "ACTIVE" },
      select: { companyId: true },
    }),
    prisma.companyFirmAccess.findMany({
      where: { userId: String(user.id), status: "ACTIVE" },
      select: { companyId: true },
    }),
  ]);

  let ids = [...clientLinks, ...firmLinks].map((i) => i.companyId).filter(Boolean);
  if (!ids.length && isCliente(user)) {
    const companies = await prisma.company.findMany({
      where: { clientId: String(user.id) },
      select: { id: true },
    });
    const legacyIds = companies.map((c) => c.id).filter(Boolean);
    if (legacyIds.length) {
      const portals = await prisma.portalClient.findMany({
        where: { companyId: { in: legacyIds } },
        select: { id: true },
      });
      ids = portals.map((p) => p.id);
    }
  }
  if (!ids.length) return { id: { in: [] } };
  return { id: { in: ids } };
}

export async function listAccessibleLegacyCompanyIds(req) {
  const user = getAuthUser(req);
  if (!user) return [];
  if (isAdminLike(user)) return null;
  const [clientLinks, firmLinks] = await prisma.$transaction([
    prisma.companyClientUser.findMany({
      where: { userId: String(user.id), status: "ACTIVE" },
      select: { companyId: true },
    }),
    prisma.companyFirmAccess.findMany({
      where: { userId: String(user.id), status: "ACTIVE" },
      select: { companyId: true },
    }),
  ]);
  const portalIds = [...new Set([...clientLinks, ...firmLinks].map((item) => item.companyId).filter(Boolean))];
  const legacyIds = new Set();
  if (portalIds.length) {
    const portals = await prisma.portalClient.findMany({
      where: { id: { in: portalIds } },
      select: { companyId: true },
    });
    for (const portal of portals) {
      if (portal?.companyId) legacyIds.add(String(portal.companyId));
    }
  }
  if (isCliente(user)) {
    const ownCompanies = await prisma.company.findMany({
      where: { clientId: String(user.id) },
      select: { id: true },
    });
    for (const company of ownCompanies) {
      if (company?.id) legacyIds.add(String(company.id));
    }
  }
  return [...legacyIds];
}

/**
 * Traduz "o id de empresa que o cliente mandou" para o id da **Company legada**.
 *
 * ⚠ POR QUE ISTO PRECISA EXISTIR. O front trabalha inteiro com **`PortalClient.id`** — é o id que
 * a aba Notas Fiscais recebe (`selectedCompanyId`) e o que toda rota `/firm/companies/:companyId/*`
 * espera (elas leem `req.params.companyId` como `portalClientId`). Já a rota de EMISSÃO vive no
 * mundo legado: `NfseService.issue` faz `prisma.company.findUnique({ where: { id: data.companyId } })`
 * e lê de lá `cnpj`, `inscricaoMunicipal`, `codigoServicoNacional/Municipal` e `rpsSerie`.
 *
 * São duas entidades diferentes, com PKs próprias — o id de uma NUNCA encontra a outra. Por isso a
 * emissão não podia ter funcionado nenhuma vez: o usuário comum caía em `403 forbidden`
 * (`listAccessibleLegacyCompanyIds` devolve ids de `Company`) e o admin, que passa direto pela
 * checagem, seguia até o serviço e voltava `404 company_not_found`.
 *
 * ⚠ ESTA FUNÇÃO NÃO AUTORIZA NADA. Ela só resolve o id; quem autoriza continua sendo
 * `ensureLegacyCompanyAccess`, chamada logo depois com o id **já resolvido** — que é justamente o
 * que faz a checagem incidir sobre a entidade certa. Inverter a ordem (checar e depois resolver)
 * autorizaria uma empresa e emitiria por outra.
 *
 * A ordem de tentativa é `Company` primeiro: quem já mandava o id legado (a rota sempre aceitou
 * esse) continua funcionando exatamente igual. `PortalClient.companyId` é `@unique`, então a volta
 * é 1:1 e não há ambiguidade.
 *
 * @returns {Promise<string|null>} id da Company legada, ou `null` quando não há a que resolver.
 */
export async function resolveLegacyCompanyId(rawId) {
  const id = String(rawId || "").trim();
  if (!id) return null;
  const company = await prisma.company.findUnique({ where: { id }, select: { id: true } });
  if (company?.id) return company.id;
  const portal = await prisma.portalClient.findUnique({
    where: { id },
    select: { companyId: true },
  });
  return portal?.companyId || null;
}

export async function ensureLegacyCompanyAccess(req, res, legacyCompanyId) {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return { ok: false };
  }
  const normalizedCompanyId = String(legacyCompanyId || "").trim();
  if (!normalizedCompanyId) {
    res.status(400).json({ error: "company_id_required" });
    return { ok: false };
  }
  if (isAdminLike(user)) {
    return { ok: true, user, companyId: normalizedCompanyId, access: { kind: "admin" } };
  }
  const allowedCompanyIds = await listAccessibleLegacyCompanyIds(req);
  if (allowedCompanyIds.includes(normalizedCompanyId)) {
    return { ok: true, user, companyId: normalizedCompanyId, access: { kind: "legacy" } };
  }
  res.status(403).json({ error: "forbidden" });
  return { ok: false };
}

export async function ensureLegacyCompanyCnpjAccess(req, res, cnpj) {
  const normalizedCnpj = String(cnpj || "").replace(/\D+/g, "");
  if (!normalizedCnpj) {
    res.status(400).json({ error: "cnpj_required" });
    return { ok: false };
  }
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: "unauthorized" });
    return { ok: false };
  }
  if (isAdminLike(user)) {
    return { ok: true, cnpj: normalizedCnpj };
  }
  const allowedCompanyIds = await listAccessibleLegacyCompanyIds(req);
  if (!allowedCompanyIds.length) {
    res.status(403).json({ error: "forbidden" });
    return { ok: false };
  }
  const company = await prisma.company.findFirst({
    where: {
      id: { in: allowedCompanyIds },
      cnpj: normalizedCnpj,
    },
    select: { id: true, cnpj: true },
  });
  if (!company?.id) {
    res.status(403).json({ error: "forbidden" });
    return { ok: false };
  }
  return { ok: true, cnpj: normalizedCnpj, companyId: company.id };
}

