import os
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models.models import GeneratedDoc, ChatSession, Roadmap, RoadmapAnswer, GostFile
from app.routers.auth import get_current_user
from app.models.models import User
from app.services import ai
from app.services.doc_builder import build_docx, convert_to_pdf
from app.services import yadisk

router = APIRouter()


class GenerateDocRequest(BaseModel):
    session_id: str
    doc_title: str = "Технический документ"
    make_pdf: bool = False


class DocOut(BaseModel):
    id: str
    session_id: Optional[str]
    roadmap_id: Optional[str]
    title: str
    docx_path: Optional[str]
    pdf_path: Optional[str]
    cloud_docx_link: Optional[str] = None
    cloud_pdf_link: Optional[str] = None
    sections_content: Optional[dict] = None

    class Config:
        from_attributes = True


class SectionContent(BaseModel):
    section: str
    text: str


class UpdateDocContent(BaseModel):
    sections: list[SectionContent]
    title: Optional[str] = None


class CreateFromTemplateRequest(BaseModel):
    gost_id: str
    title: str = "Технический документ"
    sections: list[SectionContent]
    make_pdf: bool = False


@router.get("/", response_model=list[DocOut])
async def list_docs(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(GeneratedDoc)
        .where(GeneratedDoc.user_id == user.id)
        .order_by(GeneratedDoc.created_at.desc())
    )
    return result.scalars().all()


