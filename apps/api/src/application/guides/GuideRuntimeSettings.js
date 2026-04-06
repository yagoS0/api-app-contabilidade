import { PDF_READER_URL } from "../../config.js";

export async function getGuideRuntimeSettings() {
  return {
    /** URL do serviço FastAPI pdf-reader — somente variável de ambiente `PDF_READER_URL` na API. */
    pdfReaderUrl: String(PDF_READER_URL || "").trim(),
  };
}

export async function updateGuideRuntimeSettings() {
  return getGuideRuntimeSettings();
}
