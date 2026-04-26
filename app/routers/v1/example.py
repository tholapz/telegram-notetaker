import structlog
from fastapi import APIRouter, HTTPException

from app.models.example import ItemCreate, ItemResponse
from app.services.example import create_item, get_item, list_items

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/items", tags=["Items"])


@router.get("/", response_model=list[ItemResponse])
async def read_items() -> list[ItemResponse]:
    """List all items."""
    return await list_items()


@router.post("/", response_model=ItemResponse, status_code=201)
async def create_item_endpoint(payload: ItemCreate) -> ItemResponse:
    """Create a new item."""
    item = await create_item(payload)
    logger.info("item created", item_id=item.id, name=item.name)
    return item


@router.get("/{item_id}", response_model=ItemResponse)
async def read_item(item_id: int) -> ItemResponse:
    """Get a single item by ID."""
    item = await get_item(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item
