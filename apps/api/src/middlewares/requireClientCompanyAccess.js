import { prisma } from "../infrastructure/db/prisma.js";

// Papéis do cliente (peso crescente). No app ofertamos OWNER/CLIENT_ADMIN/FINANCEIRO;
// CLIENT_USER fica só para vínculos legados (mesmo piso do FINANCEIRO).
// Gates: financeiro (notas/guias/alíquota/fluxo) = membro ativo (sem minRole);
// pró-labore/certificado/sócios = CLIENT_ADMIN; gestão de usuários = OWNER.
const ROLE_WEIGHT = {
  CLIENT_USER: 1,
  FINANCEIRO: 1,
  CLIENT_ADMIN: 2,
  OWNER: 3,
};

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

export function requireClientCompanyAccess(minRole) {
  const min = minRole ? normalize(minRole) : null;
  const minWeight = min ? ROLE_WEIGHT[min] || 0 : 0;

  return async function requireClientCompanyAccessMiddleware(req, res, next) {
    const user = req?.auth?.user;
    if (!user) return res.status(401).json({ error: "unauthorized" });

    const role = String(user.role || "").toLowerCase();
    if (role === "admin") {
      req.access = { role: "OWNER", status: "ACTIVE" };
      return next();
    }

    const companyId = String(
      req.params.companyId || req.params.clientId || req.body?.companyId || ""
    ).trim();
    if (!companyId) return res.status(400).json({ error: "company_id_required" });

    /**
     * ⚠⚠ O VISITANTE DO ESCRITÓRIO — ele entra para VER, e só (30/08/2026).
     *
     * > Dono: *"o meu acesso admin deve ser o único a conseguir isso."*
     *
     * Duas decisões, e as duas são de segurança:
     *
     * 1. ⚠⚠ **O PISO É `FINANCEIRO`, NUNCA `OWNER`.** O portal do cliente **emite NFS-e**, e a
     *    emissão exige `CLIENT_ADMIN`+ — com OWNER, o contador poderia emitir nota fiscal em nome
     *    do cliente a partir da tela dele. Ato fiscal que ninguém pediu, irreversível (a NFS-e não
     *    tem inutilização), e no CNPJ de outro. Com `FINANCEIRO` ele vê notas, guias, alíquota e
     *    fluxo — que é o que ele foi conferir — e é recusado em emissão, pró-labore, certificado,
     *    quadro societário e gestão de usuários.
     *    ⚠ Consequência aceita e nomeada: a **Situação fiscal** (piso `CLIENT_ADMIN`) não abre para
     *    ele por aqui. Ela já está inteira no portal do escritório, que é de onde ela vem.
     *
     * 2. ⚠⚠ **O ESCOPO É A CARTEIRA DELE**, por `companyFirmAccess` — nunca "qualquer empresa".
     *    É a mesma pergunta que `requireFirmCompanyAccess` faz no portal do escritório, e sem ela um
     *    usuário marcado alcançaria empresa de outro escritório pelo id na URL. Multi-tenancy é
     *    invariante desta casa.
     *
     * ⚠ A visita fica REGISTRADA (`req.visitaDoEscritorio`): um usuário do escritório lendo o
     * portal de um cliente é acesso a dado do cliente, e daqui a seis meses "quem abriu isto?" é
     * uma pergunta que alguém vai fazer.
     */
    if (user.podeAbrirPortalDoCliente === true) {
      const naCarteira = await prisma.companyFirmAccess.findUnique({
        where: { companyId_userId: { companyId, userId: String(user.id) } },
        select: { status: true },
      });
      if (!naCarteira || naCarteira.status !== "ACTIVE") {
        return res.status(403).json({ error: "forbidden" });
      }
      // ⚠ O piso pedido pela rota continua valendo: `CLIENT_ADMIN`/`OWNER` recusam o visitante.
      if (minWeight > ROLE_WEIGHT.FINANCEIRO) {
        return res.status(403).json({ error: "insufficient_role" });
      }
      req.access = { role: "FINANCEIRO", status: "ACTIVE", visitaDoEscritorio: true };
      req.visitaDoEscritorio = { userId: String(user.id), companyId };
      return next();
    }

    const link = await prisma.companyClientUser.findUnique({
      where: {
        companyId_userId: {
          companyId,
          userId: String(user.id),
        },
      },
      select: { role: true, status: true },
    });

    if (!link || link.status !== "ACTIVE") {
      return res.status(403).json({ error: "forbidden" });
    }

    const currentWeight = ROLE_WEIGHT[normalize(link.role)] || 0;
    if (currentWeight < minWeight) {
      return res.status(403).json({ error: "insufficient_role" });
    }

    req.access = { role: normalize(link.role), status: link.status };
    return next();
  };
}

