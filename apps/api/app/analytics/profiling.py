"""Column-level data profiling over a Parquet dataset version.

All aggregations run as vectorised Polars expressions on a lazy scan, so the full dataset never
passes through Python objects. Distinct counts are exact up to EXACT_DISTINCT_LIMIT rows and use
HyperLogLog (``approx_n_unique``) beyond that; the profile records which was used.

The output is JSON-safe: NaN / +-inf never appear as values (they are counted separately)."""

import math
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import polars as pl

from app.ingestion.schema import logical_type

EXACT_DISTINCT_LIMIT = 2_000_000
HISTOGRAM_BINS = 20
TOP_VALUES = 10
QUANTILES = {"p05": 0.05, "p25": 0.25, "p50": 0.5, "p75": 0.75, "p95": 0.95}
NUMERIC_TYPES = {"integer", "float", "decimal"}
TEMPORAL_TYPES = {"date", "timestamp"}


def json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, Decimal):
        # Scale-0 decimals (e.g. DuckDB HUGEINT sums) are integers; keep them exact.
        return int(value) if value.as_tuple().exponent >= 0 else float(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, bool | int | str):
        return value
    return str(value)


def _numeric_expr(col: str, ltype: str) -> pl.Expr:
    expr = pl.col(col).cast(pl.Float64)
    if ltype == "float":
        expr = pl.when(expr.is_finite()).then(expr).otherwise(None)
    return expr


def _histogram(lf: pl.LazyFrame, col: str, ltype: str, lo: float, hi: float) -> list[dict[str, Any]]:
    if lo is None or hi is None:
        return []
    is_temporal = ltype in TEMPORAL_TYPES
    if is_temporal:
        value = pl.col(col).dt.epoch("ms").cast(pl.Float64)
    else:
        value = _numeric_expr(col, ltype)
    if hi == lo:
        n = lf.select(value.is_not_null().sum()).collect().item()
        edges = [(lo, hi)]
        counts = {0: n}
    else:
        width = (hi - lo) / HISTOGRAM_BINS
        bucket = ((value - lo) / width).floor().clip(0, HISTOGRAM_BINS - 1).cast(pl.Int32).alias("b")
        grouped = lf.select(bucket).drop_nulls().group_by("b").len().collect()
        counts = dict(zip(grouped["b"].to_list(), grouped["len"].to_list(), strict=True))
        edges = [(lo + i * width, lo + (i + 1) * width) for i in range(HISTOGRAM_BINS)]

    def fmt(x: float) -> Any:
        return datetime.fromtimestamp(x / 1000, tz=UTC).isoformat() if is_temporal else x

    return [{"start": fmt(a), "end": fmt(b), "count": int(counts.get(i, 0))} for i, (a, b) in enumerate(edges)]


def _quality(col: dict[str, Any], row_count: int) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    null_pct = col["null_pct"]
    if row_count and col["null_count"] == row_count:
        issues.append({"severity": "high", "message": "Column is entirely empty"})
    elif null_pct >= 20:
        issues.append({"severity": "medium", "message": f"{null_pct:.1f}% of values are missing"})
    elif null_pct > 0:
        issues.append({"severity": "low", "message": f"{null_pct:.1f}% of values are missing"})
    if col.get("distinct_count") == 1 and row_count > 1:
        issues.append({"severity": "low", "message": "Column has a single constant value"})
    if col.get("infinite_count"):
        issues.append({"severity": "medium", "message": f"{col['infinite_count']} infinite value(s)"})
    if col.get("nan_count"):
        issues.append({"severity": "medium", "message": f"{col['nan_count']} NaN value(s)"})
    if col.get("empty_string_count"):
        issues.append({"severity": "low", "message": f"{col['empty_string_count']} empty or blank string(s)"})
    if col.get("invalid_count"):
        issues.append({
            "severity": "medium",
            "message": f"{col['invalid_count']} value(s) are not numeric in an otherwise numeric column",
        })
    if col.get("outlier_count"):
        issues.append({"severity": "info",
                       "message": f"{col['outlier_count']} potential outlier(s) by the 1.5×IQR rule"})

    invalid = (col.get("invalid_count") or 0) + (col.get("infinite_count") or 0) + (col.get("nan_count") or 0)
    non_null = row_count - col["null_count"]
    completeness = 100.0 * non_null / row_count if row_count else 100.0
    validity = 100.0 * (non_null - invalid) / non_null if non_null else 100.0
    return {
        "completeness": round(completeness, 2),
        "validity": round(validity, 2),
        "score": round(0.6 * completeness + 0.4 * validity, 1),
        "issues": issues,
    }


