"""SQLAlchemy models for application metadata. Analytical data lives in Parquet, not here."""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, JSONType, TimestampMixin, utcnow


# --------------------------------------------------------------------------- users & access
class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class UserSession(IdMixin, Base):
    __tablename__ = "sessions"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(255))

    user: Mapped[User] = relationship(lazy="joined")


class Project(IdMixin, TimestampMixin, Base):
    __tablename__ = "projects"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False, index=True)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class ProjectMember(Base):
    __tablename__ = "project_members"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # owner | editor | viewer
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    user: Mapped[User] = relationship(lazy="joined")


# --------------------------------------------------------------------------- data management
class DataSource(IdMixin, Base):
    """An uploaded file (or, later, an external connection) that datasets are imported from."""

    __tablename__ = "data_sources"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="file_upload")
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_format: Mapped[str] = mapped_column(String(16), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    detected: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict, nullable=False)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Dataset(IdMixin, TimestampMixin, Base):
    __tablename__ = "datasets"
    __table_args__ = (UniqueConstraint("project_id", "table_name", name="uq_datasets_project_table"),)

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # SQL identifier used in the workbench and chart queries; unique per project.
    table_name: Mapped[str] = mapped_column(String(63), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="importing", nullable=False)  # importing|ready|failed
    current_version: Mapped[int | None] = mapped_column(Integer)
    source_id: Mapped[str | None] = mapped_column(ForeignKey("data_sources.id", ondelete="SET NULL"))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    error_message: Mapped[str | None] = mapped_column(Text)

    versions: Mapped[list["DatasetVersion"]] = relationship(
        back_populates="dataset", cascade="all, delete-orphan", order_by="DatasetVersion.version"
    )


class DatasetVersion(IdMixin, Base):
    """Immutable snapshot of a dataset stored as a Parquet file."""

    __tablename__ = "dataset_versions"
    __table_args__ = (UniqueConstraint("dataset_id", "version", name="uq_dataset_versions_dataset_version"),)

    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), index=True, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    storage_format: Mapped[str] = mapped_column(String(16), default="parquet", nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    row_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    column_count: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    source_id: Mapped[str | None] = mapped_column(ForeignKey("data_sources.id", ondelete="SET NULL"))
    import_options: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict, nullable=False)
    warnings: Mapped[list[str]] = mapped_column(JSONType, default=list, nullable=False)
    job_id: Mapped[str | None] = mapped_column(String(36))
    profile: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    profiled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    dataset: Mapped[Dataset] = relationship(back_populates="versions")
    columns: Mapped[list["DatasetColumn"]] = relationship(
        cascade="all, delete-orphan", order_by="DatasetColumn.position", lazy="selectin"
    )


class DatasetColumn(IdMixin, Base):
    __tablename__ = "dataset_columns"
    __table_args__ = (UniqueConstraint("version_id", "position", name="uq_dataset_columns_version_position"),)

    version_id: Mapped[str] = mapped_column(
        ForeignKey("dataset_versions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    logical_type: Mapped[str] = mapped_column(String(16), nullable=False)  # string|integer|float|...
    physical_type: Mapped[str] = mapped_column(String(64), nullable=False)
    null_count: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)


# --------------------------------------------------------------------------- analytics
class SavedQuery(IdMixin, TimestampMixin, Base):
    __tablename__ = "saved_queries"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    sql: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class QueryHistory(IdMixin, Base):
    __tablename__ = "query_history"
    __table_args__ = (Index("ix_query_history_project_created", "project_id", "created_at"),)

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    sql: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # succeeded|failed|rejected|cancelled
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    row_count: Mapped[int | None] = mapped_column(BigInteger)
    truncated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


# --------------------------------------------------------------------------- visualization
class Dashboard(IdMixin, TimestampMixin, Base):
    __tablename__ = "dashboards"

    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))

    widgets: Mapped[list["DashboardWidget"]] = relationship(
        cascade="all, delete-orphan", order_by="DashboardWidget.position", lazy="selectin"
    )
    filters: Mapped[list["DashboardFilter"]] = relationship(
        cascade="all, delete-orphan", order_by="DashboardFilter.position", lazy="selectin"
    )


class DashboardWidget(IdMixin, TimestampMixin, Base):
    __tablename__ = "dashboard_widgets"

    dashboard_id: Mapped[str] = mapped_column(
        ForeignKey("dashboards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # NO ACTION (checked at statement end): blocks deleting a dataset still used by a widget,
    # while still allowing project deletion to cascade through dashboards and datasets together.
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("datasets.id"), index=True)
    chart_type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict, nullable=False)
    layout: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict, nullable=False)


class DashboardFilter(IdMixin, Base):
    __tablename__ = "dashboard_filters"

    dashboard_id: Mapped[str] = mapped_column(
        ForeignKey("dashboards.id", ondelete="CASCADE"), index=True, nullable=False
    )
    dataset_id: Mapped[str] = mapped_column(ForeignKey("datasets.id"), index=True, nullable=False)
    column: Mapped[str] = mapped_column(String(255), nullable=False)
    filter_type: Mapped[str] = mapped_column(String(16), nullable=False)  # date_range | category
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    default_value: Mapped[dict[str, Any] | None] = mapped_column(JSONType)


# --------------------------------------------------------------------------- operations
class Job(IdMixin, Base):
    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_status_created", "status", "created_at"),
        Index("ix_jobs_project_created", "project_id", "created_at"),
    )

    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    job_type: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    progress: Mapped[float | None] = mapped_column(Float)
    progress_message: Mapped[str | None] = mapped_column(String(255))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict, nullable=False)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(64))
    error_message: Mapped[str | None] = mapped_column(Text)
    worker_id: Mapped[str | None] = mapped_column(String(64))
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuditLog(IdMixin, Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_project_created", "project_id", "created_at"),)

    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # No FK: audit entries must outlive the project they describe.
    project_id: Mapped[str | None] = mapped_column(String(36))
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(32), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(36))
    summary: Mapped[str | None] = mapped_column(String(255))
    details: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
