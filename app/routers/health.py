import structlog
from fastapi import APIRouter
from pydantic import BaseModel

logger = structlog.get_logger(__name__)

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: str


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness probe — returns 200 if the process is alive."""
    return HealthResponse(status="ok")


@router.get("/ready", response_model=HealthResponse)
async def ready() -> HealthResponse:
    """Readiness probe — returns 503 if the service cannot serve traffic.

    Add dependency checks here (DB ping, cache ping, etc.).
    Raise HTTPException(status_code=503) if a dependency is unhealthy.
    """
    # TODO: add dependency health checks
    return HealthResponse(status="ready")
