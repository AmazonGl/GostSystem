"""Генерация схематичной мета-информации и промптов для ГОСТов."""
import re
from app.services.ai import extract_sections_from_text, chat


def detect_gost_series(code: str) -> str:
    code_lower = code.lower()
    if re.search(r'гост\s*19|19\.\d', code_lower):
        return "19"
    if re.search(r'гост\s*2[^0-9]|2\.\d|есскд|ескд', code_lower):
        return "2"
    if re.search(r'гост\s*34|34\.', code_lower):
        return "34"
    return "other"


def build_meta_schema(code: str, title: str, category: str, gost_text: str = "") -> dict:
    series = detect_gost_series(code)
    sections_raw = extract_sections_from_text(gost_text) if gost_text else []

    sections = []
    for s in sections_raw:
        subsections = [
            {
                "id": sub["num"],
                "title": sub["title"],
                "description": sub.get("content", "")[:200] or sub["title"],
            }
            for sub in s.get("subsections", [])[:8]
        ]
        sections.append({
            "id": s["num"],
            "title": s["title"],
            "type": _section_type(s["title"]),
            "description": s.get("content", "")[:200] or s["title"],
            "required": True,
            "fields": _infer_fields(s["title"]),
            "subsections": subsections,
        })

    if not sections:
        sections = _default_sections(series, category)

    return {
        "gost_code": code,
        "title": title,
        "category": category,
        "series": series,
        "sections": sections,
        "prompt_hints": _prompt_hints(series, category),
    }


def _section_type(title: str) -> str:
    t = title.lower()
    if any(k in t for k in ("общие", "назначение", "область")):
        return "intro"
    if any(k in t for k in ("требован", "содержан")):
        return "requirements"
    if any(k in t for k in ("структур", "состав", "комплект")):
        return "structure"
    if any(k in t for k in ("приложен", "приём", "прием", "контрол")):
        return "acceptance"
    return "general"


def _infer_fields(title: str) -> list[str]:
    t = title.lower()
    fields = []
    if "наименован" in t or "общие" in t:
        fields.extend(["наименование системы", "заказчик", "разработчик"])
    if "назначен" in t or "область" in t:
        fields.append("область применения")
    if "требован" in t:
        fields.extend(["функциональные требования", "нефункциональные требования"])
    if "состав" in t or "этап" in t:
        fields.append("этапы работ")
    if not fields:
        fields.append("содержание раздела")
    return fields


def _default_sections(series: str, category: str) -> list[dict]:
    if series == "19":
        return [
            {"id": "1", "title": "Общие положения", "type": "intro", "description": "Наименование, область применения", "required": True, "fields": ["наименование", "область применения"]},
            {"id": "2", "title": "Виды программ и программных документов", "type": "structure", "description": "Классификация ПО", "required": True, "fields": ["вид программы", "виды документов"]},
            {"id": "3", "title": "Обозначения программ и документов", "type": "structure", "description": "Правила обозначений", "required": True, "fields": ["код организации", "обозначение"]},
            {"id": "4", "title": "Комплектность документов", "type": "structure", "description": "Состав комплекта", "required": True, "fields": ["перечень документов"]},
        ]
    if series == "2":
        return [
            {"id": "1", "title": "Общие положения", "type": "intro", "description": "Область применения стандарта", "required": True, "fields": ["область применения"]},
            {"id": "2", "title": "Требования к оформлению", "type": "requirements", "description": "Форматы, шрифты, поля", "required": True, "fields": ["формат листа", "шрифт", "поля"]},
            {"id": "3", "title": "Основная надпись", "type": "structure", "description": "Штамп и реквизиты", "required": True, "fields": ["штамп", "графы"]},
            {"id": "4", "title": "Спецификация", "type": "structure", "description": "Правила заполнения спецификации", "required": False, "fields": ["позиции", "обозначения"]},
        ]
    return [
        {"id": "1", "title": "Общие сведения", "type": "intro", "description": "Наименование и назначение", "required": True, "fields": ["наименование", "назначение"]},
        {"id": "2", "title": "Требования", "type": "requirements", "description": "Основные требования", "required": True, "fields": ["требования"]},
        {"id": "3", "title": "Состав работ", "type": "structure", "description": "Этапы и сроки", "required": True, "fields": ["этапы", "сроки"]},
        {"id": "4", "title": "Порядок приёмки", "type": "acceptance", "description": "Контроль и приёмка", "required": False, "fields": ["критерии приёмки"]},
    ]


def _prompt_hints(series: str, category: str) -> list[str]:
    hints = [
        "Использовать официальный деловой стиль",
        "Ссылаться на нормативные документы при необходимости",
        "Избегать разговорных формулировок",
    ]
    if series == "19":
        hints.append("Следовать терминологии ЕСПД (ГОСТ 19)")
        hints.append("Указывать виды программ и документов по классификации")
    elif series == "2":
        hints.append("Следовать требованиям ЕСКД (ГОСТ 2)")
        hints.append("Соблюдать правила оформления чертежей и текстовых документов")
    if category == "espd":
        hints.append("Ориентироваться на стандарты ЕСПД")
    elif category == "eskd":
        hints.append("Ориентироваться на стандарты ЕСКД")
    return hints


def build_default_prompt(code: str, title: str, meta_schema: dict) -> str:
    sections_desc = "\n".join(
        f"- {s['id']}. {s['title']}: {s['description']}"
        for s in meta_schema.get("sections", [])
    )
    hints = "\n".join(f"- {h}" for h in meta_schema.get("prompt_hints", []))

    return f"""Ты эксперт по технической документации по стандарту {code} («{title}»).

Задача: помочь пользователю заполнить документ, задавая уточняющие вопросы по каждому разделу.

Структура документа:
{sections_desc}

Правила генерации:
{hints}

При формулировке вопросов:
1. Задавай конкретные вопросы по каждому разделу
2. Учитывай специфику стандарта {meta_schema.get('series', 'other')}
3. Помогай пользователю дать полный и корректный ответ
4. При генерации текста раздела — используй официальный стиль ЕСПД/ЕСКД"""


async def build_default_prompt_ai(code: str, title: str, meta_schema: dict, gost_text: str = "") -> str:
    base = build_default_prompt(code, title, meta_schema)
    if not gost_text:
        return base
    try:
        system = "Ты эксперт по ГОСТ и технической документации. Отвечай только на русском."
        user_msg = f"""Улучши промпт для работы с документом по {code}.

Текущий промпт:
{base[:1500]}

Фрагмент текста стандарта:
{gost_text[:2000]}

Верни улучшенный промпт (только текст промпта, без пояснений)."""
        improved = await chat([{"role": "user", "content": user_msg}], system=system, temperature=0.4)
        return improved.strip() if improved.strip() else base
    except Exception:
        return base
