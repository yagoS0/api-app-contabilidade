import { Buffer } from "node:buffer";
import {
  INTEGRACAO_SERPRO_SITFIS,
  SERPRO_SITFIS_SYSTEM,
  SERPRO_SITFIS_SERVICE_PROTOCOLO,
  SERPRO_SITFIS_SERVICE_RELATORIO,
  SERPRO_SITFIS_VERSAO,
} from "../../../config.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproHttpClient } from "./SerproHttpClient.js";

// Q41 — idSistema/idServico/versão confirmados no catálogo oficial do Integra Contador:
// SITFIS assíncrono em 2 etapas: (1) SOLICITARPROTOCOLO91 → /Apoiar (dados="") devolve protocoloRelatorio;
// (2) RELATORIOSITFIS92 → /Emitir (dados = string JSON escapada {"protocoloRelatorio":...}).
// Fluxo assíncrono por STATUS HTTP: 200=pronto · 202=processando (aguardar tempoEspera) ·
// 304=protocolo válido ainda não modificado (aguardar, reusar o mesmo protocolo). versaoSistema="2.0".
// ⚠ Os LABELS exatos do relatório no retorno do /Emitir ainda serão confirmados na 1ª resposta real
// (trial/homolog) — o parsing é defensivo. Protocolo só vale no dia (America/Sao_Paulo): resolução inline.
const VERIFICADO_TRIAL = false;

const MAX_POLL_MS = 28 * 1000; // teto para responder inline sem estourar o timeout HTTP
const DEFAULT_WAIT_MS = 2000;
const MAX_WAIT_MS = 8000;

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function parseNestedJsonString(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function searchValueDeep(input, matcher) {
  if (input == null) return null;
  if (Array.isArray(input)) {
    for (const item of input) {
      const found = searchValueDeep(item, matcher);
      if (found != null) return found;
    }
    return null;
  }
  if (typeof input === "string") {
    const parsed = parseNestedJsonString(input);
    if (parsed) return searchValueDeep(parsed, matcher);
    return null;
  }
  if (typeof input !== "object") return null;
  for (const [key, value] of Object.entries(input)) {
    if (matcher(key, value)) return value;
    if (typeof value === "string") {
      const parsed = parseNestedJsonString(value);
      if (parsed != null) {
        const nested = searchValueDeep(parsed, matcher);
        if (nested != null) return nested;
      }
    }
    const found = searchValueDeep(value, matcher);
    if (found != null) return found;
  }
  return null;
}

function extractProtocolo(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    if (!/protocol/.test(normalized)) return false;
    return typeof value === "string" && value.length > 0;
  });
  return raw ? String(raw).trim() : null;
}

function extractTempoEspera(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return /(tempoespera|tempo_espera|retryafter|aguard)/.test(normalized) && value != null;
  });
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // SERPRO costuma devolver em segundos ou milissegundos — normaliza para ms.
  return n < 1000 ? n * 1000 : n;
}

function extractRelatorioPdfBase64(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    if (!/(pdf|relatorio.*b64|arquivo|documento)/.test(normalized)) return false;
    return typeof value === "string" && value.length > 100;
  });
  return raw ? String(raw).trim() : null;
}

function extractRelatorioTexto(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    if (!/(relatorio|situac|texto|conteudo)/.test(normalized)) return false;
    return typeof value === "string" && value.length > 40 && value.length < 100000;
  });
  return raw ? String(raw).trim() : null;
}

