// O CLIENTE DA CLOUD API — exercido inteiro, sem UMA chamada de rede.
//
// ⚠ A TRAVA DE REDE É ESTRUTURAL, NÃO UMA PROMESSA. `globalThis.fetch` é substituído por um espião
// que ESTOURA se alguém o chamar (ver `beforeEach`). Se um caminho deste módulo esquecer o `fetch`
// injetado e cair no nativo, o teste quebra com "REDE" em vez de sair uma mensagem de verdade.
//
// ⚠ E o segredo é conferido, não confiado: há teste varrendo TODOS os argumentos de todas as
// chamadas — URL, corpo e log — atrás do token.

const TOKEN_FALSO = "EAAG-token-secreto-de-teste-nunca-deve-vazar";

jest.mock("../../../config.js", () => ({
  INTEGRACAO_WHATSAPP: true,
  WHATSAPP_TOKEN: "EAAG-token-secreto-de-teste-nunca-deve-vazar",
  WHATSAPP_PHONE_NUMBER_ID: "1234567890",
  WHATSAPP_WABA_ID: "9999",
  WHATSAPP_APP_SECRET: "app-secret-de-teste",
  WHATSAPP_VERIFY_TOKEN: "verify-de-teste",
  WHATSAPP_GRAPH_BASE_URL: "https://graph.facebook.com",
  WHATSAPP_GRAPH_VERSION: "v21.0",
  WHATSAPP_TIMEOUT_MS: 5000,
  WHATSAPP_TEMPLATE_GUIA: "guia_disponivel",
  WHATSAPP_TEMPLATE_IDIOMA: "pt_BR",
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { log } from "../../../config.js";
import {
  WhatsappCloudClient,
  WhatsappError,
  mascararTelefone,
  montarCorpoTemplate,
  montarHeaderDocumento,
  montarPayloadTemplate,
  montarPayloadTexto,
  nomeArquivoDaGuia,
  variaveisDaGuia,
} from "../WhatsappCloudClient.js";
import { CODIGOS_LOCAIS } from "../errosMeta.js";

/** Resposta de sucesso da Meta, na forma documentada. */
const ok = (corpo) => ({ ok: true, status: 200, json: async () => corpo });
const falha = (status, corpo) => ({ ok: false, status, json: async () => corpo });

const RESPOSTA_ENVIO = {
  messaging_product: "whatsapp",
  contacts: [{ input: "5521999998888", wa_id: "5521999998888" }],
  messages: [{ id: "wamid.HBgNNTUyMTk5OTk5ODg4OA==" }],
};

let fetchFalso;
let fetchNativoOriginal;

function clienteCom(respostas, cfg = {}) {
  fetchFalso = jest.fn();
  for (const r of respostas) fetchFalso.mockResolvedValueOnce(r);
  return new WhatsappCloudClient({ fetchImpl: fetchFalso, config: cfg });
}

beforeEach(() => {
  jest.clearAllMocks();
  // ⚠ A TRAVA. Nada neste arquivo pode alcançar a rede real.
  fetchNativoOriginal = globalThis.fetch;
  globalThis.fetch = jest.fn(() => {
    throw new Error("REDE: o teste tentou usar o fetch nativo — todo fetch tem de ser injetado");
  });
});

afterEach(() => {
  globalThis.fetch = fetchNativoOriginal;
});

// ── Os payloads, que só falhariam em produção ────────────────────────────────────────────────────

describe("o payload que sai para a Meta", () => {
  it("template com documento: a forma exata da referência de Messages", () => {
    const corpo = montarPayloadTemplate({
      para: "5521999998888",
      template: "guia_disponivel",
      idioma: "pt_BR",
      componentes: [
        montarHeaderDocumento({ mediaId: "MEDIA-1", nomeArquivo: "SIMPLES-2026-07.pdf" }),
        montarCorpoTemplate(["Maria", "DAS", "07/2026", "1.243,80", "20/08/2026"]),
      ],
    });

    expect(corpo).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5521999998888",
      type: "template",
      template: {
        name: "guia_disponivel",
        language: { code: "pt_BR" },
        components: [
          {
            type: "header",
            parameters: [
              { type: "document", document: { id: "MEDIA-1", filename: "SIMPLES-2026-07.pdf" } },
            ],
          },
          {
            type: "body",
            parameters: [
              { type: "text", text: "Maria" },
              { type: "text", text: "DAS" },
              { type: "text", text: "07/2026" },
              { type: "text", text: "1.243,80" },
              { type: "text", text: "20/08/2026" },
            ],
          },
        ],
      },
    });
  });

  it("texto livre: messaging_product, recipient_type, to, type e text.body", () => {
    expect(montarPayloadTexto({ para: "5521999998888", texto: "Recebido, obrigado!" })).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5521999998888",
      type: "text",
      text: { preview_url: false, body: "Recebido, obrigado!" },
    });
  });

  it("variável nomeada usa parameter_name, a posicional não", () => {
    expect(montarCorpoTemplate([{ nome: "cliente", valor: "Maria" }]).parameters[0])
      .toEqual({ type: "text", parameter_name: "cliente", text: "Maria" });
    expect(montarCorpoTemplate(["Maria"]).parameters[0]).toEqual({ type: "text", text: "Maria" });
  });

  it("template sem variável nenhuma não manda um body vazio", () => {
    expect(montarCorpoTemplate([])).toBeNull();
    const corpo = montarPayloadTemplate({ para: "1", template: "t", idioma: "pt_BR", componentes: [null] });
    expect(corpo.template.components).toEqual([]);
  });

  it("⚠ a ORDEM das cinco variáveis da guia vive num lugar só", () => {
    expect(variaveisDaGuia({
      nomeContato: "Maria",
      tipoGuia: "DAS",
      competencia: "07/2026",
      valorFormatado: "1.243,80",
      vencimentoFormatado: "20/08/2026",
    })).toEqual(["Maria", "DAS", "07/2026", "1.243,80", "20/08/2026"]);
  });

  it("o nome do anexo é o que o cliente vê — e não traz caminho de origem", () => {
    expect(nomeArquivoDaGuia({ tipoGuia: "SIMPLES", competencia: "2026-07" })).toBe("SIMPLES-2026-07.pdf");
    expect(nomeArquivoDaGuia({ tipoGuia: "a/b", competencia: "" })).toBe("a-b.pdf");
  });
});

