"""Command line entry point: `uv run aether <command>`.

  migrate          apply database migrations (Alembic upgrade head)
  serve            migrate, then run the API (and the built web app, if present) on loopback
  worker           run a standalone background worker
  demo-data        write the synthetic demo tables to a directory
  backup           write metadata + storage to a .zip archive
  restore          restore a backup archive (refuses non-empty targets without --force)
  benchmark        run the reproducible performance benchmark
"""

import argparse
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]


def migrate() -> None:
    from alembic.config import Config

    from alembic import command

    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "alembic"))
    command.upgrade(cfg, "head")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="aether", description="Aether Analytics")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate")
    serve = sub.add_parser("serve")
    serve.add_argument("--host", default="127.0.0.1", help="Bind address (default: loopback only)")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true")
    sub.add_parser("worker")
    demo = sub.add_parser("demo-data")
    demo.add_argument("--out", type=Path, required=True)
    demo.add_argument("--seed", type=int, default=42)
    backup = sub.add_parser("backup")
    backup.add_argument("--out", type=Path, required=True)
    restore = sub.add_parser("restore")
    restore.add_argument("archive", type=Path)
    restore.add_argument("--force", action="store_true")
    bench = sub.add_parser("benchmark")
    bench.add_argument("--sizes", type=int, nargs="+", default=[10_000, 100_000, 1_000_000])
    bench.add_argument("--repeats", type=int, default=3)
    bench.add_argument("--out", type=Path, help="directory for results.json and RESULTS.md")
    args = parser.parse_args(argv)

    if args.command == "migrate":
        migrate()
    elif args.command == "serve":
        import uvicorn

        migrate()
        if args.host not in ("127.0.0.1", "localhost", "::1"):
            print(f"WARNING: binding to {args.host} exposes Aether beyond this machine. "
                  "Set AETHER_COOKIE_SECURE=true behind HTTPS and see docs/SECURITY.md.", file=sys.stderr)
        uvicorn.run("app.main:app", host=args.host, port=args.port, reload=args.reload)
    elif args.command == "worker":
        from app.workers.runner import main as worker_main

        worker_main()
    elif args.command == "demo-data":
        from app.demo import generate

        args.out.mkdir(parents=True, exist_ok=True)
        for name, frame in generate(args.seed).items():
            frame.write_csv(args.out / f"{name}.csv")
            print(f"{args.out / (name + '.csv')}: {frame.height:,} rows")
    elif args.command == "backup":
        from app.backup import create_backup

        print(f"Backup written to {create_backup(args.out)}")
    elif args.command == "restore":
        from app.backup import restore_backup

        manifest = restore_backup(args.archive, force=args.force)
        print(f"Restored backup from {manifest['created_at']} (schema {manifest['alembic_revision']})")
    elif args.command == "benchmark":
        import json

        from app.benchmark import run, to_markdown

        report = run(args.sizes, args.repeats)
        markdown = to_markdown(report)
        print(markdown)
        if args.out:
            args.out.mkdir(parents=True, exist_ok=True)
            (args.out / "results.json").write_text(json.dumps(report, indent=2))
            (args.out / "RESULTS.md").write_text(markdown)


if __name__ == "__main__":
    main()
