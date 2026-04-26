## Plan

**Objective:** A production-ready GitHub repository template that any new Python/FastAPI microservice can be bootstrapped from — with Docker as the distribution artifact and GitHub Actions handling CI/CD.

**Scope of the template:**

1. Project structure and boilerplate code
2. FastAPI app skeleton with health/readiness endpoints
3. Dockerfile (multi-stage, optimized)
4. Docker Compose for local development
5. GitHub Actions workflows: CI (lint, test, build) and CD (push to registry, deploy)
6. Configuration management (env vars, Pydantic settings)
7. Logging, error handling, middleware stubs
8. Developer tooling: pre-commit hooks, Makefile

---

## Repository Structure

```
my-service/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # Lint, test, build on PR
│   │   └── cd.yml              # Build, push, deploy on main merge
│   └── PULL_REQUEST_TEMPLATE.md
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app entrypoint
│   ├── config.py               # Pydantic BaseSettings
│   ├── dependencies.py         # Shared FastAPI dependencies
│   ├── middleware.py           # CORS, logging, request ID
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── health.py           # /health, /ready
│   │   └── v1/
│   │       ├── __init__.py
│   │       └── example.py      # Example domain router
│   ├── models/
│   │   ├── __init__.py
│   │   └── example.py          # Pydantic request/response schemas
│   ├── services/
│   │   ├── __init__.py
│   │   └── example.py          # Business logic layer
│   └── utils/
│       ├── __init__.py
│       └── logging.py          # Structured JSON logger
├── tests/
│   ├── __init__.py
│   ├── conftest.py             # Pytest fixtures, test client
│   ├── unit/
│   │   └── test_example.py
│   └── integration/
│       └── test_health.py
├── .dockerignore
├── .env.example
├── .gitignore
├── .pre-commit-config.yaml
├── docker-compose.yml          # Local dev stack
├── Dockerfile                  # Multi-stage production image
├── Makefile                    # Dev shortcuts
├── pyproject.toml              # Dependencies + tool config
└── README.md
```

---

## Architecture

### Application Layer

```
Request → Middleware (logging, request-id, CORS)
        → Router (versioned: /api/v1/...)
        → Dependency Injection (auth, db session, etc.)
        → Service Layer (business logic)
        → Response (Pydantic model)
```

**Key design decisions:**

| Decision | Choice | Rationale |
|---|---|---|
| Framework | FastAPI | Async-native, OpenAPI auto-docs, Pydantic integration |
| Config | `pydantic-settings` | Typed env var parsing, `.env` support |
| Logging | `structlog` or `python-json-logger` | Machine-readable JSON logs for observability |
| Testing | `pytest` + `httpx` (async test client) | FastAPI-native async test support |
| Linting | `ruff` | Fast, replaces flake8/isort/pyupgrade in one tool |
| Type checking | `mypy` | Enforced in CI |
| Package mgmt | `uv` | Modern, faster pip replacement |

---

### Dockerfile (Multi-Stage)

```dockerfile
# Stage 1: builder
FROM python:3.12-slim AS builder
WORKDIR /app
RUN pip install uv
COPY pyproject.toml .
RUN uv pip install --system --no-cache -r pyproject.toml

# Stage 2: runtime
FROM python:3.12-slim AS runtime
WORKDIR /app
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin
COPY app/ ./app/

# Non-root user
RUN addgroup --system app && adduser --system --ingroup app app
USER app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Image size target:** < 200 MB using `python:3.12-slim` base. Avoid `python:latest` (bloated).

---

### GitHub Actions: CI Workflow (`.github/workflows/ci.yml`)

Triggers: `pull_request` to `main`

```
Steps:
1. Checkout
2. Setup Python + uv cache
3. Install dependencies
4. ruff check (lint + format check)
5. mypy (type check)
6. pytest (unit + integration, with coverage report)
7. docker build --no-push (validate image builds)
```

### GitHub Actions: CD Workflow (`.github/workflows/cd.yml`)

Triggers: `push` to `main` (merge)

```
Steps:
1. Checkout
2. Set up Docker Buildx
3. Login to container registry (GHCR or DockerHub via secrets)
4. Extract metadata (tags: git SHA, latest, semver if tagged)
5. Build & push multi-platform image (linux/amd64, linux/arm64)
6. [Optional] Trigger deployment (Render, Fly.io, k8s rollout, etc.)
```

**Registry:** GitHub Container Registry (`ghcr.io`) is the default — no external account needed, auth via `GITHUB_TOKEN`.

**Image tagging strategy:**

| Event | Tag |
|---|---|
| PR build | `pr-{number}` |
| Merge to main | `sha-{short-git-sha}`, `latest` |
| Git tag `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest` |

---

### Environment Configuration (`app/config.py`)

```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    app_name: str = "my-service"
    environment: str = "development"  # development | staging | production
    debug: bool = False
    log_level: str = "INFO"

    # Example: database
    database_url: str = "sqlite:///./dev.db"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()
```

All secrets injected via environment variables — never committed. `.env.example` documents all required vars.

---

### Health Endpoints (`/health`, `/ready`)

Required for Docker health checks, Kubernetes probes, and load balancers:

| Endpoint | Purpose | Returns |
|---|---|---|
| `GET /health` | Liveness — is the process alive? | `200 { "status": "ok" }` |
| `GET /ready` | Readiness — can it serve traffic? | `200` if deps healthy, `503` otherwise |

---

### Local Development (`docker-compose.yml`)

```yaml
services:
  api:
    build: .
    ports: ["8000:8000"]
    volumes: ["./app:/app/app"]   # hot reload in dev
    env_file: .env
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

  # Add postgres, redis, etc. as needed
```

---

### Makefile Shortcuts

```makefile
install:    uv pip install -e ".[dev]"
dev:        uvicorn app.main:app --reload
test:       pytest tests/ -v --cov=app
lint:       ruff check . && ruff format --check .
format:     ruff format .
typecheck:  mypy app/
build:      docker build -t my-service .
up:         docker compose up
```
