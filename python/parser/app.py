from flask import Flask, jsonify, request
import base64
import io
import os
import re

try:
    import pdfplumber
except Exception:  # pragma: no cover
    pdfplumber = None

app = Flask(__name__)
DEFAULT_LOG_RAW_TEXT = "0" if os.getenv("NODE_ENV", "").lower() == "production" else "1"
LOG_RAW_TEXT = os.getenv("PARSER_LOG_RAW_TEXT", DEFAULT_LOG_RAW_TEXT) == "1"
MONTHS_PT = {
    "janeiro": "01",
    "fevereiro": "02",
    "marco": "03",
    "março": "03",
    "abril": "04",
    "maio": "05",
    "junho": "06",
    "julho": "07",
    "agosto": "08",
    "setembro": "09",
    "outubro": "10",
    "novembro": "11",
    "dezembro": "12",
}


def normalize_cnpj(value: str | None):
    if not value:
        return None
    digits = re.sub(r"\D+", "", value)
    return digits if len(digits) >= 11 else None


def find_first(patterns, text, flags=0):
    for pattern in patterns:
        m = re.search(pattern, text, flags)
        if m:
            return m.group(1)
    return None


def detect_tipo(text_upper: str):
    # INSS pro-labore (DARF 1099 + contribuinte individual)
    if (
        re.search(r"\b1099\b", text_upper)
        and (
            "CONTRIB INDIVIDUAL" in text_upper
            or "CONTRIBUINTES INDIVIDUAIS" in text_upper
            or "CP DESCONTADA SEGURADO" in text_upper
        )
    ):
        return "INSS"
    if (
        "SIMPLES NACIONAL" in text_upper
        or "DOCUMENTO DE ARRECADAÇÃO DO SIMPLES NACIONAL" in text_upper
        or "PGDAS" in text_upper
        or "DAS" in text_upper
    ):
        return "SIMPLES"
    if "GUIA DA PREVIDENCIA SOCIAL" in text_upper or "GPS" in text_upper or "INSS" in text_upper:
        return "INSS"
    if "FGTS" in text_upper or "GRF" in text_upper:
        return "FGTS"
    if "COFINS" in text_upper:
        return "COFINS"
    if "PIS" in text_upper:
        return "PIS"
    if "ISS" in text_upper or "ISSQN" in text_upper:
        return "ISS"
    return "OUTRA"


def extract_text_from_pdf(content: bytes):
    if not pdfplumber:
        return ""
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        parts = []
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts)


def normalize_competencia(value: str | None):
    if not value:
        return None
    value = value.strip().lower()
    # MM/YYYY -> YYYY-MM
    m = re.match(r"^(\d{2})/(\d{4})$", value)
    if m:
        mm, yyyy = m.groups()
        return f"{yyyy}-{mm}"
    # Mês por extenso -> YYYY-MM
    m = re.match(r"^(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/(\d{4})$", value)
    if m:
        month_name, yyyy = m.groups()
        month_num = MONTHS_PT.get(month_name, None)
        if month_num:
            return f"{yyyy}-{month_num}"
    return None


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/parse-guide")
def parse_guide():
    body = request.get_json(force=True) or {}
    content_b64 = body.get("contentBase64")
    if not content_b64:
        return jsonify({"error": "contentBase64_required"}), 400

    try:
        content = base64.b64decode(content_b64)
    except Exception:
        return jsonify({"error": "invalid_base64"}), 400

    text = extract_text_from_pdf(content)
    text_upper = text.upper()

    if LOG_RAW_TEXT:
      filename = body.get("filename") or "sem_nome"
      print(f"\n=== RAW_PDF_TEXT_START | {filename} ===", flush=True)
      print(text, flush=True)
      print(f"=== RAW_PDF_TEXT_END | {filename} ===\n", flush=True)

    cnpj = find_first(
        [
            r"CNPJ[:\s]*([0-9./-]{14,18})",
            r"(\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})",
        ],
        text_upper,
        re.IGNORECASE,
    )
    competencia_raw = find_first(
        [
            r"COMPET[ÊE]NCIA[:\s]*(\d{2}/\d{4})",
            r"PER[IÍ]ODO[:\s]*(\d{2}/\d{4})",
            r"PER[IÍ]ODO\s+DE\s+APURA[ÇC][ÃA]O[^\n]*\n\s*((?:JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)/\d{4})",
            r"\b((?:JANEIRO|FEVEREIRO|MAR[CÇ]O|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO)/\d{4})\b",
        ],
        text_upper,
        re.IGNORECASE,
    )
    competencia = normalize_competencia(competencia_raw)
    valor = find_first(
        [
            r"VALOR\s+TOTAL\s+DO\s+DOCUMENTO[:\s]*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})",
            r"VALOR\s+(?:TOTAL|A\s+PAGAR)[:\s]*R?\$?\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})",
            r"PAGAR\s+AT[ÉE]:\s*\d{2}/\d{2}/\d{4}\s*\nVALOR:\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})",
            r"R\$\s*([0-9\.,]+)",
        ],
        text_upper,
        re.IGNORECASE,
    )
    codigo_receita = find_first(
        [
            r"\b(1099)\b",
            r"C[ÓO]DIGO\s+DE\s+RECEITA[:\s]*(\d{4})",
        ],
        text_upper,
        re.IGNORECASE,
    )
    vencimento = find_first(
        [
            r"VENCIMENTO[:\s]*(\d{2}/\d{2}/\d{4})",
            r"DATA\s+DE\s+VENCIMENTO[:\s]*(\d{2}/\d{2}/\d{4})",
            r"PAGAR\s+AT[ÉE]:\s*(\d{2}/\d{2}/\d{4})",
            r"PAGAR\s+ESTE\s+DOCUMENTO\s+AT[ÉE][:\s]*(\d{2}/\d{2}/\d{4})",
        ],
        text_upper,
        re.IGNORECASE,
    )

    valor_num = None
    if valor:
        try:
            valor_num = float(valor.replace(".", "").replace(",", "."))
        except Exception:
            valor_num = None

    tipo = detect_tipo(text_upper)
    is_pro_labore = bool(
        codigo_receita == "1099"
        or (
            tipo == "INSS"
            and (
                "CONTRIB INDIVIDUAL" in text_upper
                or "CONTRIBUINTES INDIVIDUAIS" in text_upper
                or "CP DESCONTADA SEGURADO" in text_upper
            )
        )
    )

    payload = {
        "tipo": tipo,
        "cnpj": normalize_cnpj(cnpj),
        "razaoSocial": None,
        "competencia": competencia,
        "vencimento": vencimento,
        "valor": valor_num,
        "codigoReceita": codigo_receita,
        "barcode": None,
        "confidence": 0.75,
        "rawTextSample": text[:2000],
        "fields": {
            "inssProLabore": is_pro_labore,
            "subtipo": "PRO_LABORE" if is_pro_labore else None,
        },
    }
    return jsonify(payload)


if __name__ == "__main__":
    host = os.getenv("PARSER_HOST", "0.0.0.0")
    port = int(os.getenv("PARSER_PORT", os.getenv("PORT", "8787")))
    app.run(host=host, port=port)

