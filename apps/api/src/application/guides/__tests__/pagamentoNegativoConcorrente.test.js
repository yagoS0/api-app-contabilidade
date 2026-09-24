jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { guide: { findUnique: jest.fn(), updateMany: jest.fn() } } }));
import { prisma } from "../../../infrastructure/db/prisma.js";
import { markGuideOpenBySerpro } from "../GuidePaymentStatusService.js";
test.each(["CLIENTE", "MANUAL"])("negativa concorrente não reabre confirmação %s nem apaga comprovante", async origem => {
  let guide = { id: "g", updatedAt: new Date("2026-09-20"), paymentStatus: "OPEN", extracted: { comprovante: { total: 100 } } };
  let calls = 0;
  prisma.guide.findUnique.mockImplementation(async () => ({ ...guide }));
  prisma.guide.updateMany.mockImplementation(async ({ where, data }) => {
    if (++calls === 1) {
      guide = { ...guide, updatedAt: new Date("2026-09-21"), paymentStatus: "PAID", paymentStatusSource: origem,
        ...(origem === "CLIENTE" ? { clienteConfirmouEm: new Date("2026-09-21") } : { baixada: true }) };
      return { count: 0 };
    }
    expect(where.updatedAt).toEqual(guide.updatedAt);
    expect(data).not.toHaveProperty("paymentStatus"); guide = { ...guide, ...data }; return { count: 1 };
  });
  expect(await markGuideOpenBySerpro({ guideId: "g", checkResult: "NAO_LOCALIZADO" })).toMatchObject({ paymentStatus: "PAID", paymentStatusSource: origem, extracted: { comprovante: { total: 100 } } });
});
