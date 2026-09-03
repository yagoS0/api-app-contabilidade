// CLIENTE DA WHATSAPP CLOUD API (Meta) — Entrega 1, F3.
//
// ⚠ NADA FOI ENVIADO, EM AMBIENTE NENHUM. Nenhuma rota, nenhum worker e nenhum serviço chama este
// módulo. Ele existe para ser exercível quando as credenciais chegarem, e todo teste roda com
// `fetch` INJETADO — não há uma chamada de rede sequer na suíte.
//
// ── O QUE ESTE MÓDULO SABE FAZER ─────────────────────────────────────────────────────────────────
//   1. subir o PDF da guia como mídia          → `uploadDocumento`
//   2. enviar o template com o PDF no cabeçalho → `enviarTemplateComDocumento`
//   3. enviar template só de corpo              → `enviarTemplate`
//   4. enviar texto livre (janela de 24h)       → `enviarTexto`
// A janela de 24h é assunto de OUTRA camada: aqui só se sabe que texto livre existe como operação,
// e que a Meta responde `131047` quando ela está fechada (traduzido em `errosMeta.js`).
//
// ── FONTES ───────────────────────────────────────────────────────────────────────────────────────
// [M1] Cloud API — Messages reference:
//      https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
//      Consultado em 2026-08-14. De lá: `POST /{Version}/{Phone-Number-ID}/messages`, base
//      `https://graph.facebook.com`, os headers `Authorization`/`Content-Type`, os campos de topo
//      (`messaging_product`, `recipient_type` ∈ individual|group, `to`, `type`), o corpo do texto,
//      o corpo do template com header de documento, a forma da resposta de sucesso
//      (`messaging_product` / `contacts[]` / `messages[].id`) e a frase do objeto de mídia:
//      **"A media object. Either `id` or `link` is required."**
// [M2] Cloud API — Media:
//      https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
//      Consultado em 2026-08-14. De lá: `POST /<PHONE_NUMBER_ID>/media`, os três campos do
//      formulário (`file`, `type`, `messaging_product: whatsapp`), a resposta `{ "id": "<MEDIA_ID>" }`,
//      `application/pdf` suportado até 100 MB, e "Media IDs returned by the API expire after 30 days".
// [M3] Service messages (janela de 24h):
//      https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
//      Consultado em 2026-08-14: "When the window closes, you can only send pre-approved template
//      messages."
// [E]  **Esqueleto do dono** (`src/whatsapp/client.js`, entregue em 2026-08-14) — de onde saem a
//      versão da Graph API (`v21.0`), o nome do template (`guia_disponivel`), o idioma (`pt_BR`) e a
//      ORDEM das cinco variáveis do corpo. Nenhum desses cinco itens está na documentação da Meta:
//      são decisão do escritório, e por isso vêm marcados `[E]` onde aparecem.

import {
  INTEGRACAO_WHATSAPP,
  WHATSAPP_TOKEN,
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_GRAPH_BASE_URL,
  WHATSAPP_GRAPH_VERSION,
  WHATSAPP_TIMEOUT_MS,
  WHATSAPP_TEMPLATE_GUIA,
  WHATSAPP_TEMPLATE_IDIOMA,
  log,
} from "../../config.js";
import { normalizarE164 } from "./telefone.js";
import {
  CODIGOS_LOCAIS,
  RETENTATIVA,
  BASE_DA_RETENTATIVA,
  FONTE,
  podeTentarDeNovo,
  traduzirErroMeta,
  traduzirFalhaDeTransporte,
} from "./errosMeta.js";

/**
 * O erro que sobe deste módulo. Carrega `codigo` e `mensagemUsuario` porque é exatamente o par que
 * `EnvioGuiaService.marcarFalhou({ codigo, mensagemUsuario })` grava — a tradução não precisa de
 * adaptador entre um e outro.
 *
 * ⚠ `message` (o do `Error`) NUNCA contém segredo: ele é a mensagem do contador, não o dump da
 * requisição. Headers não entram aqui em hipótese alguma.
 */
export class WhatsappError extends Error {
  constructor(traducao) {
    super(traducao.mensagemUsuario);
    this.name = "WhatsappError";
    this.codigo = traducao.codigo;
    this.mensagemUsuario = traducao.mensagemUsuario;
    this.traducao = traducao;
    /** `true` / `false` / **`null`** — null é "a fonte não diz". Ver `podeTentarDeNovo`. */
    this.podeTentarDeNovo = podeTentarDeNovo(traducao);
  }
}

