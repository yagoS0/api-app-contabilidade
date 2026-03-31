import io
from typing import Optional

try:
    import pdfplumber
except Exception:  # pragma: no cover
    pdfplumber = None


def extract_text_from_pdf(content: bytes) -> str:
    if not pdfplumber:
        return ""
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        parts = []
        for page in pdf.pages:
            parts.append(page.extract_text() or "")
        return "\n".join(parts)
