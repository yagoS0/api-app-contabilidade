jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {
  chartOfAccount: { findMany: jest.fn() }, guide: { findFirst: jest.fn() },
} }));
import { prisma } from "../../../infrastructure/db/prisma.js";
import { resolvePayrollTemplate } from "../payrollTemplate.js";

test.each(["PROLABORE", "FOLHA"])("%s não transforma total atualizado da guia consolidada em retenção", async (kind) => {
  prisma.chartOfAccount.findMany.mockResolvedValue([]);
  prisma.guide.findFirst.mockResolvedValue({ id: "g", valor: 1100, paymentStatus: "PAID" });
  const r = await resolvePayrollTemplate({ portalClientId: "a", kind, competencia: "2026-08" });
  expect(r.inssGuide.valor).toBe(1100);
  expect(r.valorRetencaoInss).toBeNull();
  expect(r.lines.find((l) => l.role === "inss").value).toBe(0);
  expect(prisma.guide.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ portalClientId: "a", competencia: "2026-08" }) }));
});
