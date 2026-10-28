"""SQL validation layer (defence in depth, layer 1 of 2).

Queries are parsed with sqlglot (DuckDB dialect) and must be a single read-only query whose table
references resolve to approved dataset tables or CTEs. Table functions, qualified names, file
paths and introspection/IO functions are rejected. Layer 2 is the DuckDB engine lockdown in
``query_engine`` (external access disabled, configuration locked), which holds even if a query
slips past this parser.

The query that is executed is regenerated from the validated AST, not the raw user text."""

import re
from dataclasses import dataclass

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError, TokenError

from app.core.config import get_settings
from app.core.errors import ValidationFailed

_FORBIDDEN_NODES: tuple[type[exp.Expression], ...] = (
    exp.DML, exp.DDL, exp.Command, exp.Copy, exp.Pragma, exp.Set, exp.Attach, exp.Detach, exp.Use,
    exp.Install, exp.Export, exp.Transaction, exp.Merge, exp.TruncateTable, exp.Describe,
    exp.Summarize, exp.Show,
)  # fmt: skip

# Functions that read files / remote resources, inspect engine internals or execute dynamic SQL.
_FORBIDDEN_FUNCTION = re.compile(
    r"^(read_\w+|\w+_scan|scan_\w+|glob|sniff_csv|parquet_\w+|duckdb_\w+|pragma_\w+|query|query_table|"
    r"getenv|current_setting|which_secret|load_\w+|install_\w+|export_\w+|import_\w+|sql_auto_complete|"
    r"iceberg_\w+|delta_\w+|postgres_\w+|sqlite_\w+|mysql_\w+|http\w*|enable_\w+|disable_\w+|"
    r"checkpoint|force_checkpoint|test_\w+|ducklake_\w+)$",
    re.IGNORECASE,
)


class SqlRejected(ValidationFailed):
    code = "sql_rejected"


@dataclass(frozen=True)
class ValidatedQuery:
    sql: str  # regenerated from the AST
    tables: frozenset[str]  # lower-cased approved table names referenced


def _function_name(node: exp.Func) -> str:
    if isinstance(node, exp.Anonymous):
        return str(node.name)
    return node.sql_name()


def validate_query(sql: str, allowed_tables: set[str]) -> ValidatedQuery:
    settings = get_settings()
    if not sql or not sql.strip():
        raise SqlRejected("Query is empty")
    if len(sql) > settings.max_query_chars:
        raise SqlRejected(f"Query exceeds {settings.max_query_chars} characters")

    try:
        statements = [s for s in sqlglot.parse(sql, read="duckdb") if s is not None]
    except (ParseError, TokenError) as exc:
        first = str(exc).splitlines()[0][:300]
        raise SqlRejected(f"SQL syntax error: {first}", code="sql_syntax_error") from None

    if len(statements) != 1:
        raise SqlRejected("Exactly one statement is allowed per execution")
    tree = statements[0]

    for node in tree.walk():
        if isinstance(node, _FORBIDDEN_NODES):
            raise SqlRejected(
                f"Statement type '{node.key.upper()}' is not allowed; only read-only queries are permitted"
            )
    if not isinstance(tree, exp.Query):
        raise SqlRejected("Only SELECT queries (including WITH, UNION, etc.) are permitted")

    for func in tree.find_all(exp.Func):
        name = _function_name(func)
        if _FORBIDDEN_FUNCTION.match(name):
            raise SqlRejected(f"Function '{name}' is not allowed")

    allowed = {t.lower() for t in allowed_tables}
    cte_names = {cte.alias_or_name.lower() for cte in tree.find_all(exp.CTE)}
    referenced: set[str] = set()
    for table in tree.find_all(exp.Table):
        if not isinstance(table.this, exp.Identifier):
            raise SqlRejected("Table functions and file paths are not allowed in FROM clauses")
        if table.args.get("db") or table.args.get("catalog"):
            raise SqlRejected(f"Qualified table names are not allowed ('{table.sql(dialect='duckdb')}')")
        name = table.name.lower()
        if name in cte_names:
            continue
        if name not in allowed:
            raise SqlRejected(
                f"Unknown table '{table.name}'. Available tables: {', '.join(sorted(allowed)) or 'none'}",
                code="unknown_table",
            )
        referenced.add(name)

    return ValidatedQuery(sql=tree.sql(dialect="duckdb"), tables=frozenset(referenced))
