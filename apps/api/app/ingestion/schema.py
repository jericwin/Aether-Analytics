"""Schema inference and refinement.

Polars performs the base inference. On top of that we:
  * normalise column names (unique, non-empty, trimmed);
  * detect dates/timestamps in string columns only when *every* non-null value parses with a single
    format. If two formats both parse every value (e.g. 05/01/2024 as dd/mm or mm/dd), the column
    is left as a string and a warning is emitted -- ambiguous dates are never silently guessed;
  * flatten one level of nested structs and serialise lists to JSON text (with a warning);
  * apply user type overrides strictly: values that fail conversion abort the import with a count,
    instead of being silently turned into nulls.
"""

from typing import Literal

import polars as pl

from app.core.errors import ValidationFailed

LogicalType = Literal["string", "integer", "float", "decimal", "boolean", "date", "timestamp", "unknown"]

DATE_FORMATS = ["%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%m-%d-%Y", "%d.%m.%Y", "%Y%m%d"]
DATETIME_FORMATS = [
    "%Y-%m-%d %H:%M:%S%.f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%d/%m/%Y %H:%M:%S",
    "%m/%d/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%m/%d/%Y %H:%M",
]
# Formats that are unambiguous by construction; detection stops at the first full match.
_UNAMBIGUOUS = {"%Y-%m-%d", "%Y/%m/%d", "%Y%m%d"}


def logical_type(dtype: pl.DataType) -> LogicalType:
    if dtype.is_integer():
        return "integer"
    if dtype.is_float():
        return "float"
    if isinstance(dtype, pl.Decimal):
        return "decimal"
    if dtype == pl.Boolean:
        return "boolean"
    if dtype == pl.Date:
        return "date"
    if isinstance(dtype, pl.Datetime):
        return "timestamp"
    if dtype in (pl.String, pl.Categorical) or isinstance(dtype, pl.Enum):
        return "string"
    if dtype == pl.Null:
        return "unknown"
    return "string"


def normalise_column_names(df: pl.DataFrame) -> tuple[pl.DataFrame, list[str]]:
    warnings: list[str] = []
    seen: dict[str, int] = {}
    names: list[str] = []
    for i, raw in enumerate(df.columns):
        name = " ".join(str(raw).split())[:255] or f"column_{i + 1}"
        base, n = name, seen.get(name.lower(), 0)
        while name.lower() in seen:
            n += 1
            name = f"{base}_{n + 1}"
        seen[base.lower()] = n
        seen[name.lower()] = 0
        if name != raw:
            warnings.append(f"Column '{raw}' renamed to '{name}'")
        names.append(name)
    return df.rename(dict(zip(df.columns, names, strict=True))), warnings


def _full_parse(series: pl.Series, fmt: str, kind: str) -> pl.Series | None:
    """Return the parsed series if every non-null value parses with `fmt`, else None."""
    try:
        if kind == "date":
            parsed = series.str.to_date(fmt, strict=False)
        else:
            parsed = series.str.to_datetime(fmt, strict=False, time_unit="us")
    except pl.exceptions.PolarsError:
        return None
    return parsed if parsed.null_count() == series.null_count() else None


def detect_temporal(series: pl.Series) -> tuple[pl.Series | None, str | None]:
    """Try to interpret a string column as date or timestamp. Returns (parsed, warning)."""
    non_null = series.drop_nulls()
    if non_null.len() == 0:
        return None, None
    # Cheap pre-check: temporal strings contain digits and separators only (plus T/space/colon).
    sample = non_null.head(200)
    if not sample.str.contains(r"^\s*\d{1,4}[-/.]?\d{1,2}[-/.]?\d{1,4}([ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?)?\s*$").all():
        return None, None
    cleaned = series.str.strip_chars().str.replace("T", " ", literal=True)

    for kind, formats in (("date", DATE_FORMATS), ("timestamp", DATETIME_FORMATS)):
        matches: list[tuple[str, pl.Series]] = []
        for fmt in formats:
            parsed = _full_parse(cleaned, fmt, kind)
            if parsed is not None:
                matches.append((fmt, parsed))
                if fmt in _UNAMBIGUOUS:
                    break
        if len(matches) == 1:
            return matches[0][1].alias(series.name), None
        if len(matches) > 1:
            fmts = " or ".join(m[0] for m in matches)
            return None, (
                f"Column '{series.name}' looks like a {kind} but is ambiguous ({fmts}); kept as text. "
                "Cast it explicitly to choose a format."
            )
    return None, None


