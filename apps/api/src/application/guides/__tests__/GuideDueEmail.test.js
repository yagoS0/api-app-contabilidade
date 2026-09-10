jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {
  portalClient: { findUnique: jest.fn() }, guide: { findMany: jest.fn(), updateMany: jest.fn() }, $transaction: jest.fn(),
} }));
jest.mock("../../../infrastructure/mail/EmailService.js", () => ({ EmailService: jest.fn() }));
jest.mock("../GuideService.js", () => ({ getGuidePdfBuffer: jest.fn(async () => Buffer.from("test-pdf")) }));
jest.mock("../GuideScheduledEmailService.js", () => ({ SEM_DESTINATARIO_DE_GUIA: { motivo: "Sem destinatário" },
  resolveCompanyNotificationEmails: jest.fn(async () => ["teste@example.com"]), validarDestinatariosAtuais: jest.fn() }));
jest.mock("../EnvioGuiaService.js", () => ({ enviosPorGuia: jest.fn(async () => new Map()), foiEnviadaComLegado: jest.fn(() => false) }));
import { prisma } from "../../../infrastructure/db/prisma.js";
import { EmailService } from "../../../infrastructure/mail/EmailService.js";
import { sendCompanyGuidesEmail } from "../GuideCompanyEmailService.js";
import { assinaturaGuias } from "../loteVencimento.js";
const guides = ["das", "parcela"].map((id, i) => ({ id, portalClientId: "c", tipo: "SIMPLES", competencia: i ? "2026-09" : "2026-08",
  vencimento: new Date("2026-09-20Z"), valor: 100, hash: id, paymentStatus: "OPEN", status: "PROCESSED", emailStatus: "PENDING", updatedAt: new Date("2026-09-01Z") }));
const input = { portalClientId: "c", mesVencimento: "2026-09", selectedGuideIds: ["das", "parcela"], assinatura: assinaturaGuias(guides) };
const send = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  prisma.portalClient.findUnique.mockResolvedValue({ id: "c", razao: "Cliente" });
  let reservaEm;
  prisma.guide.findMany.mockImplementation(async (query) => query.select?.updatedAt && !query.select?.portalClientId
    ? guides.map((g) => ({ ...g, updatedAt: reservaEm })) : guides);
  prisma.guide.updateMany.mockImplementation(async (query) => { if (query.data.emailStatus === "SENDING") reservaEm = query.data.updatedAt; return { count: 2 }; });
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  EmailService.mockImplementation(() => ({ send }));
});
test("anexa os dois PDFs em um e-mail por vencimento, preserva referência em cada nome", async () => {
  await expect(sendCompanyGuidesEmail(input)).resolves.toMatchObject({ sentNow: 2 });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toMatchObject({ to: "teste@example.com", subject: "Guias com vencimento em 2026-09",
    attachments: [{ filename: expect.stringContaining("2026-08") }, { filename: expect.stringContaining("2026-09") }] });
  expect(send.mock.calls[0][0].html).toContain("competência/referência 2026-08");
});
test("conferência alterada impede reserva e envio", async () => {
  await expect(sendCompanyGuidesEmail({ ...input, assinatura: "antiga" })).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
  expect(send).not.toHaveBeenCalled();
  expect(prisma.guide.updateMany).not.toHaveBeenCalled();
});
test("reserva concorrente incompleta interrompe o envio", async () => {
  prisma.guide.updateMany.mockResolvedValueOnce({ count: 1 });
  await expect(sendCompanyGuidesEmail(input)).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
  expect(send).not.toHaveBeenCalled();
});
test("pagamento confirmado enquanto monta os anexos impede o disparo", async () => {
  prisma.guide.findMany.mockResolvedValueOnce(guides).mockResolvedValueOnce(guides).mockResolvedValueOnce(guides.map((g) => ({ ...g, paymentStatus: "PAID" })));
  await expect(sendCompanyGuidesEmail(input)).rejects.toMatchObject({ code: "CONFERENCIA_DIVERGENTE" });
  expect(send).not.toHaveBeenCalled();
});
