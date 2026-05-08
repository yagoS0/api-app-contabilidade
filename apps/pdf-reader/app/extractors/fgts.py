import re
from typing import Any


def refine_fgts(fields: dict[str, Any], text_upper: str) -> dict[str, Any]:
    """FGTS / GFD (Guia do FGTS Digital)."""
    out = dict(fields)

    # GFD valor: "Total da Guia: 474,17"
    if not out.get("valor_num"):
        m = re.search(r"TOTAL\s+DA\s+GUIA[:\s]*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})", text_upper)
        if m:
            try:
                out["valor_num"] = float(m.group(1).replace(".", "").replace(",", "."))
            except Exception:
                pass

    # GFD competência: appears in the identifier line "... 33375263 02/2026 MENSAL"
    if not out.get("competencia_mm_yyyy"):
        m = re.search(r"\d+\s+[\w-]+\s+\d{8}\s+(\d{2}/\d{4})\s+\w+", text_upper)
        if not m:
            m = re.search(r"COMPETÊNCIA[^\n]*\n\s*(\d{2}/\d{4})", text_upper)
        if m:
            mm_yyyy = m.group(1)
            parts = mm_yyyy.split("/")
            if len(parts) == 2:
                out["competencia_yyyy_mm"] = f"{parts[1]}-{parts[0]}"
                out["competencia_mm_yyyy"] = mm_yyyy

    # GFD vencimento: "Pagar este documento até ... 20/03/2026"
    if not out.get("vencimento_iso"):
        m = re.search(r"PAGAR\s+ESTE\s+DOCUMENTO\s+AT[ÉE][^\d]*(\d{2}/\d{2}/\d{4})", text_upper)
        if m:
            parts = m.group(1).split("/")
            if len(parts) == 3:
                out["vencimento_iso"] = f"{parts[2]}-{parts[1]}-{parts[0]}"

    # GFD CNPJ + razão social: the header row contains "CPF/CNPJ DO EMPREGADOR NOME/RAZÃO SOCIAL DO EMPREGADOR"
    # The data row is like "33.375.263 AF SENNA MOTO PECAS LTDA" (partial 8-digit CNPJ)
    # We always try to override these since generic.py will misread the header labels
    m = re.search(
        r"CPF/CNPJ\s+DO\s+EMPREGADOR[^\n]*\n\s*([\d.]+)\s+([^\n]+)",
        text_upper,
    )
    if m:
        partial_cnpj_digits = re.sub(r"\D", "", m.group(1))
        candidate_name = m.group(2).strip()
        # Strip trailing date/time artifacts
        candidate_name = re.sub(r"\s+\d{2}/\d{2}/\d{4}.*$", "", candidate_name).strip()
        candidate_name = re.sub(r"\s+ÀS\s+.*$", "", candidate_name).strip()
        if candidate_name:
            out["razao_social"] = candidate_name
        # Partial CNPJ (8 digits) is not usable; clear any wrong value from generic
        if len(partial_cnpj_digits) < 14:
            out["cnpj"] = None

    return out
