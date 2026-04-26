from contextlib import asynccontextmanager
from collections.abc import AsyncGenerator

import structlog
from fastapi import FastAPI

from app.config import settings
from app.middleware import RequestIDMiddleware, add_cors_middleware
from app.routers import health
from app.routers.v1 import example as v1_example
from app.utils.logging import configure_logging

configure_logging()

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info(
        "service starting",
        app_name=settings.app_name,
        environment=settings.environment,
        port=settings.port,
    )
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        lifespan=lifespan,
        # Disable API docs in production; enable by setting DEBUG=true
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        openapi_url="/openapi.json" if settings.debug else None,
    )

    # Middleware — Starlette applies in reverse-add order, so CORS ends up outermost
    app.add_middleware(RequestIDMiddleware)
    add_cors_middleware(app)

    # Routers
    app.include_router(health.router)
    app.include_router(v1_example.router, prefix="/api/v1")

    return app


app = create_app()
