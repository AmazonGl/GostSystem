import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.config import settings
from app.models.models import GeneratedDoc, GostFile, DocTemplate
from app.routers.auth import get_current_user
from app.models.models import User
from app.services import ai
from app.services.doc_builder import build_docx, convert_to_pdf, update_docx_toc
from app.services import yadisk
from app.services.docx_templates import render_template, split_combined_section

router = APIRouter()


class DocOut(BaseModel):
    id: str
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


class DocFormat(BaseModel):
    font: Optional[str] = None
    size: Optional[int] = None
    align: Optional[str] = None  # justify | left | center | right
    line_spacing: Optional[float] = None


class TitlePageData(BaseModel):
    org_name: Optional[str] = None
    executor: Optional[str] = None
    approve_label: Optional[str] = None
    approve_position: Optional[str] = None
    approve_name: Optional[str] = None
    approve_date: Optional[str] = None
    doc_title: Optional[str] = None
    cipher: Optional[str] = None
    gost_code: Optional[str] = None
    stage: Optional[str] = None
    city: Optional[str] = None
    year: Optional[str] = None


class UpdateDocContent(BaseModel):
    sections: list[SectionContent]
    title: Optional[str] = None
    fmt: Optional[DocFormat] = None
    title_page: Optional[TitlePageData] = None


