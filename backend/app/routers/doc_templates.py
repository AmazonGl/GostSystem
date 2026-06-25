"""Роутер управления загружаемыми .docx-шаблонами документов."""
import os
import uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.config import settings
from app.models.models import DocTemplate, User, GostFile
from app.routers.auth import get_current_user, require_admin
from app.services.docx_templates import parse_template_structure
from app.services.ai import _norm_title
from app.services.gost_meta import _hint_for_title

router = APIRouter()


class DocTemplateOut(BaseModel):
    id: str
    name: str
    doc_type: str
    gost_id: Optional[str] = None
    structure: Optional[dict] = None

    class Config:
        from_attributes = True


class DocTemplateInfo(BaseModel):
    id: str
    name: str
    doc_type: str
    sections_count: int

    class Config:
        from_attributes = True


@router.get("/", response_model=list[DocTemplateInfo])
async def list_doc_templates(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DocTemplate).order_by(DocTemplate.created_at.desc()))
    out = []
    for t in res.scalars().all():
        cnt = len((t.structure or {}).get("sections", []))
        out.append(DocTemplateInfo(id=t.id, name=t.name, doc_type=t.doc_type, sections_count=cnt))
    return out


def _build_hint_map(meta_schema: dict) -> dict:
    """Строит карту {нормализованное_название: подсказка} из meta_schema ГОСТа,
    рекурсивно по всем разделам и подразделам."""
    hints = {}

    def walk(nodes):
        for n in nodes or []:
            title = n.get("title", "")
            desc = (n.get("description") or "").strip()
            if title:
                hints[_norm_title(title)] = desc
            walk(n.get("subsections", []))

    walk((meta_schema or {}).get("sections", []))
    return hints


def _enrich_structure_with_hints(structure: dict, hint_map: dict) -> dict:
    """Проставляет каждому узлу структуры шаблона description-подсказку:
    сперва по совпадению названия с ГОСТом, иначе — по ключевым словам."""
    def walk(nodes):
        for n in nodes or []:
            title = n.get("title", "")
            hint = hint_map.get(_norm_title(title)) or _hint_for_title(title) or ""
            n["description"] = hint
            walk(n.get("subsections", []))

    walk((structure or {}).get("sections", []))
    return structure


@router.get("/{template_id}", response_model=DocTemplateOut)
async def get_doc_template(template_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    res = await db.execute(select(DocTemplate).where(DocTemplate.id == template_id))
    tpl = res.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "Шаблон не найден")

    # Если шаблон привязан к ГОСТу — обогащаем структуру подсказками «что писать».
    structure = tpl.structure or {"sections": []}
    if tpl.gost_id:
        gost_res = await db.execute(select(GostFile).where(GostFile.id == tpl.gost_id))
        gost = gost_res.scalar_one_or_none()
        if gost and gost.meta_schema:
            import copy
            structure = _enrich_structure_with_hints(copy.deepcopy(structure), _build_hint_map(gost.meta_schema))

    return DocTemplateOut(id=tpl.id, name=tpl.name, doc_type=tpl.doc_type, gost_id=tpl.gost_id, structure=structure)


class StructureUpdate(BaseModel):
    structure: dict


@router.put("/{template_id}/structure", response_model=DocTemplateOut)
async def update_structure(
    template_id: str,
    body: StructureUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Сохраняет отредактированную структуру разделов шаблона."""
    res = await db.execute(select(DocTemplate).where(DocTemplate.id == template_id))
    tpl = res.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "Шаблон не найден")
    tpl.structure = body.structure
    await db.commit()
    await db.refresh(tpl)
    return DocTemplateOut(id=tpl.id, name=tpl.name, doc_type=tpl.doc_type, gost_id=tpl.gost_id, structure=tpl.structure)


@router.post("/upload", response_model=DocTemplateOut)
async def upload_doc_template(
    file: UploadFile = File(...),
    name: str = Form(...),
    doc_type: str = Form(""),
    gost_id: str = Form(""),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext != ".docx":
        raise HTTPException(400, "Шаблон должен быть в формате .docx")

    tpl_dir = os.path.join(settings.STORAGE_PATH, "_doc_templates")
    os.makedirs(tpl_dir, exist_ok=True)
    fname = f"{uuid.uuid4()}.docx"
    path = os.path.join(tpl_dir, fname)
    data = await file.read()
    with open(path, "wb") as f:
        f.write(data)

    # Разбираем структуру разделов из заголовков шаблона
    try:
        structure = parse_template_structure(path)
    except Exception as e:
        os.remove(path)
        raise HTTPException(400, f"Не удалось разобрать структуру шаблона: {e}")

    tpl = DocTemplate(
        name=name,
        doc_type=doc_type,
        file_path=path,
        structure=structure,
        gost_id=gost_id or None,
    )
    db.add(tpl)
    await db.commit()
    await db.refresh(tpl)
    return tpl


@router.delete("/{template_id}")
async def delete_doc_template(template_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    res = await db.execute(select(DocTemplate).where(DocTemplate.id == template_id))
    tpl = res.scalar_one_or_none()
    if not tpl:
        raise HTTPException(404, "Шаблон не найден")
    if tpl.file_path and os.path.exists(tpl.file_path):
        os.remove(tpl.file_path)
    await db.delete(tpl)
    await db.commit()
    return {"ok": True}
