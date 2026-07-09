// Monta os dados do dashboard do app (faturamento do mês corrente + extrato do Simples)
// para uma empresa. SOMENTE LEITURA — reusa a definição de `receitaMes` (notas EMIT
// autorizadas da competência) e o snapshot `CompanyMonthlyCircular` (DAS/INSS/receita).
//
// A alíquota efetiva NÃO é calculada aqui: devolve os componentes crus; o BFF aplica
// (DAS - INSS) / faturamento conforme o contrato do app.

import { prisma } from "../../infrastructure/db/prisma.js";

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

/**
 * @param {Object} opts
 * @param {string} opts.portalClientId
 * @returns {Promise<{faturamento:{valor:number,periodo:{inicio:string,fim:string},atualizadoEm:string}, extrato:{competencia:string,das:number,inss:number,faturamento:number}|null}>}
 */
export async function buildCompanyDashboard({ portalClientId }) {
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

  // NÃO-VERIFICADO: qual campo é o "faturamento do extrato" p/ base da alíquota
  // (receitaBruta vs receitaServicos+receitaVendas). Confirmar com o dono.
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

  return {
    faturamento: {
      valor: faturamentoValor,
      periodo: { inicio: toIsoDate(gte), fim: toIsoDate(ultimoDiaMes) },
      atualizadoEm: (atualizadoEm.getTime() === 0 ? new Date() : atualizadoEm).toISOString(),
    },
    extrato,
  };
}
