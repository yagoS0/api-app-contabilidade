// Executa serviços, worker e rotas reais. Somente banco, PDF e transporte são substituídos.
jest.mock("../../../infrastructure/db/prisma.js", () => {
  const models = {};
  return { prisma: new Proxy({}, { get(_target, model) {
    if (typeof model === "symbol") return undefined;
    if (!models[model]) models[model] = new Proxy({}, { get(target, method) {
      if (typeof method === "symbol") return undefined;
      return target[method] || (target[method] = jest.fn());
    } });
    return models[model];
  } }) };
});
jest.mock("../../../infrastructure/mail/EmailService.js", () => ({
  EmailService: class { send(payload) { return mockSend(payload); } },
}));
jest.mock("../../../application/guides/GuideService.js", () => ({
  ...jest.requireActual("../../../application/guides/GuideService.js"),
  getGuidePdfBuffer: jest.fn(),
}));

import express from "express";
import request from "supertest";
import { prisma } from "../../../infrastructure/db/prisma.js";
import { getGuidePdfBuffer } from "../../../application/guides/GuideService.js";
import { sendLatestGuidesEmailByCompany, sendCompanyGuidesEmail } from "../../../application/guides/GuideCompanyEmailService.js";
import { runGuideEmailWorkerSelected } from "../../../workers/guideEmailWorker.js";
import { createFirmPortalRouter } from "../index.js";

const mockSend = jest.fn();
const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
let guias;
let contatos;
let app;
let fetchOriginal;
const guia = (id = "g1", empresa = "emp1") => ({ id, portalClientId: empresa, status: "PROCESSED", tipo: "SIMPLES", competencia: "2026-08", emailStatus: "PENDING", emailAttempts: 0, emailSentAt: null });
const contato = (email, extra = {}) => ({ id: "contato1", portalClientId: "emp1", nome: "Teste", email, ativo: true, ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  guias = [guia()];
  contatos = [];
  mockSend.mockResolvedValue({});
  getGuidePdfBuffer.mockResolvedValue(Buffer.from("%PDF-1.4 teste"));
  prisma.companyFirmAccess.findUnique.mockResolvedValue(null);
  prisma.portalClient.findUnique.mockImplementation(async ({ where }) => ({ id: where.id, razao: "Empresa sintética", cnpj: "00000000000000", guideNotificationEmail: "legado@example.com" }));
  prisma.contatoWhatsapp.findMany.mockImplementation(async ({ where }) => contatos.filter((c) => c.portalClientId === where.portalClientId && (where.ativo === undefined || c.ativo === where.ativo)));
  prisma.guide.findUnique.mockImplementation(async ({ where }) => guias.find((g) => g.id === where.id) || null);
  prisma.guide.findMany.mockImplementation(async ({ where, take }) => guias.filter((g) => {
    if (where.portalClientId && g.portalClientId !== where.portalClientId) return false;
    if (where.id?.in && !where.id.in.includes(g.id)) return false;
    if (where.id?.notIn?.includes(g.id)) return false;
    if ((where.OR || where.NOT) && ["SENT", "SENDING"].includes(g.emailStatus)) return false;
    return true;
  }).slice(0, take || 100));
  prisma.guide.update.mockImplementation(async ({ where, data }) => {
    const row = guias.find((g) => g.id === where.id);
    Object.assign(row, data);
    return { ...row };
  });
  prisma.guide.updateMany.mockResolvedValue({ count: 1 });
  prisma.guideIngestionLock.create.mockResolvedValue({ id: "lock" });
  prisma.guideIngestionLock.update.mockResolvedValue({});
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = jest.fn(() => { throw new Error("REDE EXTERNA PROIBIDA NO TESTE"); });
  app = express();
  app.use(express.json());
  const ensureAuthorized = async (req) => { req.auth = { user: { id: "u1", role: "admin", accountType: "FIRM" } }; return true; };
  app.locals.ensureAuthorized = ensureAuthorized;
  app.use("/firm", createFirmPortalRouter({ ensureAuthorized, log }));
});
afterEach(() => { globalThis.fetch = fetchOriginal; });

