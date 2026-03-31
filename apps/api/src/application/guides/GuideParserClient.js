import axios from "axios";
import { PDF_READER_TIMEOUT_MS, PDF_READER_URL } from "../../config.js";
import { mapPdfReaderToParserShape } from "../../modules/pdfReader/pdfReader.mapper.js";
import { postExtract } from "../../modules/pdfReader/pdfReader.service.js";
import {
  throwIfPdfReaderBusinessError,
  validatePdfReaderExtractResponse,
} from "../../modules/pdfReader/pdfReader.validator.js";
import { normalizeCompetencia, normalizeGuideType } from "./guideContract.js";

function ensurePdfReaderConfigured(url) {
  if (!String(url || "").trim()) {
    const err = new Error("pdf_reader_not_configured");
    err.code = "PDF_READER_NOT_CONFIGURED";
    throw err;
  }
}

export function normalizeParserPayload(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const competencia = normalizeCompetencia(data.competencia);
  const tipo = normalizeGuideType(data.tipo);
  const cnpj = String(data.cnpj || "").replace(/\D+/g, "") || null;
  const valorNum = Number(data.valor);
  const vencimento = data.vencimento ? new Date(data.vencimento) : null;
  return {
    tipo,
    cnpj,
    competencia,
    vencimento:
      vencimento && !Number.isNaN(vencimento.getTime())
        ? vencimento.toISOString()
        : null,
    valor: Number.isFinite(valorNum) ? valorNum : null,
    razaoSocial: data.razaoSocial ? String(data.razaoSocial) : null,
    codigoReceita: data.codigoReceita ? String(data.codigoReceita) : null,
    barcode: data.barcode ? String(data.barcode) : null,
    confidence: Number.isFinite(Number(data.confidence))
      ? Number(data.confidence)
      : null,
    rawTextSample: data.rawTextSample ? String(data.rawTextSample) : null,
    fields: data.fields && typeof data.fields === "object" ? data.fields : {},
  };
}

/**
 * Cliente do serviço pdf-reader (FastAPI). Não há mais parser Flask legado.
 */
export class GuideParserClient {
  /**
   * @param {{ pdfReaderUrl?: string | null }} [opts]
   */
  constructor({ pdfReaderUrl } = {}) {
    this.pdfReaderUrl = String(pdfReaderUrl || "").trim() || null;
  }

  getParserSource() {
    return "PDF_READER";
  }

  static create(opts = {}) {
    const pdfReaderUrl = String(opts.pdfReaderUrl ?? PDF_READER_URL ?? "").trim() || null;
    ensurePdfReaderConfigured(pdfReaderUrl);
    return new GuideParserClient({ pdfReaderUrl });
  }

  async health() {
    ensurePdfReaderConfigured(this.pdfReaderUrl);
    const root = this.pdfReaderUrl.replace(/\/$/, "");
    const { data } = await axios.get(`${root}/health`, { timeout: 5000 });
    return data;
  }

  async parsePdf({ buffer, filename, requestId }) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      const err = new Error("pdf_buffer_required");
      err.code = "GUIDE_PDF_BUFFER_REQUIRED";
      throw err;
    }
    ensurePdfReaderConfigured(this.pdfReaderUrl);
    const res = await postExtract({
      baseURL: this.pdfReaderUrl,
      contentBase64: buffer.toString("base64"),
      filename: filename || null,
      requestId,
      timeoutMs: PDF_READER_TIMEOUT_MS,
    });
    if (res.status >= 500) {
      const err = new Error(res.statusText || "pdf_reader_http_error");
      err.code = "PDF_READER_HTTP_ERROR";
      err.status = res.status;
      throw err;
    }
    if (res.status >= 400) {
      validatePdfReaderExtractResponse(res.data);
      throwIfPdfReaderBusinessError(res.data);
      const fallback = new Error("pdf_reader_request_failed");
      fallback.code = "PDF_READER_HTTP_ERROR";
      fallback.status = res.status;
      throw fallback;
    }
    validatePdfReaderExtractResponse(res.data);
    throwIfPdfReaderBusinessError(res.data);
    const shaped = mapPdfReaderToParserShape(
      /** @type {Record<string, unknown>} */ (res.data)
    );
    return normalizeParserPayload(shaped);
  }
}
