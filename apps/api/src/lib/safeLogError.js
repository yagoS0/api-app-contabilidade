// Q8.A.7: helper que loga erros com REDAÇÃO de campos sensíveis em qualquer profundidade.
// Uso típico:
//   try { parsePfxExpiry(buf, password) }
//   catch (err) { safeLogError(log, { guideId }, err, "Falha ao parsear PFX") }

const SENSITIVE_KEY_RE = /(password|passwd|pwd|secret|token|pfx|api[_-]?key|authorization|cookie)/i;
const REDACTED = "[REDACTED]";

function deepRedact(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return "[depth_limit]"; // proteção contra ciclos longos
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: deepRedactString(value.message),
      stack: value.stack ? String(value.stack).slice(0, 4000) : undefined,
      ...(value.code ? { code: value.code } : {}),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => deepRedact(v, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = REDACTED;
      } else {
        out[k] = deepRedact(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

// Reduz risco residual de uma senha aparecer concatenada em uma string de erro.
function deepRedactString(s) {
  if (!s) return s;
  // Heurística simples — se a string contém "password" ou "pfx" seguido de qualquer coisa, redacta o resto da palavra.
  // Não é à prova de balas, mas evita os casos mais comuns ("password=abc123" → "password=[REDACTED]").
  return String(s).replace(/(password|pfx[_-]?password|secret|token)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
}

/**
 * Loga um erro de forma segura, redactando campos sensíveis no contexto e no próprio err.
 * @param {object} logger - logger pino-like com .error/.warn
 * @param {object} ctx - contexto adicional (será redactado)
 * @param {Error|unknown} err - erro a logar
 * @param {string} message - mensagem humana
 * @param {"error"|"warn"} [level="error"]
 */
export function safeLogError(logger, ctx, err, message, level = "error") {
  const safeCtx = deepRedact(ctx || {});
  const safeErr = deepRedact(err);
  const fn = (logger?.[level] || logger?.error || console.error).bind(logger || console);
  fn({ ...safeCtx, err: safeErr }, message);
}
