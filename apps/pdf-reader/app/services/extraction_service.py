import base64
import os
from typing import Any

from app.config import settings
from app.extractors import das, fgts, generic, inss
from app.services import pdf_text
from app.services.ocr_service import should_fail_short_text

PDF_MAGIC = b"%PDF"


def _should_log_raw_text() -> bool:
    default = "0" if os.getenv("NODE_ENV", "").lower() == "production" else "1"
    return os.getenv("PARSER_LOG_RAW_TEXT", default) == "1"


def validate_pdf_magic(content: bytes) -> bool:
    return len(content) >= 4 and content[:4] == PDF_MAGIC


def decode_base64_pdf(content_b64: str) -> tuple[bytes | None, str | None]:
    try:
        raw = base64.b64decode(content_b64, validate=True)
    except Exception:
        return None, "invalid_base64"
    if len(raw) > settings.max_upload_bytes:
        return None, "payload_too_large"
    if not validate_pdf_magic(raw):
        return None, "invalid_pdf_magic"
    return raw, None


def _build_fields(
    document_type: str,
    base: dict[str, Any],
    text_upper: str,
) -> dict[str, Any]:
    refined = dict(base)
    if document_type == "SIMPLES":
        refined = das.refine_simples(refined, text_upper)
    elif document_type == "INSS":
        refined = inss.refine_inss(refined, text_upper)
    elif document_type == "FGTS":
        refined = fgts.refine_fgts(refined, text_upper)

    is_pro_labore = bool(
        refined.get("codigo_receita") == "1099"
        or refined.get("_inss_pro_labore")
        or (
            document_type == "INSS"
            and (
                "CONTRIB INDIVIDUAL" in text_upper
                or "CONTRIBUINTES INDIVIDUAIS" in text_upper
                or "CP DESCONTADA SEGURADO" in text_upper
            )
        )
    )
    refined.pop("_inss_pro_labore", None)

    return {
        "cnpj": refined.get("cnpj"),
        "razao_social": refined.get("razao_social"),
        "competencia": refined.get("competencia_mm_yyyy"),
        "vencimento": refined.get("vencimento_iso"),
        "valor_total": refined.get("valor_num"),
        "codigo_receita": refined.get("codigo_receita"),
        "codigo_barras": refined.get("codigo_barras"),
        "inss_pro_labore": is_pro_labore,
        "subtipo": "PRO_LABORE" if is_pro_labore else None,
    }


def extract_from_pdf_bytes(content: bytes, filename: str | None) -> dict[str, Any]:
    text = pdf_text.extract_text_from_pdf(content)
    if _should_log_raw_text():
        name = filename or "sem_nome"
        print(f"\n=== RAW_PDF_TEXT_START | {name} ===", flush=True)
        print(text, flush=True)
        print(f"=== RAW_PDF_TEXT_END | {name} ===\n", flush=True)

    if should_fail_short_text(text):
        return {
            "success": False,
            "document_type": None,
            "fields": {},
            "confidence": 0.0,
            "warnings": [],
            "raw_text": text or "",
            "errors": [
                {
                    "code": "TEXT_EXTRACTION_FAILED",
                    "message": "Native PDF text too short and OCR is not available",
                }
            ],
        }

    text_upper = text.upper()
    document_type = generic.detect_tipo(text_upper)
    base = generic.extract_base_fields(text, text_upper)
    fields_out = _build_fields(document_type, base, text_upper)

    warnings: list[str] = []
    if not fields_out.get("cnpj"):
        warnings.append("cnpj_not_found")
    if not fields_out.get("competencia"):
        warnings.append("competencia_not_found")

    return {
        "success": True,
        "document_type": document_type,
        "fields": fields_out,
        "confidence": 0.75,
        "warnings": warnings,
        "raw_text": text,
        "errors": [],
    }
