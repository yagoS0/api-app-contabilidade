import axios from "axios";
import { GUIDE_PARSER_URL } from "../../config.js";
import { normalizeCompetencia, normalizeGuideType } from "./guideContract.js";

function ensureConfigured(baseURL) {
  if (!String(baseURL || "").trim()) {
    const err = new Error("guide_parser_not_configured");
    err.code = "GUIDE_PARSER_NOT_CONFIGURED";
    throw err;
  }
}

function normalizeParserPayload(raw) {
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

export class GuideParserClient {
  constructor(baseURL = GUIDE_PARSER_URL) {
    this.baseURL = baseURL;
    this.client = axios.create({ baseURL, timeout: 30000 });
  }

  static create({ baseURL } = {}) {
    const resolved = String(baseURL || GUIDE_PARSER_URL || "").trim();
    if (!resolved) {
      const err = new Error("guide_parser_not_configured");
      err.code = "GUIDE_PARSER_NOT_CONFIGURED";
      throw err;
    }
    return new GuideParserClient(resolved);
  }

  async health() {
    ensureConfigured(this.baseURL);
    const { data } = await this.client.get("/health");
    return data;
  }

  async parsePdf({ buffer, filename }) {
    ensureConfigured(this.baseURL);
    if (!buffer || !Buffer.isBuffer(buffer)) {
      const err = new Error("pdf_buffer_required");
      err.code = "GUIDE_PDF_BUFFER_REQUIRED";
      throw err;
    }
    const payload = {
      filename: filename || null,
      contentBase64: buffer.toString("base64"),
    };
    const { data } = await this.client.post("/parse-guide", payload);
    return normalizeParserPayload(data);
  }
}

