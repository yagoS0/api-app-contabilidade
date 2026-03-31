from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.services.extraction_service import decode_base64_pdf, extract_from_pdf_bytes

router = APIRouter(tags=["extract"])


class ExtractBody(BaseModel):
    content_base64: str = Field(..., min_length=1)
    filename: str | None = None


def _error_body(code: str, message: str) -> dict[str, Any]:
    return {
        "success": False,
        "document_type": None,
        "fields": {},
        "confidence": 0.0,
        "warnings": [],
        "raw_text": "",
        "errors": [{"code": code, "message": message}],
    }


@router.post("/extract")
def extract(body: ExtractBody):
    raw, err = decode_base64_pdf(body.content_base64)
    if err == "invalid_base64":
        return JSONResponse(status_code=400, content=_error_body("INVALID_BASE64", "content_base64 is not valid Base64"))
    if err == "payload_too_large":
        return JSONResponse(
            status_code=413,
            content=_error_body("PAYLOAD_TOO_LARGE", "Decoded PDF exceeds MAX_UPLOAD_BYTES"),
        )
    if err == "invalid_pdf_magic":
        return JSONResponse(
            status_code=400,
            content=_error_body("INVALID_PDF", "Content is not a PDF (missing %PDF magic)"),
        )
    assert raw is not None
    result = extract_from_pdf_bytes(raw, body.filename)
    if not result["success"]:
        return JSONResponse(status_code=422, content=result)
    return result
