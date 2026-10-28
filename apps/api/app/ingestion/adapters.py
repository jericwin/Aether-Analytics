"""Source adapters: one per file format, behind a common interface so database sources
(SQLite, PostgreSQL, ...) can be added later without touching the import pipeline."""

import csv
import io
import json
import tempfile
from pathlib import Path
from typing import Any, Literal, Protocol

import polars as pl
from pydantic import BaseModel, Field, field_validator

from app.core.errors import ValidationFailed
from app.ingestion import schema as schema_mod

Encoding = Literal["utf-8", "utf-8-sig", "latin-1", "windows-1252", "utf-16"]
DEFAULT_NULLS = ["", "NA", "N/A", "n/a", "null", "NULL", "None", "#N/A"]


class ImportOptions(BaseModel):
    """User-configurable import settings. Irrelevant fields are ignored for a given format."""

    delimiter: str | None = Field(default=None, description="Single character; auto-detected when null")
    encoding: Encoding = "utf-8"
    has_header: bool = True
    null_values: list[str] = Field(default_factory=lambda: list(DEFAULT_NULLS), max_length=50)
    skip_rows: int = Field(default=0, ge=0, le=1000)
    sheet: str | None = None
    json_format: Literal["auto", "records", "ndjson"] = "auto"
    detect_dates: bool = True
    type_overrides: dict[str, schema_mod.LogicalType] = Field(default_factory=dict)

    @field_validator("delimiter")
    @classmethod
    def _one_char(cls, v: str | None) -> str | None:
        if v is not None and (len(v) != 1 or v in "\r\n\""):
            raise ValueError("delimiter must be a single character other than quote or newline")
        return v


class SourceAdapter(Protocol):
    format: str

    def inspect(self, path: Path) -> dict[str, Any]:
        """Format-specific facts shown before import (sheets, detected delimiter, ...)."""
        ...

    def read(self, path: Path, options: ImportOptions, n_rows: int | None = None) -> tuple[pl.DataFrame, list[str]]:
        ...


# --------------------------------------------------------------------------- CSV
class CsvAdapter:
    format = "csv"

    def _sample_text(self, path: Path, encoding: str) -> str:
        with path.open("rb") as fh:
            raw = fh.read(65536)
        return raw.decode(encoding, errors="replace")

    def sniff_delimiter(self, path: Path, encoding: str) -> str:
        sample = self._sample_text(path, encoding)
        lines = sample.splitlines()
        if len(lines) > 1:
            sample = "\n".join(lines[:-1])  # drop a possibly truncated last line
        try:
            return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
        except csv.Error:
            return ","

    def inspect(self, path: Path) -> dict[str, Any]:
        encoding = "utf-8"
        try:
            with path.open("rb") as fh:
                fh.read(65536).decode("utf-8")
        except UnicodeDecodeError:
            encoding = "windows-1252"
        return {"delimiter": self.sniff_delimiter(path, encoding), "encoding": encoding}

    def _utf8_source(self, path: Path, encoding: str) -> tuple[Path, bool]:
        """Polars reads UTF-8 only; other encodings are transcoded to a temporary file in chunks."""
        if encoding in ("utf-8", "utf-8-sig"):
            return path, False
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".csv")
        with path.open("r", encoding=encoding, errors="strict", newline="") as src, tmp:
            writer = io.TextIOWrapper(tmp, encoding="utf-8", newline="")
            while chunk := src.read(1 << 20):
                writer.write(chunk)
            writer.flush()
            writer.detach()
        return Path(tmp.name), True

    def read(self, path: Path, options: ImportOptions, n_rows: int | None = None) -> tuple[pl.DataFrame, list[str]]:
        delimiter = options.delimiter or self.sniff_delimiter(path, options.encoding)
        try:
            src, is_tmp = self._utf8_source(path, options.encoding)
        except UnicodeDecodeError as exc:
            raise ValidationFailed(
                f"The file is not valid {options.encoding} text (byte offset {exc.start}). Try another encoding.",
                code="encoding_error",
            ) from None
        warnings: list[str] = []
        try:
            df = pl.read_csv(
                src,
                separator=delimiter,
                has_header=options.has_header,
                skip_rows=options.skip_rows,
                null_values=options.null_values or None,
                infer_schema_length=None,  # scan the whole file: avoids mid-file type failures
                n_rows=n_rows,
                try_parse_dates=False,  # dates are detected by our unambiguous detector instead
                truncate_ragged_lines=True,
                encoding="utf8",
                raise_if_empty=True,
            )
        except pl.exceptions.NoDataError:
            raise ValidationFailed("The file contains no data", code="empty_file") from None
        except pl.exceptions.ComputeError as exc:
            msg = str(exc).splitlines()[0][:300]
            if "utf-8" in msg.lower() or "utf8" in msg.lower():
                raise ValidationFailed(
                    "The file is not valid UTF-8 text. Choose a different encoding.", code="encoding_error"
                ) from None
            raise ValidationFailed(f"Could not parse CSV: {msg}", code="parse_error") from None
        finally:
            if is_tmp:
                src.unlink(missing_ok=True)
        if not options.has_header:
            df = df.rename({c: f"column_{i + 1}" for i, c in enumerate(df.columns)})
        if options.delimiter is None:
            warnings.append(f"Delimiter auto-detected as {delimiter!r}")
        return df, warnings


# --------------------------------------------------------------------------- Parquet
class ParquetAdapter:
    format = "parquet"

    def inspect(self, path: Path) -> dict[str, Any]:
        schema = pl.read_parquet_schema(path)
        return {"columns": len(schema)}

    def read(self, path: Path, options: ImportOptions, n_rows: int | None = None) -> tuple[pl.DataFrame, list[str]]:
        try:
            return pl.read_parquet(path, n_rows=n_rows), []
        except Exception as exc:  # pyarrow/polars raise a variety of types for corrupt files
            raise ValidationFailed(f"Could not read Parquet file: {str(exc)[:200]}", code="parse_error") from None


