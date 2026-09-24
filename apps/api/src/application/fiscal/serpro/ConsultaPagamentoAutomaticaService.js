import { prisma } from "../../../infrastructure/db/prisma.js";

const chaves = ({ guideId, parcelaId }) => [guideId && `pagamento_auto_negativo:guia:${guideId}`, parcelaId && `pagamento_auto_negativo:parcela:${parcelaId}`].filter(Boolean);

export function elegibilidadeVencimentoAutomatico(vencimento, now = new Date()) {
  if (!vencimento || !Number.isFinite(new Date(vencimento).getTime())) return "sem_vencimento_confirmado";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const hoje = ["year", "month", "day"].map(t => parts.find(p => p.type === t).value).join("-");
  return new Date(vencimento).toISOString().slice(0, 10) < hoje ? null : "ainda_nao_vencida";
}

export async function consultaAutomaticaEncerrada(input, db = prisma) {
  if (!input.scheduledAt) return false;
  for (const key of chaves(input)) if (await db.appSetting.findUnique({ where: { key } })) return true;
  return false;
}

// Uma negativa concluída transfere a conferência ao contador. Trocar o PDF não reabre a rotina.
export async function registrarNegativaAutomatica(input, db = prisma) {
  if (!input.scheduledAt) return;
  for (const key of chaves(input)) await db.appSetting.upsert({ where: { key }, update: {},
    create: { key, value: { status: "CONFERENCIA_MANUAL", scheduledAt: input.scheduledAt,
      guideId: input.guideId || null, parcelaId: input.parcelaId || null, registradaEm: new Date().toISOString() } } });
}
