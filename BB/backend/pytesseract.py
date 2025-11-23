"""Stub pytesseract for offline environments."""
class TesseractError(Exception):
    pass

def image_to_string(image, lang='eng'):
    raise TesseractError('pytesseract stub - module not available')
