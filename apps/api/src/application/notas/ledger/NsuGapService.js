// Robustez NFS-e/ADN — Fase 1: detecção/resolução de lacunas de NSU.
// Gap = NSU esperado na sequência que não veio no lote. É a defesa direta contra o "28 vs 27":
// gap aberto sinaliza nota possivelmente perdida (a resolver por consulta pontual; se persistir,
// bloqueia o fechamento da competência — regra da Camada 2, fora desta fase).

import { prisma } from "../../../infrastructure/db/prisma.js";

// Detecta lacunas entre o último NSU processado e os NSUs recebidos neste lote.
// Ex.: nsuAnterior=1047, recebidos=[1048,1050] → grava gap 1049 (aberto). Idempotente.
export async function detectarGaps({ portalClientId, fonte, nsusRecebidos, nsuAnterior }, tx = prisma) {
  if (!portalClientId || !fonte) {
    const e = new Error("portalClientId e fonte são obrigatórios"); e.code = "INVALID_INPUT"; throw e;
  }
  const recebidos = [...new Set((nsusRecebidos || []).map((n) => BigInt(n)))]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!recebidos.length) return { gaps: [] };

  const faltantes = [];
  let esperado = nsuAnterior != null ? BigInt(nsuAnterior) + 1n : recebidos[0];
  for (const nsu of recebidos) {
    while (esperado < nsu) { faltantes.push(esperado); esperado += 1n; }
    esperado = nsu + 1n;
  }

  const gaps = [];
  for (const nsuFaltante of faltantes) {
    // idempotente por (portalClientId, fonte, nsuFaltante)
    // eslint-disable-next-line no-await-in-loop
    const row = await tx.nsuGap.upsert({
      where: { portalClientId_fonte_nsuFaltante: { portalClientId, fonte, nsuFaltante } },
      update: {},
      create: { portalClientId, fonte, nsuFaltante, status: "aberto" },
    });
    gaps.push(row);
  }
  return { gaps };
}

// Marca um gap como resolvido (documento veio na consulta pontual) ou inexistente (NSU não é nosso).
export async function resolverGap({ portalClientId, fonte, nsuFaltante, status = "resolvido" }, tx = prisma) {
  return tx.nsuGap.update({
    where: { portalClientId_fonte_nsuFaltante: { portalClientId, fonte, nsuFaltante: BigInt(nsuFaltante) } },
    data: { status },
  });
}

// Incrementa tentativas de resolução de um gap (chamado quando a consulta pontual falha).
export async function registrarTentativaGap({ portalClientId, fonte, nsuFaltante }, tx = prisma) {
  return tx.nsuGap.update({
    where: { portalClientId_fonte_nsuFaltante: { portalClientId, fonte, nsuFaltante: BigInt(nsuFaltante) } },
    data: { tentativas: { increment: 1 } },
  });
}