# --------------------------------------------------------------------------- Excel
class ExcelAdapter:
    def __init__(self, fmt: str) -> None:
        self.format = fmt

    def inspect(self, path: Path) -> dict[str, Any]:
        import fastexcel

        try:
            reader = fastexcel.read_excel(path)
        except Exception as exc:
            raise ValidationFailed(f"Could not open workbook: {str(exc)[:200]}", code="parse_error") from None
        return {"sheets": list(reader.sheet_names)}

    def read(self, path: Path, options: ImportOptions, n_rows: int | None = None) -> tuple[pl.DataFrame, list[str]]:
        sheets = self.inspect(path)["sheets"]
        if not sheets:
            raise ValidationFailed("The workbook contains no worksheets", code="empty_file")
        sheet = options.sheet or sheets[0]
        if sheet not in sheets:
            raise ValidationFailed(f"Worksheet '{sheet}' not found", code="sheet_not_found")
        read_options: dict[str, Any] = {"header_row": 0 if options.has_header else None}
        if options.skip_rows:
            read_options["skip_rows"] = options.skip_rows
        if n_rows is not None:
            read_options["n_rows"] = n_rows
        try:
            df = pl.read_excel(path, sheet_name=sheet, engine="calamine", read_options=read_options,
                               infer_schema_length=None)
        except Exception as exc:
            message = f"Could not read worksheet '{sheet}': {str(exc)[:200]}"
            raise ValidationFailed(message, code="parse_error") from None
        warnings = [] if options.sheet else [f"Using first worksheet '{sheet}'"]
        # Excel stores blank-looking cells as empty strings; treat configured null markers as nulls.
        if options.null_values:
            nulls = set(options.null_values)
            df = df.with_columns(
                pl.when(pl.col(c).str.strip_chars().is_in(list(nulls))).then(None).otherwise(pl.col(c)).alias(c)
                for c, t in df.schema.items()
                if t == pl.String
            )
        return df, warnings


# --------------------------------------------------------------------------- JSON
class JsonAdapter:
    """Supported shapes: an array of objects ("records") or newline-delimited objects ("ndjson").
    A top-level object containing a single array of records (e.g. {"data": [...]}) is also accepted."""

    format = "json"

    def _detect(self, path: Path) -> str:
        with path.open("rb") as fh:
            head = fh.read(4096).lstrip(b"\xef\xbb\xbf \t\r\n")
        if head.startswith(b"["):
            return "records"
        # NDJSON: at least two lines that are each a complete JSON object.
        lines = [ln.strip() for ln in head.splitlines() if ln.strip()][:2]
        if len(lines) == 2:
            try:
                if all(isinstance(json.loads(ln), dict) for ln in lines):
                    return "ndjson"
            except ValueError:
                pass
        return "object"

    def inspect(self, path: Path) -> dict[str, Any]:
        return {"json_format": self._detect(path)}

    def read(self, path: Path, options: ImportOptions, n_rows: int | None = None) -> tuple[pl.DataFrame, list[str]]:
        fmt = options.json_format if options.json_format != "auto" else self._detect(path)
        warnings: list[str] = []
        try:
            if fmt == "ndjson":
                df = pl.read_ndjson(path, n_rows=n_rows, infer_schema_length=None)
            elif fmt == "records":
                df = pl.read_json(path, infer_schema_length=None)
            else:
                with path.open("rb") as fh:
                    doc = json.load(fh)
                arrays = [k for k, v in doc.items() if isinstance(v, list)] if isinstance(doc, dict) else []
                if len(arrays) != 1 or not all(isinstance(r, dict) for r in doc[arrays[0]]):
                    raise ValidationFailed(
                        "Unsupported JSON structure. Provide an array of objects, newline-delimited objects, "
                        "or an object containing exactly one array of objects.",
                        code="unsupported_json",
                    )
                df = pl.from_dicts(doc[arrays[0]], infer_schema_length=None)
                warnings.append(f"Records read from top-level key '{arrays[0]}'")
        except ValidationFailed:
            raise
        except (pl.exceptions.PolarsError, ValueError) as exc:
            message = f"Could not parse JSON: {str(exc).splitlines()[0][:200]}"
            raise ValidationFailed(message, code="parse_error") from None
        if n_rows is not None:
            df = df.head(n_rows)
        if df.width == 0:
            raise ValidationFailed("JSON contains no object fields to import", code="empty_file")
        return df, warnings


def get_adapter(fmt: str) -> SourceAdapter:
    if fmt == "csv":
        return CsvAdapter()
    if fmt == "parquet":
        return ParquetAdapter()
    if fmt in ("xlsx", "xls"):
        return ExcelAdapter(fmt)
    if fmt == "json":
        return JsonAdapter()
    raise ValidationFailed(f"No adapter for format '{fmt}'", code="unsupported_format")


def load_frame(
    path: Path, fmt: str, options: ImportOptions, n_rows: int | None = None
) -> tuple[pl.DataFrame, list[str]]:
    """Read + normalise + refine types + apply overrides. Shared by preview and full import."""
    df, warnings = get_adapter(fmt).read(path, options, n_rows=n_rows)
    df, w = schema_mod.normalise_column_names(df)
    warnings += w
    df, w = schema_mod.flatten_nested(df)
    warnings += w
    df, w = schema_mod.refine_types(df, options.detect_dates)
    warnings += w
    df = schema_mod.apply_overrides(df, dict(options.type_overrides))
    if df.width == 0:
        raise ValidationFailed("No columns found in the file", code="empty_file")
    return df, warnings
