.PHONY: install dev test test-unit test-integration lint format typecheck build up down clean

install:
	uv pip install -e ".[dev]"

dev:
	uvicorn app.main:app --reload --port $${PORT:-8000}

test:
	uv run pytest tests/ -v --cov=app --cov-report=term-missing

test-unit:
	uv run pytest tests/unit/ -v

test-integration:
	uv run pytest tests/integration/ -v

lint:
	uv run ruff check . && uv run ruff format --check .

format:
	uv run ruff format .

typecheck:
	uv run mypy app/

build:
	docker build -t my-service .

up:
	docker compose up

down:
	docker compose down

clean:
	find . -type d -name __pycache__ -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
	rm -rf .pytest_cache .mypy_cache .ruff_cache htmlcov .coverage coverage.xml
