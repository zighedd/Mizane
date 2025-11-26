"""Fake pytesseract stub for environments lacking the dependency."""
from typing import Any

class TesseractError(Exception):
    pass


def image_to_string(image: Any, lang: str = 'eng') -> str:
    raise TesseractError('pytesseract not available in this environment')
