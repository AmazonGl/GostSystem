from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import get_db
from app.models.models import User, GostFile, GeneratedDoc, DocTemplate
from app.routers.auth import require_admin

router = APIRouter()


@router.get("/")
async def get_stats(db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    users_count     = await db.scalar(select(func.count()).select_from(User))
    gosts_count     = await db.scalar(select(func.count()).select_from(GostFile))
    docs_count      = await db.scalar(select(func.count()).select_from(GeneratedDoc))
    templates_count = await db.scalar(select(func.count()).select_from(DocTemplate))

    # Топ ГОСТов по числу привязанных шаблонов документов
    top_gosts_result = await db.execute(
        select(GostFile.code, GostFile.title, func.count(DocTemplate.id).label("templates"))
        .join(DocTemplate, DocTemplate.gost_id == GostFile.id, isouter=True)
        .group_by(GostFile.id)
        .order_by(func.count(DocTemplate.id).desc())
        .limit(5)
    )
    top_gosts = [{"code": r.code, "title": r.title, "templates": r.templates} for r in top_gosts_result]

    # Последние созданные документы
    recent_docs_result = await db.execute(
        select(GeneratedDoc.title, GeneratedDoc.created_at)
        .order_by(GeneratedDoc.created_at.desc()).limit(5)
    )
    recent_docs = [{"title": r.title or "Без названия"} for r in recent_docs_result]

    recent_users_result = await db.execute(
        select(User.name, User.email, User.role, User.created_at)
        .order_by(User.created_at.desc()).limit(5)
    )
    recent_users = [{"name": r.name, "email": r.email, "role": r.role} for r in recent_users_result]

    return {
        "counts": {
            "users": users_count,
            "gosts": gosts_count,
            "docs": docs_count,
            "templates": templates_count,
        },
        "top_gosts": top_gosts,
        "recent_docs": recent_docs,
        "recent_users": recent_users,
    }
