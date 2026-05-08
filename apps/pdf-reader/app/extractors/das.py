import re
from typing import Any


def refine_simples(fields: dict[str, Any], text_upper: str) -> dict[str, Any]:
    """DAS / Simples Nacional — extract total from tax table."""
    # pdf-parse concatenates table columns without spaces, so use \s* between headers
    match = re.search(
        r"IRPJ\s*CSLL\s*COFINS\s*PIS[/\\]?PASEP\s*INSS[/\\]?CPP\s*ICMS\s*IPI\s*ISS\s*TOTAL\s*([\d.,\s]+)",
        text_upper,
    )
    if match:
        values = re.findall(r"\d{1,3}(?:\.\d{3})*,\d{2}", match.group(1))
        if values:
            try:
                fields["valor_num"] = float(values[-1].replace(".", "").replace(",", "."))
                return fields
            except Exception:
                pass

    # "Principal X Multa Y Juros Z Total W" — DAS payment slip
    match = re.search(
        r"PRINCIPAL\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(?:MULTA|JUROS).*?TOTAL\s+(\d{1,3}(?:\.\d{3})*,\d{2})",
        text_upper,
        re.DOTALL,
    )
    if match:
        try:
            fields["valor_num"] = float(match.group(2).replace(".", "").replace(",", "."))
            return fields
        except Exception:
            pass

    return fields
