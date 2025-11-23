from __future__ import annotations
import io
import os
import re
from typing import Optional

import logging
import pytesseract
import requests
from pdf2image import convert_from_bytes
from pytesseract import TesseractError

from shared.pdf_date_parser import _normalize_month, MONTH_MAP

logger = logging.getLogger(__name__)
TESSDATA_DIR = os.environ.get('TESSDATA_PREFIX', '/usr/local/share/tessdata')
FRA_TRAINEDDATA = os.path.join(TESSDATA_DIR, 'fra.traineddata')
_TESSERACT_AVAILABLE = os.path.isfile(FRA_TRAINEDDATA)

if not _TESSERACT_AVAILABLE:
    logger.warning(
        'Tesseract fra.traineddata manquant (%s). Fonction OCR désactivée.',
        FRA_TRAINEDDATA,
    )


def _tesseract_available():
    return _TESSERACT_AVAILABLE


def extract_date_from_pdf_ocr(file_url: str | None) -> Optional[str]:
    if not file_url or not _tesseract_available():
        return None
    try:
        response = requests.get(file_url, timeout=60)
        response.raise_for_status()
    except Exception:
        return None

    try:
        image = convert_from_bytes(response.content, first_page=1, last_page=1, dpi=150)[0]
    except Exception:
        return None

    try:
        text = pytesseract.image_to_string(image, lang='fra')
    except TesseractError as exc:
        logger.warning('Tesseract impossible: %s', exc)
        return None

    match = re.search(
        r'correspondant au\s+(\d{1,2})\s+([a-zàÂâéÈêÎîôÔûÙû]+)\s+(\d{4})',
        text,
        re.IGNORECASE,
    )
    if not match:
        return None

    day = int(match.group(1))
    month_raw = _normalize_month(match.group(2))
    year = int(match.group(3))
    month = MONTH_MAP.get(month_raw)
    if not month:
        return None
    return f'{year:04d}-{month:02d}-{day:02d}'
