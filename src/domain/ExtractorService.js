import { PdfTextExtractor } from "../infrastructure/ocr/PdfTextExtractor.js";

const RX_CNPJ = /(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2})/;
const RX_VALOR = /(?:valor(?:\s+total)?(?:\s+da\s+guia)?|total|valor\s+a\s+pagar)[:\s]*R?\$?\s*([\d\.\,]+)\b/i;
const RX_VENC = /venc(?:imento)?[:\s-]*([0-3]?\d\/[01]?\d\/\d{2,4})/i;
const RX_COMPET = /comp(?:et[êe]ncia)?[:\s-]*([01]?\d)[\/\-]([12]\d{3})/i;

export class ExtractorService {
  constructor() {
    this.money = new PdfTextExtractor();
  }

  sanitizeCnpj(cnpj) {
    return (cnpj || "").replace(/[^\d]/g, "").padStart(14, "0");
  }

  toMonthFolderName(mm, yyyy) {
    const monthNum = Number(mm);
    const yearNum = Number(yyyy);
    if (!Number.isFinite(monthNum) || !Number.isFinite(yearNum)) return null;
    const m = String(monthNum).padStart(2, "0");
    return `${m}-${yearNum}`;
  }

  extractFieldsFromText(text) {
    const lines = (text || "").split(/\n+/);
    const joined = lines.join("\n");
    let cnpj = null;
    const mCnpj = joined.match(RX_CNPJ);
    if (mCnpj) cnpj = this.sanitizeCnpj(mCnpj[1]);
    let empresa = null;
    if (mCnpj) {
      const idx = lines.findIndex((l) => RX_CNPJ.test(l));
      if (idx > 0) {
        const candidate = (lines[idx - 1] || "").trim();
        if (candidate && candidate.length >= 3) empresa = candidate;
      }
    }
    if (!empresa) {
      const first = lines.find((l) => l && l.trim().length > 3);
      if (first) empresa = first.trim();
    }
    let competencia = null;
    const mComp = joined.match(RX_COMPET);
    if (mComp) {
      competencia = this.toMonthFolderName(mComp[1], mComp[2]);
    }
    let valor = null;
    const mValor = joined.match(RX_VALOR);
    if (mValor) {
      valor = this.money.normalizeMoneyToNumber(mValor[1]);
    }
    let vencimento = null;
    const mVenc = joined.match(RX_VENC);
    if (mVenc) {
      const parts = (mVenc[1] || "").split("/");
      if (parts.length === 3) {
        const dd = parts[0].padStart(2, "0");
        const mm = parts[1].padStart(2, "0");
        let yyyy = parts[2];
        if (yyyy.length === 2) yyyy = `20${yyyy}`;
        vencimento = `${dd}/${mm}/${yyyy}`;
      }
    }
    return {
      empresa: empresa || null,
      cnpj: cnpj || null,
      competencia: competencia || null,
      valor,
      vencimento,
    };
  }
}


