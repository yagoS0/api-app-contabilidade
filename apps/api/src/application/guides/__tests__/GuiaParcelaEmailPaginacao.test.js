jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { guide: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() } } }));
jest.mock("../GuideLockService.js", () => ({ tryAcquireGuideLock: jest.fn(async () => true), releaseGuideLock: jest.fn() }));
jest.mock("../GuideService.js", () => ({ getGuidePdfBuffer: jest.fn() }));
jest.mock("../../../infrastructure/mail/EmailService.js", () => ({ EmailService: jest.fn() }));
jest.mock("../GuideScheduledEmailService.js", () => ({ SEM_DESTINATARIO_DE_GUIA: { codigo: "SEM_EMAIL", motivo: "Sem e-mail" }, resolveCompanyNotificationEmails: jest.fn(async () => []), validarDestinatariosAtuais: jest.fn() }));
import { prisma } from "../../../infrastructure/db/prisma.js";
import { runGuideEmailWorkerOnce } from "../../../workers/guideEmailWorker.js";
test("página inteira bloqueada não impede processar as demais guias", async () => {
  const bloqueadas = ["a", "b"].map(id => ({ id, parcelamentoId: "p", extracted: { conferenciaDocumentoPendente: true } }));
  prisma.guide.findMany.mockResolvedValueOnce(bloqueadas).mockResolvedValueOnce([{ id: "das", portalClientId: "c" }]);
  const resultado = await runGuideEmailWorkerOnce({ batchSize: 2 });
  expect(resultado.results.map(r => r.guideId)).toEqual(["a", "b", "das"]);
  expect(prisma.guide.findMany.mock.calls[1][0].where.id.notIn).toEqual(["a", "b"]);
  expect(prisma.guide.update).not.toHaveBeenCalled();
});
