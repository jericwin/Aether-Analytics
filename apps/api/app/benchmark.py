"""Reproducible benchmark: `uv run aether benchmark --sizes 10000 100000 1000000 --out ../../docs/benchmarks`.

For each size a deterministic synthetic CSV (seeded) is generated, then the real code paths are
timed: CSV parse + type refinement + Parquet write (the import job's work), profiling, an aggregate
SQL query, a join + window query, a dashboard chart query and one page of the data browser.
Results include hardware, OS and library versions. Timings are wall-clock medians of `repeats`
runs; they describe this machine only and are not hardware-independent targets."""

import os
import platform
import random
import statistics
import sys
import tempfile
import time
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import duckdb
import polars as pl

from app.analytics import profiling, query_engine, sql_guard
from app.analytics.chart_query import ChartQuery, compile_chart
from app.ingestion.adapters import ImportOptions, load_frame


def _peak_rss_mb() -> float | None:
    try:
        if sys.platform == "win32":
            import ctypes
            from ctypes import wintypes

            size_t = ctypes.c_size_t
            fields = ["PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
                      "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage"]

            class PMC(ctypes.Structure):
                _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [(f, size_t) for f in fields]

            pmc = PMC()
            pmc.cb = ctypes.sizeof(PMC)
            kernel32, psapi = ctypes.WinDLL("kernel32"), ctypes.WinDLL("psapi")
            kernel32.GetCurrentProcess.restype = wintypes.HANDLE
            psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(PMC), wintypes.DWORD]
            if not psapi.GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(pmc), pmc.cb):
                return None
            return pmc.PeakWorkingSetSize / 2**20
        import resource

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return peak / 2**20 if sys.platform == "darwin" else peak / 1024
    except Exception:
        return None


def make_csv(path: Path, rows: int, seed: int = 7) -> None:
    rng = random.Random(seed)
    regions = ["North", "South", "East", "West", "Central"]
    products = [f"P{i:03d}" for i in range(200)]
    start = date(2022, 1, 1)
    frame = pl.DataFrame({
        "order_id": range(1, rows + 1),
        "order_date": [(start + timedelta(days=rng.randrange(1000))).isoformat() for _ in range(rows)],
        "region": [rng.choice(regions) for _ in range(rows)],
        "product_id": [rng.choice(products) for _ in range(rows)],
        "quantity": [rng.randint(1, 12) if rng.random() > 0.01 else None for _ in range(rows)],
        "unit_price": [round(rng.lognormvariate(3.5, 0.8), 2) for _ in range(rows)],
        "discount": [rng.choice([0.0, 0.05, 0.1, 0.2]) for _ in range(rows)],
    })
    frame.write_csv(path)


def _time(fn: Callable[[], Any], repeats: int) -> tuple[float, Any]:
    samples, result = [], None
    for _ in range(repeats):
        t = time.perf_counter()
        result = fn()
        samples.append(time.perf_counter() - t)
    return statistics.median(samples) * 1000, result


JOIN_WINDOW_SQL = (
    "WITH m AS (SELECT p.category, date_trunc('month', CAST(o.order_date AS DATE)) AS month, "
    "sum(o.quantity * o.unit_price) AS revenue FROM orders o JOIN products p USING (product_id) GROUP BY 1, 2) "
    "SELECT *, revenue - lag(revenue) OVER (PARTITION BY category ORDER BY month) AS delta FROM m"
)
AGG_SQL = ("SELECT region, count(*) AS n, sum(quantity * unit_price * (1 - discount)) AS revenue "
           "FROM orders GROUP BY region ORDER BY revenue DESC")
BROWSE_SQL = 'SELECT * FROM orders ORDER BY "unit_price" DESC NULLS LAST LIMIT 100 OFFSET 500'


