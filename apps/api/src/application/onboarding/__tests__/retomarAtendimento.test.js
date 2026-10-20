jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
import { retomarAtendimento, statusAntesDaDesistencia } from "../OnboardingService.js";

const user = { id: "contador", role: "contador", accountType: "FIRM" };
function fixture(extra = {}) {
  let registro = { id: "o", status: "DESISTIU", versao: 4, motivoDesistencia: "Anterior", ...extra };
  const eventos = [];
  const caso = { id: "a", encerradoEm: "2026-01-01", triagem: { preservado: true } };
  const tx = {
    $queryRaw: jest.fn(async () => []),
    onboarding: {
      findUnique: jest.fn(async () => registro),
      update: jest.fn(async ({ data }) => {
        eventos.unshift({ ...data.eventos.create });
        registro = { ...registro, ...data, versao: registro.versao + 1 };
        return registro;
      }),
    },
    onboardingEvento: { findMany: jest.fn(async () => eventos) },
    onboardingLink: { updateMany: jest.fn(async () => ({ count: 2 })) },
    atendimentoLead: { findMany: jest.fn(async () => [caso]), update: jest.fn(async () => caso) },
    trabalhoFiscalLead: { updateMany: jest.fn(async () => ({ count: 0 })) },
  };
  const db = { $transaction: jest.fn(fn => fn(tx)) };
  return { db, tx, eventos };
}
test.each([
  [{}, [{ tipo: "ETAPA_ATUALIZADA", dados: { concluidaEm: "2026-01-01" } }], "RASCUNHO"],
  [{ enviadoEm: "2026-01-01" }, [], "RECEBIDO"],
  [{}, [{ tipo: "DESISTIU", dados: { statusAnterior: "EM_TRILHA" } }], "EM_TRILHA"],
])("restauração não inventa marco comercial", (registro, eventos, esperado) => {
  expect(statusAntesDaDesistencia(registro, eventos)).toBe(esperado);
});
test("retoma legado, revoga links e bloqueia somente casos vinculados, preservando atendimento encerrado", async () => {
  const { db, tx, eventos } = fixture();
  const r = await retomarAtendimento("o", { user, motivo: "Continuar a ficha", versao: 4 }, db);
  expect(r).toMatchObject({ status: "RASCUNHO", versao: 5 });
  expect(eventos[0].dados).toMatchObject({ restauracao: "RASCUNHO_CONSERVADOR", desistenciaAnterior: { motivo: "Anterior" } });
  expect(tx.onboardingLink.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { onboardingId: "o", revokedAt: null } }));
  expect(tx.atendimentoLead.update.mock.calls[0][0].data).toEqual({
    versao: { increment: 1 }, triagem: { preservado: true, retomadaManual: expect.objectContaining({ bloqueiaAutomacao: true }) },
  });
  await retomarAtendimento("o", { user, motivo: "Continuar a ficha", versao: 4 }, db);
  expect(tx.onboarding.update).toHaveBeenCalledTimes(1);
  expect(tx.onboardingLink.updateMany).toHaveBeenCalledTimes(1);
});
test.each([
  [{ user: { ...user, role: "funcionario" }, motivo: "Continuar", versao: 4 }, 403],
  [{ user, motivo: "", versao: 4 }, 400],
  [{ user, motivo: "Continuar", versao: 3 }, 409],
])("recusa papel, motivo ou versão inválidos sem escrita", async (args, status) => {
  const { db, tx } = fixture();
  await expect(retomarAtendimento("o", args, db)).rejects.toMatchObject({ status });
  expect(tx.onboarding.update).not.toHaveBeenCalled();
});
test("erro de revogação impede a mudança de status", async () => {
  const { db, tx } = fixture();
  tx.onboardingLink.updateMany.mockRejectedValue(new Error("banco"));
  await expect(retomarAtendimento("o", { user, motivo: "Continuar", versao: 4 }, db)).rejects.toThrow("banco");
  expect(tx.onboarding.update).not.toHaveBeenCalled();
});
