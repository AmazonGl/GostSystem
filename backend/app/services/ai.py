import httpx
import json
import re as _re
import random
from app.config import settings

OLLAMA_URL = settings.OLLAMA_BASE_URL
MODEL = settings.OLLAMA_MODEL


async def _post(endpoint: str, payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(f"{OLLAMA_URL}{endpoint}", json=payload)
        resp.raise_for_status()
        return resp.json()


async def chat(messages: list[dict], system: str = "", temperature: float = 0.7) -> str:
    # Для эндпоинта /api/chat системный промпт передаётся как сообщение с ролью
    # "system" в начале массива messages (поле верхнего уровня "system" здесь
    # не применяется — из-за этого модель раньше "не видела" инструкции).
    msgs = list(messages)
    if system:
        msgs = [{"role": "system", "content": system}] + msgs
    payload = {"model": MODEL, "messages": msgs, "stream": False,
                "options": {
                    "temperature": temperature,
                    "seed": random.randint(1, 999999),
                    "num_predict": 2048,   # лимит токенов вывода — чтобы текст не обрывался
                    "num_ctx": 8192,       # размер контекста
                }}
    data = await _post("/api/chat", payload)
    return data["message"]["content"]


def _extract_json(text: str) -> list:
    text = _re.sub(r'```json|```', '', text).strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    match = _re.search(r'\[.*\]', text, _re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return [
        {"section": "1. Общие сведения", "description": "Наименование системы", "question": "Укажите наименование системы, заказчика и разработчика"},
        {"section": "2. Назначение системы", "description": "Цели создания", "question": "Опишите назначение системы и цели её создания"},
        {"section": "3. Требования к системе", "description": "Требования", "question": "Перечислите основные требования к системе"},
        {"section": "4. Состав работ", "description": "Этапы работ", "question": "Опишите этапы работ и сроки"},
        {"section": "5. Порядок приёмки", "description": "Приёмка", "question": "Опишите порядок приёмки системы"},
    ]


def _norm_title(s: str) -> str:
    """Нормализация заголовка для сравнения: только буквы/цифры, нижний регистр."""
    return _re.sub(r'[^а-яёa-z0-9]', '', (s or '').lower())


def extract_sections_from_text(text: str) -> list[dict]:
    sections = []
    lines = text.split('\n')
    current_section = None
    current_content: list[str] = []
    current_subsections: list[dict] = []
    current_sub: tuple | None = None
    current_sub_content: list[str] = []

    def _flush_sub():
        nonlocal current_sub, current_sub_content
        if current_sub:
            current_subsections.append({
                "num": current_sub[0],
                "title": current_sub[1],
                "content": ' '.join(current_sub_content[:10]),
            })
        current_sub = None
        current_sub_content = []

    def _flush_section():
        nonlocal current_section, current_content, current_subsections
        if current_section:
            # Убираем из текста раздела строки, дублирующие названия подразделов
            # (в оглавлении/теле ГОСТа перечень подразделов часто повторяется как текст).
            sub_titles = {_norm_title(s["title"]) for s in current_subsections}
            cleaned = [
                ln for ln in current_content
                if _norm_title(_re.sub(r'^\d+(?:\.\d+)*\s+', '', ln)) not in sub_titles
            ]
            sections.append({
                "num": current_section[0],
                "title": current_section[1],
                "content": ' '.join(cleaned[:12]),
                "subsections": current_subsections[:],
            })
        current_section = None
        current_content = []
        current_subsections = []

    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        # Раздел: "1 Заголовок", "1. Заголовок", "1 ЗАГОЛОВОК" (номер без точек)
        main = _re.match(r'^(\d+)\.?\s+([А-ЯA-ZЁ][^\n]{3,80})$', line)
        # Подраздел: "1.1 Заголовок", "2.1. Заголовок", "5.5.2.1 Заголовок"
        sub = _re.match(r'^(\d+(?:\.\d+)+)\.?\s+([А-ЯA-Za-zЁёа-я][^\n]{2,90})$', line)
        if sub and current_section:
            _flush_sub()
            current_sub = (sub.group(1), sub.group(2).strip())
            continue
        if main:
            _flush_sub()
            _flush_section()
            current_section = (main.group(1), main.group(2).strip())
            continue
        if current_sub and line and len(line) > 5:
            current_sub_content.append(line)
        elif current_section and line and len(line) > 15:
            current_content.append(line)

    _flush_sub()
    _flush_section()

    skip = ['предисловие', 'приложение', 'библиограф', 'взамен', 'разработан', 'внесен', 'принят', 'введен']
    return [s for s in sections if not any(k in s['title'].lower() for k in skip) and int(s['num'].split('.')[0]) < 100][:10]


def generate_questions_without_ai(sections: list[dict]) -> list[dict]:
    result = []
    for s in sections:
        title = s['title'].lower()
        name = f"{s['num']} {s['title']}"
        desc = s.get('content', '')[:300]

        if 'область применения' in title:
            q = "Опишите область применения вашей системы — в каких сферах деятельности и для каких задач она предназначена?"
        elif 'нормативные ссылки' in title or 'нормативная база' in title:
            q = "Какие нормативные стандарты и документы используются при разработке вашей системы?"
        elif 'термины' in title or 'определения' in title or 'обозначения и сокращения' in title:
            q = "Перечислите основные термины, определения и сокращения используемые в вашем проекте."
        elif 'виды программных документов' in title:
            q = "Какие программные документы будут разрабатываться для вашей системы? Укажите виды и стадии разработки."
        elif 'виды программ' in title and 'документ' not in title:
            q = "Укажите вид вашей программы: программный компонент, программный комплекс или комплекс программ? Обоснуйте выбор."
        elif 'виды' in title and 'наименование' in title:
            q = "Какие виды документов планируется разрабатывать для вашей системы? Укажите стадии создания АС и перечень документов для каждой стадии."
        elif 'виды' in title:
            q = f"Перечислите виды '{s['title']}' которые относятся к вашей системе согласно стандарту."
        elif 'комплектность' in title:
            q = "Опишите состав комплекта документации для вашей системы — какие документы войдут в каждый комплект на каждой стадии разработки?"
        elif 'обозначение' in title or 'обозначений' in title or 'обозначения' in title:
            q = "Укажите код организации-разработчика (ОГРН) и код классификационной характеристики системы для формирования обозначений документов вашего проекта."
        elif 'общие сведения' in title or 'общие положения' in title:
            q = "Укажите полное наименование системы, организацию-заказчика, организацию-разработчика и основание для разработки."
        elif 'назначение' in title:
            q = "Опишите назначение системы — какие задачи она решает и каковы цели её создания?"
        elif 'требования к системе' in title or 'технические требования' in title:
            q = "Перечислите функциональные и нефункциональные требования к системе: производительность, надёжность, безопасность, интерфейс."
        elif 'требования' in title:
            q = f"Опишите требования раздела «{s['title']}» применительно к вашей системе."
        elif 'состав' in title and 'работ' in title:
            q = "Опишите состав и этапы работ по созданию системы с указанием сроков выполнения каждого этапа."
        elif 'содержание' in title and 'работ' in title:
            q = "Опишите содержание работ по каждому этапу создания системы."
        elif 'порядок контроля' in title or 'приёмка' in title or 'приемка' in title:
            q = "Опишите порядок контроля и приёмки системы — виды испытаний, критерии приёмки, состав приёмочной комиссии."
        elif 'порядок' in title:
            q = f"Опишите порядок '{s['title']}' применительно к вашему проекту."
        elif 'источники' in title or 'финансирование' in title:
            q = "Укажите источники финансирования и порядок финансирования работ по созданию системы."
        elif 'очерёдность' in title or 'стадии' in title or 'этапы' in title:
            q = "Опишите стадии и этапы создания системы с указанием сроков и ожидаемых результатов каждого этапа."
        elif 'структура' in title:
            q = f"Опишите структуру '{s['title']}' вашей системы."
        elif 'функц' in title:
            q = "Перечислите основные функции системы и опишите каждую из них."
        elif 'интерфейс' in title:
            q = "Опишите интерфейсы системы — пользовательский интерфейс, программные интерфейсы, форматы данных."
        elif 'безопасност' in title or 'защита' in title:
            q = "Опишите требования к безопасности и защите информации в вашей системе."
        elif 'надёжност' in title or 'надежност' in title:
            q = "Укажите требования к надёжности системы — допустимое время простоя, вероятность отказа, резервирование."
        elif 'сопровождение' in title or 'техническое обслуживание' in title:
            q = "Опишите порядок сопровождения и технического обслуживания системы после ввода в эксплуатацию."
        elif 'документирование' in title or 'документация' in title:
            q = "Перечислите состав документации которая будет разработана в рамках проекта."
        else:
            q = f"Опишите '{s['title']}' применительно к вашей системе согласно требованиям стандарта."

        result.append({"section": name, "description": desc if desc else s['title'], "question": q})
    return result


async def generate_roadmap(gost_text: str, prompt_instruction: str) -> list[dict]:
    system = "Ты помощник по технической документации. Отвечай только на русском языке."
    user_message = f"""{prompt_instruction}

Текст документа:
{gost_text[:4000]}

Составь список из 5-7 разделов. Ответь строго в формате JSON:
[{{"section": "...", "description": "...", "question": "..."}}]"""
    try:
        raw = await chat([{"role": "user", "content": user_message}], system=system, temperature=0.8)
        return _extract_json(raw)
    except Exception:
        return _extract_json("")


async def generate_roadmap_smart(gost_text: str, prompt_instruction: str) -> list[dict]:
    sections = extract_sections_from_text(gost_text)
    if not sections:
        return await generate_roadmap(gost_text, prompt_instruction)
    return generate_questions_without_ai(sections)


async def generate_document_section(section: str, description: str, user_answer: str) -> str:
    system = """Ты опытный технический писатель, специалист по ЕСПД и ЕСКД.
Пиши профессиональный текст раздела технического документа:
- Официальный деловой стиль
- Конкретные формулировки без воды
- Структура: общее → детализация → конкретика
- Числа пиши цифрами
- Не повторяй название раздела в тексте
- 150-400 слов"""
    user_message = f"""Раздел: {section}
Что должно быть: {description}
Данные от заказчика: {user_answer}

Напиши профессиональный текст раздела."""
    try:
        return await chat([{"role": "user", "content": user_message}], temperature=0.5)
    except Exception:
        return user_answer


async def check_health() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


async def list_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            data = resp.json()
            return [m["name"] for m in data.get("models", [])]
    except Exception:
        return []


async def assistant_reply(user_message: str, system: str = "", history: list[dict] | None = None) -> str:
    messages = list(history or [])
    messages.append({"role": "user", "content": user_message})
    try:
        return await chat(messages, system=system, temperature=0.3)
    except Exception:
        return (
            "Извините, нейросеть сейчас недоступна. "
            "Проверьте, что Ollama запущена. "
            "Вы можете перейти в раздел «Чат» для заполнения документа или «Документы» для генерации."
        )
