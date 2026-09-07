import express from "express";
import request from "supertest";
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../../config.js", () => ({ WHATSAPP_TOKEN: "", WHATSAPP_GRAPH_BASE_URL: "https://graph.facebook.com", WHATSAPP_GRAPH_VERSION: "v22.0" }));
import { createWhatsappArquivosRouter } from "../whatsappArquivos.js";

const row = { id: "a", portalClientId: "A", estado: "DISPONIVEL", mimeType: "application/x-ofx", nomeArquivo: "extrato.ofx", conteudo: Buffer.from("<OFX>"), expiraEm: new Date("2099-01-01Z"), recebidoEm: new Date() };
function setup(overrides = {}) {
  const db = { arquivoWhatsapp: {
    findFirst: jest.fn(async ({ where }) => where.portalClientId === "A" && where.id === "a" ? { ...row, ...overrides } : null),
    findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 1 })),
  } };
  const roles = [];
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.auth = { user: { id: "u", role: "contador" } }; next(); });
  app.use(createWhatsappArquivosRouter({ db, acesso: opts => { roles.push(opts); return (req, res, next) => next(); } }));
  return { app, db, roles };
}
test("arquivo de outra empresa não abre nem recebe registro de importação", async () => {
  const { app, db } = setup();
  expect((await request(app).get("/companies/B/whatsapp/arquivos/a/conteudo")).status).toBe(404);
  expect((await request(app).post("/companies/B/whatsapp/arquivos/a/importado")).status).toBe(404);
  expect(db.arquivoWhatsapp.updateMany).not.toHaveBeenCalled();
});
test("listagem seleciona metadados e cursor de outra empresa é recusado", async () => {
  const { app, db } = setup();
  expect((await request(app).get("/companies/B/whatsapp/arquivos?cursor=a")).status).toBe(400);
  expect(db.arquivoWhatsapp.findMany).not.toHaveBeenCalled();
  await request(app).get("/companies/A/whatsapp/arquivos");
  const consulta = db.arquivoWhatsapp.findMany.mock.calls[0][0];
  expect(consulta.where.portalClientId).toBe("A");
  expect(consulta.select.conteudo).toBeUndefined();
  expect(consulta.select.midiaProvedorId).toBeUndefined();
});
test("arquivo expirado não é entregue ainda que os bytes aguardem limpeza", async () => {
  const { app } = setup({ expiraEm: new Date("2020-01-01Z") });
  const r = await request(app).get("/companies/A/whatsapp/arquivos/a/conteudo");
  expect(r.status).toBe(410); expect(r.body.base64).toBeUndefined();
});
test("download explícito sem cache e registro exige papel contábil", async () => {
  const { app, roles } = setup();
  const r = await request(app).get("/companies/A/whatsapp/arquivos/a/conteudo");
  expect(r.status).toBe(200); expect(r.headers["cache-control"]).toBe("no-store");
  expect(r.body.base64).toBe(row.conteudo.toString("base64"));
  expect(roles).toContainEqual({ minRole: "ACCOUNTANT" });
});
test("vínculo exige confirmação e exclui histórico de empresa removida da fila global", async () => {
  const { app, db } = setup();
  expect((await request(app).post("/companies/A/whatsapp/arquivos/a/vincular").send({ confirmarCompanyId: "B" })).status).toBe(400);
  expect(db.arquivoWhatsapp.updateMany).not.toHaveBeenCalled();
  expect((await request(app).post("/companies/A/whatsapp/arquivos/a/vincular").send({ confirmarCompanyId: "A" })).status).toBe(200);
  const q = db.arquivoWhatsapp.updateMany.mock.calls[0][0];
  expect(q.where.portalClientId).toBeNull();
  expect(q.where.mensagem.conversa).toEqual({ portalClientId: null, OR: [{ chaveEscopo: { startsWith: "sem-empresa:" } }, { chaveEscopo: { startsWith: "legado:sem-empresa:" } }] });
  expect(q.data).toMatchObject({ portalClientId: "A", vinculadoPorUserId: "u" });
});
