jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { guide: { findMany: jest.fn() } } }));
jest.mock("../EnvioGuiaService.js", () => ({ enviosPorGuia: jest.fn(), foiEnviadaComLegado: jest.fn() }));
import { prisma } from "../../../infrastructure/db/prisma.js";
import { enviosPorGuia, foiEnviadaComLegado } from "../EnvioGuiaService.js";
import { conferirGuiasVencimento } from "../GuideDueBatchService.js";
import { assinaturaGuias } from "../loteVencimento.js";
const guia = { id: "g", portalClientId: "c", competencia: "2026-08", valor: 100, vencimento: new Date("2026-09-20Z"), status: "PROCESSED", paymentStatus: "OPEN" };
const input = { portalClientIds: ["c"], mesVencimento: "2026-09", guideIds: ["g"], assinatura: assinaturaGuias([guia]) };
beforeEach(() => { jest.clearAllMocks(); prisma.guide.findMany.mockResolvedValue([guia]); enviosPorGuia.mockResolvedValue(new Map()); foiEnviadaComLegado.mockReturnValue(false); });

test("revalida período, empresa, pagamento e seleção exata no banco", async () => {
  await expect(conferirGuiasVencimento(input)).resolves.toMatchObject({ assinatura: input.assinatura });
  expect(prisma.guide.findMany.mock.calls[0][0].where).toMatchObject({ id: { in: ["g"] }, portalClientId: { in: ["c"] },
    status: "PROCESSED", vencimento: { gte: new Date("2026-09-01Z"), lt: new Date("2026-10-01Z") },
    AND: [{ OR: [{ paymentStatus: null }, { paymentStatus: { not: "PAID" } }] }, expect.anything()] });
});
test.each([[], null, ["g", "g"]])("seleção vazia ou duplicada nunca amplia o lote: %j", async (guideIds) => {
  await expect(conferirGuiasVencimento({ ...input, guideIds })).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
  expect(prisma.guide.findMany).not.toHaveBeenCalled();
});
test("documento removido ou fora do escopo interrompe o envio", async () => {
  prisma.guide.findMany.mockResolvedValue([]);
  await expect(conferirGuiasVencimento(input)).rejects.toMatchObject({ status: 409 });
});
test("envio por outro canal após a prévia interrompe o envio", async () => {
  foiEnviadaComLegado.mockReturnValue(true);
  await expect(conferirGuiasVencimento(input)).rejects.toMatchObject({ status: 409 });
});
test("mesma quantidade de documentos, mas valor alterado, exige conferência nova", async () => {
  prisma.guide.findMany.mockResolvedValue([{ ...guia, valor: 826.66 }]);
  await expect(conferirGuiasVencimento(input)).rejects.toMatchObject({ status: 409 });
});
