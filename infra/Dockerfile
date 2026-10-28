# Single image: builds the web app, then serves it from the FastAPI process.
FROM node:24-slim AS web
WORKDIR /src/apps/web
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web/ ./
RUN pnpm exec vite build

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1
# pg_dump / pg_restore for `aether backup` and `aether restore` against PostgreSQL
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /usr/local/bin/uv
WORKDIR /app/apps/api
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api/ ./
RUN uv sync --frozen --no-dev
COPY --from=web /src/apps/web/dist /app/apps/web/dist
RUN useradd --create-home --uid 10001 aether && mkdir -p /data && chown aether /data
USER aether
ENV AETHER_STORAGE_DIR=/data
EXPOSE 8000
CMD ["uv", "run", "--no-sync", "aether", "serve", "--host", "0.0.0.0", "--port", "8000"]
