from fastapi import APIRouter, Depends
from app.routers.auth import require_admin
from app.services import ai
from app.config import settings

router = APIRouter()


@router.get("/health")
async def ollama_health(_=Depends(require_admin)):
    alive = await ai.check_health()
    models = await ai.list_models() if alive else []
    return {
        "status": "ok" if alive else "unavailable",
        "base_url": settings.OLLAMA_BASE_URL,
        "active_model": settings.OLLAMA_MODEL,
        "available_models": models,
    }
