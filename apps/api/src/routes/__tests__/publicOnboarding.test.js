import fs from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
jest.mock("../../application/onboarding/ComercialService.js", () => ({ criarServicoComercial: jest.fn() }));
jest.mock("../../application/onboarding/OnboardingService.js", () => ({ OnboardingError: class extends Error { constructor(code, message, status) { super(message); this.code = code; this.status = status; } } }));
import { createPublicOnboardingRouter } from "../publicOnboarding.js";
import { OnboardingError } from "../../application/onboarding/OnboardingService.js";

function setup() {
  const servico = { publico: jest.fn(async () => ({ onboarding: { dados: {}, versao: 1 } })) };
  const app = express(); app.use("/public", createPublicOnboardingRouter({ servico })); app.use(express.json());
  return { app, servico };
}
it("token é lido somente do Authorization; resposta não pode ser cacheada", async () => {
  const { app, servico } = setup(); const token = "a".repeat(43);
  const r = await request(app).get("/public/onboarding").set("Authorization", `Bearer ${token}`);
  expect(r.status).toBe(200); expect(r.headers["cache-control"]).toBe("no-store");
  expect(r.headers["referrer-policy"]).toBe("no-referrer");
  expect(servico.publico).toHaveBeenCalledWith(token, null);
});
it("token em query não autoriza acesso", async () => {
  const { app, servico } = setup(); servico.publico.mockRejectedValue(new OnboardingError("link_invalido", "Link inválido.", 404));
  const r = await request(app).get("/public/onboarding?token=segredo");
  expect(r.status).toBe(404); expect(servico.publico).toHaveBeenCalledWith(undefined, null);
});
it("PATCH propaga versão e retorna conflito de domínio", async () => {
  const { app, servico } = setup(); servico.publico.mockRejectedValue(new OnboardingError("formulario_alterado", "Recarregue.", 409));
  const body = { dados: {}, versao: 2 };
  const r = await request(app).patch("/public/onboarding").set("Authorization", `Bearer ${"a".repeat(43)}`).send(body);
  expect(r.status).toBe(409); expect(servico.publico).toHaveBeenCalledWith("a".repeat(43), body);
});
it("payload acima do limite não chega ao serviço", async () => {
  const { app, servico } = setup();
  const r = await request(app).patch("/public/onboarding").send({ dados: { texto: "a".repeat(70000) } });
  expect(r.status).toBe(413); expect(servico.publico).not.toHaveBeenCalled();
});

it("montagem real mantém parser público antes do global, com CORS e webhook preservados", () => {
 const fonte = fs.readFileSync(path.resolve(__dirname, "../../server.js"), "utf8");
 const publico = fonte.indexOf('app.use("/public", createPublicOnboardingRouter())');
 expect(publico).toBeGreaterThan(fonte.indexOf("cors({"));
 expect(publico).toBeGreaterThan(fonte.indexOf("app.use(CAMINHO_WEBHOOK_WHATSAPP"));
 expect(publico).toBeLessThan(fonte.indexOf("app.use(express.json())"));
});