def profile_column(lf: pl.LazyFrame, name: str, dtype: pl.DataType, row_count: int, exact: bool) -> dict[str, Any]:
    ltype = logical_type(dtype)
    c = pl.col(name)
    exprs: dict[str, pl.Expr] = {
        "null_count": c.null_count(),
        "distinct_count": (c.n_unique() if exact else c.approx_n_unique()),
    }
    if ltype in NUMERIC_TYPES:
        v = _numeric_expr(name, ltype)
        exprs |= {"min": v.min(), "max": v.max(), "mean": v.mean(), "std": v.std(), "median": v.median()}
        exprs |= {k: v.quantile(q, interpolation="linear") for k, q in QUANTILES.items()}
        if ltype == "float":
            exprs |= {"infinite_count": c.is_infinite().sum(), "nan_count": c.is_nan().sum()}
    elif ltype in TEMPORAL_TYPES:
        exprs |= {"min": c.min(), "max": c.max()}
    elif ltype == "boolean":
        exprs |= {"true_count": c.sum()}
    elif ltype == "string":
        length = c.str.len_chars()
        trimmed = c.str.strip_chars()
        as_num = trimmed.cast(pl.Float64, strict=False)
        exprs |= {
            "min_length": length.min(),
            "max_length": length.max(),
            "mean_length": length.mean(),
            "empty_string_count": (trimmed == "").sum(),
            "numeric_like": as_num.is_not_null().sum(),
        }

    stats = lf.select(**exprs).collect().row(0, named=True)
    col: dict[str, Any] = {
        "name": name,
        "logical_type": ltype,
        "physical_type": str(dtype),
        "null_count": int(stats["null_count"]),
        "null_pct": round(100.0 * stats["null_count"] / row_count, 4) if row_count else 0.0,
        # n_unique counts null as a value; report distinct non-null values.
        "distinct_count": max(int(stats["distinct_count"]) - (1 if exact and stats["null_count"] else 0), 0),
        "distinct_approximate": not exact,
    }
    for key in ("min", "max", "mean", "std", "median", "min_length", "max_length", "mean_length",
                "infinite_count", "nan_count", "empty_string_count", "true_count"):
        if key in stats:
            col[key] = json_safe(stats[key])
    if ltype in NUMERIC_TYPES:
        col["quantiles"] = {k: json_safe(stats[k]) for k in QUANTILES}

    if ltype == "string":
        non_null = row_count - col["null_count"] - (stats["empty_string_count"] or 0)
        numeric_like = int(stats["numeric_like"] or 0)
        # Flag a string column as "mostly numeric" when >= 90% of values parse as numbers.
        if non_null and numeric_like < non_null and numeric_like / non_null >= 0.9:
            col["invalid_count"] = non_null - numeric_like
            col["invalid_examples"] = (
                lf.select(c)
                .filter(c.is_not_null() & (c.str.strip_chars() != "")
                        & c.str.strip_chars().cast(pl.Float64, strict=False).is_null())
                .unique()
                .head(5)
                .collect()[name]
                .to_list()
            )

    if ltype in NUMERIC_TYPES and col.get("quantiles", {}).get("p25") is not None:
        q1, q3 = col["quantiles"]["p25"], col["quantiles"]["p75"]
        iqr = q3 - q1
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        v = _numeric_expr(name, ltype)
        col["outlier_count"] = int(lf.select(((v < lo) | (v > hi)).sum()).collect().item() or 0)
        col["outlier_bounds"] = {"lower": lo, "upper": hi}

    if ltype in NUMERIC_TYPES:
        col["histogram"] = _histogram(lf, name, ltype, col.get("min"), col.get("max"))
    elif ltype in TEMPORAL_TYPES and stats.get("min") is not None:
        bounds = lf.select(c.dt.epoch("ms").min().alias("lo"), c.dt.epoch("ms").max().alias("hi")).collect().row(0)
        col["histogram"] = _histogram(lf, name, ltype, float(bounds[0]), float(bounds[1]))

    if ltype in ("string", "boolean", "integer") or (ltype in TEMPORAL_TYPES and col["distinct_count"] <= 50):
        top = (
            lf.select(c).drop_nulls().group_by(name).len()
            .sort(["len", name], descending=[True, False]).head(TOP_VALUES).collect()
        )
        col["top_values"] = [{"value": json_safe(v), "count": int(n)} for v, n in top.iter_rows()]

    col["quality"] = _quality(col, row_count)
    return col


def profile_parquet(path: Path) -> dict[str, Any]:
    lf = pl.scan_parquet(path)
    schema = lf.collect_schema()
    row_count = int(lf.select(pl.len()).collect().item())
    exact = row_count <= EXACT_DISTINCT_LIMIT
    columns = [profile_column(lf, name, dtype, row_count, exact) for name, dtype in schema.items()]
    unique_rows = int(lf.unique().select(pl.len()).collect().item()) if row_count else 0
    duplicate_rows = row_count - unique_rows
    total_cells = row_count * len(columns)
    missing_cells = sum(c["null_count"] for c in columns)
    scores = [c["quality"]["score"] for c in columns]
    return {
        "row_count": row_count,
        "column_count": len(columns),
        "duplicate_rows": duplicate_rows,
        "duplicate_pct": round(100.0 * duplicate_rows / row_count, 4) if row_count else 0.0,
        "missing_cells": missing_cells,
        "missing_pct": round(100.0 * missing_cells / total_cells, 4) if total_cells else 0.0,
        "quality_score": round(sum(scores) / len(scores), 1) if scores else None,
        "distinct_method": "exact" if exact else "hyperloglog",
        "computed_at": datetime.now(UTC).isoformat(),
        "columns": columns,
    }
