import { conferirParcelasParaEnvio, SELECT_PARCELA_ENVIO } from "./GuiaParcelaEnvioGuard.js";
import { prisma } from "../../infrastructure/db/prisma.js";
import { enviosPorGuia, foiEnviadaComLegado } from "./EnvioGuiaService.js";
import { montarRelatorioVencimento, periodoVencimento, assinaturaGuias, loteAlterado } from "./loteVencimento.js";
import { listarPendenciasParcelamento } from "../accounting/parcelamento/ParcelamentoAcompanhamentoService.js";

export async function relatorioPorVencimento({ companies, mesVencimento, competencia = "" }) {
  const periodo = periodoVencimento(mesVencimento);
  if (competencia) periodoVencimento(competencia);
  const portalClientId = { in: companies.map((c) => c.id) };
  const [guides, acompanhamento] = await Promise.all([
    prisma.guide.findMany({ where: { portalClientId, status: "PROCESSED", ...(competencia ? { competencia } : {}),
      OR: [{ vencimento: periodo }, { AND: [
        { OR: [{ vencimento: null }, { vencimento: { lt: periodo.gte } }] },
        { OR: [{ paymentStatus: null }, { paymentStatus: { not: "PAID" } }] },
      ] }] },
      select: { id: true, portalClientId: true, tipo: true, competencia: true, vencimento: true, valor: true,
        status: true, paymentStatus: true, emailStatus: true, emailSentAt: true, emailLastError: true,
        updatedAt: true, hash: true, ...SELECT_PARCELA_ENVIO, numeroParcela: true,
        parcelamento: { select: { numeroParcelamento: true, label: true, formaPagamento: true, status: true } } }, orderBy: { vencimento: "asc" } }),
    listarPendenciasParcelamento({ portalClientIds: companies.map(c => c.id), mesOperacional: mesVencimento }),
  ]);
  const envios = await enviosPorGuia(guides.map((g) => g.id));
  return { ...montarRelatorioVencimento({ companies, guides, parcelas: [], acompanhamento, mesVencimento,
    enviada: (g) => foiEnviadaComLegado(envios.get(g.id) || [], g) }), competenciaFiltro: competencia };
}

// Seleção explícita: [] nunca significa "todas". Revalida empresa, pagamento, período e envio.
export async function conferirGuiasVencimento({ portalClientIds, mesVencimento, guideIds, assinatura }) {
  const vencimento = periodoVencimento(mesVencimento);
  if (!Array.isArray(guideIds) || !guideIds.length || new Set(guideIds).size !== guideIds.length) throw loteAlterado();
  const guias = await prisma.guide.findMany({ where: { id: { in: guideIds },
    portalClientId: { in: portalClientIds }, vencimento, status: "PROCESSED",
    AND: [{ OR: [{ paymentStatus: null }, { paymentStatus: { not: "PAID" } }] },
      { OR: [{ emailStatus: null }, { emailStatus: { in: ["PENDING", "ERROR"] } }] }],
    }, select: { id: true, portalClientId: true, competencia: true, tipo: true, valor: true,
      vencimento: true, status: true, paymentStatus: true, emailStatus: true, emailSentAt: true,
      emailAttempts: true, hash: true, updatedAt: true, ...SELECT_PARCELA_ENVIO } });
  const envios = await enviosPorGuia(guias.map((g) => g.id));
  if (guias.length !== guideIds.length || guias.some((g) => foiEnviadaComLegado(envios.get(g.id) || [], g))) throw loteAlterado();
  await conferirParcelasParaEnvio(guias, { atualizar: false });
  const atual = assinaturaGuias(guias);
  if (assinatura != null && assinatura !== atual) throw loteAlterado();
  return { guias, assinatura: atual };
}
