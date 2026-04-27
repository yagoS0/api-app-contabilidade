import axios from "axios";

function buildMappedError({ code, message, status = null, retryable = false, details = null, cause = null }) {
  const err = new Error(message || "serpro_request_failed");
  err.code = code || "SERPRO_REQUEST_FAILED";
  err.status = status;
  err.retryable = retryable;
  err.details = details;
  if (cause) err.cause = cause;
  return err;
}

function pickProviderMessage(data) {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (Array.isArray(data?.mensagens) && typeof data.mensagens[0]?.texto === "string") return data.mensagens[0].texto;
  if (typeof data?.message === "string") return data.message;
  if (typeof data?.error_description === "string") return data.error_description;
  if (typeof data?.error === "string") return data.error;
  if (typeof data?.detail === "string") return data.detail;
  return null;
}

function normalizeProviderMessage(message) {
  const raw = String(message || "").trim();
  if (!raw) return raw;
  if (/header ['"]?Role-Type['"]? deve estar preenchido/i.test(raw)) {
    return "Configuracao incompleta da integracao SERPRO: o header obrigatorio Role-Type nao estava sendo enviado.";
  }
  if (/^runtime error$/i.test(raw)) {
    return "Erro de integracao SERPRO: o endpoint chamado nao foi encontrado ou nao corresponde ao metodo esperado.";
  }
  return raw;
}

export function mapSerproError(error, fallbackCode = "SERPRO_REQUEST_FAILED") {
  if (!error) {
    return buildMappedError({
      code: fallbackCode,
      message: "serpro_request_failed",
      retryable: false,
    });
  }

  if (error.code && String(error.code).startsWith("SERPRO_")) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const status = Number(error.response?.status || 0) || null;
    const providerData = error.response?.data || null;
    const providerMessage = normalizeProviderMessage(pickProviderMessage(providerData) || error.message || "serpro_request_failed");

    if (status === 401 || status === 403) {
      return buildMappedError({
        code: "SERPRO_AUTH_ERROR",
        message: providerMessage,
        status,
        retryable: false,
        details: providerData,
        cause: error,
      });
    }

    if (status === 400 || status === 404 || status === 422) {
      return buildMappedError({
        code: "SERPRO_BUSINESS_ERROR",
        message: providerMessage,
        status,
        retryable: false,
        details: providerData,
        cause: error,
      });
    }

    if (status === 429) {
      return buildMappedError({
        code: "SERPRO_RATE_LIMIT",
        message: providerMessage,
        status,
        retryable: true,
        details: providerData,
        cause: error,
      });
    }

    if (status >= 500) {
      return buildMappedError({
        code: "SERPRO_SERVICE_UNAVAILABLE",
        message: providerMessage,
        status,
        retryable: true,
        details: providerData,
        cause: error,
      });
    }

    if (error.code === "ECONNABORTED") {
      return buildMappedError({
        code: "SERPRO_TIMEOUT",
        message: providerMessage,
        retryable: true,
        details: providerData,
        cause: error,
      });
    }

    return buildMappedError({
      code: fallbackCode,
      message: providerMessage,
      status,
      retryable: false,
      details: providerData,
      cause: error,
    });
  }

  return buildMappedError({
    code: fallbackCode,
    message: error?.message || "serpro_request_failed",
    retryable: false,
    cause: error,
  });
}
