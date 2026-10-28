"""Isolated DuckDB execution (defence in depth, layer 2 of 2).

Each execution gets a fresh in-memory DuckDB connection that:
  * exposes only the referenced dataset versions as views over their Parquet files;
  * restricts file access to exactly those files (allowed_paths) and then disables external access;
  * locks its configuration so the query cannot re-enable anything;
  * enforces a memory limit, thread cap, wall-clock timeout (via interrupt) and bounded results.

Running executions are registered by a caller-provided key so they can be cancelled."""

import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import duckdb
import polars as pl

from app.analytics.profiling import json_safe
from app.core.config import get_settings
from app.core.errors import AppError


class QueryFailed(AppError):
    code = "query_failed"


class QueryCancelled(AppError):
    code = "query_cancelled"
    status_code = 409


class QueryTimeout(AppError):
    code = "query_timeout"
    status_code = 408


@dataclass
class QueryResult:
    columns: list[dict[str, str]]
    rows: list[list[Any]]
    row_count: int
    truncated: bool
    duration_ms: int
    sql: str = ""
    extra: dict[str, Any] = field(default_factory=dict)


_running: dict[str, duckdb.DuckDBPyConnection] = {}
_cancelled: set[str] = set()
_lock = threading.Lock()


def cancel(key: str) -> bool:
    with _lock:
        con = _running.get(key)
        if con is None:
            return False
        _cancelled.add(key)
    con.interrupt()
    return True


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _open_locked_connection(tables: dict[str, Path]) -> duckdb.DuckDBPyConnection:
    settings = get_settings()
    con = duckdb.connect(":memory:", config={"autoinstall_known_extensions": False,
                                             "autoload_known_extensions": False})
    con.execute(f"SET memory_limit={_sql_string(settings.query_memory_limit)}")
    con.execute(f"SET threads={int(settings.query_threads)}")
    paths: list[str] = []
    for name, path in tables.items():
        p = path.resolve().as_posix()
        paths.append(p)
        con.execute(f"CREATE VIEW {_quote_ident(name)} AS SELECT * FROM read_parquet({_sql_string(p)})")
    con.execute(f"SET allowed_paths=[{', '.join(_sql_string(p) for p in paths)}]")
    con.execute("SET enable_external_access=false")
    con.execute("SET lock_configuration=true")
    return con


def _arrow_to_rows(table: Any) -> tuple[list[dict[str, str]], list[list[Any]]]:
    df = pl.from_arrow(table)
    assert isinstance(df, pl.DataFrame)
    columns = [{"name": n, "type": str(t)} for n, t in df.schema.items()]
    rows = [[json_safe(v) for v in row] for row in df.iter_rows()]
    return columns, rows


def execute(sql: str, tables: dict[str, Path], *, max_rows: int | None = None, key: str | None = None,
            timeout: float | None = None) -> QueryResult:
    """Execute already-validated SQL and return JSON-safe rows."""
    max_rows = max_rows or get_settings().max_result_rows
    table, truncated, duration_ms = execute_arrow(sql, tables, max_rows=max_rows, key=key, timeout=timeout)
    columns, rows = _arrow_to_rows(table)
    return QueryResult(columns=columns, rows=rows, row_count=len(rows), truncated=truncated,
                       duration_ms=duration_ms, sql=sql)


def execute_arrow(sql: str, tables: dict[str, Path], *, max_rows: int, key: str | None = None,
                  timeout: float | None = None) -> tuple[Any, bool, int]:
    """Execute already-validated SQL; returns (arrow table, truncated, duration_ms)."""
    timeout = timeout or get_settings().query_timeout_seconds
    con = _open_locked_connection(tables)
    timed_out = threading.Event()

    def _on_timeout() -> None:
        timed_out.set()
        con.interrupt()

    timer = threading.Timer(timeout, _on_timeout)
    if key:
        with _lock:
            _running[key] = con
    start = time.perf_counter()
    timer.start()
    try:
        wrapped = f"SELECT * FROM ({sql}) AS _aether_q LIMIT {int(max_rows) + 1}"
        table = con.sql(wrapped).to_arrow_table()
    except duckdb.InterruptException:
        if timed_out.is_set():
            raise QueryTimeout(f"Query exceeded the {timeout:g}s time limit") from None
        raise QueryCancelled("Query was cancelled") from None
    except duckdb.Error as exc:
        if key and key in _cancelled:
            raise QueryCancelled("Query was cancelled") from None
        message = str(exc).split("\n")[0][:500]
        raise QueryFailed(message) from None
    finally:
        timer.cancel()
        if key:
            with _lock:
                _running.pop(key, None)
                _cancelled.discard(key)
        con.close()
    duration_ms = int((time.perf_counter() - start) * 1000)
    truncated = table.num_rows > max_rows
    if truncated:
        table = table.slice(0, max_rows)
    return table, truncated, duration_ms
