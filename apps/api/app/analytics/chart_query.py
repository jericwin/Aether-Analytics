"""Chart query compiler: a validated chart configuration -> aggregate SQL over one dataset.

Chart configuration and result data are kept separate: widgets persist only the configuration;
data is always recomputed from the dataset's current version (so it reflects re-imports)."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.analytics.sql_builder import NUMERIC, TEMPORAL, ColumnFilter, ident, resolve_column, where_clause
from app.core.errors import ValidationFailed

ChartType = Literal["kpi", "bar", "stacked_bar", "line", "area", "pie", "donut", "scatter", "histogram",
                    "table", "heatmap", "boxplot"]
Aggregation = Literal["count", "count_distinct", "sum", "avg", "min", "max", "median"]
DateGrain = Literal["none", "day", "week", "month", "quarter", "year"]

NUMERIC_AGGS = {"sum", "avg", "median"}
MAX_CATEGORIES = 1000
MAX_POINTS = 5000


class Measure(BaseModel):
    column: str | None = None  # None only for count(*)
    agg: Aggregation = "count"
    label: str | None = Field(default=None, max_length=120)


class SortSpec(BaseModel):
    by: Literal["dimension", "measure"] = "measure"
    direction: Literal["asc", "desc"] = "desc"


class ChartQuery(BaseModel):
    chart_type: ChartType
    dimension: str | None = None
    date_grain: DateGrain = "none"
    series: str | None = None
    measures: list[Measure] = Field(default_factory=lambda: [Measure()], max_length=8)
    x: str | None = None  # scatter
    y: str | None = None  # scatter / histogram / boxplot value column
    bins: int = Field(default=20, ge=2, le=200)
    sort: SortSpec | None = None
    limit: int = Field(default=50, ge=1, le=MAX_CATEGORIES)
    include_nulls: bool = True
    filters: list[ColumnFilter] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def _shape(self) -> "ChartQuery":
        t = self.chart_type
        if t in ("bar", "stacked_bar", "line", "area", "pie", "donut", "heatmap") and not self.dimension:
            raise ValueError(f"A '{t}' chart requires a dimension")
        if t in ("stacked_bar", "heatmap") and not self.series:
            raise ValueError(f"A '{t}' chart requires a series (breakdown) column")
        if t == "scatter" and not (self.x and self.y):
            raise ValueError("A scatter plot requires x and y columns")
        if t in ("histogram", "boxplot") and not self.y:
            raise ValueError(f"A '{t}' chart requires a value column (y)")
        if not self.measures:
            raise ValueError("At least one measure is required")
        return self


def _measure_sql(m: Measure, types: dict[str, str]) -> str:
    if m.column is None:
        if m.agg != "count":
            raise ValidationFailed(f"Aggregation '{m.agg}' requires a column", code="invalid_chart")
        return "count(*)"
    ltype = resolve_column(types, m.column)
    col = ident(m.column)
    if m.agg in NUMERIC_AGGS and ltype not in NUMERIC and ltype != "boolean":
        raise ValidationFailed(f"Cannot apply '{m.agg}' to {ltype} column '{m.column}'", code="invalid_chart")
    if m.agg in ("min", "max") and ltype not in NUMERIC | TEMPORAL:
        raise ValidationFailed(f"Cannot apply '{m.agg}' to {ltype} column '{m.column}'", code="invalid_chart")
    if ltype == "boolean" and m.agg in NUMERIC_AGGS:
        col = f"CAST({col} AS INTEGER)"
    if m.agg == "count_distinct":
        return f"count(DISTINCT {col})"
    return f"{m.agg}({col})"


def measure_label(m: Measure) -> str:
    if m.label:
        return m.label
    return "count" if m.column is None else f"{m.agg}_{m.column}"


def _dimension_sql(column: str, grain: str, types: dict[str, str]) -> str:
    ltype = resolve_column(types, column)
    col = ident(column)
    if grain != "none":
        if ltype not in TEMPORAL:
            raise ValidationFailed(f"Date grouping requires a date/timestamp column; '{column}' is {ltype}",
                                   code="invalid_chart")
        return f"CAST(date_trunc('{grain}', {col}) AS DATE)"
    return col


def compile_chart(cfg: ChartQuery, types: dict[str, str], table: str,
                  extra_filters: list[ColumnFilter] | None = None) -> tuple[str, int]:
    """Return (sql, row_cap) for the chart. Column references are validated against `types`."""
    filters = list(cfg.filters) + list(extra_filters or [])
    where = where_clause(types, filters)
    src = ident(table)
    t = cfg.chart_type

    if t == "scatter":
        for c in (cfg.x, cfg.y):
            if resolve_column(types, c or "") not in NUMERIC | TEMPORAL:
                raise ValidationFailed(f"Scatter axes must be numeric or temporal ('{c}')", code="invalid_chart")
        cols = [ident(cfg.x or ""), ident(cfg.y or "")]
        if cfg.series:
            resolve_column(types, cfg.series)
            cols.append(ident(cfg.series))
        nn = f"{cols[0]} IS NOT NULL AND {cols[1]} IS NOT NULL"
        cond = f"{where} AND {nn}" if where else f" WHERE {nn}"
        return f"SELECT {', '.join(cols)} FROM {src}{cond} USING SAMPLE {MAX_POINTS} ROWS", MAX_POINTS

    if t == "histogram":
        if resolve_column(types, cfg.y or "") not in NUMERIC:
            raise ValidationFailed("Histogram requires a numeric column", code="invalid_chart")
        v = f"CAST({ident(cfg.y or '')} AS DOUBLE)"
        cond = f"{where} AND isfinite({v})" if where else f" WHERE isfinite({v})"
        b = int(cfg.bins)
        # Equal-width bins over [min, max]; the max value falls into the last bin. When all values
        # are equal the width is NULL and everything lands in bucket 0.
        bucket = f"coalesce(least(CAST(floor((x - lo) / nullif((hi - lo) / {b}, 0)) AS INTEGER), {b - 1}), 0)"
        sql = (
            f"WITH v AS (SELECT {v} AS x FROM {src}{cond}), "
            f"r AS (SELECT min(x) AS lo, max(x) AS hi FROM v), "
            f"b AS (SELECT {bucket} AS bucket, lo, (hi - lo) / {b} AS width FROM v, r) "
            f"SELECT bucket, any_value(lo) + bucket * any_value(width) AS bin_start, "
            f"any_value(lo) + (bucket + 1) * any_value(width) AS bin_end, count(*) AS count "
            f"FROM b GROUP BY 1 ORDER BY 1"
        )
        return sql, b

    if t == "boxplot":
        if resolve_column(types, cfg.y or "") not in NUMERIC:
            raise ValidationFailed("Box plot requires a numeric value column", code="invalid_chart")
        v = f"CAST({ident(cfg.y or '')} AS DOUBLE)"
        group = _dimension_sql(cfg.dimension, cfg.date_grain, types) if cfg.dimension else "'all'"
        cond = f"{where} AND isfinite({v})" if where else f" WHERE isfinite({v})"
        sql = (
            f"SELECT {group} AS category, min({v}) AS min, quantile_cont({v}, 0.25) AS q1, median({v}) AS median, "
            f"quantile_cont({v}, 0.75) AS q3, max({v}) AS max, count(*) AS n FROM {src}{cond} "
            f"GROUP BY 1 ORDER BY 1 LIMIT {int(cfg.limit)}"
        )
        return sql, cfg.limit

    measures = [f"{_measure_sql(m, types)} AS {ident(measure_label(m))}" for m in cfg.measures]
    if t == "kpi" or (t == "table" and not cfg.dimension):
        return f"SELECT {', '.join(measures)} FROM {src}{where}", 1

    dim = _dimension_sql(cfg.dimension or "", cfg.date_grain, types)
    group_cols = [f"{dim} AS {ident(cfg.dimension or '')}"]
    if cfg.series:
        resolve_column(types, cfg.series)
        if cfg.series == cfg.dimension:
            raise ValidationFailed("Series must differ from the dimension", code="invalid_chart")
        group_cols.append(f"{ident(cfg.series)} AS {ident(cfg.series)}")
    if not cfg.include_nulls:
        nn = " AND ".join(f"{ident(c)} IS NOT NULL" for c in [cfg.dimension, cfg.series] if c)
        where = f"{where} AND {nn}" if where else f" WHERE {nn}"

    is_time = cfg.date_grain != "none" or resolve_column(types, cfg.dimension or "") in TEMPORAL
    sort = cfg.sort or SortSpec(by="dimension" if is_time else "measure",
                                direction="asc" if is_time else "desc")
    direction = sort.direction.upper()
    first_measure = _measure_sql(cfg.measures[0], types)
    rank_key = "1" if sort.by == "dimension" else first_measure
    select_list = ", ".join(group_cols + measures)
    group_by = ", ".join(str(i + 1) for i in range(len(group_cols)))

    if not cfg.series:
        order = f"{rank_key} {direction} NULLS LAST" + ("" if sort.by == "dimension" else ", 1")
        sql = f"SELECT {select_list} FROM {src}{where} GROUP BY {group_by} ORDER BY {order} LIMIT {int(cfg.limit)}"
        return sql, cfg.limit

    # With a series breakdown, `limit` applies to dimension values: pick the top-N dimension values
    # first, then return every series for them, so stacked bars are never partially truncated.
    top_dims = f"SELECT {dim} AS d FROM {src}{where} GROUP BY 1 ORDER BY {rank_key} {direction} NULLS LAST " \
               f"LIMIT {int(cfg.limit)}"
    in_top = f"({dim} IN (SELECT d FROM top_dims) OR ({dim} IS NULL AND EXISTS " \
             f"(SELECT 1 FROM top_dims WHERE d IS NULL)))"
    where_top = f"{where} AND {in_top}" if where else f" WHERE {in_top}"
    sql = f"WITH top_dims AS ({top_dims}) SELECT {select_list} FROM {src}{where_top} " \
          f"GROUP BY {group_by} ORDER BY 1, 2"
    return sql, min(cfg.limit * 50, MAX_CATEGORIES * 5)