describe("⚠ id XOR link — 'Either id or link is required'", () => {
  it("os dois juntos são recusados AQUI, não em produção", () => {
    expect(() => montarHeaderDocumento({ mediaId: "M", link: "https://x/y.pdf" })).toThrow(WhatsappError);
  });

  it("nenhum dos dois também é recusado", () => {
    expect(() => montarHeaderDocumento({})).toThrow(/não foi informado/i);
  });

  it("aceita link quando é o caminho escolhido — a estrutura não desaparece", () => {
    expect(montarHeaderDocumento({ link: "https://x/y.pdf", nomeArquivo: "y.pdf" }).parameters[0].document)
      .toEqual({ link: "https://x/y.pdf", filename: "y.pdf" });
  });
});

// ── As chamadas ──────────────────────────────────────────────────────────────────────────────────

describe("upload do PDF e envio da guia", () => {
  it("⚠ a guia sobe como MÍDIA e vai por id — nunca por URL pública", async () => {
    const cliente = clienteCom([ok({ id: "MEDIA-42" }), ok(RESPOSTA_ENVIO)]);

    const r = await cliente.enviarGuia({
      telefone: "(21) 99999-8888",
      conteudoPdf: Buffer.from("%PDF-1.4 conteudo"),
      nomeArquivo: "SIMPLES-2026-07.pdf",
      variaveis: variaveisDaGuia({
        nomeContato: "Maria",
        tipoGuia: "DAS",
        competencia: "07/2026",
        valorFormatado: "1.243,80",
        vencimentoFormatado: "20/08/2026",
      }),
    });

    expect(fetchFalso).toHaveBeenCalledTimes(2);

    // 1ª chamada: upload multipart em /media
    const [urlUpload, optsUpload] = fetchFalso.mock.calls[0];
    expect(urlUpload).toBe("https://graph.facebook.com/v21.0/1234567890/media");
    expect(optsUpload.body).toBeInstanceOf(FormData);
    expect(optsUpload.body.get("messaging_product")).toBe("whatsapp");
    expect(optsUpload.body.get("type")).toBe("application/pdf");
    expect(optsUpload.body.get("file")).toBeTruthy();
    // ⚠ Content-Type NÃO pode ser definido à mão no multipart: o boundary é do fetch.
    expect(optsUpload.headers["Content-Type"]).toBeUndefined();

    // 2ª chamada: o id do upload vai no header do template — e não há `link` em lugar nenhum.
    const [urlEnvio, optsEnvio] = fetchFalso.mock.calls[1];
    expect(urlEnvio).toBe("https://graph.facebook.com/v21.0/1234567890/messages");
    const enviado = JSON.parse(optsEnvio.body);
    expect(enviado.template.components[0].parameters[0].document).toEqual({
      id: "MEDIA-42",
      filename: "SIMPLES-2026-07.pdf",
    });
    expect(optsEnvio.body).not.toContain("\"link\"");
    expect(optsEnvio.headers["Content-Type"]).toBe("application/json");

    expect(r.wamid).toBe("wamid.HBgNNTUyMTk5OTk5ODg4OA==");
  });

  it("telefone inválido recusa ANTES do upload — não se gasta chamada com destino torto", async () => {
    const cliente = clienteCom([]);
    await expect(cliente.enviarGuia({ telefone: "abc", conteudoPdf: Buffer.from("x") }))
      .rejects.toThrow(/telefone do contato não é um número válido/i);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("PDF ausente recusa com o motivo — 'registro existe, arquivo não' é caso real aqui", async () => {
    const cliente = clienteCom([]);
    await expect(cliente.enviarGuia({ telefone: "5521999998888", conteudoPdf: null }))
      .rejects.toThrow(/arquivo da guia está vazio|não foi encontrado/i);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("upload que responde 200 sem id não é tratado como sucesso mudo", async () => {
    const cliente = clienteCom([ok({ sem: "id" })]);
    await expect(cliente.uploadDocumento({ conteudo: Buffer.from("x"), nomeArquivo: "g.pdf" }))
      .rejects.toThrow(WhatsappError);
  });

  it("o telefone é normalizado pela MESMA função do cadastro (E.164 sem '+')", async () => {
    const cliente = clienteCom([ok(RESPOSTA_ENVIO)]);
    await cliente.enviarTexto({ telefone: "(21) 99999-8888", texto: "oi" });
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body).to).toBe("5521999998888");
  });
});

describe("texto livre — a janela de 24h é decidida em outra camada", () => {
  it("envia e devolve o wamid", async () => {
    const cliente = clienteCom([ok(RESPOSTA_ENVIO)]);
    const r = await cliente.enviarTexto({ telefone: "5521999998888", texto: "Recebido!" });
    expect(JSON.parse(fetchFalso.mock.calls[0][1].body).type).toBe("text");
    expect(r.wamid).toBe("wamid.HBgNNTUyMTk5OTk5ODg4OA==");
  });

  it("com a janela fechada, o 131047 da Meta chega traduzido e NÃO como número", async () => {
    const cliente = clienteCom([
      falha(429, { error: { message: "(#131047) Re-engagement message", code: 131047, fbtrace_id: "T1" } }),
    ]);
    const erro = await cliente.enviarTexto({ telefone: "5521999998888", texto: "oi" }).catch((e) => e);
    expect(erro).toBeInstanceOf(WhatsappError);
    expect(erro.codigo).toBe("META_131047");
    expect(erro.mensagemUsuario).toMatch(/24 horas/i);
    expect(erro.podeTentarDeNovo).toBe(false);
  });

  it("texto vazio é recusado antes de sair", async () => {
    const cliente = clienteCom([]);
    await expect(cliente.enviarTexto({ telefone: "5521999998888", texto: "   " }))
      .rejects.toThrow(/mensagem está vazia/i);
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

describe("erros da Meta viram WhatsappError com codigo + mensagemUsuario", () => {
  it("o par que EnvioGuiaService.marcarFalhou grava vem pronto", async () => {
    const cliente = clienteCom([falha(400, { error: { message: "x", code: 131026 } })]);
    const erro = await cliente.enviarTexto({ telefone: "5521999998888", texto: "oi" }).catch((e) => e);
    expect(erro.codigo).toBe("META_131026");
    expect(typeof erro.mensagemUsuario).toBe("string");
    expect(erro.podeTentarDeNovo).toBe(false); // número sem WhatsApp não melhora com retentativa
  });

  it("rate limit vem marcado como retentável", async () => {
    const cliente = clienteCom([falha(429, { error: { message: "x", code: 130429 } })]);
    const erro = await cliente.enviarTexto({ telefone: "5521999998888", texto: "oi" }).catch((e) => e);
    expect(erro.podeTentarDeNovo).toBe(true);
  });

  it("queda de rede é 'não se sabe' — nem retentável nem definitivo", async () => {
    fetchFalso = jest.fn().mockRejectedValue(new Error("ECONNRESET"));
    const cliente = new WhatsappCloudClient({ fetchImpl: fetchFalso });
    const erro = await cliente.enviarTexto({ telefone: "5521999998888", texto: "oi" }).catch((e) => e);
    expect(erro.codigo).toBe(CODIGOS_LOCAIS.FALHA_DE_TRANSPORTE);
    expect(erro.podeTentarDeNovo).toBeNull();
    expect(erro.mensagemUsuario).toMatch(/duas vezes/i);
  });

  it("corpo de erro não-JSON não vira exceção crua — vira recusa nomeada", async () => {
    const cliente = clienteCom([{
      ok: false,
      status: 502,
      json: async () => { throw new Error("Unexpected token < in JSON"); },
    }]);
    const erro = await cliente.enviarTexto({ telefone: "5521999998888", texto: "oi" }).catch((e) => e);
    expect(erro.codigo).toBe(CODIGOS_LOCAIS.RESPOSTA_NAO_RECONHECIDA);
  });
});

describe("⚠ integração desligada ou incompleta: recusa NOMEADA, e nenhuma chamada sai", () => {
  it("flag OFF: diz que está desligada e não chama a Meta", async () => {
    const cliente = clienteCom([ok(RESPOSTA_ENVIO)], { habilitada: false });
    const erro = await cliente.enviarTexto({ telefone: "5521999998888", texto: "oi" }).catch((e) => e);
    expect(erro.codigo).toBe(CODIGOS_LOCAIS.NAO_CONFIGURADO);
    expect(erro.mensagemUsuario).toMatch(/desligado/i);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("credencial faltando: diz o NOME da variável — nunca o valor", async () => {
    const cliente = clienteCom([ok(RESPOSTA_ENVIO)], { token: "", versao: "" });
    const erro = await cliente.enviarTexto({ telefone: "5521999998888", texto: "oi" }).catch((e) => e);
    expect(erro.mensagemUsuario).toContain("WHATSAPP_TOKEN");
    expect(erro.mensagemUsuario).toContain("WHATSAPP_GRAPH_VERSION");
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("o diagnóstico lista o que falta sem expor nada", () => {
    const d = new WhatsappCloudClient({ fetchImpl: jest.fn(), config: { token: "", phoneNumberId: "" } })
      .diagnostico();
    expect(d.pronta).toBe(false);
    expect(d.faltando).toEqual(["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]);
    expect(JSON.stringify(d)).not.toContain(TOKEN_FALSO);
  });
});

// ── A regra dura ────────────────────────────────────────────────────────────────────────────────

describe("⚠ SEGREDO NUNCA SAI", () => {
  it("o token vai no header Authorization — e em lugar nenhum além dele", async () => {
    const cliente = clienteCom([ok({ id: "M1" }), ok(RESPOSTA_ENVIO)]);
    await cliente.enviarGuia({
      telefone: "5521999998888",
      conteudoPdf: Buffer.from("%PDF"),
      nomeArquivo: "g.pdf",
      variaveis: ["Maria"],
    });

    for (const [url, opts] of fetchFalso.mock.calls) {
      expect(url).not.toContain(TOKEN_FALSO);
      expect(opts.headers.Authorization).toBe(`Bearer ${TOKEN_FALSO}`);
      if (typeof opts.body === "string") expect(opts.body).not.toContain(TOKEN_FALSO);
    }
  });

  it("nenhuma linha de log carrega o token ou o app secret", async () => {
    const cliente = clienteCom([falha(401, { error: { message: "expirou", code: 190 } })]);
    await cliente.enviarTexto({ telefone: "5521999998888", texto: "oi" }).catch(() => {});

    const tudoQueFoiLogado = JSON.stringify([
      ...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls,
    ]);
    expect(tudoQueFoiLogado).not.toContain(TOKEN_FALSO);
    expect(tudoQueFoiLogado).not.toContain("app-secret-de-teste");
  });

  it("o erro lançado não carrega o token nem em message, nem serializado", async () => {
    const cliente = clienteCom([falha(401, { error: { message: "expirou", code: 190 } })]);
    const erro = await cliente.enviarTexto({ telefone: "5521999998888", texto: "oi" }).catch((e) => e);
    expect(erro.message).not.toContain(TOKEN_FALSO);
    expect(JSON.stringify(erro.traducao)).not.toContain(TOKEN_FALSO);
    expect(String(erro.stack)).not.toContain(TOKEN_FALSO);
  });

  it("⚠ o corpo da mensagem NÃO vai para o log, e o telefone vai mascarado (LGPD)", async () => {
    const cliente = clienteCom([ok(RESPOSTA_ENVIO)]);
    await cliente.enviarTexto({ telefone: "5521999998888", texto: "o DAS deste mês é 1.243,80" });

    const logado = JSON.stringify(log.info.mock.calls);
    expect(logado).not.toContain("1.243,80");
    expect(logado).not.toContain("5521999998888");
    expect(logado).toContain("+55…8888");
  });

  it("mascararTelefone guarda só os quatro últimos dígitos", () => {
    expect(mascararTelefone("5521999998888")).toBe("+55…8888");
    expect(mascararTelefone("12")).toBe("…");
  });
});

describe("⚠ NENHUM TESTE TOCA A REDE", () => {
  it("o fetch nativo continua intocado depois de todos os envios", async () => {
    const cliente = clienteCom([ok({ id: "M1" }), ok(RESPOSTA_ENVIO)]);
    await cliente.enviarGuia({
      telefone: "5521999998888",
      conteudoPdf: Buffer.from("%PDF"),
      nomeArquivo: "g.pdf",
      variaveis: ["Maria"],
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

// ── DOCUMENTO FORA DE TEMPLATE (Entrega 2, 02/09/2026) ─────────────────────────────────────────
import { montarPayloadDocumento } from "../WhatsappCloudClient.js";

describe("enviarDocumento — a resposta 'manda a guia' do assistente", () => {
  it("o payload é type=document com id (nunca link), filename e caption", () => {
    const p = montarPayloadDocumento({ para: "5521999998888", mediaId: "MID1", nomeArquivo: "DAS-2026-08.pdf", legenda: "Guia DAS" });
    expect(p).toEqual({ messaging_product: "whatsapp", recipient_type: "individual", to: "5521999998888", type: "document", document: { id: "MID1", filename: "DAS-2026-08.pdf", caption: "Guia DAS" } });
    expect(JSON.stringify(p)).not.toMatch(/link/);
  });
  it("sem mediaId recusa localmente", () => {
    expect(() => montarPayloadDocumento({ para: "5521999998888", mediaId: "" })).toThrow(/documento não foi informado/);
  });
  it("enviarDocumento sobe o PDF (media) e depois manda a mensagem (messages), com o token só no header", async () => {
    const chamadas = [];
    const fetchImpl = jest.fn(async (url, opts) => {
      chamadas.push({ url, opts });
      const json = url.endsWith("/media") ? { id: "MID9" } : { messages: [{ id: "wamid.doc" }] };
      return { ok: true, status: 200, json: async () => json };
    });
    const c = new WhatsappCloudClient({ fetchImpl, config: { habilitada: true, token: "T", phoneNumberId: "P", versao: "v21.0", log: null } });
    const r = await c.enviarDocumento({ telefone: "(21) 99999-8888", conteudo: Buffer.from("%PDF"), nomeArquivo: "x.pdf", legenda: "leg" });
    expect(r.wamid).toBe("wamid.doc");
    expect(chamadas[0].url).toMatch(/\/media$/);
    expect(chamadas[1].url).toMatch(/\/messages$/);
    const corpo = JSON.parse(chamadas[1].opts.body);
    expect(corpo.type).toBe("document");
    expect(corpo.document).toEqual({ id: "MID9", filename: "x.pdf", caption: "leg" });
    expect(chamadas[1].opts.headers.Authorization).toBe("Bearer T");
    expect(chamadas[1].url).not.toMatch(/T/);
  });
});
