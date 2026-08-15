// A ROTA PÚBLICA, EXERCIDA DE VERDADE — express real, corpo real, HMAC real.
//
// ⚠ Nenhuma chamada de rede: o processamento do evento é injetado como dublê. O que este teste
// prova é a PORTA (quem entra e quem não entra) e a MONTAGEM (o corpo raw), que é o par de coisas
// que só falharia em produção, com a Meta do outro lado.

import request from "supertest";
import express from "express";
import crypto from "node:crypto";
import { createWhatsappWebhookRouter, CAMINHO_WEBHOOK_WHATSAPP } from "../whatsapp.js";

const APP_SECRET = "app-secret-de-teste";
const VERIFY_TOKEN = "verify-token-de-teste";

const EVENTO = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
            contacts: [{ profile: { name: "Cliente" }, wa_id: "5521988887777" }],
            messages: [
              { from: "5521988887777", id: "wamid.IN1", timestamp: "1755000000", type: "text", text: { body: "oi" } },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

const CORPO = JSON.stringify(EVENTO);
const assinar = (corpo, segredo = APP_SECRET) =>
  "sha256=" + crypto.createHmac("sha256", segredo).update(Buffer.from(corpo, "utf8")).digest("hex");

function log() {
  return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

/**
 * O app do teste é montado como o `server.js`: o webhook ANTES do `express.json()` global.
 * `jsonPrimeiro` inverte a ordem de propósito — é a armadilha que a montagem existe para evitar.
 */
function montarApp({ processar, jsonPrimeiro = false, logger = log(), ...cfg } = {}) {
  const app = express();
  const router = createWhatsappWebhookRouter({
    habilitada: true,
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    processar,
    log: logger,
    ...cfg,
  });
  if (jsonPrimeiro) app.use(express.json());
  app.use(CAMINHO_WEBHOOK_WHATSAPP, router);
  return { app, logger };
}

/** Espera o `setImmediate` do processamento assíncrono virar. */
const proximoTick = () => new Promise((r) => setImmediate(r));

describe("GET — o handshake da tela \"Verificar e salvar\" da Meta", () => {
  test("token certo devolve o hub.challenge, cru", async () => {
    const { app } = montarApp();
    const r = await request(app)
      .get(CAMINHO_WEBHOOK_WHATSAPP)
      .query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1158201444" });

    expect(r.status).toBe(200);
    expect(r.text).toBe("1158201444");
    expect(r.headers["content-type"]).toMatch(/text\/plain/);
  });

  test("token ERRADO não devolve o challenge", async () => {
    const { app } = montarApp();
    const r = await request(app)
      .get(CAMINHO_WEBHOOK_WHATSAPP)
      .query({ "hub.mode": "subscribe", "hub.verify_token": "chute", "hub.challenge": "1158201444" });

    expect(r.status).toBe(403);
    expect(r.text).not.toContain("1158201444");
  });

  test("sem hub.mode=subscribe não verifica", async () => {
    const { app } = montarApp();
    const r = await request(app)
      .get(CAMINHO_WEBHOOK_WHATSAPP)
      .query({ "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1" });
    expect(r.status).toBe(403);
  });

  test("⚠ VERIFY_TOKEN não configurado recusa com 503 — nunca aceita a chamada vazia", async () => {
    const { app, logger } = montarApp({ verifyToken: "" });
    const r = await request(app)
      .get(CAMINHO_WEBHOOK_WHATSAPP)
      .query({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" });

    expect(r.status).toBe(503);
    expect(r.body.error).toBe("whatsapp_webhook_sem_verify_token");
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("POST — a assinatura é a autenticação", () => {
  test("assinatura correta: 200 e o evento é processado, com o payload já parseado", async () => {
    const processar = jest.fn().mockResolvedValue({ mensagens: {}, statuses: {}, erros: [] });
    const { app } = montarApp({ processar });

    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", assinar(CORPO))
      .send(CORPO);

    expect(r.status).toBe(200);
    await proximoTick();
    expect(processar).toHaveBeenCalledTimes(1);
    expect(processar.mock.calls[0][0]).toEqual(EVENTO);
  });

  test("⚠ UM BYTE alterado no corpo é recusado, e nada é processado", async () => {
    const processar = jest.fn();
    const { app } = montarApp({ processar });
    const adulterado = CORPO.replace("wamid.IN1", "wamid.IN2");

    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", assinar(CORPO)) // assinatura do corpo ORIGINAL
      .send(adulterado);

    expect(r.status).toBe(403);
    await proximoTick();
    expect(processar).not.toHaveBeenCalled();
  });

  test("assinatura de outro segredo é recusada", async () => {
    const processar = jest.fn();
    const { app } = montarApp({ processar });
    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", assinar(CORPO, "segredo-do-atacante"))
      .send(CORPO);

    expect(r.status).toBe(403);
    expect(processar).not.toHaveBeenCalled();
  });

  test("header ausente é recusado", async () => {
    const processar = jest.fn();
    const { app } = montarApp({ processar });
    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "application/json")
      .send(CORPO);

    expect(r.status).toBe(403);
    expect(r.body.error).toBe("whatsapp_webhook_assinatura_invalida");
    expect(processar).not.toHaveBeenCalled();
  });

  test("⚠ SEM APP SECRET NÃO VIRA 'ACEITA TUDO': 503, nada processado, log de erro", async () => {
    const processar = jest.fn();
    const { app, logger } = montarApp({ processar, appSecret: "" });

    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", assinar(CORPO))
      .send(CORPO);

    expect(r.status).toBe(503);
    expect(r.body.error).toBe("whatsapp_webhook_nao_configurado");
    await proximoTick();
    expect(processar).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  test("⚠ MONTADO DEPOIS DO express.json(): a assinatura não confere, e o motivo aponta a montagem", async () => {
    const processar = jest.fn();
    const { app, logger } = montarApp({ processar, jsonPrimeiro: true });

    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", assinar(CORPO))
      .send(CORPO);

    expect(r.status).toBe(503);
    expect(r.body.reason).toMatch(/express\.raw/);
    expect(processar).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  test("corpo assinado que não é JSON responde 400 (a Meta reentrega) e não é processado", async () => {
    const processar = jest.fn();
    const { app, logger } = montarApp({ processar });
    const lixo = "isto não é json";

    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", assinar(lixo))
      .send(lixo);

    expect(r.status).toBe(400);
    await proximoTick();
    expect(processar).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  test("Content-Type inesperado NÃO derruba a conferência — a assinatura é sobre os bytes", async () => {
    const processar = jest.fn().mockResolvedValue({});
    const { app } = montarApp({ processar });

    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "text/plain")
      .set("X-Hub-Signature-256", assinar(CORPO))
      .send(CORPO);

    expect(r.status).toBe(200);
    await proximoTick();
    expect(processar).toHaveBeenCalledTimes(1);
  });

  test("⚠ a resposta 200 NÃO espera o processamento — e o erro dele não vira erro de resposta", async () => {
    let liberar;
    const processar = jest.fn(() => new Promise((_, rejeitar) => { liberar = () => rejeitar(new Error("caiu")); }));
    const { app, logger } = montarApp({ processar });

    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", assinar(CORPO))
      .send(CORPO);

    expect(r.status).toBe(200); // já respondeu, com o processamento ainda pendurado
    await proximoTick();
    liberar();
    await proximoTick();
    await proximoTick();
    // ⚠ Processar "depois" não pode virar processar "nunca" em silêncio: a queda aparece em log.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: "caiu" }),
      "WhatsApp: processamento do evento do webhook falhou por inteiro",
    );
  });

  test("evento REENTREGUE (mesmo corpo, mesma assinatura) responde 200 as duas vezes", async () => {
    // ⚠ Responder erro na reentrega faria a Meta reentregar indefinidamente. A idempotência é do
    // banco (UNIQUE do wamid); do fluxo é só não transformar duplicata em erro.
    const processar = jest.fn().mockResolvedValue({});
    const { app } = montarApp({ processar });
    const enviar = () =>
      request(app)
        .post(CAMINHO_WEBHOOK_WHATSAPP)
        .set("Content-Type", "application/json")
        .set("X-Hub-Signature-256", assinar(CORPO))
        .send(CORPO);

    expect((await enviar()).status).toBe(200);
    expect((await enviar()).status).toBe(200);
    await proximoTick();
    expect(processar).toHaveBeenCalledTimes(2);
  });
});

describe("a flag nasce OFF — e desligado responde de forma DECLARADA", () => {
  test("GET desligado: 503 com nome próprio, não 404 nem erro genérico", async () => {
    const { app } = montarApp({ habilitada: false });
    const r = await request(app)
      .get(CAMINHO_WEBHOOK_WHATSAPP)
      .query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1" });

    expect(r.status).toBe(503);
    expect(r.body.error).toBe("whatsapp_webhook_desligado");
    expect(r.body.reason).toMatch(/INTEGRACAO_WHATSAPP/);
    expect(r.text).not.toContain("challenge");
  });

  test("POST desligado: 503, mesmo com assinatura VÁLIDA, e nada é processado", async () => {
    const processar = jest.fn();
    const { app } = montarApp({ habilitada: false, processar });

    const r = await request(app)
      .post(CAMINHO_WEBHOOK_WHATSAPP)
      .set("Content-Type", "application/json")
      .set("X-Hub-Signature-256", assinar(CORPO))
      .send(CORPO);

    expect(r.status).toBe(503);
    expect(r.body.error).toBe("whatsapp_webhook_desligado");
    await proximoTick();
    expect(processar).not.toHaveBeenCalled();
  });
});
