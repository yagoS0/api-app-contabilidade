// A PORTA. Como esta é a única rota pública do sistema, a assinatura é a autenticação — e um teste
// que só verificasse "assinatura certa passa" seria inútil: o que precisa estar provado é que TODAS
// as outras formas são recusadas, cada uma com nome próprio.

import crypto from "node:crypto";
import {
  ASSINATURA,
  CABECALHO_ASSINATURA,
  HANDSHAKE,
  MODO_VERIFICACAO,
  PREFIXO_ASSINATURA,
  conferirAssinatura,
  conferirHandshake,
} from "../assinaturaWebhook.js";

const SEGREDO = "app-secret-de-teste-nao-e-de-ninguem";
const CORPO = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

const assinar = (corpo, segredo = SEGREDO) =>
  PREFIXO_ASSINATURA + crypto.createHmac("sha256", segredo).update(Buffer.from(corpo, "utf8")).digest("hex");

describe("conferirAssinatura", () => {
  test("assinatura correta passa", () => {
    const r = conferirAssinatura({ corpoRaw: Buffer.from(CORPO), cabecalho: assinar(CORPO), appSecret: SEGREDO });
    expect(r).toEqual({ ok: true, resultado: ASSINATURA.VALIDA, motivo: "" });
  });

  test("aceita o corpo como string, além de Buffer (o HMAC é sobre os mesmos bytes)", () => {
    const r = conferirAssinatura({ corpoRaw: CORPO, cabecalho: assinar(CORPO), appSecret: SEGREDO });
    expect(r.ok).toBe(true);
  });

  test("hex em MAIÚSCULAS confere — hex é indiferente a caixa", () => {
    const cabecalho = assinar(CORPO).toUpperCase().replace("SHA256=", PREFIXO_ASSINATURA);
    expect(conferirAssinatura({ corpoRaw: CORPO, cabecalho, appSecret: SEGREDO }).ok).toBe(true);
  });

  test("⚠ UM BYTE alterado no corpo derruba a assinatura", () => {
    const alterado = CORPO.replace("whatsapp_business_account", "whatsapp_business_accounx");
    expect(alterado).not.toBe(CORPO);
    const r = conferirAssinatura({ corpoRaw: alterado, cabecalho: assinar(CORPO), appSecret: SEGREDO });
    expect(r.ok).toBe(false);
    expect(r.resultado).toBe(ASSINATURA.NAO_CONFERE);
  });

  test("⚠ reserializar o JSON (o que aconteceria depois do express.json) NÃO confere", () => {
    // Este é, literalmente, o defeito que a montagem do router existe para evitar: mesmo objeto,
    // outro texto — a Meta assina o texto, não o objeto.
    const reserializado = JSON.stringify(JSON.parse(CORPO), null, 2);
    const r = conferirAssinatura({ corpoRaw: reserializado, cabecalho: assinar(CORPO), appSecret: SEGREDO });
    expect(r.resultado).toBe(ASSINATURA.NAO_CONFERE);
  });

  test("segredo errado é recusado", () => {
    const r = conferirAssinatura({ corpoRaw: CORPO, cabecalho: assinar(CORPO, "outro-segredo"), appSecret: SEGREDO });
    expect(r.resultado).toBe(ASSINATURA.NAO_CONFERE);
  });

  test("header ausente é recusado, com nome próprio", () => {
    const r = conferirAssinatura({ corpoRaw: CORPO, cabecalho: undefined, appSecret: SEGREDO });
    expect(r).toMatchObject({ ok: false, resultado: ASSINATURA.SEM_CABECALHO });
  });

  test("header sem o prefixo sha256= é recusado", () => {
    const semPrefixo = assinar(CORPO).slice(PREFIXO_ASSINATURA.length);
    expect(conferirAssinatura({ corpoRaw: CORPO, cabecalho: semPrefixo, appSecret: SEGREDO }).resultado)
      .toBe(ASSINATURA.FORMATO_INESPERADO);
  });

  test("header com o prefixo e lixo no lugar do digest é recusado sem estourar", () => {
    const r = conferirAssinatura({ corpoRaw: CORPO, cabecalho: `${PREFIXO_ASSINATURA}nao-e-hex`, appSecret: SEGREDO });
    expect(r.resultado).toBe(ASSINATURA.FORMATO_INESPERADO);
  });

  test("⚠ SEM APP SECRET NÃO É 'ACEITA TUDO' — é recusa nomeada", () => {
    const r = conferirAssinatura({ corpoRaw: CORPO, cabecalho: assinar(CORPO), appSecret: "" });
    expect(r.ok).toBe(false);
    expect(r.resultado).toBe(ASSINATURA.SEM_APP_SECRET);
    expect(r.motivo).toMatch(/WHATSAPP_APP_SECRET/);
  });

  test("⚠ corpo já parseado (objeto) é recusado apontando a montagem do router", () => {
    const r = conferirAssinatura({ corpoRaw: { object: "whatsapp_business_account" }, cabecalho: assinar(CORPO), appSecret: SEGREDO });
    expect(r.resultado).toBe(ASSINATURA.CORPO_AUSENTE);
    expect(r.motivo).toMatch(/express\.raw/);
  });

  test("o nome do cabeçalho é o documentado, em minúsculas (como o Express entrega)", () => {
    expect(CABECALHO_ASSINATURA).toBe("x-hub-signature-256");
  });
});

describe("conferirHandshake", () => {
  const TOKEN = "verify-token-longo-de-teste";

  test("token certo devolve o challenge", () => {
    const r = conferirHandshake({
      modo: MODO_VERIFICACAO,
      token: TOKEN,
      challenge: "1158201444",
      verifyToken: TOKEN,
    });
    expect(r).toEqual({ ok: true, resultado: HANDSHAKE.OK, challenge: "1158201444", motivo: "" });
  });

  test("token errado é recusado", () => {
    const r = conferirHandshake({ modo: MODO_VERIFICACAO, token: "chute", challenge: "1", verifyToken: TOKEN });
    expect(r).toMatchObject({ ok: false, resultado: HANDSHAKE.TOKEN_NAO_CONFERE, challenge: null });
  });

  test("hub.mode diferente de subscribe é recusado", () => {
    const r = conferirHandshake({ modo: "unsubscribe", token: TOKEN, challenge: "1", verifyToken: TOKEN });
    expect(r.resultado).toBe(HANDSHAKE.MODO_INESPERADO);
  });

  test("⚠ VERIFY TOKEN VAZIO NÃO ACEITA CHAMADA SEM TOKEN — recusa nomeada", () => {
    const r = conferirHandshake({ modo: MODO_VERIFICACAO, token: "", challenge: "1", verifyToken: "" });
    expect(r.ok).toBe(false);
    expect(r.resultado).toBe(HANDSHAKE.SEM_VERIFY_TOKEN);
  });

  test("token certo sem challenge não inventa resposta", () => {
    const r = conferirHandshake({ modo: MODO_VERIFICACAO, token: TOKEN, challenge: undefined, verifyToken: TOKEN });
    expect(r.resultado).toBe(HANDSHAKE.SEM_CHALLENGE);
  });
});
