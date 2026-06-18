import os
import shutil
import fitz
from docx import Document as DocxDocument
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.models import GostFile, PromptGost, Roadmap, ChatSession, RoadmapAnswer, GeneratedDoc, GostTemplate
from app.routers.auth import require_admin, get_current_user
from app.config import settings
from app.services.gost_meta import build_meta_schema, build_default_prompt, build_default_prompt_ai

router = APIRouter()


class GostOut(BaseModel):
    id: str
    code: str
    title: str
    file_path: str
    file_type: str
    category: str
    folder_path: str
    meta_schema: Optional[dict] = None
    has_template: bool = False

    class Config:
        from_attributes = True


class MetaSchemaUpdate(BaseModel):
    meta_schema: dict


def extract_text(file_path: str, file_type: str) -> str:
    if file_type == "pdf":
        doc = fitz.open(file_path)
        return "\n".join(page.get_text() for page in doc)
    elif file_type == "docx":
        doc = DocxDocument(file_path)
        return "\n".join(p.text for p in doc.paragraphs)
    return ""


async def _create_template_for_gost(db: AsyncSession, gost: GostFile, gost_text: str = "", use_ai: bool = False):
    existing = await db.execute(select(GostTemplate).where(GostTemplate.gost_id == gost.id))
    if existing.scalar_one_or_none():
        return

    if not gost.meta_schema:
        gost.meta_schema = build_meta_schema(gost.code, gost.title, gost.category, gost_text)

    if use_ai and gost_text:
        prompt = await build_default_prompt_ai(gost.code, gost.title, gost.meta_schema, gost_text)
    else:
        prompt = build_default_prompt(gost.code, gost.title, gost.meta_schema)

    tmpl = GostTemplate(gost_id=gost.id, default_prompt=prompt, current_prompt=prompt)
    db.add(tmpl)


@router.get("/", response_model=list[GostOut])
async def list_gosts(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(GostFile).order_by(GostFile.code))
    gosts = result.scalars().all()
    tmpl_result = await db.execute(select(GostTemplate.gost_id))
    tmpl_ids = {row for row in tmpl_result.scalars().all()}
    return [
        {
            "id": g.id, "code": g.code, "title": g.title, "file_path": g.file_path,
            "file_type": g.file_type, "category": g.category, "folder_path": g.folder_path,
            "meta_schema": g.meta_schema, "has_template": g.id in tmpl_ids,
        }
        for g in gosts
    ]


@router.post("/upload", response_model=GostOut)
async def upload_gost(
    file: UploadFile = File(...),
    code: str = Form(...),
    title: str = Form(...),
    category: str = Form(...),
    folder_path: str = Form(default="/"),
    auto_meta: bool = Form(default=True),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".pdf", ".docx"):
        raise HTTPException(400, "Только PDF или DOCX")

    dest_dir = os.path.join(settings.STORAGE_PATH, folder_path.lstrip("/"))
    os.makedirs(dest_dir, exist_ok=True)
    dest_path = os.path.join(dest_dir, file.filename)

    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    gost_text = extract_text(dest_path, ext.lstrip(".")) if auto_meta else ""
    meta = build_meta_schema(code, title, category, gost_text) if auto_meta else None

    gost = GostFile(
        code=code, title=title, file_path=dest_path,
        file_type=ext.lstrip("."), category=category, folder_path=folder_path,
        meta_schema=meta,
    )
    db.add(gost)
    await db.flush()

    if auto_meta:
        await _create_template_for_gost(db, gost, gost_text, use_ai=False)

    await db.commit()
    await db.refresh(gost)

    tmpl_check = await db.execute(select(GostTemplate).where(GostTemplate.gost_id == gost.id))
    has_tmpl = tmpl_check.scalar_one_or_none() is not None

    return {
        "id": gost.id, "code": gost.code, "title": gost.title, "file_path": gost.file_path,
        "file_type": gost.file_type, "category": gost.category, "folder_path": gost.folder_path,
        "meta_schema": gost.meta_schema, "has_template": has_tmpl,
    }


@router.get("/{gost_id}/preview")
async def preview_gost(gost_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(GostFile).where(GostFile.id == gost_id))
    gost = result.scalar_one_or_none()
    if not gost or not os.path.exists(gost.file_path):
        raise HTTPException(404, "Файл не найден")
    media = "application/pdf" if gost.file_type == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    return FileResponse(gost.file_path, media_type=media, filename=os.path.basename(gost.file_path))


