// Endpoints INTERNOS (serviço-a-serviço). Consumidos pelo BFF do app mobile
// (portal-cliente-app), autenticados por API key (x-api-key). NÃO expor ao app.
//
// Fonte dos dados (reuso, sem reescrever regra fiscal):
//   - faturamento do mês corrente: soma das notas EMIT autorizadas da competência
//     (mesma definição de `receitaMes` em application/notas/apuracao/CalculoFiscal.js).
//   - extrato (DAS/INSS/receita): CompanyMonthlyCircular da última competência com DAS.
//
// A alíquota efetiva NÃO é calculada aqui: este endpoint só devolve os componentes
// crus; o BFF aplica (DAS - INSS) / faturamento conforme o contrato do app.

import { Router } from "express";
import { prisma } from "../infrastructure/db/prisma.js";

/** Competência corrente "YYYY-MM" (UTC). */
function competenciaAtual(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Range [1º dia, 1º dia do mês seguinte) de uma competência YYYY-MM. */
function rangeMes(competencia) {
  const [y, m] = competencia.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(y, m - 1, 1)),
    lt: new Date(Date.UTC(y, m, 1)),
  };
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

export function createInternalRouter({ ensureAuthorized, log }) {
  const router = Router();

  // GET /internal/companies/:portalClientId/dashboard
  router.get("/companies/:portalClientId/dashboard", async (req, res) => {
    // Requer credencial de serviço (x-api-key) ou JWT válido.
    if (!(await ensureAuthorized(req, res, { allowApiKeyFallback: true }))) return;

    const { portalClientId } = req.params;
    try {
      const competencia = competenciaAtual();
      const { gte, lt } = rangeMes(competencia);

      // Faturamento do mês corrente: notas EMIT autorizadas na competência.
      const notas = await prisma.portalInvoice.findMany({
        where: {
          clientId: portalClientId,
          papel: "EMIT",
          statusEfetivo: "autorizada",
          competencia: { gte, lt },
        },
        select: { total: true, updatedAt: true },
      });
      const faturamentoValor = notas.reduce((sum, n) => sum + Number(n.total || 0), 0);
      const atualizadoEm = notas.reduce(
        (max, n) => (n.updatedAt && n.updatedAt > max ? n.updatedAt : max),
        new Date(0),
      );

      // Extrato: última circular com DAS informado.
      const circular = await prisma.companyMonthlyCircular.findFirst({
        where: { portalClientId, dasTotal: { not: null } },
        orderBy: { competencia: "desc" },
        select: {
          competencia: true,
          dasTotal: true,
          inssTotal: true,
          receitaBruta: true,
          receitaServicos: true,
          receitaVendas: true,
        },
      });

      // NÃO-VERIFICADO: qual campo representa o "faturamento do extrato" para a base
      // da alíquota (receitaBruta vs receitaServicos+receitaVendas). Confirmar com o dono.
      const extrato = circular
        ? {
            competencia: circular.competencia,
            das: Number(circular.dasTotal || 0),
            inss: Number(circular.inssTotal || 0),
            faturamento:
              circular.receitaBruta != null
                ? Number(circular.receitaBruta)
                : Number(circular.receitaServicos || 0) + Number(circular.receitaVendas || 0),
          }
        : null;

      const ultimoDiaMes = new Date(lt.getTime() - 24 * 60 * 60 * 1000);

      return res.json({
        faturamento: {
          valor: faturamentoValor,
          periodo: { inicio: toIsoDate(gte), fim: toIsoDate(ultimoDiaMes) },
          atualizadoEm: (atualizadoEm.getTime() === 0 ? new Date() : atualizadoEm).toISOString(),
        },
        extrato,
      });
    } catch (err) {
      log.error({ err: err.message, portalClientId }, "internal dashboard falhou");
      return res.status(500).json({ error: "internal_error" });
    }
  });

  return router;
}
