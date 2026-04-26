import pytest

from app.models.example import ItemCreate
from app.services import example as svc


@pytest.fixture(autouse=True)
def reset_store() -> None:
    """Reset the in-memory store between tests."""
    svc._store.clear()
    svc._counter = 0


async def test_create_item() -> None:
    payload = ItemCreate(name="Widget", description="A test widget")
    item = await svc.create_item(payload)
    assert item.id == 1
    assert item.name == "Widget"
    assert item.description == "A test widget"


async def test_create_item_no_description() -> None:
    payload = ItemCreate(name="Bare")
    item = await svc.create_item(payload)
    assert item.description is None


async def test_get_item() -> None:
    payload = ItemCreate(name="Findable")
    created = await svc.create_item(payload)
    found = await svc.get_item(created.id)
    assert found is not None
    assert found.name == "Findable"


async def test_get_item_not_found() -> None:
    result = await svc.get_item(999999)
    assert result is None


async def test_list_items_empty() -> None:
    items = await svc.list_items()
    assert items == []


async def test_list_items_after_create() -> None:
    await svc.create_item(ItemCreate(name="A"))
    await svc.create_item(ItemCreate(name="B"))
    items = await svc.list_items()
    assert len(items) == 2
    assert {i.name for i in items} == {"A", "B"}
