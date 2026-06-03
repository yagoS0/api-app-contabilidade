// Q12.A.2: máquina de estados por (empresa, competência).
//
// Estados (CompanyMonthlyCircular.estado):
//   aberto → em_conferencia → fechado → calculado → revisado → transmitido → confirmado
//   qualquer estado → erro (retry)
//   fechado/calculado/revisado/transmitido/confirmado → em_conferencia (reabertura explícita)
//
// Regras:
// - SELECT FOR UPDATE pra evitar race entre captura concorrente e fechamento do contador.
// - Cada transição registra timestamps (lockedAt/reopenedAt) e o userId responsável.
// - Audit trail no FiscalExecutionLog (action = "competencia_<verb>") pra reusar a UI de histórico.
// - Reabertura volta SEMPRE pra em_conferencia (não pra aberto) — o conteúdo já foi montado.

import { prisma } from "../../infrastructure/db/prisma.js";

export const ESTADOS = Object.freeze({
  ABERTO: "aberto",
  EM_CONFERENCIA: "em_conferencia",
  FECHADO: "fechado",
  CALCULADO: "calculado",
  REVISADO: "revisado",
  TRANSMITIDO: "transmitido",
  CONFIRMADO: "confirmado",
  ERRO: "erro",
});

// Transições válidas. Bloqueio rígido — se não está aqui, rejeita.
const TRANSITIONS = {
  aberto: ["em_conferencia", "erro"],
  em_conferencia: ["fechado", "aberto", "erro"],
  fechado: ["calculado", "em_conferencia", "erro"],
  calculado: ["revisado", "em_conferencia", "erro"],
  revisado: ["transmitido", "em_conferencia", "erro"],
  transmitido: ["confirmado", "erro", "em_conferencia"],
  confirmado: ["em_conferencia"], // só por reabertura explícita
  erro: ["em_conferencia", "revisado"], // retry depois de corrigir
};

function isValidTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  return allowed.includes(to);
}

// Carrega a competência com SELECT FOR UPDATE.
// Como o schema usa (portalClientId, competencia) sem unique index, usamos findFirst.
async function lockCompetencia(tx, { portalClientId, competencia }) {
  // Prisma não expõe FOR UPDATE direto; usamos $queryRaw como trava real.
  await tx.$queryRaw`SELECT id FROM "company_monthly_circulars"
    WHERE "portalClientId" = ${portalClientId} AND competencia = ${competencia}
    FOR UPDATE`;
  return tx.companyMonthlyCircular.findFirst({
    where: { portalClientId, competencia },
  });
}

async function logTransition(tx, { portalClientId, competencia, fromState, toState, userId, reason, extra }) {
  // Reusa FiscalExecutionLog (action prefixada com "competencia_") em vez de tabela nova.
  // Status já indica resultado; skipReason carrega o motivo (útil pra reabertura).
  await tx.fiscalExecutionLog.create({
    data: {
      portalClientId,
      competencia,
      action: `competencia_${toState}`,
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      durationMs: 0,
      triggeredBy: userId || null,
      skipReason: reason || null,
      errorMessage: extra?.errorMessage || null,
    },
  }).catch(() => null); // best-effort — audit não bloqueia transição
}

/**
 * Garante que a competência existe (cria com estado=aberto se for o 1º acesso).
 * Idempotente.
 */
export async function ensureCompetencia({ portalClientId, competencia, tx = prisma }) {
  const existing = await tx.companyMonthlyCircular.findFirst({
    where: { portalClientId, competencia },
  });
  if (existing) return existing;
  return tx.companyMonthlyCircular.create({
    data: { portalClientId, competencia, estado: ESTADOS.ABERTO },
  });
}

/**
 * Transição genérica. Validações:
 *  - competência existe
 *  - estado atual ∈ fromStates (se passado)
 *  - transição (atual → toState) é permitida
 *
 * `extra` permite gravar campos adicionais (ex: fs12Manual, fatorR, rb12).
 */
