import fitz
from docx import Document as DocxDocument
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from app.database import get_db
from app.models.models import Roadmap, GostFile, Prompt, RoadmapAnswer, ChatSession, GeneratedDoc, GostTemplate
from app.routers.auth import require_admin, get_current_user
from app.services import ai

router = APIRouter()


class RoadmapOut(BaseModel):
    id: str
    gost_id: str
    prompt_id: str
    name: str
    structure: list

    class Config:
        from_attributes = True


class GenerateRequest(BaseModel):
    gost_id: str
    prompt_id: str
    name: str = ""


def extract_text(file_path: str, file_type: str) -> str:
    if file_type == "pdf":
        doc = fitz.open(file_path)
        return "\n".join(page.get_text() for page in doc)
    elif file_type == "docx":
        doc = DocxDocument(file_path)
        return "\n".join(p.text for p in doc.paragraphs)
    return ""


def find_content_start(text: str) -> int:
    import re
    match = re.search(r'\n\s*1\s+[А-Я]', text)
    if match:
        return max(0, match.start() - 50)
    return 0


@router.get("/", response_model=list[RoadmapOut])
async def list_roadmaps(db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(Roadmap).order_by(Roadmap.created_at.desc()))
    roadmaps = result.scalars().all()
    out = []
    for rm in roadmaps:
        out.append({
            "id": rm.id, "gost_id": rm.gost_id, "prompt_id": rm.prompt_id,
            "name": getattr(rm, "name", "") or "",
            "structure": rm.structure,
        })
    return out


@router.post("/generate", response_model=RoadmapOut)
async def generate_roadmap(
    body: GenerateRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    gost_result = await db.execute(select(GostFile).where(GostFile.id == body.gost_id))
    gost = gost_result.scalar_one_or_none()
    if not gost:
        raise HTTPException(404, "ГОСТ не найден")

    prompt_result = await db.execute(select(Prompt).where(Prompt.id == body.prompt_id))
    prompt = prompt_result.scalar_one_or_none()
    if not prompt:
        raise HTTPException(404, "Промпт не найден")

    tmpl_result = await db.execute(select(GostTemplate).where(GostTemplate.gost_id == body.gost_id))
    tmpl = tmpl_result.scalar_one_or_none()
    prompt_instruction = prompt.content
    if tmpl:
        prompt_instruction = f"{tmpl.current_prompt}\n\nДополнительные инструкции:\n{prompt.content}"
    if gost.meta_schema:
        sections_hint = "\n".join(
            f"- {s['id']}. {s['title']}: {s.get('description', '')}"
            for s in gost.meta_schema.get("sections", [])
        )
        prompt_instruction += f"\n\nСтруктура по мета-схеме ГОСТа:\n{sections_hint}"

    if not await ai.check_health():
        raise HTTPException(503, "Ollama недоступна")

    full_text = extract_text(gost.file_path, gost.file_type)
    if not full_text.strip():
        raise HTTPException(422, "Не удалось извлечь текст из файла ГОСТа")

    structure = await ai.generate_roadmap_smart(full_text, prompt_instruction)

    name = body.name or f"{gost.code} — {prompt.title}"

    roadmap = Roadmap(gost_id=body.gost_id, prompt_id=body.prompt_id, structure=structure)
    try:
        roadmap.name = name
    except Exception:
        pass
    db.add(roadmap)
    await db.commit()
    await db.refresh(roadmap)
    return {
        "id": roadmap.id, "gost_id": roadmap.gost_id, "prompt_id": roadmap.prompt_id,
        "name": name, "structure": roadmap.structure,
    }


@router.get("/{roadmap_id}", response_model=RoadmapOut)
async def get_roadmap(roadmap_id: str, db: AsyncSession = Depends(get_db), _=Depends(get_current_user)):
    result = await db.execute(select(Roadmap).where(Roadmap.id == roadmap_id))
    roadmap = result.scalar_one_or_none()
    if not roadmap:
        raise HTTPException(404, "Роадмап не найден")
    return {
        "id": roadmap.id, "gost_id": roadmap.gost_id, "prompt_id": roadmap.prompt_id,
        "name": getattr(roadmap, "name", "") or "",
        "structure": roadmap.structure,
    }


@router.delete("/{roadmap_id}")
async def delete_roadmap(roadmap_id: str, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    result = await db.execute(select(Roadmap).where(Roadmap.id == roadmap_id))
    roadmap = result.scalar_one_or_none()
    if not roadmap:
        raise HTTPException(404, "Роадмап не найден")
    await db.execute(delete(RoadmapAnswer).where(RoadmapAnswer.roadmap_id == roadmap_id))
    await db.execute(delete(GeneratedDoc).where(GeneratedDoc.roadmap_id == roadmap_id))
    sess_result = await db.execute(select(ChatSession).where(ChatSession.roadmap_id == roadmap_id))
    for sess in sess_result.scalars().all():
        sess.roadmap_id = None
    await db.delete(roadmap)
    await db.commit()
    return {"ok": True}
