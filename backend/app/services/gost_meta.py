"""Генерация схематичной мета-информации и промптов для ГОСТов."""
import re
from app.services.ai import extract_sections_from_text, chat, _norm_title


def detect_gost_series(code: str) -> str:
    code_lower = code.lower()
    if re.search(r'гост\s*19|19\.\d', code_lower):
        return "19"
    if re.search(r'гост\s*2[^0-9]|2\.\d|есскд|ескд', code_lower):
        return "2"
    if re.search(r'гост\s*34|34\.', code_lower):
        return "34"
    return "other"


def _nodes_to_meta(nodes: list) -> list:
    """Преобразует дерево заголовков (из parse_template_structure) в разделы мета-схемы
    с рекурсивными подразделами любой глубины."""
    out = []
    for n in nodes:
        subs = _nodes_to_meta(n.get("subsections", []))
        out.append({
            "id": n["id"],
            "title": n["title"],
            "type": _section_type(n["title"]),
            "description": "" if subs else (_hint_for_title(n["title"]) or n["title"]),
            "required": True,
            "fields": _infer_fields(n["title"]),
            "subsections": subs,
        })
    return out


def build_meta_schema_from_docx(code: str, title: str, category: str, file_path: str) -> dict:
    """Строит мета-схему по структуре заголовков .docx ГОСТа (стили Heading / нумерация).
    Точнее текстового парсера и поддерживает полную вложенность."""
    from app.services.docx_templates import parse_template_structure
    series = detect_gost_series(code)
    try:
        structure = parse_template_structure(file_path)
    except Exception:
        structure = {"sections": []}
    sections = _nodes_to_meta(structure.get("sections", []))
    # отсекаем служебные разделы
    skip = ("предислови", "содержание", "приложени", "библиограф", "взамен", "введен")
    sections = [s for s in sections if not any(k in s["title"].lower() for k in skip)]
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


def build_meta_schema(code: str, title: str, category: str, gost_text: str = "") -> dict:
    series = detect_gost_series(code)
    sections_raw = extract_sections_from_text(gost_text) if gost_text else []

    sections = []
    for s in sections_raw:
        subsections = [
            {
                "id": sub["num"],
                "title": sub["title"],
                "description": sub.get("content", "").strip() or _hint_for_title(sub["title"]) or sub["title"],
            }
            for sub in s.get("subsections", [])[:20]
        ]
        # Описание родителя: если есть подразделы, не дублируем их перечень в описании.
        sub_titles = {_norm_title(x["title"]) for x in subsections}
        raw_desc = s.get("content", "")
        desc_words = [w for w in raw_desc.split() if _norm_title(w) not in sub_titles]
        parent_desc = " ".join(desc_words).strip()
        if not parent_desc:
            # для раздела с подразделами не навязываем подсказку (писать будут в подразделах)
            parent_desc = "" if subsections else _hint_for_title(s["title"]) or s["title"]
        sections.append({
            "id": s["num"],
            "title": s["title"],
            "type": _section_type(s["title"]),
            "description": parent_desc,
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


_HINT_RULES = [
    (("введен",), "Кратко: назначение документа, для чего разрабатывается система, контекст."),
    (("термин", "определен"), "Перечислите ключевые термины и их определения, используемые в документе."),
    (("сокращ", "перечень сокращ", "аббревиатур"), "Расшифруйте аббревиатуры и сокращения, встречающиеся в тексте."),
    (("наименован",), "Полное и краткое наименование разработки (системы, программы)."),
    (("цель", "задач"), "Сформулируйте цель разработки и перечислите задачи, которые она решает."),
    (("участник", "исполнител", "заказчик"), "Укажите заказчика, разработчика и других участников, их роли."),
    (("срок",), "Сроки начала и окончания работ, ключевые этапы по датам."),
    (("назначен",), "Для чего предназначена система, кто пользователи, какие функции выполняет."),
    (("область", "применен"), "Где и как применяется разработка, границы применения."),
    (("предметн",), "Опишите предметную область, основные понятия и процессы."),
    (("аналог", "обзор"), "Перечислите существующие аналоги, их плюсы и минусы, отличия вашей разработки."),
    (("функц",), "Перечислите функции, которые должна выполнять система."),
    (("интерфейс", "пользовательск"), "Требования к экранам, навигации, удобству, оформлению интерфейса."),
    (("надежн",), "Требования к отказоустойчивости, восстановлению, времени работы."),
    (("безопасн",), "Требования к защите данных, разграничению доступа, аутентификации."),
    (("технич", "обеспечен"), "Требования к оборудованию, ОС, серверам, сетевой инфраструктуре."),
    (("информац",), "Требования к структуре данных, БД, форматам обмена."),
    (("состав", "содержан работ"), "Перечислите этапы работ и их содержание."),
    (("порядок", "разработк"), "Опишите последовательность и порядок выполнения разработки."),
    (("документиров",), "Какие документы должны быть подготовлены по итогам разработки."),
    (("приём", "прием", "сдаточн", "контрол"), "Условия и критерии приёмки, порядок испытаний и сдачи."),
    (("патент",), "Требования к патентной чистоте используемых решений."),
    (("перспектив", "развит"), "Возможные направления дальнейшего развития системы."),
]


def _hint_for_title(title: str) -> str:
    """Короткая подсказка «что писать», по ключевым словам названия. Без нейросети."""
    t = (title or "").lower()
    for keys, hint in _HINT_RULES:
        if any(k in t for k in keys):
            return hint
    return ""


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
