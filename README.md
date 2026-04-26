# my-service

A production-ready FastAPI microservice template. Deployable to **Google Cloud Run** or any **VPS running Docker Engine**.

---

## Using this template

### Step 1 — Create your repo from this template

Click **"Use this template"** on GitHub, or clone and re-init:

```bash
git clone https://github.com/your-org/my-microservice-template my-service
cd my-service
rm -rf .git && git init && git add . && git commit -m "Initial commit from template"
```

### Step 2 — Rename the service

Replace `my-service` with your service name in:

| File | What to change |
|---|---|
| `pyproject.toml` | `name = "my-service"` |
| `Makefile` | `docker build -t my-service .` |
| `docker-compose.yml` | `image: my-service:local` |
| `.env.example` | `APP_NAME=my-service` |

### Step 3 — Install local prerequisites

| Tool | Install |
|---|---|
| Python 3.12+ | https://python.org/downloads |
| uv | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Docker + Docker Compose | https://docs.docker.com/get-docker/ |

### Step 4 — Run locally

```bash
cp .env.example .env
make install
pre-commit install   # optional: enables git hooks
make dev
```

The API is now running at `http://localhost:8000`.

> **Debug mode** (enables `/docs` OpenAPI UI): set `DEBUG=true` in `.env`.

---

## Try it out

After `make dev`, run these in another terminal:

```bash
# Health / readiness
curl http://localhost:8000/health
curl http://localhost:8000/ready

# List items (empty to start)
curl http://localhost:8000/api/v1/items/

# Create an item
curl -X POST http://localhost:8000/api/v1/items/ \
  -H "Content-Type: application/json" \
  -d '{"name": "Widget", "description": "My first item"}'

# Get the item by ID
curl http://localhost:8000/api/v1/items/1
```

See [`examples/requests.http`](examples/requests.http) for a full set of examples compatible with VS Code REST Client and JetBrains HTTP Client.

---

## Running with Docker

```bash
# Build image
make build

# Start with Docker Compose (hot-reload, debug mode)
make up

# Simulate Cloud Run PORT injection
docker run --rm -p 8080:8080 -e PORT=8080 my-service
curl http://localhost:8080/health
```

---

## Configuration

All config is via environment variables. Copy `.env.example` to `.env` and adjust.

| Variable | Default | Description |
|---|---|---|
| `APP_NAME` | `my-service` | Service name (appears in logs) |
| `ENVIRONMENT` | `development` | `development`, `staging`, or `production` |
| `DEBUG` | `false` | Enables `/docs`, `/redoc`, `/openapi.json` |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `PORT` | `8000` | Listen port. Cloud Run injects `PORT=8080` automatically. |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed CORS origins |

---

## CI/CD prerequisites

### Image registry (GHCR — always on)

No setup needed. The CD workflow authenticates to GitHub Container Registry using the built-in `GITHUB_TOKEN`. Images are pushed to `ghcr.io/<owner>/<repo>`.

### Deploy to Google Cloud Run (optional)

Uncomment the `deploy-cloud-run` job in `.github/workflows/cd.yml`, then:

1. Enable APIs in your GCP project:
   ```bash
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com
   ```
2. Set up [Workload Identity Federation](https://github.com/google-github-actions/auth#setting-up-workload-identity-federation) (no long-lived keys needed).
3. Add these secrets to your GitHub repo (`Settings → Secrets → Actions`):

   | Secret | Value |
   |---|---|
   | `GCP_WORKLOAD_IDENTITY_PROVIDER` | WIF provider resource name |
   | `GCP_SERVICE_ACCOUNT` | Service account email |

4. Grant the service account `roles/run.admin` and `roles/iam.serviceAccountUser`.
5. Fill in `GCP_PROJECT_ID`, `GCP_REGION`, `CLOUD_RUN_SERVICE` in the workflow file.

> **PORT note:** Cloud Run injects `PORT=8080` at runtime. No app changes needed — `app/config.py` reads `PORT` automatically and the Dockerfile `CMD` expands it at container start.

### Deploy to VPS via SSH (optional)

Uncomment the `deploy-vps` job in `.github/workflows/cd.yml`, then:

1. Add these secrets to your GitHub repo:

   | Secret | Value |
   |---|---|
   | `VPS_HOST` | Server IP or hostname |
   | `VPS_USER` | SSH username (e.g. `deploy`) |
   | `VPS_SSH_KEY` | Private key contents (`cat ~/.ssh/id_ed25519`) |
   | `VPS_DEPLOY_PATH` | Absolute path on server (e.g. `/opt/my-service`) |

2. On the server, copy `docker-compose.yml` to `VPS_DEPLOY_PATH` and create a `.env` with production values.
3. Ensure the SSH user is in the `docker` group: `sudo usermod -aG docker $USER`.

---

## Testing

```bash
make test                # all tests + coverage report
make test-unit           # unit tests only (services, models)
make test-integration    # integration tests only (HTTP endpoints)
```

---

## Project structure

```
app/
├── config.py          # Pydantic settings (env var parsing)
├── main.py            # App factory, middleware wiring, router registration
├── middleware.py      # Request-ID injection, CORS, structured logging
├── dependencies.py    # Shared FastAPI dependencies (auth stubs, etc.)
├── models/            # Pydantic request/response schemas
├── routers/
│   ├── health.py      # GET /health, GET /ready
│   └── v1/            # Versioned API routers
└── services/          # Business logic layer
```

See `design.md` for the full architecture diagram and design decisions.
