"""Standalone worker process: `python -m app.workers.runner`."""

import signal

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.workers.queue import Worker


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level, settings.log_json)
    worker = Worker()
    signal.signal(signal.SIGINT, lambda *_: worker.stop())
    signal.signal(signal.SIGTERM, lambda *_: worker.stop())
    worker.run_forever()


if __name__ == "__main__":
    main()