describe("serviço de última competência confere todos os destinatários", () => {
  it("não aceita endereço pronto quando não existe cadastro, mesmo havendo e-mail legado", async () => {
    await expect(sendLatestGuidesEmailByCompany({ portalClientId: "emp1", to: "legado@example.com" })).rejects.toMatchObject({ code: "COMPANY_EMAIL_NOT_FOUND" });
    expect(mockSend).not.toHaveBeenCalled();
    expect(prisma.guide.updateMany).not.toHaveBeenCalled();
  });
  it.each(["fora@example.com", "permitido@example.com, fora@example.com", "inativo@example.com", "outra@example.com"])("recusa destinatário não cadastrado/ativo nesta empresa: %s", async (to) => {
    contatos = [contato("permitido@example.com"), contato("inativo@example.com", { ativo: false }), contato("outra@example.com", { portalClientId: "emp2" })];
    await expect(sendLatestGuidesEmailByCompany({ portalClientId: "emp1", to })).rejects.toMatchObject({ code: "GUIDE_EMAIL_RECIPIENT_NOT_REGISTERED" });
    expect(mockSend).not.toHaveBeenCalled();
  });
  it("envia somente destinatários permitidos, normalizados e sem repetição", async () => {
    contatos = [contato("primeiro@example.com"), contato("segundo@example.com")];
    const r = await sendLatestGuidesEmailByCompany({ portalClientId: "emp1", to: " PRIMEIRO@example.com, segundo@example.com, primeiro@example.com " });
    expect(r.status).toBe("sent");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe("primeiro@example.com, segundo@example.com");
  });
  it("remoção enquanto carrega PDF impede envio ao cadastro antigo", async () => {
    contatos = [contato("permitido@example.com")];
    getGuidePdfBuffer.mockImplementationOnce(async () => { contatos = []; return Buffer.from("%PDF"); });
    await expect(sendLatestGuidesEmailByCompany({ portalClientId: "emp1", to: "permitido@example.com" })).rejects.toMatchObject({ code: "COMPANY_EMAIL_NOT_FOUND" });
    expect(mockSend).not.toHaveBeenCalled();
  });
  it("lote por competência também recusa contato removido durante leitura do PDF", async () => {
    contatos = [contato("permitido@example.com")];
    getGuidePdfBuffer.mockImplementationOnce(async () => { contatos = []; return Buffer.from("%PDF"); });
    await expect(sendCompanyGuidesEmail({ portalClientId: "emp1", competencia: "2026-08" })).rejects.toMatchObject({ code: "COMPANY_EMAIL_NOT_FOUND" });
    expect(mockSend).not.toHaveBeenCalled();
  });
  it("lote por competência envia destinatário ainda ativo", async () => {
    contatos = [contato("permitido@example.com")];
    const r = await sendCompanyGuidesEmail({ portalClientId: "emp1", competencia: "2026-08" });
    expect(r.status).toBe("sent");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe("permitido@example.com");
  });
});