function recusaLocal(codigo, mensagemUsuario) {
  return new WhatsappError({
    codigo,
    codigoMeta: null,
    traduzido: false,
    titulo: null,
    onde: null,
    solucaoDocumentada: null,
    detalheDaMeta: "",
    mensagemUsuario,
    // Recusa nossa não é caso de reenviar: o que falta é o dado, não a sorte.
    retentativa: RETENTATIVA.NAO,
    baseDaRetentativa: BASE_DA_RETENTATIVA.DOCUMENTADA,
    httpStatus: null,
    httpStatusDocumentado: null,
    fbtraceId: null,
    subcodigoMeta: null,
    fonte: FONTE,
    procedencia: null,
    noEsqueletoDoDono: false,
    divergeDoEsqueleto: null,
  });
}

/**
 * Telefone mascarado para log: `5521999998888` → `+55…8888`.
 *
 * ⚠ O plano manda "logs sem corpo de mensagem" (LGPD, Fase 3.2). O número inteiro num log de
 * aplicação é dado pessoal do cliente do cliente; os quatro últimos dígitos bastam para o contador
 * reconhecer a linha ao investigar.
 */
export function mascararTelefone(e164) {
  const d = String(e164 || "").replace(/\D+/g, "");
  if (d.length < 4) return "…";
  return `+${d.slice(0, 2)}…${d.slice(-4)}`;
}

// ── PAYLOADS ─────────────────────────────────────────────────────────────────────────────────────
// Puros de propósito: é onde a forma exata do que sai para a Meta pode ser afirmada por teste sem
// nenhuma rede. Um payload errado só falharia em produção, com o cliente do outro lado.

/**
 * Header de documento. [M1]
 *
 * ⚠ `id` XOR `link`, e a exigência é da fonte: "Either `id` or `link` is required" [M1].
 * Mandar os dois, ou nenhum, é recusado AQUI — não na Meta, e não em produção.
 *
 * ⚠ **ESTE PROJETO USA `id`, NÃO `link`** — ver `enviarGuia` para o motivo (é decisão, não detalhe).
 */
export function montarHeaderDocumento({ mediaId, link, nomeArquivo }) {
  const temId = Boolean(String(mediaId || "").trim());
  const temLink = Boolean(String(link || "").trim());
  if (temId === temLink) {
    throw recusaLocal(
      CODIGOS_LOCAIS.RECUSA_LOCAL,
      temId
        ? "O documento foi informado das duas formas ao mesmo tempo (arquivo enviado e link). A Meta aceita uma só."
        : "O documento do template não foi informado: falta o arquivo enviado à Meta ou o link dele.",
    );
  }
  const documento = temId ? { id: String(mediaId).trim() } : { link: String(link).trim() };
  const nome = String(nomeArquivo || "").trim();
  // `filename` é o nome que o cliente vê no anexo. Sem ele o WhatsApp mostra um nome qualquer, e
  // "documento.pdf" no celular do cliente não diz qual guia é.
  if (nome) documento.filename = nome;
  return { type: "header", parameters: [{ type: "document", document: documento }] };
}

/**
 * Corpo do template. Aceita as DUAS formas documentadas de variável:
 *  - posicional (`{{1}}`, `{{2}}`…): array de strings → `{ type: "text", text }`
 *  - nomeada (`{{nome}}`): array de `{ nome, valor }` → `{ type: "text", parameter_name, text }` [M1]
 *
 * ⚠ O template `guia_disponivel` do plano é POSICIONAL (`{{1}}`…`{{5}}`), e a ORDEM das cinco
 * variáveis vem do esqueleto do dono [E], não da Meta: nome · tipo da guia · competência · valor ·
 * vencimento. Trocar a ordem manda o vencimento no lugar do valor, e a mensagem sai errada para o
 * cliente sem erro nenhum da Meta.
 */
export function montarCorpoTemplate(variaveis) {
  const lista = Array.isArray(variaveis) ? variaveis : [];
  if (!lista.length) return null;
  const parametros = lista.map((v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nome = String(v.nome ?? v.parameter_name ?? "").trim();
      if (!nome) {
        throw recusaLocal(
          CODIGOS_LOCAIS.RECUSA_LOCAL,
          "Uma variável nomeada do template foi enviada sem nome.",
        );
      }
      return { type: "text", parameter_name: nome, text: String(v.valor ?? v.text ?? "") };
    }
    return { type: "text", text: String(v ?? "") };
  });
  return { type: "body", parameters: parametros };
}

