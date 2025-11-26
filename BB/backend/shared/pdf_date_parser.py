from __future__ import annotations
import io
import re
import requests
import unicodedata
from typing import Optional
from PyPDF2 import PdfReader

MONTH_MAP = {
    'janvier': 1,
    'fevrier': 2,
    'février': 2,
    'mars': 3,
    'avril': 4,
    'mai': 5,
    'juin': 6,
    'juillet': 7,
    'aout': 8,
    'août': 8,
    'septembre': 9,
    'octobre': 10,
    'novembre': 11,
    'decembre': 12,
    'décembre': 12
}


def _normalize_month(value: str) -> str:
    normalized = unicodedata.normalize('NFD', value)
    return ''.join(ch for ch in normalized if not unicodedata.combining(ch)).lower()


def extract_date_from_pdf_header(file_url: str | None) -> Optional[str]:
    if not file_url:
        return None
    try:
        response = requests.get(file_url, timeout=45)
        response.raise_for_status()
        content = response.content
    except Exception:
        return None

    try:
        reader = PdfReader(io.BytesIO(content))
        if not reader.pages:
            return None
        raw_text = reader.pages[0].extract_text() or ''
    except Exception:
        return None

    match = re.search(r'Correspondant au\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})', raw_text, re.IGNORECASE)
    if not match:
        return None

    day = int(match.group(1))
    month_raw = _normalize_month(match.group(2))
    year = int(match.group(3))
    month = MONTH_MAP.get(month_raw)
    if not month:
        return None

    try:
        return f'{year:04d}-{month:02d}-{day:02d}'
    except Exception:
        return None
