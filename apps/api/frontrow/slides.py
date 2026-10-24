"""PDF to per-slide text."""

from __future__ import annotations

import io

from .models import Slide

MAX_UPLOAD_BYTES = 100 * 1024 * 1024


class SlideError(ValueError):
    """The upload is empty, too large, or not a readable PDF."""


def extract_slides(data: bytes) -> list[Slide]:
    """Extract one :class:`Slide` per PDF page, in page order.

    Pages without extractable text become slides with empty text.
    """
    if not data:
        raise SlideError("the uploaded file is empty")
    if len(data) > MAX_UPLOAD_BYTES:
        raise SlideError("the uploaded file exceeds 100 MB")
    if not data.lstrip()[:5] == b"%PDF-":
        raise SlideError("the uploaded file is not a PDF")

    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [page.extract_text() or "" for page in reader.pages]
    except (PdfReadError, ValueError, KeyError) as exc:
        raise SlideError(f"could not read the PDF: {exc}") from exc
    return [Slide(index=i, text=" ".join(text.split())) for i, text in enumerate(pages)]
