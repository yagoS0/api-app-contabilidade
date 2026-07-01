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

function buildPagtoWebPayload({ numeroDocumento }) {
  const doc = String(numeroDocumento || "").trim();
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
      // ⚠ estrutura de `dados` a confirmar no sandbox (verificadoTrial:false).
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
export async function confirmarPagamento({ contratanteCnpj, contribuinteCnpj, numeroDocumento }) {
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
  const response = await client.post("/Emitir", {
    contratante: { numero: procuradorCnpj, tipo: 2 },
    autorPedidoDados: { numero: procuradorCnpj, tipo: 2 },
    contribuinte: { numero: contribuinte, tipo: 2 },
    ...buildPagtoWebPayload({ numeroDocumento }),
  });

  const pdfBase64 = extractComprovantePdfBase64(response);
  if (pdfBase64) {
    const pdfBuffer = Buffer.from(pdfBase64, "base64");
    return {
      pago: pdfBuffer.length > 0,
      comprovantePdfBuffer: pdfBuffer.length > 0 ? pdfBuffer : null,
      mensagem: null,
      verificadoTrial: VERIFICADO_TRIAL,
      rawPayload: response,
    };
  }

  return {
    pago: false,
    comprovantePdfBuffer: null,
    mensagem: extractNotFoundMessage(response) || "Comprovante de pagamento não localizado no SERPRO.",
    verificadoTrial: VERIFICADO_TRIAL,
    rawPayload: response,
  };
}