@router.post("/from-template", response_model=DocOut)
async def create_doc_from_template(
    body: CreateFromTemplateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    gost_result = await db.execute(select(GostFile).where(GostFile.id == body.gost_id))
    gost = gost_result.scalar_one_or_none()
    if not gost:
        raise HTTPException(404, "ГОСТ не найден")

    structure = [{"section": s.section, "description": "", "question": ""} for s in body.sections]
    texts = [s.text for s in body.sections]

    docx_path = build_docx(
        roadmap_structure=structure,
        answers=texts,
        generated_texts=texts,
        doc_title=body.title,
        gost_code=gost.code,
    )

    pdf_path = None
    if body.make_pdf:
        pdf_path = convert_to_pdf(docx_path)

    cloud_links = {}
    if yadisk.is_configured():
        cloud_links = await yadisk.upload_document(docx_path, pdf_path, body.title)

    doc = GeneratedDoc(
        user_id=user.id,
        session_id=None,
        roadmap_id=None,
        title=body.title,
        sections_content={"sections": [s.model_dump() for s in body.sections]},
        docx_path=docx_path,
        pdf_path=pdf_path,
        cloud_docx_link=cloud_links.get("docx"),
        cloud_pdf_link=cloud_links.get("pdf"),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.post("/generate", response_model=DocOut)
async def generate_doc(
    body: GenerateDocRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sess_result = await db.execute(
        select(ChatSession).where(ChatSession.id == body.session_id, ChatSession.user_id == user.id)
    )
    session = sess_result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Сессия не найдена")
    if not session.roadmap_id:
        raise HTTPException(422, "К сессии не привязан роадмап")

    rm_result = await db.execute(select(Roadmap).where(Roadmap.id == session.roadmap_id))
    roadmap = rm_result.scalar_one_or_none()
    if not roadmap:
        raise HTTPException(404, "Роадмап не найден")

    ans_result = await db.execute(
        select(RoadmapAnswer)
        .where(RoadmapAnswer.session_id == body.session_id)
        .order_by(RoadmapAnswer.question_index)
    )
    answers = [row.answer for row in ans_result.scalars().all()]
    structure = roadmap.structure

    if len(answers) < len(structure):
        raise HTTPException(422, f"Пользователь ответил на {len(answers)} из {len(structure)} вопросов")

    gost_code = ""
    if session.gost_id:
        gost_result = await db.execute(select(GostFile).where(GostFile.id == session.gost_id))
        gost = gost_result.scalar_one_or_none()
        if gost:
            gost_code = gost.code

    generated_texts = []
    for i, item in enumerate(structure):
        text = await ai.generate_document_section(
            section=item.get("section", ""),
            description=item.get("description", ""),
            user_answer=answers[i],
        )
        generated_texts.append(text)

    docx_path = build_docx(
        roadmap_structure=structure,
        answers=answers,
        generated_texts=generated_texts,
        doc_title=body.doc_title,
        gost_code=gost_code,
    )

    pdf_path = None
    if body.make_pdf:
        pdf_path = convert_to_pdf(docx_path)

    # Загружаем в облако — сначала Яндекс, потом Google если настроен
    cloud_links = {}
    if yadisk.is_configured():
        cloud_links = await yadisk.upload_document(docx_path, pdf_path, body.doc_title)

    doc = GeneratedDoc(
        user_id=user.id,
        session_id=body.session_id,
        roadmap_id=roadmap.id,
        title=body.doc_title,
        sections_content={
            "sections": [
                {"section": structure[i].get("section", f"Раздел {i+1}"), "text": generated_texts[i]}
                for i in range(len(structure))
            ]
        },
        docx_path=docx_path,
        pdf_path=pdf_path,
        cloud_docx_link=cloud_links.get("docx"),
        cloud_pdf_link=cloud_links.get("pdf"),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.get("/{doc_id}/download/docx")
async def download_docx(doc_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(GeneratedDoc).where(GeneratedDoc.id == doc_id, GeneratedDoc.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc or not doc.docx_path or not os.path.exists(doc.docx_path):
        raise HTTPException(404, "Файл не найден")
    return FileResponse(
        doc.docx_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{doc.title or 'document'}.docx"
    )


@router.get("/{doc_id}/download/pdf")
async def download_pdf(doc_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(GeneratedDoc).where(GeneratedDoc.id == doc_id, GeneratedDoc.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Документ не найден")
    if not doc.pdf_path or not os.path.exists(doc.pdf_path or ""):
        if not doc.docx_path or not os.path.exists(doc.docx_path or ""):
            raise HTTPException(404, "DOCX файл не найден")
        pdf_path = convert_to_pdf(doc.docx_path)
        doc.pdf_path = pdf_path
        await db.commit()
    return FileResponse(doc.pdf_path, media_type="application/pdf", filename=f"{doc.title or 'document'}.pdf")


@router.get("/{doc_id}/preview")
async def preview_doc(doc_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    import mammoth
    result = await db.execute(
        select(GeneratedDoc).where(GeneratedDoc.id == doc_id, GeneratedDoc.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc or not doc.docx_path or not os.path.exists(doc.docx_path):
        raise HTTPException(404, "Файл не найден")
    with open(doc.docx_path, "rb") as f:
        result = mammoth.convert_to_html(f)
    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body {{ font-family: 'Times New Roman', serif; font-size: 14pt; line-height: 1.5;
          max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }}
  h1 {{ font-size: 16pt; font-weight: bold; text-align: center; margin: 20px 0; }}
  h2 {{ font-size: 14pt; font-weight: bold; margin: 16px 0 8px; }}
  p  {{ text-indent: 1.25cm; margin: 6px 0; text-align: justify; }}
</style></head><body>{result.value}</body></html>"""
    return HTMLResponse(html)


@router.get("/{doc_id}/content")
async def get_doc_content(doc_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(GeneratedDoc).where(GeneratedDoc.id == doc_id, GeneratedDoc.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Документ не найден")

    if doc.sections_content:
        return doc.sections_content

    if not doc.roadmap_id:
        return {"sections": [], "title": doc.title}

    rm_result = await db.execute(select(Roadmap).where(Roadmap.id == doc.roadmap_id))
    roadmap = rm_result.scalar_one_or_none()
    if not roadmap:
        raise HTTPException(404, "Роадмап не найден")

    import mammoth
    sections = []
    if doc.docx_path and os.path.exists(doc.docx_path):
        with open(doc.docx_path, "rb") as f:
            result_html = mammoth.convert_to_html(f)
        import re
        structure = roadmap.structure
        for i, item in enumerate(structure):
            sections.append({
                "section": item.get("section", f"Раздел {i+1}"),
                "text": re.sub(r'<[^>]+>', '', result_html.value)[:2000] if i == 0 else "",
            })

    return {"sections": sections, "title": doc.title}


@router.put("/{doc_id}/content", response_model=DocOut)
async def update_doc_content(
    doc_id: str,
    body: UpdateDocContent,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GeneratedDoc).where(GeneratedDoc.id == doc_id, GeneratedDoc.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Документ не найден")

    if doc.roadmap_id:
        rm_result = await db.execute(select(Roadmap).where(Roadmap.id == doc.roadmap_id))
        roadmap = rm_result.scalar_one_or_none()
    else:
        roadmap = None

    if body.title:
        doc.title = body.title

    doc.sections_content = {"sections": [s.model_dump() for s in body.sections]}

    gost_code = ""
    if doc.session_id:
        sess_result = await db.execute(select(ChatSession).where(ChatSession.id == doc.session_id))
        session = sess_result.scalar_one_or_none()
    else:
        session = None
    if session and session.gost_id:
        gost_result = await db.execute(select(GostFile).where(GostFile.id == session.gost_id))
        gost = gost_result.scalar_one_or_none()
        if gost:
            gost_code = gost.code

    structure = roadmap.structure if roadmap else [{"section": s.section, "description": "", "question": ""} for s in body.sections]
    generated_texts = [s.text for s in body.sections]
    answers = generated_texts

    if doc.docx_path and os.path.exists(doc.docx_path):
        os.remove(doc.docx_path)
    if doc.pdf_path and os.path.exists(doc.pdf_path or ""):
        os.remove(doc.pdf_path)

    docx_path = build_docx(
        roadmap_structure=structure,
        answers=answers,
        generated_texts=generated_texts,
        doc_title=doc.title,
        gost_code=gost_code,
    )
    doc.docx_path = docx_path
    doc.pdf_path = None

    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/{doc_id}")
async def delete_doc(doc_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(GeneratedDoc).where(GeneratedDoc.id == doc_id, GeneratedDoc.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Документ не найден")
    for path in [doc.docx_path, doc.pdf_path]:
        if path and os.path.exists(path):
            os.remove(path)
    await db.delete(doc)
    await db.commit()
    return {"ok": True}
