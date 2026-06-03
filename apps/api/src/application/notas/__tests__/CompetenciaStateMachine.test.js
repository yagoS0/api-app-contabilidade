// Q12.A.2: testes da máquina de estados da competência.
// Foco: validação das transições, criação on-demand, regras de reabertura.

jest.mock("../../../infrastructure/db/prisma.js", () => {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    companyMonthlyCircular: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    fiscalExecutionLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (fn) => fn(tx)),
  };
  // expor tx pros testes via prop não-enumerable
  Object.defineProperty(prisma, "__tx", { value: tx, enumerable: false });
  return { prisma };
});

import { prisma } from "../../../infrastructure/db/prisma.js";
import {
  ESTADOS,
  transitionState,
  fecharCompetencia,
  reabrirCompetencia,
  iniciarConferencia,
  marcarCalculado,
  marcarRevisado,
  ensureCompetencia,
} from "../CompetenciaStateMachine.js";

const tx = prisma.__tx;
const baseRow = { id: "comp-1", portalClientId: "pc-1", competencia: "2026-05", estado: ESTADOS.ABERTO };

beforeEach(() => {
  jest.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([]);
  tx.fiscalExecutionLog.create.mockResolvedValue({});
});

describe("ensureCompetencia", () => {
  it("retorna existente quando achar", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue(baseRow);
    const out = await ensureCompetencia({ portalClientId: "pc-1", competencia: "2026-05" });
    expect(out).toEqual(baseRow);
    expect(tx.companyMonthlyCircular.create).not.toHaveBeenCalled();
  });

  it("cria com estado=aberto quando não existir", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue(null);
    tx.companyMonthlyCircular.create.mockResolvedValue({ ...baseRow, id: "new" });
    await ensureCompetencia({ portalClientId: "pc-1", competencia: "2026-05" });
    expect(tx.companyMonthlyCircular.create).toHaveBeenCalledWith({
      data: { portalClientId: "pc-1", competencia: "2026-05", estado: ESTADOS.ABERTO },
    });
  });
});

describe("transitionState", () => {
  it("rejeita transição inválida (aberto → transmitido)", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue({ ...baseRow, estado: ESTADOS.ABERTO });
    await expect(
      transitionState({
        portalClientId: "pc-1", competencia: "2026-05",
        toState: ESTADOS.TRANSMITIDO,
      })
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION", currentState: ESTADOS.ABERTO });
    expect(tx.companyMonthlyCircular.update).not.toHaveBeenCalled();
  });

  it("rejeita transição quando fromStates não bate", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue({ ...baseRow, estado: ESTADOS.FECHADO });
    await expect(
      transitionState({
        portalClientId: "pc-1", competencia: "2026-05",
        fromStates: [ESTADOS.ABERTO],
        toState: ESTADOS.EM_CONFERENCIA,
      })
    ).rejects.toMatchObject({ code: "INVALID_FROM_STATE", currentState: ESTADOS.FECHADO });
  });

  it("aceita transição válida e grava timestamps no fechar", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue({ ...baseRow, estado: ESTADOS.EM_CONFERENCIA });
    tx.companyMonthlyCircular.update.mockResolvedValue({ ...baseRow, estado: ESTADOS.FECHADO });
    await transitionState({
      portalClientId: "pc-1", competencia: "2026-05",
      fromStates: [ESTADOS.EM_CONFERENCIA],
      toState: ESTADOS.FECHADO,
      userId: "u1",
    });
    const data = tx.companyMonthlyCircular.update.mock.calls[0][0].data;
    expect(data.estado).toBe(ESTADOS.FECHADO);
    expect(data.lockedAt).toBeInstanceOf(Date);
    expect(data.lockedByUserId).toBe("u1");
  });

  it("grava timestamps de reabertura ao voltar pra em_conferencia", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue({ ...baseRow, estado: ESTADOS.FECHADO });
    tx.companyMonthlyCircular.update.mockResolvedValue({ ...baseRow, estado: ESTADOS.EM_CONFERENCIA });
    await transitionState({
      portalClientId: "pc-1", competencia: "2026-05",
      toState: ESTADOS.EM_CONFERENCIA,
      userId: "u2",
      reason: "nota retroativa",
    });
    const data = tx.companyMonthlyCircular.update.mock.calls[0][0].data;
    expect(data.reopenedAt).toBeInstanceOf(Date);
    expect(data.reopenedByUserId).toBe("u2");
    expect(data.reopenedReason).toBe("nota retroativa");
  });

  it("cria competência on-the-fly se não existir e segue a transição", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue(null);
    tx.companyMonthlyCircular.create.mockResolvedValue({ ...baseRow, estado: ESTADOS.ABERTO });
    tx.companyMonthlyCircular.update.mockResolvedValue({ ...baseRow, estado: ESTADOS.EM_CONFERENCIA });
    await transitionState({
      portalClientId: "pc-1", competencia: "2026-05",
      toState: ESTADOS.EM_CONFERENCIA,
    });
    expect(tx.companyMonthlyCircular.create).toHaveBeenCalled();
    expect(tx.companyMonthlyCircular.update).toHaveBeenCalled();
  });

  it("audita no FiscalExecutionLog (best-effort)", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue({ ...baseRow, estado: ESTADOS.EM_CONFERENCIA });
    tx.companyMonthlyCircular.update.mockResolvedValue({ ...baseRow, estado: ESTADOS.FECHADO });
    await fecharCompetencia({ portalClientId: "pc-1", competencia: "2026-05", userId: "u1" });
    expect(tx.fiscalExecutionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "competencia_fechado",
          triggeredBy: "u1",
        }),
      })
    );
  });
});

