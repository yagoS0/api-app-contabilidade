import express from "express";
import request from "supertest";
jest.mock("../../../infrastructure/db/prisma.js", () => ({ prisma: {} }));
jest.mock("../../../application/whatsapp/AtendimentoPushService.js", () => ({
  configuracaoPush: jest.fn(() => ({ enabled: false, publicKey: null })),
  registrarInscricaoPush: jest.fn(async args => ({ ok: true, id: "s1", userId: args.userId })),
  revogarInscricaoPush: jest.fn(async () => ({ ok: true })),
}));
import { registrarInscricaoPush, revogarInscricaoPush } from "../../../application/whatsapp/AtendimentoPushService.js";
import { createAtendimentoPushRouter } from "../atendimentoPush.js";

const user = { id: "operador", role: "contador", accountType: "FIRM", status: "active" };
function app(userValue = user, config = { enabled: true, publicKey: "PUBLICA", privateKey: "SEGREDO" }) {
  const server = express(); server.use(express.json());
  server.use((req, _res, next) => { req.auth = userValue ? { user: userValue } : null; next(); });
  server.use(createAtendimentoPushRouter({ client: {}, config })); return server;
}
beforeEach(() => { jest.clearAllMocks(); });

test.each([null, { ...user, role: "cliente" }, { ...user, accountType: "CLIENT" }])("RBAC recusa conta sem atendimento", async conta => {
  const server = app(conta);
  expect((await request(server).get("/whatsapp/push/config")).status).toBe(403);
  expect((await request(server).post("/whatsapp/push/subscriptions").send({ subscription: {} })).status).toBe(403);
  expect((await request(server).delete("/whatsapp/push/subscriptions").send({ endpoint: "https://example.com" })).status).toBe(403);
  expect(registrarInscricaoPush).not.toHaveBeenCalled(); expect(revogarInscricaoPush).not.toHaveBeenCalled();
});
test("configuração só expõe chave pública, sem cache", async () => {
  const r = await request(app()).get("/whatsapp/push/config");
  expect(r.status).toBe(200); expect(r.body).toEqual({ ok: true, enabled: true, publicKey: "PUBLICA" });
  expect(r.headers["cache-control"]).toBe("no-store");
});
test("configuração desativada é declarada sem prometer notificações", async () => {
  const r = await request(app(user, { enabled: false, publicKey: null })).get("/whatsapp/push/config");
  expect(r.body).toEqual({ ok: true, enabled: false, publicKey: null });
});
test("POST e DELETE sempre usam usuário autenticado e não dono fornecido no corpo", async () => {
  const server = app();
  const body = { userId: "vitima", subscription: { endpoint: "teste" }, deviceName: "Celular", preferencias: { minhas: true } };
  const r = await request(server).post("/whatsapp/push/subscriptions").send(body);
  expect(r.status).toBe(200);
  expect(registrarInscricaoPush.mock.calls[0][0]).toEqual({ userId: "operador", subscription: body.subscription, deviceName: "Celular", preferencias: body.preferencias });
  await request(server).delete("/whatsapp/push/subscriptions").send({ userId: "vitima", endpoint: "https://push.test/token" });
  expect(revogarInscricaoPush.mock.calls[0][0]).toEqual({ userId: "operador", endpoint: "https://push.test/token" });
});
test("erro conhecido orienta; erro interno não expõe subscription, token ou pilha", async () => {
  registrarInscricaoPush.mockRejectedValueOnce({ status: 409, code: "PUSH_OUTRA_CONTA", message: "Desative a inscrição anterior." });
  const r = await request(app()).post("/whatsapp/push/subscriptions").send({});
  expect(r.status).toBe(409); expect(r.body.error).toBe("PUSH_OUTRA_CONTA");
  registrarInscricaoPush.mockRejectedValueOnce(new Error("token=SEGREDO"));
  const e = await request(app()).post("/whatsapp/push/subscriptions").send({});
  expect(e.status).toBe(500); expect(e.body.error).toBe("push_indisponivel"); expect(e.text).not.toContain("SEGREDO");
});