// SERPRO devolve HTTP 200 com um `status` no corpo (200 pronto / 202 processando / 304 protocolo válido).
function extractBodyStatus(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    return normalized === "status" && (typeof value === "number" || typeof value === "string");
  });
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// Q43: parse EXPLÍCITO do envelope Integra Contador — `dados` é sempre string JSON escapada.
function parseDadosEnvelope(resp) {
  const d = resp && (resp.dados ?? resp.Dados);
  if (d == null) return null;
  if (typeof d === "object") return d;
  const s = String(d).trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// Q43: em 204, o SERPRO manda o tempo de espera no HEADER (não no corpo).
function extractTempoEsperaHeader(headers) {
  if (!headers || typeof headers !== "object") return null;
  for (const [k, v] of Object.entries(headers)) {
    if (/tempo|retry|espera/i.test(k)) {
      const n = Number(String(v).replace(/[^\d]/g, ""));
      if (Number.isFinite(n) && n > 0) return n < 1000 ? n * 1000 : n;
    }
  }
  return null;
}

// Q43.1: concatena as mensagens de retorno do SERPRO (envelope + dados) para inspeção.
function extractMensagemTexto(payload) {
  if (payload == null) return "";
  let obj = payload;
  if (typeof payload === "string") obj = parseNestedJsonString(payload) || {};
  if (typeof obj !== "object") return String(payload);
  const bag = [];
  const push = (x) => {
    if (x == null) return;
    if (typeof x === "string") bag.push(x);
    else if (typeof x === "object") bag.push(String(x.texto || x.mensagem || x.descricao || JSON.stringify(x)));
  };
  const m = obj.mensagens || obj.Mensagens || obj.mensagem || obj.Mensagem;
  if (Array.isArray(m)) m.forEach(push); else push(m);
  const d = parseDadosEnvelope(obj);
  if (d && typeof d === "object") push(d.mensagem || d.mensagens || d.Mensagem);
  return bag.filter(Boolean).join(" | ");
}

// Q43.3: normaliza o protocolo. O ETag do /Apoiar pode vir como `W/"..."`, entre aspas, ou com o
// rótulo `protocoloRelatorio:` grudado na frente do base64. O /Emitir precisa APENAS do base64.
function normalizeProtocolo(v) {
  let s = String(v || "").trim();
  if (!s) return "";
  s = s.replace(/^W\//i, "").trim();                         // weak-etag
  s = s.replace(/^"+|"+$/g, "").trim();                       // aspas externas
  s = s.replace(/^protocolo(relatorio)?\s*[:=]\s*/i, "").trim(); // rótulo grudado
  s = s.replace(/^"+|"+$/g, "").trim();                       // aspas após o rótulo
  return s;
}

// Q43.1: SERPRO pede "Inicie uma nova solicitação /apoiar" quando o protocolo é inválido/expirado.
function pedeNovoProtocolo(text) {
  const t = String(text || "").toLowerCase();
  return /nova solicita|\/apoiar|protocolo.*(inv[aá]lid|expir|n[ãa]o encontrad|inexist|n[ãa]o localiz)/.test(t);
}

// Q43.6: o /Apoiar pode responder 200 SEM protocolo, com aviso AV02 ("limite de solicitações em
// processamento foi atingido — aguarde o tempoEspera"). Não é erro: o SERPRO está montando o protocolo
// e pede para reconsultar depois. Detecta esse caso para devolver "processando" em vez de falhar.
function pedeAguardarProtocolo(text) {
  const t = String(text || "").toLowerCase();
  return /limite de solicita|processamento foi atingido|em processamento|aguarde o tempo|av02/.test(t);
}

// Preview seguro da resposta do /Apoiar p/ diagnóstico (protocolo/mensagens; sem PDF/dado sensível).
function safeApoiarPreview(resp) {
  if (!resp || typeof resp !== "object") return { raw: String(resp).slice(0, 300) };
  return {
    status: resp.status ?? resp.Status ?? null,
    mensagens: resp.mensagens ?? resp.Mensagens ?? null,
    dados: typeof resp.dados === "string" ? resp.dados.slice(0, 500) : resp.dados,
  };
}

/**
 * Obtém o relatório de situação fiscal (SITFIS) de um contribuinte.
 * Resolve o polling inline (≤~28s); se não ficar pronto a tempo, retorna { processando:true }.
 * @returns {{ ok, processando?, protocolo?, relatorioPdfBuffer?, relatorioTexto?, verificadoTrial, rawPayload }}
 */
export async function obterRelatorio({ contratanteCnpj, contribuinteCnpj, tipo = 2, protocoloExistente = null, logger = null }) {
  if (!INTEGRACAO_SERPRO_SITFIS) {
    const err = new Error("serpro_sitfis_disabled");
    err.code = "SERPRO_SITFIS_DISABLED";
    throw err;
  }

  const runtime = await getResolvedSerproCredentials();
  const procuradorCnpj = onlyDigits(contratanteCnpj || runtime.certificate.document);
  if (!procuradorCnpj || procuradorCnpj.length !== 14) {
    const err = new Error("serpro_procurador_cnpj_not_configured");
    err.code = "SERPRO_PROCURADOR_CNPJ_NOT_CONFIGURED";
    throw err;
  }
  const contribuinte = onlyDigits(contribuinteCnpj);
  const contribuinteTipo = Number(tipo) === 1 ? 1 : 2;
  if (!contribuinte || (contribuinteTipo === 2 ? contribuinte.length !== 14 : contribuinte.length !== 11)) {
    const err = new Error("serpro_contribuinte_documento_invalid");
    err.code = "SERPRO_CONTRIBUINTE_DOCUMENTO_INVALID";
    throw err;
  }

  const client = new SerproHttpClient();
  const envelopeBase = {
    contratante: { numero: procuradorCnpj, tipo: 2 },
    autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
    contribuinte: { numero: contribuinte, tipo: contribuinteTipo },
  };

  // Etapa 1: solicitar protocolo (SOLICITARPROTOCOLO91 → /Apoiar) — GRÁTIS.
  // Cache oficial do SITFIS: se já há protocolo válido no dia, o /Apoiar responde 304 e o protocolo vem
  // no header ETag (corpo vazio). Se não há, responde 200 com o protocolo no corpo (dados.protocoloRelatorio).
  async function solicitarProtocolo() {
    const resp = await client.post("/Apoiar", {
      ...envelopeBase,
      pedidoDados: {
        idSistema: SERPRO_SITFIS_SYSTEM,
        idServico: SERPRO_SITFIS_SERVICE_PROTOCOLO,
        versaoSistema: SERPRO_SITFIS_VERSAO,
        dados: "",
      },
    }, { raw: true, validateStatus: () => true }); // aceita 304 (cache) sem lançar

    const httpStatus = resp.status;
    const headers = resp.headers || {};
    const etagRaw = headers.etag || headers.ETag || headers.Etag || null;
    const etag = etagRaw ? normalizeProtocolo(etagRaw) : null;

    let proto = null;
    let fonte = null;
    if (httpStatus === 304) {
      proto = etag; // 304 Not Modified = protocolo em cache, entregue no ETag
      fonte = etag ? "etag" : null;
    } else {
      const dados = parseDadosEnvelope(resp.data);
      const fromBody = dados && normalizeProtocolo(dados.protocoloRelatorio || dados.protocolo || "");
      proto = fromBody || normalizeProtocolo(extractProtocolo(resp.data) || "") || etag;
      fonte = fromBody ? "body" : (proto ? "etag" : null);
    }
    const dadosBody = parseDadosEnvelope(resp.data);
    const wait = extractTempoEspera(dadosBody) ?? extractTempoEspera(resp.data);
    logger?.warn?.({ httpStatus, fonte, temEtag: Boolean(etag) }, "SITFIS: /Apoiar");
    return { proto, wait, etag, status: httpStatus, resp: resp.data };
  }

  // Q43.7: reuso do protocolo do dia. O protocolo SITFIS vale o dia todo (America/Sao_Paulo); se já
  // temos um gravado hoje, pulamos o /Apoiar (que abre um "slot de processamento" por CONTRATANTE e é
  // o que dispara o limite AV02) e vamos direto ao /Emitir. Se o protocolo estiver inválido/expirado,
  // o loop do /Emitir detecta "inicie nova solicitação" e re-solicita automaticamente.
  let sol = null;
  if (protocoloExistente) {
    const proto = normalizeProtocolo(protocoloExistente);
    if (proto) {
      logger?.warn?.({ reuso: true }, "SITFIS: reusando protocolo do dia (pulando /Apoiar)");
      sol = { proto, wait: 0, etag: null, status: 200, resp: null };
    }
  }
  if (!sol) sol = await solicitarProtocolo();
  if (!sol.proto) {
    // Q43.6: caso legítimo de "aguarde" — o /Apoiar 200 sem protocolo, com tempoEspera / aviso AV02
    // ("limite de solicitações em processamento atingido"). Se o tempo cabe no orçamento inline,
    // aguarda e re-solicita 1x; senão devolve "processando" para o cliente reconsultar depois.
    const msgApoiar = extractMensagemTexto(sol.resp);
    if (sol.wait || pedeAguardarProtocolo(msgApoiar)) {
      const waitMs = sol.wait || 30000;
      if (waitMs <= MAX_POLL_MS - 3000) {
        await sleep(waitMs);
        sol = await solicitarProtocolo();
      }
      if (!sol.proto) {
        const segundos = Math.ceil(waitMs / 1000);
        logger?.warn?.({ status: sol.status, waitMs }, "SITFIS: /Apoiar pediu para aguardar (limite de processamento)");
        return {
          ok: true,
          processando: true,
          protocolo: null,
          relatorioPdfBuffer: null,
          relatorioTexto: null,
          verificadoTrial: VERIFICADO_TRIAL,
          rawPayload: sol.resp,
          tempoEsperaSegundos: segundos,
          mensagem: `O SERPRO está processando a solicitação (limite momentâneo atingido). Aguarde ~${segundos}s e consulte novamente.`,
        };
      }
    }
  }
  if (!sol.proto) {
    logger?.warn?.(
      { status: sol.status, temEtag: Boolean(sol.etag), apoiar: safeApoiarPreview(sol.resp) },
      "SITFIS: protocolo não encontrado no /Apoiar",
    );
    const err = new Error("serpro_sitfis_protocolo_not_found");
    err.code = "SERPRO_SITFIS_PROTOCOLO_NOT_FOUND";
    err.details = { status: sol.status, ...safeApoiarPreview(sol.resp) };
    throw err;
  }
  let protocolo = sol.proto;
  // O /Apoiar 200 traz o tempoEspera a aguardar antes do 1º /Emitir; no 304 (cache) usa espera curta.
  const preWait = sol.wait || (sol.status === 304 ? 1500 : 0);
  if (preWait) await sleep(Math.min(preWait, MAX_POLL_MS - 2000));

  // Etapa 2: consultar o relatório (RELATORIOSITFIS92 → /Emitir) — COBRADO (inclusive 202).
  // Status: 200=pronto · 202=processando (tempoEspera no corpo) · 204=processando (header) ·
  // 304=protocolo válido, reusar. Se o SERPRO mandar "inicie nova solicitação /apoiar" (protocolo
  // inválido/expirado), re-solicitamos o protocolo (até 1x) e tentamos de novo.
  const deadline = Date.now() + MAX_POLL_MS;
  let lastData = null;
  let logged = false;
  let resolicitou = 0;
  while (Date.now() < deadline) {
    const emitirDados = JSON.stringify({ protocoloRelatorio: protocolo });
    // eslint-disable-next-line no-await-in-loop
    const relResp = await client.post("/Emitir", {
      ...envelopeBase,
      pedidoDados: {
        idSistema: SERPRO_SITFIS_SYSTEM,
        idServico: SERPRO_SITFIS_SERVICE_RELATORIO,
        versaoSistema: SERPRO_SITFIS_VERSAO,
        dados: emitirDados, // string JSON escapada exata
      },
    }, { raw: true, validateStatus: () => true }); // aceita tudo — inspecionamos o corpo (não lança)

    const httpStatus = relResp.status;
    const data = relResp.data;
    lastData = data;
    const mensagem = extractMensagemTexto(data);

    // Diagnóstico (1x): status + mensagem + chaves do dados — pra fixar os labels do relatório depois.
    if (!logged) {
      logged = true;
      const parsed = parseDadosEnvelope(data);
      logger?.warn?.(
        { httpStatus, emitirDados, mensagem, dadosKeys: parsed && typeof parsed === "object" ? Object.keys(parsed) : null },
        "SITFIS: 1ª resposta do /Emitir",
      );
    }

    // 200 = relatório pronto → extrai PDF (base64) ou texto (parse defensivo).
    if (httpStatus === 200) {
      const pdfBase64 = extractRelatorioPdfBase64(data);
      if (pdfBase64) {
        const buffer = Buffer.from(pdfBase64, "base64");
        if (buffer.length > 0) {
          return { ok: true, protocolo, relatorioPdfBuffer: buffer, relatorioTexto: null, verificadoTrial: VERIFICADO_TRIAL, rawPayload: data };
        }
      }
      const texto = extractRelatorioTexto(data);
      if (texto) {
        return { ok: true, protocolo, relatorioPdfBuffer: null, relatorioTexto: texto, verificadoTrial: VERIFICADO_TRIAL, rawPayload: data };
      }
      // 200 sem relatório reconhecível → segue aguardando (defensivo).
    }

    // Protocolo inválido/expirado → SERPRO pede nova solicitação /apoiar. Re-solicita (até 1x) e retenta.
    if (pedeNovoProtocolo(mensagem)) {
      if (resolicitou >= 1) {
        const err = new Error("serpro_sitfis_protocolo_invalido");
        err.code = "SERPRO_SITFIS_PROTOCOLO_INVALIDO";
        err.details = { httpStatus, mensagem };
        throw err;
      }
      resolicitou += 1;
      logger?.warn?.({ httpStatus, mensagem }, "SITFIS: /Emitir pediu novo protocolo — re-solicitando /Apoiar");
      // eslint-disable-next-line no-await-in-loop
      sol = await solicitarProtocolo();
      if (!sol.proto) {
        // MESMA regra do /Apoiar inicial: 200 sem protocolo + tempoEspera/AV02 = "aguarde", não
        // erro. Esta re-solicitação é o caminho mais provável de bater no limite (o protocolo
        // salvo expirou → re-solicitamos → o /Apoiar é justamente o que consome o limite por
        // CONTRATANTE). Sem isso o contador via um "protocolo não encontrado" seco.
        const msgReSolic = extractMensagemTexto(sol.resp);
        if (sol.wait || pedeAguardarProtocolo(msgReSolic)) {
          const segundos = Math.ceil((sol.wait || 30000) / 1000);
          logger?.warn?.({ status: sol.status, wait: sol.wait }, "SITFIS: re-solicitação pediu para aguardar (limite)");
          return {
            ok: true,
            processando: true,
            protocolo: null,
            relatorioPdfBuffer: null,
            relatorioTexto: null,
            verificadoTrial: VERIFICADO_TRIAL,
            rawPayload: sol.resp,
            tempoEsperaSegundos: segundos,
            mensagem: `O SERPRO está processando a solicitação (limite momentâneo atingido). Aguarde ~${segundos}s e consulte novamente.`,
          };
        }
        logger?.warn?.(
          { status: sol.status, apoiar: safeApoiarPreview(sol.resp) },
          "SITFIS: re-solicitação do /Apoiar não devolveu protocolo",
        );
        const err = new Error("serpro_sitfis_protocolo_not_found");
        err.code = "SERPRO_SITFIS_PROTOCOLO_NOT_FOUND";
        // Sem os detalhes aqui, o erro chegava na tela sem nenhuma pista do motivo.
        err.details = { status: sol.status, etapa: "re-solicitacao", ...safeApoiarPreview(sol.resp) };
        throw err;
      }
      protocolo = sol.proto;
      // eslint-disable-next-line no-await-in-loop
      if (sol.wait) await sleep(Math.min(sol.wait, 5000));
      continue;
    }

    // 5xx/429 → indisponibilidade transitória: para e devolve processando (cliente re-tenta depois).
    if (httpStatus >= 500 || httpStatus === 429) {
      logger?.warn?.({ httpStatus, mensagem }, "SITFIS: /Emitir indisponível — tentar mais tarde");
      break;
    }
    // 4xx inesperado (não 304) → erro real, com a mensagem do SERPRO.
    if (httpStatus >= 400 && httpStatus !== 304) {
      const err = new Error("serpro_sitfis_emitir_erro");
      err.code = "SERPRO_SITFIS_EMITIR_ERRO";
      err.details = { httpStatus, mensagem };
      throw err;
    }

    // 202 → tempoEspera no corpo; 204 → tempoEspera no header; 304 → aguarda e reusa o protocolo.
    const wait = extractTempoEspera(data)
      || (httpStatus === 204 ? extractTempoEsperaHeader(relResp.headers) : null)
      || DEFAULT_WAIT_MS;
    // Respeita o tempoEspera CHEIO. Se o próximo /Emitir cairia fora do orçamento inline, para aqui
    // (não bate de novo — cada 202 é cobrado). O cliente re-tenta depois.
    if (Date.now() + wait >= deadline) break;
    // eslint-disable-next-line no-await-in-loop
    await sleep(wait);
  }

  // Não ficou pronto no orçamento inline — cliente re-tenta depois (protocolo só vale no mesmo dia).
  return {
    ok: true,
    processando: true,
    protocolo,
    relatorioPdfBuffer: null,
    relatorioTexto: null,
    verificadoTrial: VERIFICADO_TRIAL,
    rawPayload: lastData,
  };
}
