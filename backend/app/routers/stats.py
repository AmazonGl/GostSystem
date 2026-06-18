from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.models import User, GostFile, ChatSession, GeneratedDoc, Roadmap, ChatMessage
from app.routers.auth import require_admin

router = APIRouter()


@router.get("/")
async def get_stats(db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    users_count    = await db.scalar(select(func.count()).select_from(User))
    gosts_count    = await db.scalar(select(func.count()).select_from(GostFile))
    sessions_count = await db.scalar(select(func.count()).select_from(ChatSession))
    docs_count     = await db.scalar(select(func.count()).select_from(GeneratedDoc))
    roadmaps_count = await db.scalar(select(func.count()).select_from(Roadmap))
    messages_count = await db.scalar(select(func.count()).select_from(ChatMessage))

    top_gosts_result = await db.execute(
        select(GostFile.code, GostFile.title, func.count(ChatSession.id).label("sessions"))
        .join(ChatSession, ChatSession.gost_id == GostFile.id, isouter=True)
        .group_by(GostFile.id)
        .order_by(func.count(ChatSession.id).desc())
        .limit(5)
    )
    top_gosts = [{"code": r.code, "title": r.title, "sessions": r.sessions} for r in top_gosts_result]

    recent_users_result = await db.execute(
        select(User.name, User.email, User.role, User.created_at)
        .order_by(User.created_at.desc()).limit(5)
    )
    recent_users = [{"name": r.name, "email": r.email, "role": r.role} for r in recent_users_result]

    return {
        "counts": {
            "users": users_count, "gosts": gosts_count,
            "sessions": sessions_count, "docs": docs_count,
            "roadmaps": roadmaps_count, "messages": messages_count,
        },
        "top_gosts": top_gosts,
        "recent_users": recent_users,
    }