/** Corpo completo de um envio de template. [M1] */
export function montarPayloadTemplate({ para, template, idioma, componentes = [] }) {
  return {
    messaging_product: "whatsapp",
    // Documentado em [M1] entre os campos de topo (`individual` | `group`). O esqueleto do dono o
    // omite; explicitá-lo não muda o destino e deixa a intenção legível.
    recipient_type: "individual",
    to: para,
    type: "template",
    template: {
      name: template,
      language: { code: idioma },
      components: componentes.filter(Boolean),
    },
  };
}

/**
 * Corpo de um DOCUMENTO fora de template (mensagem de serviço). [M1]
 *
 * Referência de Messages: `type: "document"` com o objeto de mídia `{ id | link, caption?, filename? }`
 * — o MESMO objeto do header de template (`montarHeaderDocumento`), agora como mensagem própria.
 * ⚠ SÓ VALE COM A JANELA DE 24H ABERTA (mensagem de serviço), e ⚠ `id`, nunca `link`, pelos dois
 * motivos escritos em `enviarGuia`. Nasceu em 02/09/2026 para o assistente responder "manda a guia"
 * com o PDF; até então só existia documento dentro de template.
 */
export function montarPayloadDocumento({ para, mediaId, nomeArquivo, legenda }) {
  const documento = { id: String(mediaId || "").trim() };
  if (!documento.id) {
    throw recusaLocal(CODIGOS_LOCAIS.RECUSA_LOCAL, "O documento não foi informado: falta o arquivo enviado à Meta.");
  }
  const nome = String(nomeArquivo || "").trim();
  if (nome) documento.filename = nome;
  const caption = String(legenda || "").trim();
  if (caption) documento.caption = caption;
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: para,
    type: "document",
    document: documento,
  };
}

/** Corpo de um texto livre. [M1] */
export function montarPayloadTexto({ para, texto, previewUrl = false }) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: para,
    type: "text",
    text: { preview_url: Boolean(previewUrl), body: texto },
  };
}

// ── O CLIENTE ────────────────────────────────────────────────────────────────────────────────────

export class WhatsappCloudClient {
  /**
   * @param {object} [opcoes]
   * @param {Function} [opcoes.fetchImpl]  ⚠ O ponto de injeção. Default: `fetch` nativo do Node 20.
   *   Todo teste passa o seu — nenhum toca a rede.
   * @param {object} [opcoes.config]  sobrescreve o que vem de `config.js` (usado só por teste).
   */
  constructor(opcoes = {}) {
    const cfg = opcoes.config || {};
    this.fetchImpl = opcoes.fetchImpl || globalThis.fetch;
    this.habilitada = cfg.habilitada ?? INTEGRACAO_WHATSAPP;
    this.token = cfg.token ?? WHATSAPP_TOKEN;
    this.phoneNumberId = cfg.phoneNumberId ?? WHATSAPP_PHONE_NUMBER_ID;
    this.baseUrl = String(cfg.baseUrl ?? WHATSAPP_GRAPH_BASE_URL).replace(/\/+$/, "");
    this.versao = cfg.versao ?? WHATSAPP_GRAPH_VERSION;
    this.timeoutMs = cfg.timeoutMs ?? WHATSAPP_TIMEOUT_MS;
    this.templateGuia = cfg.templateGuia ?? WHATSAPP_TEMPLATE_GUIA;
    this.idioma = cfg.idioma ?? WHATSAPP_TEMPLATE_IDIOMA;
    this.log = cfg.log ?? log;
  }

  /**
   * A integração está utilizável?
   *
   * ⚠ Devolve os NOMES do que falta, nunca os valores. "Sem credencial, integração desabilitada" é
   * o padrão do SERPRO neste projeto; o que se acrescenta aqui é que a recusa DIZ o que falta —
   * ausência muda faz o contador clicar em "enviar" e não entender por que nada acontece.
   */
  diagnostico() {
    const faltando = [];
    if (!this.token) faltando.push("WHATSAPP_TOKEN");
    if (!this.phoneNumberId) faltando.push("WHATSAPP_PHONE_NUMBER_ID");
    if (!this.versao) faltando.push("WHATSAPP_GRAPH_VERSION");
    if (typeof this.fetchImpl !== "function") faltando.push("fetch");
    return { habilitada: this.habilitada, faltando, pronta: this.habilitada && faltando.length === 0 };
  }

