from typing import Any


def refine_inss(fields: dict[str, Any], text_upper: str) -> dict[str, Any]:
    """INSS / GPS — align pro-labore hints with legacy parser."""
    out = dict(fields)
    cr = out.get("codigo_receita")
    if cr == "1099" or (
        "CONTRIB INDIVIDUAL" in text_upper
        or "CONTRIBUINTES INDIVIDUAIS" in text_upper
        or "CP DESCONTADA SEGURADO" in text_upper
    ):
        out["_inss_pro_labore"] = True
    return out
