"""Profiling correctness against reference values computed independently (statistics module)."""

import math
import statistics

import polars as pl
import pytest

from app.analytics.profiling import profile_parquet


@pytest.fixture
def parquet(tmp_path):
    def _make(df: pl.DataFrame):
        path = tmp_path / "p.parquet"
        df.write_parquet(path)
        return profile_parquet(path)

    return _make


def test_numeric_statistics_match_reference(parquet):
    values = [2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0, 100.0]
    prof = parquet(pl.DataFrame({"v": values + [None]}))
    col = prof["columns"][0]
    assert col["null_count"] == 1 and col["null_pct"] == 10.0
    assert col["min"] == 2.0 and col["max"] == 100.0
    assert col["mean"] == pytest.approx(statistics.mean(values))
    assert col["median"] == pytest.approx(statistics.median(values))
    assert col["std"] == pytest.approx(statistics.stdev(values))  # sample std (ddof=1)
    q = statistics.quantiles(values, n=4, method="inclusive")  # linear interpolation
    assert col["quantiles"]["p25"] == pytest.approx(q[0])
    assert col["quantiles"]["p75"] == pytest.approx(q[2])
    assert col["outlier_count"] == 1  # 100 is beyond Q3 + 1.5*IQR
    assert col["distinct_count"] == 6
    assert sum(b["count"] for b in col["histogram"]) == 9


def test_infinite_and_nan_are_counted_not_emitted(parquet):
    prof = parquet(pl.DataFrame({"v": [1.0, float("inf"), float("nan"), 3.0, None]}))
    col = prof["columns"][0]
    assert col["infinite_count"] == 1 and col["nan_count"] == 1
    assert col["max"] == 3.0 and col["mean"] == 2.0  # computed over finite values only
    assert all(v is None or math.isfinite(v) for v in col["quantiles"].values())
    assert any("infinite" in i["message"] for i in col["quality"]["issues"])


def test_strings_dates_booleans_and_duplicates(parquet):
    import datetime as dt

    df = pl.DataFrame({
        "s": ["a", "b", "a", " ", None, "a"],
        "d": [dt.date(2024, 1, 1), dt.date(2024, 3, 1), dt.date(2024, 1, 1), None, dt.date(2024, 2, 1),
              dt.date(2024, 1, 1)],
        "b": [True, False, True, None, True, True],
    })
    prof = parquet(df)
    s, d, b = prof["columns"]
    assert s["top_values"][0] == {"value": "a", "count": 3}
    assert s["empty_string_count"] == 1 and s["distinct_count"] == 3
    assert d["min"] == "2024-01-01" and d["max"] == "2024-03-01"
    assert b["true_count"] == 4
    # rows 0, 2 and 5 are identical -> 2 duplicates
    assert prof["duplicate_rows"] == 2
    assert prof["row_count"] == 6 and prof["missing_cells"] == 3


def test_all_null_and_empty(parquet):
    prof = parquet(pl.DataFrame({"n": pl.Series([None, None], dtype=pl.Int64)}))
    col = prof["columns"][0]
    assert col["quality"]["completeness"] == 0
    assert col["quality"]["issues"][0]["severity"] == "high"
    empty = parquet(pl.DataFrame({"x": pl.Series([], dtype=pl.Float64)}))
    assert empty["row_count"] == 0 and empty["columns"][0]["histogram"] == []
