import { Buffer } from "node:buffer";
import {
  INTEGRACAO_SERPRO_PAGTOWEB,
  SERPRO_PAGTOWEB_SYSTEM,
  SERPRO_PAGTOWEB_SERVICE_COMPROVANTE,
} from "../../../config.js";
import { getResolvedSerproCredentials } from "./SerproRuntimeSettings.js";
import { SerproHttpClient } from "./SerproHttpClient.js";

// ⚠ Q40 — NÃO INVENTAR: idSistema/idServico/payload do PAGTOWEB (COMPARRECADACAO) são o palpite da
// spec; precisam ser confirmados no catálogo oficial + validados no sandbox antes de ligar a flag
// INTEGRACAO_SERPRO_PAGTOWEB. Enquanto a flag estiver OFF, este serviço nunca é chamado em produção.
// O parse é defensivo: comprovante PDF (base64) presente = PAGO; mensagem "não localizado"/vazio = não pago.
const VERIFICADO_TRIAL = false;

function onlyDigits(value) {
  return String(value || "").replace(/\D+/g, "");
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

function extractComprovantePdfBase64(payload) {
  const raw = searchValueDeep(payload, (key, value) => {
    const normalized = String(key || "").toLowerCase();
    if (!/(pdf|comprovante|arquivo|documento|arrecad)/.test(normalized)) return false;
    return typeof value === "string" && value.length > 100;
  });
  return raw ? String(raw).trim() : null;
}

function extractNotFoundMessage(payload) {
  const value = searchValueDeep(payload, (key, val) => {
    const normalized = String(key || "").toLowerCase();
    if (!/(mensagem|status|texto|erro|situac)/.test(normalized)) return false;
    return typeof val === "string" || typeof val === "number";
  });
  if (value == null) return null;
  const text = String(value);
  if (/nao localiz|não localiz|inexist|nenhum|sem pagamento|nao encontrad|não encontrad|sem documento/i.test(text)) {
    return text;
  }
  return null;
}

// ✅ VALIDADO em produção (27/07/2026) com o probe `scripts/probe-pagtoweb.mjs`:
//   {"numeroDocumento":"07162619444412336"} → HTTP 200 · Sucesso-PAGTOWEB-00000 + comprovante.
// Duas coisas confirmadas na prática:
//   • o campo é `numeroDocumento` — `numeroDocumentoArrecadacao` devolve
//     "EntradaIncorreta-PAGTOWEB-00001: Parâmetro de entrada ... inválido";
//   • o valor tem que ser SÓ DÍGITOS. Com a máscara do documento (07.16.26194.4441233-6) o
//     serviço responde 500 / Erro-PAGTOWEB-00099 (erro interno genérico) — era isso que fazia a
//     confirmação de pagamento nunca funcionar.
function buildPagtoWebPayload({ numeroDocumento }) {
  const doc = String(numeroDocumento || "").replace(/\D+/g, "");
  if (!doc) {
    const err = new Error("numero_documento_required");
    err.code = "SERPRO_PAGTOWEB_NUMERO_DOCUMENTO_REQUIRED";
    throw err;
  }
  return {
    pedidoDados: {
      idSistema: SERPRO_PAGTOWEB_SYSTEM,
      idServico: SERPRO_PAGTOWEB_SERVICE_COMPROVANTE,
      versaoSistema: "1.0",
      dados: JSON.stringify({ numeroDocumento: doc }),
    },
  };
}

/**
 * Consulta o comprovante de arrecadação de um documento (DAS/DARF/INSS) no PAGTOWEB.
 * Retorna { pago, comprovantePdfBuffer?, mensagem?, verificadoTrial, rawPayload }.
 * - pago=true quando o SERPRO devolve o comprovante (PDF base64).
 * - pago=false quando devolve "não localizado" / vazio (ainda não pago).
 * Só roda com a flag INTEGRACAO_SERPRO_PAGTOWEB ligada (senão lança SERPRO_PAGTOWEB_DISABLED).
 */
// Concatena as mensagens do envelope (para o diagnóstico da 1ª resposta real do trial).
function extractMensagensTexto(payload) {
  if (payload == null) return "";
  let obj = payload;
  if (typeof payload === "string") obj = parseNestedJsonString(payload) || {};
  if (typeof obj !== "object") return String(payload);
  const bag = [];
  const m = obj.mensagens || obj.Mensagens || obj.mensagem || obj.Mensagem;
  const push = (x) => {
    if (x == null) return;
    if (typeof x === "string") bag.push(x);
    else if (typeof x === "object") bag.push(String(x.texto || x.mensagem || x.descricao || JSON.stringify(x)));
  };
  if (Array.isArray(m)) m.forEach(push); else push(m);
  return bag.filter(Boolean).join(" | ");
}

export async function confirmarPagamento({ contratanteCnpj, contribuinteCnpj, numeroDocumento, logger = null }) {
  if (!INTEGRACAO_SERPRO_PAGTOWEB) {
    const err = new Error("serpro_pagtoweb_disabled");
    err.code = "SERPRO_PAGTOWEB_DISABLED";
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
  if (!contribuinte || contribuinte.length !== 14) {
    const err = new Error("serpro_contribuinte_cnpj_invalid");
    err.code = "SERPRO_CONTRIBUINTE_CNPJ_INVALID";
    throw err;
  }

  const client = new SerproHttpClient();
  // raw + validateStatus: não estoura em 4xx (documento não pago/não localizado é resposta de negócio,
  // não erro de rede). versaoSistema "1.0" (COMPARRECADACAO72) — NÃO reusar o 2.0 do SITFIS.
  const resp = await client.post("/Emitir", {
    contratante: { numero: procuradorCnpj, tipo: 2 },
    autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
    contribuinte: { numero: contribuinte, tipo: 2 },
    ...buildPagtoWebPayload({ numeroDocumento }),
  }, { raw: true, validateStatus: () => true });

  const httpStatus = resp.status;
  const data = resp.data;
  const mensagem = extractMensagensTexto(data);

  // Diagnóstico (validação no trial): status + mensagem + chaves do `dados` de saída — fixa o parse depois.
  const parsedDados = (() => {
    try { const d = data && (data.dados ?? data.Dados); return typeof d === "string" ? JSON.parse(d) : d; } catch { return null; }
  })();
  logger?.warn?.(
    { httpStatus, mensagem, dadosKeys: parsedDados && typeof parsedDados === "object" ? Object.keys(parsedDados) : null },
    "PAGTOWEB: resposta /Emitir",
  );

  // 200 com comprovante (PDF base64) = PAGO.
  const pdfBase64 = extractComprovantePdfBase64(data);
  if (pdfBase64) {
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    if (pdfBuffer.length > 0) {
      // O comprovante só vem como PDF (validado: `dados` = { pdf }, sem campos estruturados).
      // Lemos o texto pra obter a DATA DE ARRECADAÇÃO e a quebra principal/juros/multa — é isso
      // que permite baixar na data certa em vez de "hoje" + valor devido da guia.
      // Best-effort: falha na leitura NÃO invalida o pagamento (o PDF é a prova).
      let comprovante = null;
      // A COMPOSIÇÃO POR CÓDIGO DE RECEITA, do mesmo texto. É ela que distingue, dentro de uma
      // parcela de parcelamento, a dívida consolidada sendo amortizada (códigos-tributo) do
      // encargo corrente do mês (códigos TJLP) — duas naturezas contábeis no mesmo documento.
      // O bloco "Totais" que o `comprovante` traz não permite essa separação.
      let composicao = null;
      try {
        const pdfParse = (await import("pdf-parse")).default;
        const { parseComprovanteArrecadacao } = await import("./parseComprovanteArrecadacao.js");
        const { parseComposicaoComprovante } = await import("./parseComposicaoComprovante.js");
        const out = await pdfParse(pdfBuffer);
        const texto = out?.text || "";
        comprovante = parseComprovanteArrecadacao(texto);
        composicao = parseComposicaoComprovante(texto);
      } catch (err) {
        logger?.warn?.({ err: err?.message }, "PAGTOWEB: não consegui ler o texto do comprovante (segue com o PDF)");
      }
      return {
        pago: true,
        comprovantePdfBuffer: pdfBuffer,
        // `confiavel:false` = não conseguimos a quebra com segurança (a soma não fechou) →
        // quem chama deve pedir conferência humana em vez de lançar valores.
        comprovante,
        composicao,
        mensagem: null,
        verificadoTrial: VERIFICADO_TRIAL,
        rawPayload: data,
      };
    }
  }

  // 5xx = indisponibilidade transitória → erro (cliente re-tenta depois).
  if (httpStatus >= 500) {
    const err = new Error(mensagem || "serpro_pagtoweb_indisponivel");
    err.code = "SERPRO_PAGTOWEB_INDISPONIVEL";
    err.details = { httpStatus, mensagem };
    throw err;
  }

  // Sem comprovante (200 sem PDF, ou 4xx de negócio) = NÃO PAGO / não localizado.
  return {
    pago: false,
    comprovantePdfBuffer: null,
    mensagem: extractNotFoundMessage(data) || mensagem || "Comprovante de pagamento não localizado no SERPRO.",
    verificadoTrial: VERIFICADO_TRIAL,
    rawPayload: data,
  };
}