describe("worker e reenvio não inventam canal nem apagam histórico sem destinatário", () => {
  it("worker sem e-mail retorna SKIPPED e não toca na guia nem no transporte", async () => {
    const r = await runGuideEmailWorkerSelected({ guideIds: ["g1"] });
    expect(r).toMatchObject({ sent: 0, errors: 0, results: [{ status: "SKIPPED", naoSeAplica: true }] });
    expect(prisma.guide.update).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
  it("reenvio sem e-mail preserva SENT, data e tentativas anteriores", async () => {
    Object.assign(guias[0], { emailStatus: "SENT", emailAttempts: 3, emailSentAt: new Date("2026-08-05") });
    const anterior = { ...guias[0] };
    const r = await request(app).post("/firm/guides/g1/resend-email").send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sent: false, emailStatus: "SENT", envio: { feito: false, naoSeAplica: true } });
    expect(guias[0]).toEqual(anterior);
    expect(prisma.guide.update).not.toHaveBeenCalled();
    expect(prisma.guideIngestionLock.create).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
  it("falha ao conferir destinatários recusa antes de mutar ou enviar", async () => {
    prisma.contatoWhatsapp.findMany.mockRejectedValueOnce(new Error("banco indisponível"));
    const r = await request(app).post("/firm/guides/g1/resend-email").send({});
    expect(r.status).toBe(503);
    expect(r.body.sent).toBe(false);
    expect(prisma.guide.update).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
  it("contato removido entre precheck e worker preserva histórico anterior", async () => {
    Object.assign(guias[0], { emailStatus: "SENT", emailAttempts: 3, emailSentAt: new Date("2026-08-05") });
    const anterior = { ...guias[0] };
    prisma.contatoWhatsapp.findMany.mockResolvedValueOnce([contato("permitido@example.com")]);
    const r = await request(app).post("/firm/guides/g1/resend-email").send({});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sent: false, emailStatus: "SENT", envio: { naoSeAplica: true } });
    expect(guias[0]).toEqual(anterior);
    expect(prisma.guide.update).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });
  it("worker recusa contato removido durante leitura do PDF", async () => {
    contatos = [contato("permitido@example.com")];
    getGuidePdfBuffer.mockImplementationOnce(async () => { contatos = []; return Buffer.from("%PDF"); });
    const r = await runGuideEmailWorkerSelected({ guideIds: ["g1"] });
    expect(r).toMatchObject({ sent: 0, errors: 1, results: [{ status: "ERROR", code: "COMPANY_EMAIL_NOT_FOUND" }] });
    expect(mockSend).not.toHaveBeenCalled();
  });
  it("reenvio válido chega ao transporte e só então responde sent:true", async () => {
    contatos = [contato("permitido@example.com")];
    Object.assign(guias[0], { emailStatus: "SENT", emailAttempts: 3 });
    const r = await request(app).post("/firm/guides/g1/resend-email").send({});
    expect(r.status).toBe(200);
    expect(r.body.sent).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].to).toBe("permitido@example.com");
    expect(guias[0].emailAttempts).toBe(4);
  });
});

describe("lote pendente informa e deixa para trás as guias sem e-mail", () => {
  it("sem destinatário processa uma vez e não anuncia sucesso de envio", async () => {
    const r = await request(app).post("/firm/guides/emails/send-pending").send({ batchSize: 1, maxBatches: 10 });
    expect(r.status).toBe(200);
    expect(r.body.result).toMatchObject({ sent: 0, skipped: 1, totalProcessed: 1 });
    expect(r.body.message).toMatch(/Nenhum e-mail foi enviado/);
    expect(prisma.guide.findMany).toHaveBeenCalledTimes(2);
    expect(mockSend).not.toHaveBeenCalled();
  });
  it("guia sem canal na primeira página não impede envio válido da página seguinte", async () => {
    guias.push(guia("g2", "emp2"));
    contatos = [contato("permitido@example.com", { portalClientId: "emp2" })];
    const r = await request(app).post("/firm/guides/emails/send-pending").send({ batchSize: 1, maxBatches: 10 });
    expect(r.status).toBe(200);
    expect(r.body.result).toMatchObject({ sent: 1, skipped: 1, totalProcessed: 2 });
    expect(r.body.result.skippedItems[0].guideId).toBe("g1");
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(prisma.guide.findMany).toHaveBeenCalledTimes(3);
  });
  it("lote vazio informa que nada foi enviado", async () => {
    guias = [];
    const r = await request(app).post("/firm/guides/emails/send-pending").send({});
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/Nenhum e-mail foi enviado/);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
