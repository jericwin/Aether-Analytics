"""Job handler registry. Importing this module registers all handlers with the queue."""

from typing import Any

from app.db.session import get_sessionmaker
from app.models import DatasetVersion
from app.services import datasets
from app.workers.queue import JobContext, register

register("dataset_import", on_failure=datasets.on_import_failed)(datasets.run_import)


@register("dataset_profile")
def profile_version(ctx: JobContext) -> dict[str, Any]:
    with get_sessionmaker()() as db:
        version = db.get(DatasetVersion, ctx.payload["version_id"])
        if version is None:
            return {"skipped": "version deleted"}
        ctx.progress(0.1, "Profiling columns")
        profile = datasets.reprofile(db, version)
    return {"version_id": ctx.payload["version_id"], "quality_score": profile.get("quality_score")}
