"""
OCR stub: when OCR_ENABLED and native text is too short, signal TEXT_EXTRACTION_FAILED.
No pytesseract dependency yet.
"""

from app.config import settings


def should_fail_short_text(text: str) -> bool:
    if not settings.ocr_enabled:
        return False
    stripped = (text or "").strip()
    return len(stripped) < settings.min_text_chars
