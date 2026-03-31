/**
 * @param {unknown} data
 * @returns {asserts data is Record<string, unknown>}
 */
function assertObject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    const err = new Error("pdf_reader_invalid_response_shape");
    err.code = "PDF_READER_INVALID_RESPONSE";
    throw err;
  }
}

/**
 * @param {unknown} data
 */
export function validatePdfReaderExtractResponse(data) {
  assertObject(data);
  if (typeof data.success !== "boolean") {
    const err = new Error("pdf_reader_missing_success");
    err.code = "PDF_READER_INVALID_RESPONSE";
    throw err;
  }
  if (!data.fields || typeof data.fields !== "object" || Array.isArray(data.fields)) {
    const err = new Error("pdf_reader_missing_fields");
    err.code = "PDF_READER_INVALID_RESPONSE";
    throw err;
  }
  if (!Array.isArray(data.warnings)) {
    const err = new Error("pdf_reader_missing_warnings");
    err.code = "PDF_READER_INVALID_RESPONSE";
    throw err;
  }
  if (!Array.isArray(data.errors)) {
    const err = new Error("pdf_reader_missing_errors");
    err.code = "PDF_READER_INVALID_RESPONSE";
    throw err;
  }
}

/**
 * @param {unknown} data
 */
export function throwIfPdfReaderBusinessError(data) {
  assertObject(data);
  if (data.success) return;
  const first =
    Array.isArray(data.errors) && data.errors.length
      ? data.errors[0]
      : null;
  const code =
    first && typeof first === "object" && first.code
      ? String(first.code)
      : "PDF_READER_EXTRACT_FAILED";
  const message =
    first && typeof first === "object" && first.message
      ? String(first.message)
      : "PDF extraction failed";
  const err = new Error(message);
  err.code = code;
  throw err;
}
