from httpx import AsyncClient


async def test_health_returns_ok(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_ready_returns_ok(client: AsyncClient) -> None:
    response = await client.get("/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


async def test_response_has_request_id_header(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert "x-request-id" in response.headers


async def test_custom_request_id_is_echoed(client: AsyncClient) -> None:
    response = await client.get("/health", headers={"X-Request-ID": "my-trace-id"})
    assert response.headers["x-request-id"] == "my-trace-id"


async def test_items_endpoint_reachable(client: AsyncClient) -> None:
    response = await client.get("/api/v1/items/")
    assert response.status_code == 200
    assert response.json() == []


async def test_create_and_get_item(client: AsyncClient) -> None:
    create_resp = await client.post(
        "/api/v1/items/",
        json={"name": "Test Item", "description": "Hello"},
    )
    assert create_resp.status_code == 201
    item = create_resp.json()
    assert item["name"] == "Test Item"
    assert item["id"] >= 1

    get_resp = await client.get(f"/api/v1/items/{item['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Test Item"


async def test_get_nonexistent_item_returns_404(client: AsyncClient) -> None:
    response = await client.get("/api/v1/items/999999")
    assert response.status_code == 404