@router.get("/{gost_id}/meta")
async def get_gost_meta(gost_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(GostFile).where(GostFile.id == gost_id))
    gost = result.scalar_one_or_none()
    if not gost:
        raise HTTPException(404, "ГОСТ не найден")
    tmpl_result = await db.execute(select(GostTemplate).where(GostTemplate.gost_id == gost_id))
    tmpl = tmpl_result.scalar_one_or_none()
    return {
        "gost_id": gost.id,
        "code": gost.code,
        "title": gost.title,
        "meta_schema": gost.meta_schema,
        "template": {
            "id": tmpl.id,
            "default_prompt": tmpl.default_prompt,
            "current_prompt": tmpl.current_prompt,
        } if tmpl else None,
    }


@router.put("/{gost_id}/meta", response_model=GostOut)
async def update_gost_meta(
    gost_id: str,
    body: MetaSchemaUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    result = await db.execute(select(GostFile).where(GostFile.id == gost_id))
    gost = result.scalar_one_or_none()
    if not gost:
        raise HTTPException(404, "ГОСТ не найден")
    gost.meta_schema = body.meta_schema
    await db.commit()
    await db.refresh(gost)
    tmpl_check = await db.execute(select(GostTemplate).where(GostTemplate.gost_id == gost.id))
    return {
        "id": gost.id, "code": gost.code, "title": gost.title, "file_path": gost.file_path,
        "file_type": gost.file_type, "category": gost.category, "folder_path": gost.folder_path,
        "meta_schema": gost.meta_schema, "has_template": tmpl_check.scalar_one_or_none() is not None,
    }


@router.post("/{gost_id}/generate-meta")
async def regenerate_meta(gost_id: str, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    result = await db.execute(select(GostFile).where(GostFile.id == gost_id))
    gost = result.scalar_one_or_none()
    if not gost:
        raise HTTPException(404, "ГОСТ не найден")

    gost_text = extract_text(gost.file_path, gost.file_type) if os.path.exists(gost.file_path) else ""
    gost.meta_schema = build_meta_schema(gost.code, gost.title, gost.category, gost_text)

    tmpl_result = await db.execute(select(GostTemplate).where(GostTemplate.gost_id == gost_id))
    tmpl = tmpl_result.scalar_one_or_none()
    prompt = await build_default_prompt_ai(gost.code, gost.title, gost.meta_schema, gost_text)
    if tmpl:
        tmpl.default_prompt = prompt
        tmpl.current_prompt = prompt
    else:
        tmpl = GostTemplate(gost_id=gost.id, default_prompt=prompt, current_prompt=prompt)
        db.add(tmpl)

    await db.commit()
    return {"ok": True, "meta_schema": gost.meta_schema}


@router.delete("/{gost_id}")
async def delete_gost(gost_id: str, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    result = await db.execute(select(GostFile).where(GostFile.id == gost_id))
    gost = result.scalar_one_or_none()
    if not gost:
        raise HTTPException(404, "ГОСТ не найден")

    rm_result = await db.execute(select(Roadmap).where(Roadmap.gost_id == gost_id))
    roadmaps = rm_result.scalars().all()
    for rm in roadmaps:
        await db.execute(delete(RoadmapAnswer).where(RoadmapAnswer.roadmap_id == rm.id))
        sess_result = await db.execute(select(ChatSession).where(ChatSession.roadmap_id == rm.id))
        for sess in sess_result.scalars().all():
            sess.roadmap_id = None
        await db.execute(delete(GeneratedDoc).where(GeneratedDoc.roadmap_id == rm.id))
        await db.delete(rm)

    await db.execute(delete(PromptGost).where(PromptGost.gost_id == gost_id))
    await db.execute(delete(GostTemplate).where(GostTemplate.gost_id == gost_id))

    sess_result = await db.execute(select(ChatSession).where(ChatSession.gost_id == gost_id))
    for sess in sess_result.scalars().all():
        sess.gost_id = None

    if os.path.exists(gost.file_path):
        os.remove(gost.file_path)

    await db.delete(gost)
    await db.commit()
    return {"ok": True}
