import { Prisma } from '@prisma/client';
// Evidência informativa do recálculo explícito. Não altera o razão nem confirma pagamento.
const objeto = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : {};
const idVinculado = (e) => e.sourceGuideId || (e.eventType === "DAS_SIMPLES" ? null : e.sourceGuide?.id);
const moeda = (v) => v != null && Number.isFinite(Number(v)) ? Number(v) : null;

export function lerRegistroRecalculo(guide) {
  const r = objeto(guide?.extracted).recalculoGuia;
  if (!r || String(r.guiaId) !== String(guide?.id) || !r.recalculadoEm
    || !Number.isFinite(new Date(r.recalculadoEm).getTime())) return null;
  return {
    guiaId: String(guide.id), recalculadoEm: r.recalculadoEm,
    valorAnterior: moeda(r.valorAnterior), valorAtual: moeda(r.valorAtual),
    escopoValor: "TOTAL_GUIA", especie: r.especie || null,
  };
}

export async function registrarRecalculoGuia(client, { guiaAnterior, guiaId, especie, userId, agora = new Date() }) {
  if (!guiaAnterior?.portalClientId || !guiaId) throw new Error("recalculo_sem_vinculo_da_guia");
  for (let tentativa = 0; tentativa < 4; tentativa += 1) {
    const atual = await client.guide.findFirst({
      where: { id: String(guiaId), portalClientId: guiaAnterior.portalClientId, competencia: guiaAnterior.competencia, status: "PROCESSED" },
      select: { id: true, valor: true, extracted: true, updatedAt: true },
    });
    if (!atual) throw new Error("guia_recalculada_nao_encontrada");
    // Releitura pode incorporar um comprovante, mas não substituir outro recálculo
    // que terminou depois de começar esta operação. Preserve a evidência vencedora.
    const registrado = objeto(atual.extracted).recalculoGuia;
    if (registrado && JSON.stringify(registrado) !== JSON.stringify(objeto(guiaAnterior.extracted).recalculoGuia)) {
      throw Object.assign(new Error("Outro recálculo foi registrado. Confira a guia antes de continuar."), { code: "GUIA_ALTERADA", status: 409 });
    }
    const recalculoGuia = {
      guiaId: atual.id, recalculadoEm: agora.toISOString(),
      valorAnterior: moeda(guiaAnterior.valor), valorAtual: moeda(atual.valor),
      escopoValor: "TOTAL_GUIA", especie, solicitadoPor: userId || null,
    };
    const alterada = await client.guide.updateMany({ where: {
      id: atual.id, portalClientId: guiaAnterior.portalClientId,
      competencia: guiaAnterior.competencia, status: "PROCESSED", updatedAt: atual.updatedAt,
      valor: atual.valor,
      extracted: { equals: atual.extracted ?? Prisma.AnyNull },
    }, data: {
      extracted: { ...objeto(atual.extracted), recalculoGuia },
    } });
    if (alterada.count === 1) return lerRegistroRecalculo({ ...atual, extracted: { recalculoGuia } });
  }
  throw Object.assign(new Error("A guia mudou durante o registro do recálculo. Confira antes de continuar."), { code: "GUIA_ALTERADA", status: 409 });
}

// A ligação direta prevalece. DAS antigo sem sourceGuideId só é associado se houver uma
// única guia mensal dessa empresa; a mesma competência de outra empresa nunca participa.
export async function sinalizarRecalculosNosLancamentos(client, portalClientId, entries) {
  if (!entries.length) return entries;
  const ids = [...new Set(entries.map(idVinculado).filter(Boolean))];
  const competenciasDas = [...new Set(entries.filter((e) => !idVinculado(e) && e.eventType === "DAS_SIMPLES").map((e) => e.competencia).filter(Boolean))];
  if (!ids.length && !competenciasDas.length) return entries;
  const guias = await client.guide.findMany({
    where: { portalClientId, status: "PROCESSED", OR: [
      ...(ids.length ? [{ id: { in: ids } }] : []),
      ...(competenciasDas.length ? [{ tipo: "SIMPLES", parcelamentoId: null, competencia: { in: competenciasDas } }] : []),
    ] },
    select: { id: true, portalClientId: true, competencia: true, tipo: true, parcelamentoId: true, extracted: true },
  });
  const doEscopo = guias.filter((g) => g.portalClientId === portalClientId);
  const porId = new Map(doEscopo.map((g) => [g.id, g]));
  return entries.map((e) => {
    const id = idVinculado(e);
    const candidatas = !id && e.eventType === "DAS_SIMPLES"
      ? doEscopo.filter((g) => g.tipo === "SIMPLES" && !g.parcelamentoId && g.competencia === e.competencia) : [];
    const guia = id ? porId.get(id) : candidatas.length === 1 ? candidatas[0] : null;
    return { ...e, recalculoGuia: lerRegistroRecalculo(guia) };
  });
}
