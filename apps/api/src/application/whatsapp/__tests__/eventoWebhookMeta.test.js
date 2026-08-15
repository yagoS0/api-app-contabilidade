// A LEITURA DO PAYLOAD. O exemplo de mensagem recebida abaixo é o da própria documentação da Meta
// (developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples, consultado em
// 2026-08-15) — copiado, não inventado, inclusive o `timestamp` "1749416383" como STRING.

import {
  AVISOS_EVENTO,
  CAMPO_MENSAGENS,
  STATUS_DOCUMENTADOS,
  STATUS_FALHA,
  extrairCorpo,
  extrairMidiaProvedorId,
  instanteDoProvedor,
  lerEventoWebhook,
} from "../eventoWebhookMeta.js";

const AGORA = new Date("2026-08-15T12:00:00.000Z");

const EXEMPLO_OFICIAL_TEXTO = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
            contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }],
            messages: [
              {
                from: "16505551234",
                id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
                timestamp: "1749416383",
                type: "text",
                text: { body: "Does it come in another color?" },
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

const comValue = (value, field = CAMPO_MENSAGENS) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1", changes: [{ value, field }] }],
});

describe("instanteDoProvedor", () => {
  test("lê o timestamp em SEGUNDOS (procedência: esqueleto do dono)", () => {
    const { instante, avisos } = instanteDoProvedor("1749416383", new Date("2025-06-09T12:00:00Z"));
    expect(instante.toISOString()).toBe("2025-06-08T20:59:43.000Z");
    expect(avisos).toEqual([]);
  });

  test("ausência não é invalidez — devolve nulo com aviso nomeado", () => {
    expect(instanteDoProvedor(undefined, AGORA)).toEqual({ instante: null, avisos: [AVISOS_EVENTO.SEM_TIMESTAMP] });
  });

  test("timestamp que não é dígito não vira data plausível", () => {
    expect(instanteDoProvedor("ontem", AGORA).instante).toBeNull();
    expect(instanteDoProvedor("ontem", AGORA).avisos).toEqual([AVISOS_EVENTO.TIMESTAMP_ILEGIVEL]);
  });

  test("⚠ valor em MILISSEGUNDOS lido como segundos acende o aviso de unidade suspeita", () => {
    const { instante, avisos } = instanteDoProvedor(String(AGORA.getTime()), AGORA);
    expect(instante).toBeInstanceOf(Date);
    expect(avisos).toContain(AVISOS_EVENTO.UNIDADE_SUSPEITA);
  });

  test("data anterior à existência da API também acende o aviso", () => {
    expect(instanteDoProvedor("1", AGORA).avisos).toContain(AVISOS_EVENTO.UNIDADE_SUSPEITA);
  });
});

describe("lerEventoWebhook — mensagens", () => {
  test("o exemplo oficial vira uma mensagem, com nome de perfil e instante convertido", () => {
    const r = lerEventoWebhook(EXEMPLO_OFICIAL_TEXTO, new Date("2025-06-09T12:00:00Z"));
    expect(r.objeto).toBe("whatsapp_business_account");
    expect(r.statuses).toHaveLength(0);
    expect(r.mensagens).toHaveLength(1);
    expect(r.mensagens[0]).toMatchObject({
      telefone: "16505551234",
      providerMessageId: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=",
      tipo: "text",
      corpo: "Does it come in another color?",
      midiaProvedorId: null,
      nomePerfilProvedor: "Sheena Nelson",
      avisos: [],
    });
    expect(r.mensagens[0].ocorridaEmProvedor).toBeInstanceOf(Date);
  });

  test("nome de perfil só é usado quando o wa_id CASA com o remetente", () => {
    const payload = comValue({
      contacts: [{ profile: { name: "Outra Pessoa" }, wa_id: "5521999990000" }],
      messages: [{ from: "5521988887777", id: "wamid.A", timestamp: "1755000000", type: "text", text: { body: "oi" } }],
    });
    expect(lerEventoWebhook(payload, AGORA).mensagens[0].nomePerfilProvedor).toBeNull();
  });

  test("mídia entra pelo ID, nunca por URL", () => {
    const payload = comValue({
      messages: [
        {
          from: "5521988887777",
          id: "wamid.B",
          timestamp: "1755000000",
          type: "document",
          document: { id: "MEDIA-123", caption: "segue o comprovante", mime_type: "application/pdf" },
        },
      ],
    });
    const m = lerEventoWebhook(payload, AGORA).mensagens[0];
    expect(m.midiaProvedorId).toBe("MEDIA-123");
    expect(m.tipo).toBe("document");
    expect(m.corpo).toBe("segue o comprovante");
  });

  test("tipo sem texto nenhum (áudio) continua virando mensagem — nada some por falta de corpo", () => {
    const payload = comValue({
      messages: [{ from: "5521988887777", id: "wamid.C", timestamp: "1755000000", type: "audio", audio: { id: "A1" } }],
    });
    const m = lerEventoWebhook(payload, AGORA).mensagens[0];
    expect(m).toMatchObject({ tipo: "audio", corpo: null, midiaProvedorId: "A1" });
  });

  test("tipo que não está na lista documentada chega inteiro, sem de-para inventado", () => {
    const payload = comValue({
      messages: [{ from: "5521988887777", id: "wamid.D", timestamp: "1755000000", type: "sticker", sticker: { id: "S9" } }],
    });
    const m = lerEventoWebhook(payload, AGORA).mensagens[0];
    expect(m.tipo).toBe("sticker");
    expect(m.midiaProvedorId).toBe("S9");
  });

  test("campos ausentes viram AVISO nomeado, não exceção", () => {
    const payload = comValue({ messages: [{ timestamp: "1755000000" }] });
    const m = lerEventoWebhook(payload, AGORA).mensagens[0];
    expect(m.telefone).toBeNull();
    expect(m.avisos).toEqual(
      expect.arrayContaining([AVISOS_EVENTO.SEM_REMETENTE, AVISOS_EVENTO.SEM_IDENTIFICADOR, AVISOS_EVENTO.SEM_TIPO]),
    );
  });

  test("payload vazio/torto não estoura e não inventa item", () => {
    for (const p of [null, undefined, {}, { entry: null }, { entry: [{}] }, { entry: [{ changes: [{}] }] }]) {
      const r = lerEventoWebhook(p, AGORA);
      expect(r.mensagens).toEqual([]);
      expect(r.statuses).toEqual([]);
    }
  });
});

