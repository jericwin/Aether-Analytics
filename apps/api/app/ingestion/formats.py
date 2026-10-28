"""Content-based file format detection. The extension is a claim; the bytes are the evidence."""

import zipfile
from pathlib import Path

from app.core.errors import ValidationFailed

SUPPORTED_EXTENSIONS: dict[str, str] = {
    "csv": "csv",
    "tsv": "csv",
    "txt": "csv",
    "parquet": "parquet",
    "xlsx": "xlsx",
    "xls": "xls",
    "json": "json",
    "jsonl": "json",
    "ndjson": "json",
}

_PARQUET_MAGIC = b"PAR1"
_ZIP_MAGIC = b"PK\x03\x04"
_OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def format_for_extension(filename: str) -> str:
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted({f".{e}" for e in SUPPORTED_EXTENSIONS}))
        raise ValidationFailed(f"Unsupported file type '.{ext}'. Supported: {supported}", code="unsupported_format")
    return SUPPORTED_EXTENSIONS[ext]


def _looks_like_text(sample: bytes) -> bool:
    if not sample:
        return False
    if sample.startswith((b"\xff\xfe", b"\xfe\xff")):  # UTF-16 BOM
        return True
    return b"\x00" not in sample


def detect_format(path: Path, declared: str) -> str:
    """Verify that the file content matches the declared format; raise otherwise."""
    with path.open("rb") as fh:
        head = fh.read(65536)
        size = fh.seek(0, 2)
        tail = b""
        if size >= 8:
            fh.seek(-4, 2)
            tail = fh.read(4)
    if not head:
        raise ValidationFailed("The uploaded file is empty", code="empty_file")

    if declared == "parquet":
        if head[:4] == _PARQUET_MAGIC and tail == _PARQUET_MAGIC:
            return "parquet"
    elif declared == "xlsx":
        if head[:4] == _ZIP_MAGIC:
            try:
                with zipfile.ZipFile(path) as zf:
                    if "xl/workbook.xml" in zf.namelist():
                        return "xlsx"
            except zipfile.BadZipFile:
                pass
    elif declared == "xls":
        if head[:8] == _OLE_MAGIC:
            return "xls"
    elif declared == "json":
        if _looks_like_text(head) and head.lstrip(b"\xef\xbb\xbf \t\r\n")[:1] in (b"[", b"{"):
            return "json"
    elif declared == "csv":
        if head[:4] in (_PARQUET_MAGIC, _ZIP_MAGIC) or head[:8] == _OLE_MAGIC:
            raise ValidationFailed("File content is binary, not delimited text", code="format_mismatch")
        if _looks_like_text(head):
            return "csv"
    raise ValidationFailed(
        f"File content does not match the '{declared}' format implied by its extension", code="format_mismatch"
    )