  assertPronta() {
    const d = this.diagnostico();
    if (d.pronta) return;
    if (!d.habilitada) {
      throw recusaLocal(
        CODIGOS_LOCAIS.NAO_CONFIGURADO,
        "O envio por WhatsApp está desligado neste ambiente (INTEGRACAO_WHATSAPP). "
        + "Nenhuma mensagem sai enquanto a integração não for habilitada.",
      );
    }
    throw recusaLocal(
      CODIGOS_LOCAIS.NAO_CONFIGURADO,
      "O envio por WhatsApp está sem configuração completa no servidor. "
      + `Falta definir: ${d.faltando.join(", ")}.`,
    );
  }

  /** `https://graph.facebook.com/v21.0/<PHONE_NUMBER_ID>/messages` [M1] */
  url(recurso) {
    return `${this.baseUrl}/${this.versao}/${this.phoneNumberId}/${recurso}`;
  }

  /**
   * O ÚNICO ponto por onde as chamadas passam — como o `SerproHttpClient` é para o SERPRO.
   *
   * ⚠ O token entra AQUI e não sai daqui. Ele vive no header `Authorization`, nunca na URL (que
   * aparece em log de proxy e em mensagem de erro) e nunca no corpo. Nada do que esta função
   * devolve ou lança carrega header.
   */
  async chamar({ recurso, corpo, formulario }) {
    this.assertPronta();

    const url = this.url(recurso);
    const cabecalhos = { Authorization: `Bearer ${this.token}` };
    // ⚠ Com FormData, o Content-Type é montado pelo fetch com o boundary. Defini-lo à mão quebra o
    // upload de um jeito que parece erro da Meta.
    if (!formulario) cabecalhos["Content-Type"] = "application/json";

    // Timeout sem dependência nova: AbortController é global no Node 20.
    const abortador = new AbortController();
    const relogio = setTimeout(() => abortador.abort(), this.timeoutMs);

    let resposta;
    try {
      resposta = await this.fetchImpl(url, {
        method: "POST",
        headers: cabecalhos,
        body: formulario || JSON.stringify(corpo),
        signal: abortador.signal,
      });
    } catch (causa) {
      // ⚠ NÃO SE SABE SE CHEGOU. Ver `traduzirFalhaDeTransporte`.
      throw new WhatsappError(traduzirFalhaDeTransporte(causa, { timeout: abortador.signal.aborted }));
    } finally {
      clearTimeout(relogio);
    }

    const status = Number(resposta?.status ?? 0) || null;
    let json = null;
    try {
      json = await resposta.json();
    } catch {
      json = null; // corpo vazio ou não-JSON: a tradução trata como "resposta não reconhecida".
    }

    if (!resposta?.ok) {
      const traducao = traduzirErroMeta(json, { httpStatus: status });
      // Log sem token, sem corpo de mensagem, sem telefone inteiro. Só o que serve para investigar.
      this.log?.warn?.(
        { codigo: traducao.codigo, httpStatus: status, fbtraceId: traducao.fbtraceId, recurso },
        "envio WhatsApp recusado pela Meta",
      );
      throw new WhatsappError(traducao);
    }

    return json;
  }

  /**
   * Sobe um documento e devolve o `media_id`. [M2]
   *
   * `POST /<PHONE_NUMBER_ID>/media`, multipart com `messaging_product`, `type` e `file`.
   * ⚠ O id **expira em 30 dias** [M2] — serve para enviar agora, não para guardar na guia.
   *
   * Sem dependência nova: `FormData`, `Blob` e `fetch` são globais no Node 20.
   */
  async uploadDocumento({ conteudo, nomeArquivo, mimeType = "application/pdf" }) {
    if (!conteudo || !conteudo.length) {
      throw recusaLocal(
        CODIGOS_LOCAIS.RECUSA_LOCAL,
        "O arquivo da guia está vazio ou não foi encontrado no armazenamento — não há o que enviar. "
        + "Confira se o PDF da guia ainda existe.",
      );
    }
    const formulario = new FormData();
    formulario.append("messaging_product", "whatsapp");
    formulario.append("type", mimeType);
    formulario.append("file", new Blob([conteudo], { type: mimeType }), String(nomeArquivo || "guia.pdf"));

    const json = await this.chamar({ recurso: "media", formulario });
    const mediaId = json?.id ? String(json.id) : null;
    if (!mediaId) {
      throw new WhatsappError(
        traduzirErroMeta(json, { httpStatus: 200 }),
      );
    }
    return mediaId;
  }