describe("lerEventoWebhook — statuses", () => {
  test("os três status documentados são lidos como vieram", () => {
    for (const status of STATUS_DOCUMENTADOS) {
      const payload = comValue({
        statuses: [{ id: "wamid.OUT", status, timestamp: "1755000000", recipient_id: "5521988887777" }],
      });
      const s = lerEventoWebhook(payload, AGORA).statuses[0];
      expect(s).toMatchObject({ providerMessageId: "wamid.OUT", status, destinatario: "5521988887777", erros: [] });
    }
  });

  test("failed traz os erros adiante, sem traduzir aqui", () => {
    const erro = { code: 131047, title: "Re-engagement message", message: "Message failed to send" };
    const payload = comValue({ statuses: [{ id: "wamid.OUT", status: STATUS_FALHA, timestamp: "1755000000", errors: [erro] }] });
    const s = lerEventoWebhook(payload, AGORA).statuses[0];
    expect(s.status).toBe("failed");
    expect(s.erros).toEqual([erro]);
  });

  test("mensagens e statuses no MESMO evento não se misturam", () => {
    const payload = comValue({
      contacts: [{ profile: { name: "Cliente" }, wa_id: "5521988887777" }],
      messages: [{ from: "5521988887777", id: "wamid.IN", timestamp: "1755000000", type: "text", text: { body: "oi" } }],
      statuses: [{ id: "wamid.OUT", status: "delivered", timestamp: "1755000000" }],
    });
    const r = lerEventoWebhook(payload, AGORA);
    expect(r.mensagens).toHaveLength(1);
    expect(r.statuses).toHaveLength(1);
    expect(r.mensagens[0].providerMessageId).toBe("wamid.IN");
    expect(r.statuses[0].providerMessageId).toBe("wamid.OUT");
  });

  test("change.field diferente de messages é registrado, não processado em silêncio", () => {
    const payload = comValue({ statuses: [{ id: "x", status: "sent", timestamp: "1755000000" }] }, "account_alerts");
    const r = lerEventoWebhook(payload, AGORA);
    expect(r.camposIgnorados).toEqual(["account_alerts"]);
    expect(r.avisos).toContain(AVISOS_EVENTO.CAMPO_NAO_ASSINADO);
  });
});

describe("extratores", () => {
  test("extrairCorpo cobre os lugares do esqueleto do dono, na ordem", () => {
    expect(extrairCorpo({ text: { body: "a" } })).toBe("a");
    expect(extrairCorpo({ button: { text: "b" } })).toBe("b");
    expect(extrairCorpo({ interactive: { button_reply: { title: "c" } } })).toBe("c");
    expect(extrairCorpo({ document: { caption: "d" } })).toBe("d");
    expect(extrairCorpo({ location: { latitude: 1 } })).toBeNull();
  });

  test("extrairMidiaProvedorId ignora id que não seja texto", () => {
    expect(extrairMidiaProvedorId({ type: "image", image: { id: 123 } })).toBeNull();
    expect(extrairMidiaProvedorId({ type: "text", text: { body: "oi" } })).toBeNull();
  });
});
