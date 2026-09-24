import { prisma } from "../../../infrastructure/db/prisma.js";
import { enviosPorGuia, foiEnviadaComLegado } from "../../guides/EnvioGuiaService.js";
import { projetarPendenciasParcelamento, mesAtualOperacional } from "./pendenciasParcelamento.js";
import { resolverPagamentoGuia, resumirBaixas } from "../pagamentoGuiaEfetivo.js";
import { reprocessarSitfisParcelamentos } from "../../fiscal/serpro/ParcelamentoDescobertaService.js";

const GUIA = { id: true, numeroParcela: true, competencia: true, anoMesParcela: true, storageKey: true,
  status: true, paymentStatus: true, baixada: true, vencimento: true, valor: true, extracted: true,
  emailStatus: true, emailSentAt: true, portalClientId: true };

export async function listarPendenciasParcelamento({ portalClientIds, mesOperacional = mesAtualOperacional() }) {
  projetarPendenciasParcelamento({ mesOperacional }); // Valida antes de ler/gravar o relatório salvo.
  const ids = [...new Set((portalClientIds || []).filter(Boolean))];
  if (!ids.length) return projetarPendenciasParcelamento({ mesOperacional });
  // Aproveita o relatório já salvo, sem consulta fiscal externa.
  for (const portalClientId of ids) await reprocessarSitfisParcelamentos({ portalClientId });
  const [contratos, indicacoes] = await Promise.all([
    prisma.parcelamento.findMany({ where: { portalClientId: { in: ids }, status: { not: "EXCLUIDO" } }, include: {
      parcelasContratadas: { include: { guia: { select: GUIA } } }, guides: { where: { parcela: null }, select: GUIA },
      parcelas: { where: { tipo: { in: ["BAIXA", "ESTORNO"] } }, include: { lines: true } },
    } }),
    prisma.parcelamentoIndicacao.findMany({ where: { portalClientId: { in: ids }, status: "PENDENTE" } }),
  ]);
  const normalizados = contratos.map(c => ({ ...c, parcelas: [
    ...(c.parcelasContratadas || []),
    ...(c.guides || []).map(g => ({ id: `guia:${g.id}`, numeroParcela: g.numeroParcela,
      competencia: g.competencia, anoMesParcela: g.anoMesParcela, guiaId: g.id, guia: g })),
  ].map(p => ({ ...p, valorEfetivoPago: p.guia
    ? resolverPagamentoGuia({ guia: p.guia, baixas: c.parcelas || [], portalClientId: c.portalClientId })?.total
    : resumirBaixas((c.parcelas || []).filter(e => e.numeroParcela === p.numeroParcela))?.total })) }));
  const guiaIds = normalizados.flatMap(c => c.parcelas.map(p => p.guiaId).filter(Boolean));
  const [envios, documentos] = await Promise.all([enviosPorGuia(guiaIds),
    guiaIds.length ? prisma.guide.findMany({ where: { id: { in: guiaIds }, OR: [{ pdfBytes: { not: null } }, { storageKey: { not: null } }] }, select: { id: true } }) : [],
  ]);
  const pdfs = new Set(documentos.map(d => d.id));
  for (const c of normalizados) for (const p of c.parcelas) if (p.guia) p.guia.pdfDisponivel = pdfs.has(p.guia.id);
  return projetarPendenciasParcelamento({ contratos: normalizados, indicacoes, mesOperacional,
    enviada: g => foiEnviadaComLegado(envios.get(g.id) || [], g) });
}
