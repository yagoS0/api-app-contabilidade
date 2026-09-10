import express from "express";
import request from "supertest";
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: { guide: { findFirst: jest.fn() } } }));
jest.mock("../../../middlewares/requireFirmCompanyAccess.js", () => ({ requireFirmCompanyAccess: () => (_req, _res, next) => next() }));
jest.mock("../empresasVisiveis.js", () => ({ empresasVisiveis: jest.fn(async () => ["c1"]) }));
jest.mock("../../../application/guides/GuideReleaseBatchService.js", () => ({ createGuideReleaseBatchService: jest.fn() }));
jest.mock("../../../application/whatsapp/EnvioGuiaWhatsappService.js", () => ({
  SELECT_GUIA_PARA_ENVIO: {}, carregarCanal: jest.fn(async () => ({ disponivel: true })),
  enviarParaTodosOsDestinatarios: jest.fn(async () => ({ ok: true, estado: "aceito" })), EnvioGuiaWhatsappError: class extends Error {},
}));
jest.mock("../../../application/guides/EnvioGuiaService.js", () => ({
  STATUS_TERMINAL: ["enviado", "entregue", "lido"], enviosPorGuia: jest.fn(), foiEnviadaComLegado: jest.fn(() => true),
}));
jest.mock("../../../workers/guideEmailWorker.js", () => ({}));
jest.mock("../../../application/guides/GuideCompanyEmailService.js", () => ({}));
jest.mock("../../../application/whatsapp/ContatoWhatsappService.js", () => ({
  destinatarioWhatsapp: jest.fn(async () => ({ contato: { telefoneE164: "5511999990000" } })),
  destinatariosDeEnvio: jest.fn(async () => ({ telefones: [{ telefoneE164: "5511999990000" }] })),
}));
import { createWhatsappGuiasRouter } from "../whatsappGuias.js";
import { createGuideReleaseBatchService } from "../../../application/guides/GuideReleaseBatchService.js";
import { enviarParaTodosOsDestinatarios } from "../../../application/whatsapp/EnvioGuiaWhatsappService.js";
import { enviosPorGuia } from "../../../application/guides/EnvioGuiaService.js";
import { prisma } from "../../../infrastructure/db/prisma.js";
const release = { prever: jest.fn(async () => ({ ok: true, assinatura: "preview" })), executar: jest.fn(async () => ({ ok: true, results: [] })) };
function app(role = "contador") {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => { req.auth = { user: { id: "ator", role } }; next(); });
  a.use(createWhatsappGuiasRouter()); return a;
}
beforeEach(() => {
  jest.clearAllMocks(); createGuideReleaseBatchService.mockReturnValue(release);
  prisma.guide.findFirst.mockResolvedValue({ id: "g1", portalClientId: "c1", status: "PROCESSED", emailStatus: "SENT" });
  enviosPorGuia.mockResolvedValue(new Map([["g1", [{ canal: "EMAIL", status: "enviado" }]]]));
});
test.each(["/previa", ""])("liberação exige contador/admin: %s", async (path) => {
  expect((await request(app("assistente")).post(`/guides/liberacao/lote${path}`).send({})).status).toBe(403);
  expect(release.prever).not.toHaveBeenCalled(); expect(release.executar).not.toHaveBeenCalled();
});
test("execução recebe escopo do servidor e ator, nunca permitidas do corpo", async () => {
  await request(app()).post("/guides/liberacao/lote").send({ items: [{ portalClientId: "c2" }], assinatura: "x", permitidas: ["c2"], userId: "falso" }).expect(200);
  expect(release.executar).toHaveBeenCalledWith(expect.objectContaining({ permitidas: ["c1"], userId: "ator", assinatura: "x" }));
});
test("complementar e-mail enviado permite WhatsApp sem reenviar=true", async () => {
  await request(app()).post("/companies/c1/guides/g1/enviar-whatsapp").send({ complementar: true }).expect(200);
  expect(enviarParaTodosOsDestinatarios).toHaveBeenCalledWith(expect.objectContaining({ reenviar: false }));
  expect(prisma.guide.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "g1", portalClientId: "c1" } }));
});
test("complementar não repete WhatsApp já enviado", async () => {
  enviosPorGuia.mockResolvedValue(new Map([["g1", [{ canal: "WHATSAPP", status: "entregue" }]]]));
  const r = await request(app()).post("/companies/c1/guides/g1/enviar-whatsapp").send({ complementar: true });
  expect(r.status).toBe(422); expect(r.body.error).toBe("GUIA_JA_ENVIADA");
  expect(enviarParaTodosOsDestinatarios).not.toHaveBeenCalled();
});