def flatten_nested(df: pl.DataFrame) -> tuple[pl.DataFrame, list[str]]:
    warnings: list[str] = []
    for name, dtype in list(df.schema.items()):
        if isinstance(dtype, pl.Struct):
            fields = df[name].struct.unnest()
            fields = fields.rename({f: f"{name}.{f}" for f in fields.columns})
            idx = df.columns.index(name)
            df = pl.concat([df.select(df.columns[:idx]), fields, df.select(df.columns[idx + 1 :])], how="horizontal")
            warnings.append(f"Nested object '{name}' flattened into {len(fields.columns)} column(s)")
    for name, dtype in list(df.schema.items()):
        if isinstance(dtype, (pl.List, pl.Array, pl.Struct)):
            df = df.with_columns(pl.col(name).map_elements(_to_json, return_dtype=pl.String))
            warnings.append(f"Column '{name}' contains lists or deeper nesting; stored as JSON text")
    return df, warnings


def _to_json(value: object) -> str:
    import json

    return json.dumps(value.to_list() if isinstance(value, pl.Series) else value, default=str)


def refine_types(df: pl.DataFrame, detect_dates: bool) -> tuple[pl.DataFrame, list[str]]:
    warnings: list[str] = []
    if not detect_dates:
        return df, warnings
    replacements = []
    for name, dtype in df.schema.items():
        if dtype == pl.String:
            parsed, warning = detect_temporal(df[name])
            if parsed is not None:
                replacements.append(parsed)
            if warning:
                warnings.append(warning)
    if replacements:
        df = df.with_columns(replacements)
    return df, warnings


_CAST_TARGETS: dict[str, pl.DataType] = {
    "string": pl.String(),
    "integer": pl.Int64(),
    "float": pl.Float64(),
    "boolean": pl.Boolean(),
    "date": pl.Date(),
    "timestamp": pl.Datetime("us"),
}


def strict_cast(series: pl.Series, target: str, fmt: str | None = None) -> pl.Series:
    """Cast a column; raise with a count of failing values instead of producing silent nulls."""
    if target not in _CAST_TARGETS:
        raise ValidationFailed(f"Unsupported target type '{target}'", code="invalid_cast")
    dtype = _CAST_TARGETS[target]
    if series.dtype == pl.String and target in ("date", "timestamp"):
        src = series.str.strip_chars()
        out = src.str.to_date(fmt, strict=False) if target == "date" else src.str.to_datetime(
            fmt, strict=False, time_unit="us"
        )
    elif series.dtype == pl.String and target == "boolean":
        lowered = series.str.strip_chars().str.to_lowercase()
        mapping = {"true": True, "false": False, "yes": True, "no": False, "1": True, "0": False, "y": True, "n": False}
        out = lowered.replace_strict(mapping, default=None, return_dtype=pl.Boolean)
    elif series.dtype == pl.String and target in ("integer", "float"):
        out = series.str.strip_chars().cast(dtype, strict=False)
    else:
        out = series.cast(dtype, strict=False)
    failed = out.null_count() - series.null_count()
    if failed > 0:
        bad = series.filter(out.is_null() & series.is_not_null()).head(3).cast(pl.String).to_list()
        raise ValidationFailed(
            f"{failed} value(s) in column '{series.name}' cannot be converted to {target} "
            f"(examples: {', '.join(repr(b) for b in bad)})",
            code="invalid_cast",
            details={"column": series.name, "failed": failed, "examples": bad},
        )
    return out.alias(series.name)


def apply_overrides(df: pl.DataFrame, overrides: dict[str, str]) -> pl.DataFrame:
    unknown = [c for c in overrides if c not in df.columns]
    if unknown:
        raise ValidationFailed(f"Type override for unknown column(s): {', '.join(unknown)}", code="unknown_column")
    if not overrides:
        return df
    return df.with_columns([strict_cast(df[c], t) for c, t in overrides.items()])
