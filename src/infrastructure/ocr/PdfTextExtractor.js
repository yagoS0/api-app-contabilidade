import fs from "node:fs";
import pdfParse from "pdf-parse";
import { log } from "../../config.js";

export class PdfTextExtractor {
  async extract(localPath) {
    const buf = fs.readFileSync(localPath);
    try {
      const res = await pdfParse(buf);
      const text = (res.text || "")
        .replace(/\r/g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
      return text;
    } catch (e) {
      log.warn({ err: e, file: localPath }, "Falha ao extrair texto do PDF");
      return "";
    }
  }

  normalizeMoneyToNumber(input) {
    const s = (input || "").toString().replace(/\s/g, "");
    const only = s.replace(/[^0-9,.-]/g, "");
    const normalized = only.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
}


