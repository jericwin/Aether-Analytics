"""Generate SQL for structured requests (table browsing, chart queries, dashboard filters).

Every column name is checked against the dataset schema before use; identifiers and literals are
quoted here and nowhere else. Generated SQL is then passed through ``sql_guard`` like any user
query, so structured features never bypass the security layer."""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.core.errors import ValidationFailed

FilterOp = Literal["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "between", "contains",
                   "starts_with", "is_null", "not_null"]
NUMERIC = {"integer", "float", "decimal"}
TEMPORAL = {"date", "timestamp"}


class ColumnFilter(BaseModel):
    column: str = Field(min_length=1, max_length=255)
    op: FilterOp
    value: Any = None
    values: list[Any] | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def _check_arity(self) -> "ColumnFilter":
        if self.op in ("in", "not_in") and not self.values:
            raise ValueError(f"'{self.op}' requires a non-empty 'values' list")
        if self.op == "between" and (not self.values or len(self.values) != 2):
            raise ValueError("'between' requires exactly two values")
        if self.op not in ("in", "not_in", "between", "is_null", "not_null") and self.value is None:
            raise ValueError(f"'{self.op}' requires 'value'")
        return self


def ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def string_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def literal(value: Any, ltype: str) -> str:
    """Render a literal coerced to the column's logical type (rejects mismatches)."""
    if value is None:
        return "NULL"
    try:
        if ltype in NUMERIC:
            if isinstance(value, bool):
                raise ValueError
            number = float(value)
            if number != number or number in (float("inf"), float("-inf")):
                raise ValueError
            return repr(int(number)) if ltype == "integer" and number.is_integer() else repr(number)
        if ltype == "boolean":
            if isinstance(value, bool):
                return "TRUE" if value else "FALSE"
            lowered = str(value).strip().lower()
            if lowered in ("true", "false"):
                return lowered.upper()
            raise ValueError
        if ltype == "date":
            parsed = date.fromisoformat(str(value)[:10])
            return f"DATE {string_literal(parsed.isoformat())}"
        if ltype == "timestamp":
            parsed_ts = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return f"TIMESTAMP {string_literal(parsed_ts.replace(tzinfo=None).isoformat(sep=' '))}"
    except (ValueError, TypeError):
        raise ValidationFailed(f"Value {value!r} is not a valid {ltype}", code="invalid_filter_value") from None
    return string_literal(str(value))


def resolve_column(columns: dict[str, str], name: str) -> str:
    if name not in columns:
        raise ValidationFailed(f"Unknown column '{name}'", code="unknown_column")
    return columns[name]


def condition(columns: dict[str, str], flt: ColumnFilter) -> str:
    ltype = resolve_column(columns, flt.column)
    col = ident(flt.column)
    op = flt.op
    if op == "is_null":
        return f"{col} IS NULL"
    if op == "not_null":
        return f"{col} IS NOT NULL"
    if op in ("contains", "starts_with"):
        text = str(flt.value).replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{text}%" if op == "contains" else f"{text}%"
        return f"CAST({col} AS VARCHAR) ILIKE {string_literal(pattern)} ESCAPE '\\'"
    if op in ("in", "not_in"):
        values = flt.values or []
        non_null = [v for v in values if v is not None]
        parts = []
        if non_null:
            items = ", ".join(literal(v, ltype) for v in non_null)
            parts.append(f"{col} {'IN' if op == 'in' else 'NOT IN'} ({items})")
        if len(non_null) != len(values):
            parts.append(f"{col} IS {'' if op == 'in' else 'NOT '}NULL")
        joiner = " OR " if op == "in" else " AND "
        return "(" + joiner.join(parts) + ")"
    if op == "between":
        lo, hi = flt.values or [None, None]
        return f"{col} BETWEEN {literal(lo, ltype)} AND {literal(hi, ltype)}"
    sql_op = {"eq": "=", "neq": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
    if op == "neq":
        return f"({col} {sql_op} {literal(flt.value, ltype)} OR {col} IS NULL)"
    return f"{col} {sql_op} {literal(flt.value, ltype)}"


def where_clause(columns: dict[str, str], filters: list[ColumnFilter]) -> str:
    if not filters:
        return ""
    return " WHERE " + " AND ".join(condition(columns, f) for f in filters)
