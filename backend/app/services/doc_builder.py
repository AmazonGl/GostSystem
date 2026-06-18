import os
import re
import subprocess
import uuid
from datetime import datetime
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from app.config import settings


def _set_page_margins(doc):
    for section in doc.sections:
        section.left_margin   = Cm(3.0)
        section.right_margin  = Cm(1.5)
        section.top_margin    = Cm(2.0)
        section.bottom_margin = Cm(2.0)


def _set_font(run, size=14, bold=False, italic=False):
    run.font.name = "Times New Roman"
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = RGBColor(0, 0, 0)


def _clean(text: str) -> str:
    """Убираем все markdown символы"""
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'__(.+?)__', r'\1', text)
    text = re.sub(r'`(.+?)`', r'\1', text)
    return text.strip()


def _add_title_page(doc, doc_title: str, gost_code: str, org_name: str = ""):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(org_name or "ОРГАНИЗАЦИЯ-РАЗРАБОТЧИК")
    _set_font(r, 12)

    for _ in range(3):
        doc.add_paragraph()

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p.add_run("УТВЕРЖДАЮ")
    _set_font(r, 12, bold=True)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p.add_run("________________________")
    _set_font(r, 12)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    r = p.add_run(f'«___» ____________ {datetime.now().year} г.')
    _set_font(r, 12)

    for _ in range(4):
        doc.add_paragraph()

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(doc_title.upper())
    _set_font(r, 18, bold=True)

    if gost_code:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(gost_code)
        _set_font(r, 14)

    for _ in range(6):
        doc.add_paragraph()

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(str(datetime.now().year))
    _set_font(r, 14)

    doc.add_page_break()


def _add_toc(doc, structure: list):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("СОДЕРЖАНИЕ")
    _set_font(r, 14, bold=True)
    doc.add_paragraph()

    for i, item in enumerate(structure):
        title = _clean(item.get("section", f"Раздел {i+1}"))
        dots = max(1, 55 - len(title))
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(2)
        p.paragraph_format.space_after  = Pt(2)
        r = p.add_run(f"{title} {'.' * dots} {i + 3}")
        _set_font(r, 14)

    doc.add_page_break()


def _add_section_heading(doc, text: str):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after  = Pt(10)
    r = p.add_run(_clean(text))
    _set_font(r, 14, bold=True)


def _add_body(doc, text: str):
    """Парсим текст от нейронки и добавляем правильно отформатированные абзацы"""
    lines = text.split('\n')
    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Заголовок markdown ## ###
        if re.match(r'^#{1,6}\s+', line):
            clean = _clean(line)
            if not clean:
                continue
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(8)
            p.paragraph_format.space_after  = Pt(4)
            r = p.add_run(clean)
            _set_font(r, 14, bold=True)

        # Маркированный список * - •
        elif re.match(r'^[\*\-•]\s+', line):
            clean = _clean(re.sub(r'^[\*\-•]\s+', '', line))
            if not clean:
                continue
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.left_indent = Cm(1.5)
            p.paragraph_format.first_line_indent = Cm(-0.5)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after  = Pt(2)
            r = p.add_run(f"– {clean}")
            _set_font(r, 14)

        # Нумерованный список 1. 2. 3)
        elif re.match(r'^\d+[\.\)]\s+', line):
            clean = _clean(line)
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.left_indent = Cm(1.5)
            p.paragraph_format.first_line_indent = Cm(-0.5)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after  = Pt(2)
            r = p.add_run(clean)
            _set_font(r, 14)

        # Строка только из ** (подзаголовок)
        elif re.match(r'^\*\*.+\*\*:?$', line):
            clean = _clean(line)
            if not clean:
                continue
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(8)
            p.paragraph_format.space_after  = Pt(4)
            r = p.add_run(clean)
            _set_font(r, 14, bold=True)

        # Обычный текст
        else:
            clean = _clean(line)
            if not clean:
                continue
            p = doc.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            p.paragraph_format.first_line_indent = Cm(1.25)
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after  = Pt(6)
            r = p.add_run(clean)
            _set_font(r, 14)


def build_docx(
    roadmap_structure: list,
    answers: list,
    generated_texts: list,
    doc_title: str = "Технический документ",
    gost_code: str = "",
    org_name: str = "",
) -> str:
    doc = Document()
    _set_page_margins(doc)

    style = doc.styles["Normal"]
    style.font.name = "Times New Roman"
    style.font.size = Pt(14)

    _add_title_page(doc, doc_title, gost_code, org_name)
    _add_toc(doc, roadmap_structure)

    for i, item in enumerate(roadmap_structure):
        section_title = item.get("section", f"Раздел {i + 1}")
        _add_section_heading(doc, section_title)

        text = generated_texts[i] if i < len(generated_texts) else answers[i] if i < len(answers) else ""
        if text:
            _add_body(doc, text)

        doc.add_paragraph()

    out_dir = os.path.join(settings.STORAGE_PATH, "_generated")
    os.makedirs(out_dir, exist_ok=True)
    filename = f"{uuid.uuid4()}.docx"
    path = os.path.join(out_dir, filename)
    doc.save(path)
    return path


def convert_to_pdf(docx_path: str) -> str:
    out_dir = os.path.dirname(docx_path)
    result = subprocess.run(
        ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"LibreOffice error: {result.stderr}")
    pdf_path = docx_path.replace(".docx", ".pdf")
    if not os.path.exists(pdf_path):
        raise RuntimeError("PDF файл не был создан")
    return pdf_path
