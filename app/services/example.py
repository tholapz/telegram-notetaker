from app.models.example import ItemCreate, ItemResponse

# In-memory store for template purposes — replace with a real DB layer.
_store: dict[int, ItemResponse] = {}
_counter: int = 0


async def create_item(payload: ItemCreate) -> ItemResponse:
    global _counter
    _counter += 1
    item = ItemResponse(id=_counter, name=payload.name, description=payload.description)
    _store[item.id] = item
    return item


async def get_item(item_id: int) -> ItemResponse | None:
    return _store.get(item_id)


async def list_items() -> list[ItemResponse]:
    return list(_store.values())