describe("Helpers semânticos", () => {
  it("iniciarConferencia exige estado=aberto", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue({ ...baseRow, estado: ESTADOS.FECHADO });
    await expect(iniciarConferencia({ portalClientId: "pc-1", competencia: "2026-05" }))
      .rejects.toMatchObject({ code: "INVALID_FROM_STATE" });
  });

  it("reabrirCompetencia exige reason", async () => {
    await expect(
      reabrirCompetencia({ portalClientId: "pc-1", competencia: "2026-05", reason: "" })
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(
      reabrirCompetencia({ portalClientId: "pc-1", competencia: "2026-05", reason: "   " })
    ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("reabrirCompetencia funciona a partir de fechado/calculado/revisado/transmitido/confirmado", async () => {
    for (const from of [ESTADOS.FECHADO, ESTADOS.CALCULADO, ESTADOS.REVISADO, ESTADOS.TRANSMITIDO, ESTADOS.CONFIRMADO]) {
      tx.companyMonthlyCircular.findFirst.mockResolvedValue({ ...baseRow, estado: from });
      tx.companyMonthlyCircular.update.mockResolvedValue({ ...baseRow, estado: ESTADOS.EM_CONFERENCIA });
      await expect(
        reabrirCompetencia({ portalClientId: "pc-1", competencia: "2026-05", reason: "motivo" })
      ).resolves.toBeDefined();
    }
  });

  it("marcarCalculado grava rb12 e fatorR", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue({ ...baseRow, estado: ESTADOS.FECHADO });
    tx.companyMonthlyCircular.update.mockResolvedValue({ ...baseRow, estado: ESTADOS.CALCULADO });
    await marcarCalculado({
      portalClientId: "pc-1", competencia: "2026-05",
      rb12: 100000, fatorR: 0.28,
    });
    const data = tx.companyMonthlyCircular.update.mock.calls[0][0].data;
    expect(data.rb12).toBe(100000);
    expect(data.fatorR).toBe(0.28);
  });

  it("marcarRevisado grava fs12Manual + fs12Origem default", async () => {
    tx.companyMonthlyCircular.findFirst.mockResolvedValue({ ...baseRow, estado: ESTADOS.CALCULADO });
    tx.companyMonthlyCircular.update.mockResolvedValue({ ...baseRow, estado: ESTADOS.REVISADO });
    await marcarRevisado({
      portalClientId: "pc-1", competencia: "2026-05",
      fs12Manual: 30000,
    });
    const data = tx.companyMonthlyCircular.update.mock.calls[0][0].data;
    expect(data.fs12Manual).toBe(30000);
    expect(data.fs12Origem).toBe("MANUAL");
  });
});