class CreateFromTemplateRequest(BaseModel):
    gost_id: Optional[str] = None
    template_id: Optional[str] = None
    title: str = "Технический документ"
    sections: list[SectionContent]
    make_pdf: bool = False
    fmt: Optional[DocFormat] = None
    title_page: Optional[TitlePageData] = None


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
    # ГОСТ необязателен: без него документ оформляется по базовому шаблону.
    gost_code = ""
    if body.gost_id:
        gost_result = await db.execute(select(GostFile).where(GostFile.id == body.gost_id))
        gost = gost_result.scalar_one_or_none()
        if not gost:
            raise HTTPException(404, "ГОСТ не найден")
        gost_code = gost.code

    structure = [{"section": s.section, "description": "", "question": ""} for s in body.sections]
    texts = [s.text for s in body.sections]

    # Если выбран загруженный .docx-шаблон — рендерим по нему (текст вставляется
    # под заголовки шаблона, оформление шаблона сохраняется). Иначе — сборка по ГОСТ.
    docx_path = None
    if body.template_id:
        tpl_res = await db.execute(select(DocTemplate).where(DocTemplate.id == body.template_id))
        tpl = tpl_res.scalar_one_or_none()
        if not tpl or not os.path.exists(tpl.file_path):
            raise HTTPException(404, "Шаблон документа не найден")
        out_dir = os.path.join(settings.STORAGE_PATH, "_generated")
        os.makedirs(out_dir, exist_ok=True)
        docx_path = os.path.join(out_dir, f"{uuid.uuid4()}.docx")
        sections_data = [split_combined_section(s.section, s.text) for s in body.sections]
        title_vars = (body.title_page.model_dump() if body.title_page else {}) or {}
        # work_name — для замены {{меток}} в шаблоне; не влияет на решение
        # генерировать ли титул (это решается по реально заполненным полям).
        title_vars["work_name"] = title_vars.get("doc_title") or body.title
        render_template(tpl.file_path, docx_path, sections_data, title_vars)
        update_docx_toc(docx_path)  # готовое содержание сразу в DOCX (без F9)
    else:
        docx_path = build_docx(
            roadmap_structure=structure,
            answers=texts,
            generated_texts=texts,
            doc_title=body.title,
            gost_code=gost_code,
            fmt=body.fmt.model_dump() if body.fmt else None,
            title_page=body.title_page.model_dump() if body.title_page else None,
        )

    pdf_path = None
    if body.make_pdf:
        pdf_path = convert_to_pdf(docx_path)

    cloud_links = {}
    if yadisk.is_configured():
        cloud_links = await yadisk.upload_document(docx_path, pdf_path, body.title)

    doc = GeneratedDoc(
        user_id=user.id,
        title=body.title,
        sections_content={"sections": [s.model_dump() for s in body.sections], "fmt": body.fmt.model_dump() if body.fmt else None, "title_page": body.title_page.model_dump() if body.title_page else None, "template_id": body.template_id or None},
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
        try:
            pdf_path = convert_to_pdf(doc.docx_path)
        except Exception as e:
            raise HTTPException(
                503,
                "Не удалось сконвертировать документ в PDF. "
                "Убедитесь, что в системе установлен LibreOffice. "
                f"Подробности: {e}",
            )
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
        content = dict(doc.sections_content)
        if "title" not in content:
            content["title"] = doc.title
        return content

    return {"sections": [], "title": doc.title}


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

    if body.title:
        doc.title = body.title

    prev_content = doc.sections_content or {}
    template_id = prev_content.get("template_id")
    doc.sections_content = {"sections": [s.model_dump() for s in body.sections], "fmt": body.fmt.model_dump() if body.fmt else prev_content.get("fmt"), "title_page": body.title_page.model_dump() if body.title_page else prev_content.get("title_page"), "template_id": template_id}

    gost_code = ""

    # Структура документа всегда строится из присланных разделов,
    # что позволяет добавлять, удалять и переименовывать разделы целиком.
    structure = [{"section": s.section, "description": "", "question": ""} for s in body.sections]
    generated_texts = [s.text for s in body.sections]
    answers = generated_texts

    if doc.docx_path and os.path.exists(doc.docx_path):
        os.remove(doc.docx_path)
    if doc.pdf_path and os.path.exists(doc.pdf_path or ""):
        os.remove(doc.pdf_path)

    tpl = None
    if template_id:
        tpl_res = await db.execute(select(DocTemplate).where(DocTemplate.id == template_id))
        tpl = tpl_res.scalar_one_or_none()

    if tpl and os.path.exists(tpl.file_path):
        out_dir = os.path.join(settings.STORAGE_PATH, "_generated")
        os.makedirs(out_dir, exist_ok=True)
        docx_path = os.path.join(out_dir, f"{uuid.uuid4()}.docx")
        sections_data = [split_combined_section(s.section, s.text) for s in body.sections]
        title_vars = (body.title_page.model_dump() if body.title_page else prev_content.get("title_page")) or {}
        title_vars.setdefault("work_name", doc.title)
        title_vars.setdefault("doc_title", doc.title)
        render_template(tpl.file_path, docx_path, sections_data, title_vars)
        update_docx_toc(docx_path)  # готовое содержание сразу в DOCX (без F9)
    else:
        docx_path = build_docx(
            roadmap_structure=structure,
            answers=answers,
            generated_texts=generated_texts,
            doc_title=doc.title,
            gost_code=gost_code,
            fmt=body.fmt.model_dump() if body.fmt else None,
            title_page=body.title_page.model_dump() if body.title_page else None,
        )
    doc.docx_path = docx_path
    doc.pdf_path = None

    await db.commit()
    await db.refresh(doc)
    return doc


@router.post("/upload-image")
async def upload_doc_image(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    # Разрешаем только изображения
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"):
        raise HTTPException(400, "Поддерживаются только изображения (png, jpg, gif, bmp, webp)")
    img_dir = os.path.join(settings.STORAGE_PATH, "_doc_images")
    os.makedirs(img_dir, exist_ok=True)
    fname = f"{uuid.uuid4()}{ext}"
    path = os.path.join(img_dir, fname)
    data = await file.read()
    with open(path, "wb") as f:
        f.write(data)
    # Возвращаем относительный путь-идентификатор
    return {"path": path, "id": fname}


@router.post("/{doc_id}/duplicate", response_model=DocOut)
async def duplicate_doc(doc_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    result = await db.execute(
        select(GeneratedDoc).where(GeneratedDoc.id == doc_id, GeneratedDoc.user_id == user.id)
    )
    src = result.scalar_one_or_none()
    if not src:
        raise HTTPException(404, "Документ не найден")

    new_title = f"{src.title} (копия)"
    content = src.sections_content or {"sections": []}
    sections = content.get("sections", []) if isinstance(content, dict) else []

    docx_path = None
    try:
        if sections:
            # Пересобираем документ из сохранённых разделов
            structure = [{"section": s.get("section", ""), "description": "", "question": ""} for s in sections]
            texts = [s.get("text", "") for s in sections]
            docx_path = build_docx(
                roadmap_structure=structure,
                answers=texts,
                generated_texts=texts,
                doc_title=new_title,
                gost_code="",
            )
        elif src.docx_path and os.path.exists(src.docx_path):
            # Нет структуры — просто копируем готовый файл
            import shutil
            out_dir = os.path.join(settings.STORAGE_PATH, "_generated")
            os.makedirs(out_dir, exist_ok=True)
            docx_path = os.path.join(out_dir, f"{uuid.uuid4()}.docx")
            shutil.copyfile(src.docx_path, docx_path)
    except Exception as e:
        raise HTTPException(500, f"Не удалось создать копию документа: {e}")

    new_doc = GeneratedDoc(
        user_id=user.id,
        title=new_title,
        sections_content={"sections": sections, "title": new_title, "template_id": (src.sections_content or {}).get("template_id")},
        docx_path=docx_path,
        pdf_path=None,
    )
    db.add(new_doc)
    await db.commit()
    await db.refresh(new_doc)
    return new_doc


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


@router.get("/_diag/toc")
async def diagnose_toc(user: User = Depends(get_current_user)):
    """Диагностика обновления оглавления: показывает, доступен ли UNO и какой
    интерпретатор питона его видит. Открой /api/docs/_diag/toc в браузере."""
    import shutil, subprocess, sys, os
    info = {
        "app_python": sys.executable,
        "soffice": shutil.which("soffice") or shutil.which("libreoffice"),
        "uno_in_app_python": False,
        "python_candidates": {},
        "libreoffice_python": None,
    }
    try:
        import uno  # noqa
        info["uno_in_app_python"] = True
    except Exception:
        pass

    for p in ("/usr/lib/libreoffice/program/python", "/opt/libreoffice/program/python"):
        if os.path.exists(p):
            info["libreoffice_python"] = p
            break

    for cand in ("/usr/bin/python3", "/usr/bin/python3.13", "/usr/bin/python3.12",
                 "/usr/bin/python3.11", "/usr/bin/python3.10", sys.executable,
                 info["libreoffice_python"]):
        if not cand or not (os.path.exists(cand) or shutil.which(cand)):
            continue
        try:
            r = subprocess.run([cand, "-c", "import uno; print('OK')"],
                               capture_output=True, text=True, timeout=20)
            info["python_candidates"][cand] = "uno OK" if "OK" in r.stdout else (r.stderr.strip()[:120] or "no uno")
        except Exception as e:
            info["python_candidates"][cand] = f"err: {e}"

    info["verdict"] = (
        "OK — есть питон с uno, обновление TOC должно работать"
        if any(v == "uno OK" for v in info["python_candidates"].values())
        else "ПРОБЛЕМА — ни один питон не видит uno. Нужен пакет python3-uno в образе."
    )
    return info