export async function transitionState({
  portalClientId,
  competencia,
  fromStates = null, // se null, aceita qualquer estado origem
  toState,
  userId = null,
  reason = null,
  extra = {},
}) {
  if (!ESTADOS[toState.toUpperCase()] && !Object.values(ESTADOS).includes(toState)) {
    const err = new Error(`Invalid target state: ${toState}`);
    err.code = "INVALID_STATE";
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    let row = await lockCompetencia(tx, { portalClientId, competencia });
    if (!row) {
      // 1º acesso — cria como aberto e segue. Útil pra fechar competência que nunca foi tocada.
      row = await tx.companyMonthlyCircular.create({
        data: { portalClientId, competencia, estado: ESTADOS.ABERTO },
      });
    }

    if (fromStates && !fromStates.includes(row.estado)) {
      const err = new Error(`Competência está em "${row.estado}", esperado um de [${fromStates.join(", ")}]`);
      err.code = "INVALID_FROM_STATE";
      err.currentState = row.estado;
      throw err;
    }

    if (!isValidTransition(row.estado, toState)) {
      const err = new Error(`Transição não permitida: ${row.estado} → ${toState}`);
      err.code = "INVALID_TRANSITION";
      err.currentState = row.estado;
      throw err;
    }

    const data = { estado: toState, ...extra };
    // Timestamps automáticos por destino
    if (toState === ESTADOS.FECHADO) {
      data.lockedAt = new Date();
      data.lockedByUserId = userId;
    }
    if (toState === ESTADOS.EM_CONFERENCIA && [ESTADOS.FECHADO, ESTADOS.CALCULADO, ESTADOS.REVISADO, ESTADOS.TRANSMITIDO, ESTADOS.CONFIRMADO].includes(row.estado)) {
      data.reopenedAt = new Date();
      data.reopenedByUserId = userId;
      data.reopenedReason = reason || null;
    }

    const updated = await tx.companyMonthlyCircular.update({
      where: { id: row.id },
      data,
    });

    await logTransition(tx, {
      portalClientId, competencia,
      fromState: row.estado, toState,
      userId, reason, extra,
    });

    return updated;
  });
}

// ─── Helpers semânticos (uso preferido pelos endpoints/serviços) ─────────────

export async function iniciarConferencia({ portalClientId, competencia, userId }) {
  return transitionState({
    portalClientId, competencia,
    fromStates: [ESTADOS.ABERTO],
    toState: ESTADOS.EM_CONFERENCIA,
    userId,
  });
}

export async function fecharCompetencia({ portalClientId, competencia, userId }) {
  return transitionState({
    portalClientId, competencia,
    fromStates: [ESTADOS.EM_CONFERENCIA],
    toState: ESTADOS.FECHADO,
    userId,
  });
}

export async function reabrirCompetencia({ portalClientId, competencia, userId, reason }) {
  if (!reason || !String(reason).trim()) {
    const err = new Error("Motivo da reabertura é obrigatório");
    err.code = "REASON_REQUIRED";
    throw err;
  }
  return transitionState({
    portalClientId, competencia,
    fromStates: [ESTADOS.FECHADO, ESTADOS.CALCULADO, ESTADOS.REVISADO, ESTADOS.TRANSMITIDO, ESTADOS.CONFIRMADO, ESTADOS.ERRO],
    toState: ESTADOS.EM_CONFERENCIA,
    userId, reason,
  });
}

export async function marcarCalculado({ portalClientId, competencia, userId, rb12, fatorR }) {
  return transitionState({
    portalClientId, competencia,
    fromStates: [ESTADOS.FECHADO],
    toState: ESTADOS.CALCULADO,
    userId,
    extra: {
      ...(rb12 != null ? { rb12 } : {}),
      ...(fatorR != null ? { fatorR } : {}),
    },
  });
}

export async function marcarRevisado({ portalClientId, competencia, userId, fs12Manual, fs12Origem }) {
  return transitionState({
    portalClientId, competencia,
    fromStates: [ESTADOS.CALCULADO],
    toState: ESTADOS.REVISADO,
    userId,
    extra: {
      ...(fs12Manual != null ? { fs12Manual, fs12Origem: fs12Origem || "MANUAL" } : {}),
    },
  });
}

export async function marcarTransmitido({ portalClientId, competencia, userId }) {
  return transitionState({
    portalClientId, competencia,
    fromStates: [ESTADOS.REVISADO],
    toState: ESTADOS.TRANSMITIDO,
    userId,
  });
}

export async function marcarConfirmado({ portalClientId, competencia, userId }) {
  return transitionState({
    portalClientId, competencia,
    fromStates: [ESTADOS.TRANSMITIDO],
    toState: ESTADOS.CONFIRMADO,
    userId,
  });
}

export async function marcarErro({ portalClientId, competencia, userId, errorMessage }) {
  return transitionState({
    portalClientId, competencia,
    fromStates: null, // erro pode vir de qualquer estado
    toState: ESTADOS.ERRO,
    userId,
    extra: {},
    reason: errorMessage,
  });
}
