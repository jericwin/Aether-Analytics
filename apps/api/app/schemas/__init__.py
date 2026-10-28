"""Pydantic request/response models. These are the API contract consumed by the web app."""

from datetime import UTC, datetime
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field

from app.analytics.chart_query import ChartQuery
from app.analytics.sql_builder import ColumnFilter
from app.ingestion.adapters import ImportOptions

T = TypeVar("T")


def _as_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes; all stored timestamps are UTC, so make that explicit."""
    return value if value.tzinfo else value.replace(tzinfo=UTC)


UTCDateTime = Annotated[datetime, AfterValidator(_as_utc)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


# --------------------------------------------------------------------------- auth
class RegisterIn(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=10, max_length=256)


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class UserOut(ORM):
    id: str
    email: str
    display_name: str
    created_at: UTCDateTime


class AuthStatus(BaseModel):
    user: UserOut | None
    registration_open: bool
    has_users: bool


# --------------------------------------------------------------------------- projects
class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    status: Literal["active", "archived"] | None = None


class ProjectOut(ORM):
    id: str
    name: str
    description: str | None
    status: str
    is_demo: bool
    created_at: UTCDateTime
    updated_at: UTCDateTime
    role: str | None = None


class MemberIn(BaseModel):
    email: EmailStr
    role: Literal["viewer", "editor", "owner"]


class MemberOut(ORM):
    user_id: str
    role: str
    created_at: UTCDateTime
    email: str
    display_name: str


class AuditOut(ORM):
    id: str
    action: str
    resource_type: str
    resource_id: str | None
    summary: str | None
    user_id: str | None
    created_at: UTCDateTime


class JobOut(ORM):
    id: str
    project_id: str | None
    job_type: str
    status: str
    progress: float | None
    progress_message: str | None
    payload: dict[str, Any]
    result: dict[str, Any] | None
    cancel_requested: bool
    attempts: int
    error_code: str | None
    error_message: str | None
    created_at: UTCDateTime
    started_at: UTCDateTime | None
    finished_at: UTCDateTime | None


class ProjectOverview(BaseModel):
    project: ProjectOut
    dataset_count: int
    dashboard_count: int
    saved_query_count: int
    query_count: int
    total_rows: int
    avg_quality_score: float | None
    datasets_with_issues: int
    failed_datasets: int
    activity: list[AuditOut]
    recent_jobs: list[JobOut]


# --------------------------------------------------------------------------- datasets
class UploadOut(ORM):
    id: str
    original_filename: str
    file_format: str
    size_bytes: int
    detected: dict[str, Any]
    created_at: UTCDateTime


class PreviewIn(BaseModel):
    options: ImportOptions = Field(default_factory=ImportOptions)


class ImportIn(BaseModel):
    source_id: str
    name: str = Field(min_length=1, max_length=120)
    table_name: str | None = Field(default=None, max_length=63)
    description: str | None = Field(default=None, max_length=2000)
    options: ImportOptions = Field(default_factory=ImportOptions)


class NewVersionIn(BaseModel):
    source_id: str
    options: ImportOptions = Field(default_factory=ImportOptions)


class DatasetPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class ColumnOut(ORM):
    position: int
    name: str
    logical_type: str
    physical_type: str
    null_count: int


class VersionOut(ORM):
    id: str
    version: int
    storage_format: str
    size_bytes: int
    row_count: int
    column_count: int
    content_hash: str
    source_id: str | None
    import_options: dict[str, Any]
    warnings: list[str]
    job_id: str | None
    profiled_at: UTCDateTime | None
    created_at: UTCDateTime


class VersionDetail(VersionOut):
    columns: list[ColumnOut]


class DatasetOut(ORM):
    id: str
    project_id: str
    name: str
    table_name: str
    description: str | None
    status: str
    current_version: int | None
    error_message: str | None
    created_at: UTCDateTime
    updated_at: UTCDateTime
    row_count: int | None = None
    column_count: int | None = None
    size_bytes: int | None = None
    quality_score: float | None = None
    source_filename: str | None = None
    source_format: str | None = None


class DatasetDetail(DatasetOut):
    version: VersionDetail | None = None
    versions: list[VersionOut] = []


class ImportStarted(BaseModel):
    dataset: DatasetOut
    job: JobOut


class RowsIn(BaseModel):
    version: int | None = None
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=1000)
    sort: list[tuple[str, Literal["asc", "desc"]]] = Field(default_factory=list, max_length=5)
    filters: list[ColumnFilter] = Field(default_factory=list, max_length=30)
    columns: list[str] | None = Field(default=None, max_length=2000)


class ExportIn(BaseModel):
    version: int | None = None
    filters: list[ColumnFilter] = Field(default_factory=list, max_length=30)
    columns: list[str] | None = None


# --------------------------------------------------------------------------- queries
class QueryIn(BaseModel):
    sql: str = Field(min_length=1, max_length=100_000)
    max_rows: int | None = Field(default=None, ge=1, le=100_000)
    client_query_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9-]{8,64}$")


class SavedQueryIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sql: str = Field(min_length=1, max_length=100_000)
    description: str | None = Field(default=None, max_length=2000)


class SavedQueryPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sql: str | None = Field(default=None, min_length=1, max_length=100_000)
    description: str | None = Field(default=None, max_length=2000)


class SavedQueryOut(ORM):
    id: str
    name: str
    description: str | None
    sql: str
    created_at: UTCDateTime
    updated_at: UTCDateTime


class QueryHistoryOut(ORM):
    id: str
    sql: str
    status: str
    duration_ms: int | None
    row_count: int | None
    truncated: bool
    error_message: str | None
    created_at: UTCDateTime


# --------------------------------------------------------------------------- dashboards
class Layout(BaseModel):
    x: int = Field(ge=0, le=48)
    y: int = Field(ge=0, le=10_000)
    w: int = Field(ge=1, le=48)
    h: int = Field(ge=1, le=100)


class WidgetIn(BaseModel):
    id: str | None = Field(default=None, max_length=36)
    title: str = Field(min_length=1, max_length=200)
    dataset_id: str
    query: ChartQuery
    display: dict[str, Any] = Field(default_factory=dict)
    layout: Layout


class FilterIn(BaseModel):
    id: str | None = Field(default=None, max_length=36)
    dataset_id: str
    column: str = Field(min_length=1, max_length=255)
    filter_type: Literal["date_range", "category"]
    label: str = Field(min_length=1, max_length=120)
    default_value: dict[str, Any] | None = None


class DashboardIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class DashboardSave(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    widgets: list[WidgetIn] = Field(default_factory=list, max_length=60)
    filters: list[FilterIn] = Field(default_factory=list, max_length=20)


class WidgetOut(ORM):
    id: str
    dataset_id: str | None
    chart_type: str
    title: str
    position: int
    config: dict[str, Any]
    layout: dict[str, Any]


class FilterOut(ORM):
    id: str
    dataset_id: str
    column: str
    filter_type: str
    label: str
    position: int
    default_value: dict[str, Any] | None


class DashboardOut(ORM):
    id: str
    project_id: str
    name: str
    description: str | None
    created_at: UTCDateTime
    updated_at: UTCDateTime
    widget_count: int = 0


class DashboardDetail(DashboardOut):
    widgets: list[WidgetOut]
    filters: list[FilterOut]


class ActiveFilter(BaseModel):
    dataset_id: str
    filter: ColumnFilter


class ChartDataIn(BaseModel):
    dataset_id: str
    query: ChartQuery
    dashboard_filters: list[ActiveFilter] = Field(default_factory=list, max_length=50)
