import re
from typing import Any

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


def normalize_cnpj(value: str | None) -> str | None:
    if not value:
        return None
    digits = re.sub(r"\D+", "", value)
    return digits if len(digits) >= 11 else None


def find_first(patterns: list[str], text: str, flags: int = 0) -> str | None:
    for pattern in patterns:
        m = re.search(pattern, text, flags)
        if m:
            return m.group(1)
    return None


def detect_tipo(text_upper: str) -> str:
    if re.search(r"\b1099\b", text_upper) and (
        "CONTRIB INDIVIDUAL" in text_upper
        or "CONTRIBUINTES INDIVIDUAIS" in text_upper
        or "CP DESCONTADA SEGURADO" in text_upper
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


def normalize_competencia_yyyy_mm(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip().lower()
    m = re.match(r"^(\d{2})/(\d{4})$", value)
    if m:
        mm, yyyy = m.groups()
        return f"{yyyy}-{mm}"
    m = re.match(
        r"^(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/(\d{4})$",
        value,
    )
    if m:
        month_name, yyyy = m.groups()
        month_num = MONTHS_PT.get(month_name, None)
        if month_num:
            return f"{yyyy}-{month_num}"
    return None


def yyyy_mm_to_mm_yyyy(yyyy_mm: str | None) -> str | None:
    if not yyyy_mm or "-" not in yyyy_mm:
        return None
    parts = yyyy_mm.split("-")
    if len(parts) != 2:
        return None
    yyyy, mm = parts[0], parts[1]
    if len(yyyy) == 4 and len(mm) == 2:
        return f"{mm}/{yyyy}"
    return None


def br_date_to_iso(s: str | None) -> str | None:
    if not s:
        return None
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", s.strip())
    if not m:
        return None
    dd, mm, yyyy = m.groups()
    return f"{yyyy}-{mm}-{dd}"


def extract_base_fields(text: str, text_upper: str) -> dict[str, Any]:
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
    competencia_yyyy_mm = normalize_competencia_yyyy_mm(competencia_raw) if competencia_raw else None

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
    vencimento_br = find_first(
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

    return {
        "cnpj_raw": cnpj,
        "cnpj": normalize_cnpj(cnpj),
        "competencia_yyyy_mm": competencia_yyyy_mm,
        "competencia_mm_yyyy": yyyy_mm_to_mm_yyyy(competencia_yyyy_mm),
        "valor_num": valor_num,
        "codigo_receita": codigo_receita,
        "vencimento_iso": br_date_to_iso(vencimento_br),
        "razao_social": None,
        "codigo_barras": None,
    }
