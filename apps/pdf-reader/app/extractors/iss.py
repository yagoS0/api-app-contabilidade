import re
from typing import Any


def refine_iss(fields: dict[str, Any], text_upper: str) -> dict[str, Any]:
    """ISS / DARM RIO — refine valor and competência for municipal ISS guides."""
    out = dict(fields)

    # DARM field 09: "09. VALOR TOTAL (R$): 1.234,56" or "09 VALOR TOTAL 1.234,56"
    m = re.search(r"09\.?\s*VALOR\s+TOTAL[^:]*:?\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})", text_upper)
    if m and not out.get("valor_num"):
        try:
            out["valor_num"] = float(m.group(1).replace(".", "").replace(",", "."))
        except Exception:
            pass

    # DARM competência: "04. COMPETÊNCIA (MM/AAAA): 04 / 2026"
    if not out.get("competencia_mm_yyyy"):
        m = re.search(r"COMPET[ÊE]NCIA[^:]*:\s*(\d{2})\s*/\s*(\d{4})", text_upper)
        if m:
            mm, yyyy = m.group(1), m.group(2)
            out["competencia_yyyy_mm"] = f"{yyyy}-{mm}"
            out["competencia_mm_yyyy"] = f"{mm}/{yyyy}"

    # DARM vencimento: "03. DATA DE VENCIMENTO: 20/05/2026"
    if not out.get("vencimento_iso"):
        m = re.search(r"03\.?\s*DATA\s+DE\s+VENCIMENTO[:\s]*(\d{2}/\d{2}/\d{4})", text_upper)
        if m:
            parts = m.group(1).split("/")
            if len(parts) == 3:
                out["vencimento_iso"] = f"{parts[2]}-{parts[1]}-{parts[0]}"

    return out
