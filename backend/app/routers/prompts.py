from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.models import Prompt, PromptGost
from app.routers.auth import require_admin, get_current_user

router = APIRouter()


class PromptIn(BaseModel):
    title: str
    content: str


class PromptOut(BaseModel):
    id: str
    title: str
    content: str

    class Config:
        from_attributes = True


class BindRequest(BaseModel):
    gost_id: str


@router.get("/", response_model=list[PromptOut])
async def list_prompts(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(Prompt).order_by(Prompt.created_at.desc()))
    return result.scalars().all()


@router.post("/", response_model=PromptOut)
async def create_prompt(body: PromptIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    p = Prompt(title=body.title, content=body.content)
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return p


@router.put("/{prompt_id}", response_model=PromptOut)
async def update_prompt(prompt_id: str, body: PromptIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Промпт не найден")
    p.title = body.title
    p.content = body.content
    await db.commit()
    await db.refresh(p)
    return p


@router.delete("/{prompt_id}")
async def delete_prompt(prompt_id: str, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    result = await db.execute(select(Prompt).where(Prompt.id == prompt_id))
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Промпт не найден")
    await db.delete(p)
    await db.commit()
    return {"ok": True}


@router.post("/{prompt_id}/bind")
async def bind_to_gost(prompt_id: str, body: BindRequest, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    existing = await db.execute(
        select(PromptGost).where(PromptGost.prompt_id == prompt_id, PromptGost.gost_id == body.gost_id)
    )
    if existing.scalar_one_or_none():
        return {"ok": True, "message": "Уже привязан"}
    link = PromptGost(prompt_id=prompt_id, gost_id=body.gost_id)
    db.add(link)
    await db.commit()
    return {"ok": True}


@router.delete("/{prompt_id}/bind/{gost_id}")
async def unbind_from_gost(prompt_id: str, gost_id: str, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    result = await db.execute(
        select(PromptGost).where(PromptGost.prompt_id == prompt_id, PromptGost.gost_id == gost_id)
    )
    link = result.scalar_one_or_none()
    if link:
        await db.delete(link)
        await db.commit()
    return {"ok": True}