  /** Extrai o `wamid` da resposta de sucesso. [M1] É a chave de correlação com o webhook de status. */
  static wamidDaResposta(json) {
    return json?.messages?.[0]?.id ? String(json.messages[0].id) : null;
  }

  /**
   * Normaliza o destino com a MESMA função do cadastro (`telefone.js`).
   *
   * ⚠ Segunda normalização seria segunda verdade sobre "qual é o número" — o defeito que
   * `vinculoTelefone.js` documenta. E a Meta espera E.164 **sem o `+`**, que é o que
   * `normalizarE164` já devolve.
   */
  destino(telefone) {
    const e164 = normalizarE164(telefone);
    if (!e164) {
      throw recusaLocal(
        CODIGOS_LOCAIS.RECUSA_LOCAL,
        "O telefone do contato não é um número válido. Corrija-o no cadastro da empresa antes de enviar.",
      );
    }
    return e164;
  }

  /** Template com documento no cabeçalho + variáveis no corpo. [M1] */
  async enviarTemplateComDocumento({
    telefone,
    template = this.templateGuia,
    idioma = this.idioma,
    documento,
    variaveis = [],
  }) {
    const para = this.destino(telefone);
    const componentes = [montarHeaderDocumento(documento || {}), montarCorpoTemplate(variaveis)];
    const json = await this.chamar({
      recurso: "messages",
      corpo: montarPayloadTemplate({ para, template, idioma, componentes }),
    });
    this.log?.info?.(
      { template, para: mascararTelefone(para), comDocumento: true },
      "mensagem WhatsApp aceita pela Meta",
    );
    return { wamid: WhatsappCloudClient.wamidDaResposta(json), resposta: json };
  }

  /** Template só de corpo (`solicitar_documentos`, `lembrete_vencimento`, `sem_movimento`…). [M1] */
  async enviarTemplate({ telefone, template, idioma = this.idioma, variaveis = [] }) {
    const para = this.destino(telefone);
    const corpo = montarCorpoTemplate(variaveis);
    const json = await this.chamar({
      recurso: "messages",
      corpo: montarPayloadTemplate({ para, template, idioma, componentes: corpo ? [corpo] : [] }),
    });
    this.log?.info?.({ template, para: mascararTelefone(para) }, "mensagem WhatsApp aceita pela Meta");
    return { wamid: WhatsappCloudClient.wamidDaResposta(json), resposta: json };
  }

  /**
   * Texto livre.
   *
   * ⚠ SÓ VALE COM A JANELA DE 24H ABERTA — "When the window closes, you can only send pre-approved
   * template messages" [M3]. Este módulo **não decide** a janela: quem sabe quando o cliente falou
   * pela última vez é a camada de conversa. O que se garante aqui é que, se a janela estiver
   * fechada, a recusa da Meta (`131047`) chega ao contador dizendo o que fazer, e não como número.
   */
  async enviarTexto({ telefone, texto, previewUrl = false }) {
    const para = this.destino(telefone);
    const conteudo = String(texto ?? "").trim();
    if (!conteudo) {
      throw recusaLocal(CODIGOS_LOCAIS.RECUSA_LOCAL, "A mensagem está vazia — não há o que enviar.");
    }
    const json = await this.chamar({
      recurso: "messages",
      corpo: montarPayloadTexto({ para, texto: conteudo, previewUrl }),
    });
    // ⚠ O CORPO DA MENSAGEM NÃO VAI PARA O LOG (LGPD, plano §3.2). Só o tamanho.
    this.log?.info?.(
      { para: mascararTelefone(para), caracteres: conteudo.length },
      "texto livre WhatsApp aceito pela Meta",
    );
    return { wamid: WhatsappCloudClient.wamidDaResposta(json), resposta: json };
  }