def _bench_size(root: Path, n: int, products: Path, repeats: int) -> dict[str, Any]:
    csv = root / f"orders_{n}.csv"
    parquet = root / f"orders_{n}.parquet"
    make_csv(csv, n)
    heavy = 1 if n >= 1_000_000 else repeats

    def do_import() -> int:
        df, _ = load_frame(csv, "csv", ImportOptions())
        df.write_parquet(parquet, compression="zstd", statistics=True)
        return df.height

    tables = {"orders": parquet, "products": products}

    def q(sql: str, max_rows: int = 10_000) -> Callable[[], Any]:
        validated = sql_guard.validate_query(sql, set(tables))
        return lambda: query_engine.execute(validated.sql, tables, max_rows=max_rows)

    timings: dict[str, float] = {}
    timings["import_csv_ms"], height = _time(do_import, heavy)
    timings["profile_ms"], _ = _time(lambda: profiling.profile_parquet(parquet), heavy)
    timings["sql_aggregate_ms"], _ = _time(q(AGG_SQL), repeats)
    timings["sql_join_window_ms"], _ = _time(q(JOIN_WINDOW_SQL), repeats)
    types = {c: profiling.logical_type(t) for c, t in pl.read_parquet_schema(parquet).items()}
    chart_sql, cap = compile_chart(ChartQuery.model_validate({
        "chart_type": "line", "dimension": "order_date", "date_grain": "month",
        "measures": [{"column": "unit_price", "agg": "sum"}]}), types, "orders")
    timings["chart_query_ms"], _ = _time(q(chart_sql, cap), repeats)
    timings["browse_page_ms"], _ = _time(q(BROWSE_SQL, 100), repeats)
    return {"rows": height, "csv_mb": round(csv.stat().st_size / 2**20, 2),
            "parquet_mb": round(parquet.stat().st_size / 2**20, 2), **{k: round(v, 1) for k, v in timings.items()}}


def run(sizes: list[int], repeats: int = 3) -> dict[str, Any]:
    results = []
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        products = root / "products.parquet"
        pl.DataFrame({"product_id": [f"P{i:03d}" for i in range(200)],
                      "category": [["A", "B", "C", "D"][i % 4] for i in range(200)]}).write_parquet(products)
        for n in sizes:
            results.append(_bench_size(root, n, products, repeats))
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "methodology": "median wall-clock of repeated runs (1 run for >=1M-row import/profile); "
                       "single process; synthetic seeded CSV with 7 columns; see app/benchmark.py",
        "environment": {
            "os": platform.platform(), "python": platform.python_version(), "cpu": platform.processor(),
            "logical_cpus": os.cpu_count(), "duckdb": duckdb.__version__, "polars": pl.__version__,
        },
        "peak_rss_mb": round(_peak_rss_mb() or 0, 1),
        "results": results,
    }


def to_markdown(report: dict[str, Any]) -> str:
    env = report["environment"]
    lines = [
        "# Benchmark results", "",
        f"Generated {report['generated_at']} on `{env['os']}`, CPU `{env['cpu']}` ({env['logical_cpus']} logical), "
        f"Python {env['python']}, DuckDB {env['duckdb']}, Polars {env['polars']}.", "",
        f"Methodology: {report['methodology']}. Peak process RSS: {report['peak_rss_mb']} MB.", "",
        "| Rows | CSV MB | Parquet MB | Import (ms) | Profile (ms) | SQL agg (ms) | SQL join+window (ms) "
        "| Chart query (ms) | Browse page (ms) |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    keys = ["csv_mb", "parquet_mb", "import_csv_ms", "profile_ms", "sql_aggregate_ms", "sql_join_window_ms",
            "chart_query_ms", "browse_page_ms"]
    for r in report["results"]:
        lines.append(f"| {r['rows']:,} | " + " | ".join(f"{r[k]:,}" for k in keys) + " |")
    lines += ["", "These numbers describe one machine; re-run `uv run aether benchmark` to measure yours.", ""]
    return "\n".join(lines)
