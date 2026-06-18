from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models.models import GostTemplate, GostFile
from app.routers.auth import require_admin, get_current_user

router = APIRouter()


class TemplateOut(BaseModel):
    id: str
    gost_id: str
    gost_code: str
    gost_title: str
    gost_category: str
    default_prompt: str
    current_prompt: str
    meta_schema: dict | None = None

    class Config:
        from_attributes = True


class TemplateUpdate(BaseModel):
    current_prompt: str


@router.get("/", response_model=list[TemplateOut])
async def list_templates(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(
        select(GostTemplate, GostFile)
        .join(GostFile, GostTemplate.gost_id == GostFile.id)
        .order_by(GostFile.code)
    )
    out = []
    for tmpl, gost in result.all():
        out.append({
            "id": tmpl.id,
            "gost_id": gost.id,
            "gost_code": gost.code,
            "gost_title": gost.title,
            "gost_category": gost.category,
            "default_prompt": tmpl.default_prompt,
            "current_prompt": tmpl.current_prompt,
            "meta_schema": gost.meta_schema,
        })
    return out


@router.get("/{template_id}", response_model=TemplateOut)
async def get_template(template_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(
        select(GostTemplate, GostFile)
        .join(GostFile, GostTemplate.gost_id == GostFile.id)
        .where(GostTemplate.id == template_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(404, "Шаблон не найден")
    tmpl, gost = row
    return {
        "id": tmpl.id,
        "gost_id": gost.id,
        "gost_code": gost.code,
        "gost_title": gost.title,
        "gost_category": gost.category,
        "default_prompt": tmpl.default_prompt,
        "current_prompt": tmpl.current_prompt,
        "meta_schema": gost.meta_schema,
    }


@router.put("/{template_id}", response_model=TemplateOut)
async def update_template(
    template_id: str,
    body: TemplateUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    result = await db.execute(select(GostTemplate).where(GostTemplate.id == template_id))
    tmpl = result.scalar_one_or_none()
    if not tmpl:
        raise HTTPException(404, "Шаблон не найден")
    tmpl.current_prompt = body.current_prompt
    await db.commit()

    gost_result = await db.execute(select(GostFile).where(GostFile.id == tmpl.gost_id))
    gost = gost_result.scalar_one()
    return {
        "id": tmpl.id,
        "gost_id": gost.id,
        "gost_code": gost.code,
        "gost_title": gost.title,
        "gost_category": gost.category,
        "default_prompt": tmpl.default_prompt,
        "current_prompt": tmpl.current_prompt,
        "meta_schema": gost.meta_schema,
    }


@router.post("/{template_id}/reset", response_model=TemplateOut)
async def reset_template(template_id: str, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    result = await db.execute(select(GostTemplate).where(GostTemplate.id == template_id))
    tmpl = result.scalar_one_or_none()
    if not tmpl:
        raise HTTPException(404, "Шаблон не найден")
    tmpl.current_prompt = tmpl.default_prompt
    await db.commit()

    gost_result = await db.execute(select(GostFile).where(GostFile.id == tmpl.gost_id))
    gost = gost_result.scalar_one()
    return {
        "id": tmpl.id,
        "gost_id": gost.id,
        "gost_code": gost.code,
        "gost_title": gost.title,
        "gost_category": gost.category,
        "default_prompt": tmpl.default_prompt,
        "current_prompt": tmpl.current_prompt,
        "meta_schema": gost.meta_schema,
    }