  /**
   * DOCUMENTO fora de template — a resposta "manda a guia" do assistente (Entrega 2).
   *
   * ⚠ SÓ DENTRO DA JANELA DE 24H: é mensagem de serviço, e a Meta recusa fora dela (`131047`,
   * traduzido). Quem confere a janela é a camada de conversa (`janelaDaConversa`), ANTES de
   * chamar; aqui só se sabe que a operação existe.
   * O PDF sobe agora (`uploadDocumento`, `id`) — nunca `link`, nunca `media_id` guardado.
   */
  async enviarDocumento({ telefone, conteudo, nomeArquivo, legenda, mimeType = "application/pdf" }) {
    const para = this.destino(telefone);
    const mediaId = await this.uploadDocumento({ conteudo, nomeArquivo, mimeType });
    const json = await this.chamar({
      recurso: "messages",
      corpo: montarPayloadDocumento({ para, mediaId, nomeArquivo, legenda }),
    });
    this.log?.info?.({ para: mascararTelefone(para), documento: true }, "documento WhatsApp aceito pela Meta");
    return { wamid: WhatsappCloudClient.wamidDaResposta(json), resposta: json };
  }

  /**
   * A operação da Entrega 1: a guia vai como template, com o PDF anexado.
   *
   * ⚠⚠ O PDF SOBE COMO MÍDIA (`id`), NUNCA COMO URL PÚBLICA (`link`) — e isso é decisão, não
   * preferência de estilo. O esqueleto do dono usa `document: { link: pdfUrl }`, e o próprio
   * esqueleto oferece esta alternativa. Dois motivos, ambos concretos:
   *
   *  1. **Guia é documento fiscal do cliente.** Para a Meta baixar de um `link`, a URL tem de ser
   *     alcançável sem autenticação — qualquer um com o endereço lê a guia. Não existe, neste
   *     projeto, URL pública de guia; criar uma para viabilizar o anexo trocaria o problema do
   *     anexo por um vazamento de documento fiscal.
   *  2. **O volume do Railway é efêmero.** "Registro existe, arquivo não" já é caso REAL aqui, com
   *     guias e com relatórios SITFIS. Uma URL que a Meta busca *depois*, e que aponta para um
   *     arquivo que o próximo deploy apagou, falha em silêncio no meio do lote. O upload lê o PDF
   *     agora, na hora, pelo mesmo caminho que o e-mail já usa (`getGuidePdfBuffer`).
   *
   * ⚠ Nada na documentação da Meta desqualifica `id` — ao contrário: "Either `id` or `link` is
   * required" [M1] põe os dois em pé de igualdade, e o endpoint de upload existe exatamente para
   * isso [M2].
   *
   * O `conteudoPdf` chega por parâmetro (Buffer), como o `danfse` recebe o XML: este módulo não lê
   * banco, não lê storage e não sabe o que é uma guia. Quem chamar passa o retorno de
   * `getGuidePdfBuffer(guide)` — a MESMA fonte de PDF do `guideEmailWorker`.
   */
  async enviarGuia({
    telefone,
    conteudoPdf,
    nomeArquivo,
    variaveis,
    template = this.templateGuia,
    idioma = this.idioma,
  }) {
    // Recusa o destino ANTES de gastar o upload: telefone torto não melhora depois de subir 200 KB.
    const para = this.destino(telefone);
    const mediaId = await this.uploadDocumento({ conteudo: conteudoPdf, nomeArquivo });
    return this.enviarTemplateComDocumento({
      telefone: para,
      template,
      idioma,
      documento: { mediaId, nomeArquivo },
      variaveis,
    });
  }
}

/**
 * As cinco variáveis do `guia_disponivel`, NA ORDEM. [E]
 *
 * ⚠ A ordem é do esqueleto do dono, não da Meta — a Meta não conhece o conteúdo do template, só
 * conta as variáveis (é o `132000`). Se o modelo aprovado tiver outra ordem, é AQUI que se conserta,
 * num lugar só, e não em cada chamador.
 *
 * ⚠ Valor e vencimento entram JÁ FORMATADOS (`"1.243,80"`, `"20/08/2026"`), como no esqueleto: a
 * formatação de moeda e data é decisão de apresentação, e este módulo não a toma.
 */
export function variaveisDaGuia({ nomeContato, tipoGuia, competencia, valorFormatado, vencimentoFormatado }) {
  return [nomeContato, tipoGuia, competencia, valorFormatado, vencimentoFormatado].map((v) => String(v ?? ""));
}

/** Nome do anexo que o cliente vê no WhatsApp. Mesma intenção do `guidePdfFilename` do e-mail. */
export function nomeArquivoDaGuia({ tipoGuia, competencia }) {
  const parte = (v) => String(v ?? "").trim().replace(/[\\/]+/g, "-");
  const base = [parte(tipoGuia), parte(competencia)].filter(Boolean).join("-");
  return `${base || "guia"}.pdf`;
}
