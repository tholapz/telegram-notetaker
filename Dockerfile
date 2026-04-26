# =============================================================================
# Stage 1: builder — install dependencies using uv
# =============================================================================
FROM python:3.12-slim AS builder

WORKDIR /app

RUN pip install --no-cache-dir uv==0.2.0

# Copy only the dependency manifest first to maximise layer caching
COPY pyproject.toml .

# Install production deps only (no dev extras) into the system Python
# Install only production deps (dev extras are opt-in via [dev], so omitting them excludes dev deps)
RUN uv pip install --system --no-cache .

# =============================================================================
# Stage 2: runtime — minimal image with only what's needed to run
# =============================================================================
FROM python:3.12-slim AS runtime

WORKDIR /app

# Copy installed packages and the uvicorn binary from builder
COPY --from=builder /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=builder /usr/local/bin/uvicorn /usr/local/bin/uvicorn

# Copy application source
COPY app/ ./app/

# Run as non-root user
RUN addgroup --system app && adduser --system --ingroup app app
USER app

# Built-in health check — works without curl (uses Python stdlib urllib)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-8000}/health')"

# PORT defaults to 8000 for local/VPS use.
# Cloud Run injects PORT=8080 at container start automatically.
ENV PORT=8000
EXPOSE ${PORT}

# Shell form CMD (not exec form) is intentional: the shell expands ${PORT} at
# container start time, so Cloud Run's injected PORT=8080 is used correctly.
# Exec form ["uvicorn", ..., "${PORT}"] would pass the literal string "${PORT}".
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
