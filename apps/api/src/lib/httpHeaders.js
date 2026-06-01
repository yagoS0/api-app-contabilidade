// Q8.A.6: helpers para sanitização de valores que entram em response headers.
// Foco: prevenir HTTP Header Injection via filename derivado de input do usuário.

/**
 * Limpa um nome de arquivo para uso em `Content-Disposition: attachment; filename="..."`.
 * Remove caracteres de controle (CR, LF, NUL, etc.) que permitiriam injetar novos headers,
 * aspas e backslash que quebram a sintaxe RFC-6266, e limita o tamanho.
 */
export function sanitizeFilename(name, { fallback = "download", maxLen = 200 } = {}) {
  const raw = String(name || "").trim();
  if (!raw) return fallback;
  const cleaned = raw
    // remove caracteres de controle (CR, LF, TAB, NUL, etc.)
    .replace(/[\x00-\x1f\x7f]/g, "_")
    // remove caracteres que quebram a sintaxe de filename (aspas, backslash, semicolons)
    .replace(/[\\"<>:|?*]/g, "_")
    // colapsa múltiplos underscores em um só
    .replace(/_{2,}/g, "_");
  const trimmed = cleaned.slice(0, maxLen);
  return trimmed || fallback;
}

/**
 * Helper que monta o valor completo de Content-Disposition para download.
 */
export function contentDispositionAttachment(filename) {
  return `attachment; filename="${sanitizeFilename(filename)}"`;
}
