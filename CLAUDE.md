# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a production-ready GitHub repository template for bootstrapping Python/FastAPI microservices. The distribution artifact is a Docker image; CI/CD is handled via GitHub Actions.

## Commands

```bash
# Install dependencies (dev)
uv pip install -e ".[dev]"

# Run dev server (hot reload)
uvicorn app.main:app --reload

# Run tests
uv run pytest tests/ -v --cov=app

# Run a single test
uv run pytest tests/unit/test_example.py::test_name -v

# Lint
uv run ruff check . && uv run ruff format --check .

# Auto-format
uv run ruff format .

# Type check
uv run mypy app/

# Build Docker image
docker build -t my-service .

# Start local stack
docker compose up
```

## Architecture

```
Request → Middleware (logging, request-id, CORS)
        → Router (versioned: /api/v1/...)
        → Dependency Injection (auth, db session, etc.)
        → Service Layer (business logic)
        → Response (Pydantic model)
```

### Key layers

- **`app/config.py`** — `pydantic-settings` `BaseSettings`; all config injected via env vars, `.env` file supported.
- **`app/middleware.py`** — CORS, structured logging, request-ID injection.
- **`app/routers/health.py`** — `GET /health` (liveness) and `GET /ready` (readiness, returns 503 if deps unhealthy).
- **`app/routers/v1/`** — Versioned domain routers.
- **`app/services/`** — Business logic; routers should stay thin and delegate here.
- **`app/models/`** — Pydantic request/response schemas only (not ORM models).

### Toolchain

| Tool | Purpose |
|---|---|
| `uv` | Package management (replaces pip) |
| `ruff` | Lint + format (replaces flake8/isort) |
| `mypy` | Static type checking |
| `pytest` + `httpx` | Tests (async test client) |
| `structlog` / `python-json-logger` | Structured JSON logging |

### Docker

Multi-stage build: `builder` stage installs deps via `uv`, `runtime` stage copies only what's needed. Non-root `app` user. Target image size < 200 MB (`python:3.12-slim`).

### CI/CD (GitHub Actions)

- **`ci.yml`** — Triggered on PRs to `main`: ruff → mypy → pytest → docker build (no push).
- **`cd.yml`** — Triggered on merge to `main`: build & push multi-platform image (`linux/amd64`, `linux/arm64`) to GHCR via `GITHUB_TOKEN`. Tags: `sha-{short-sha}` + `latest` on merge; semver tags on `v*` git tags.
