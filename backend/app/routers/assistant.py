from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.routers.auth import get_current_user
from app.models.models import User, GostFile
from app.services import ai

router = APIRouter()

SITE_CONTEXT = """Ты — помощник системы документирования по стандартам ЕСПД (ГОСТ 19) и ЕСКД (ГОСТ 2).
Твоя единственная задача — помогать пользователю составлять техническую документацию: подсказывать, что писать в разделах, и улучшать формулировки в официально-деловом стиле.

ВАЖНЫЕ ПРАВИЛА:
- Отвечай кратко и строго по делу, на русском. Не более 4–6 предложений, если не просят черновик.
- Никогда не рассказывай о себе, своих возможностях, не предлагай «решать уравнения», «переводить текст» и подобное — ты только про документацию.
- Не здоровайся повторно и не лей «воду». Сразу давай полезный ответ по сути вопроса.
- Опирайся на раздел документа и требования ГОСТа из контекста ниже, если они есть.

Когда пользователь заполняет раздел документа (видно из контекста):
- если поле пустое — кратко объясни, что по ГОСТу пишут в этом разделе, и дай 1–2 примера формулировок;
- если текст написан — предложи, как сделать его чётче и официальнее в стиле ЕСПД/ЕСКД;
- предлагай готовые формулировки, которые можно вставить в документ.

Разделы системы (для справки по навигации): «Новый документ» — создание по шаблону; «Документы» — список и редактирование; «Стандарты», «Шаблоны», «Структура документов» — у администратора.
"""


class AssistantMessage(BaseModel):
    content: str
    page_context: str = ""
    section_context: str = ""


class SuggestGostRequest(BaseModel):
    title: str


class SuggestGostResponse(BaseModel):
    gost_id: Optional[str]
    gost_code: Optional[str]
    message: Optional[str]


class AssistantResponse(BaseModel):
    reply: str


@router.post("/chat", response_model=AssistantResponse)
async def assistant_chat(body: AssistantMessage, user: User = Depends(get_current_user)):
    system = SITE_CONTEXT
    if body.page_context:
        system += f"\n\nТекущая страница пользователя: {body.page_context}"
    if body.section_context:
        system += f"\n\nПользователь сейчас заполняет раздел документа:\n{body.section_context}"
    if user.role == "admin":
        system += "\nПользователь — администратор, может видеть все разделы."

    reply = await ai.assistant_reply(body.content, system=system)
    return {"reply": reply}


@router.post("/suggest-gost", response_model=SuggestGostResponse)
async def suggest_gost(
    body: SuggestGostRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if len(body.title.strip()) < 5:
        return SuggestGostResponse(gost_id=None, gost_code=None, message=None)

    result = await db.execute(select(GostFile))
    gosts = result.scalars().all()
    if not gosts:
        return SuggestGostResponse(gost_id=None, gost_code=None, message=None)

    t = body.title.lower()
    kw_19 = ['программ', 'еспд', 'гост 19', 'по ', 'приложени']
    kw_34 = ['автоматизир', 'систем', ' ас ', 'гост 34', 'аис', 'информационн', 'платформ', 'сервис', 'crm', 'erp']

    score_19 = sum(1 for k in kw_19 if k in t)
    score_34 = sum(1 for k in kw_34 if k in t)

    target = '19' if score_19 > score_34 and score_19 > 0 else ('34' if score_34 > 0 else None)
    if not target:
        return SuggestGostResponse(gost_id=None, gost_code=None, message=None)

    for gost in gosts:
        meta = gost.meta_schema or {}
        series = str(meta.get('series', ''))
        if series == target or target in (gost.code or ''):
            return SuggestGostResponse(
                gost_id=gost.id,
                gost_code=gost.code,
                message=f"Похоже на документ серии ГОСТ {target} — рекомендуем «{gost.code}». Применить структуру разделов?",
            )

    return SuggestGostResponse(gost_id=None, gost_code=None, message=None)


class ImproveRequest(BaseModel):
    text: str
    question: str = ""
    section: str = ""        # название раздела
    gost_hint: str = ""      # требования ГОСТа к разделу
    doc_title: str = ""      # название документа
    topic: str = ""          # о чём документ / предмет разработки
    mode: str = "improve"    # improve — улучшить текст; draft — написать черновик


@router.post("/improve")
async def improve_text(body: ImproveRequest, _=Depends(get_current_user)):
    """Улучшение текста раздела или написание черновика по требованиям ГОСТа."""
    from app.services.ai import chat as ai_chat

    ctx = []
    if body.topic:
        ctx.append(f"О чём документ (предмет разработки): {body.topic}")
    if body.doc_title:
        ctx.append(f"Документ: {body.doc_title}.")
    if body.section:
        ctx.append(f"Раздел документа: «{body.section}».")
    if body.gost_hint:
        ctx.append(f"Согласно стандарту (ЕСПД/ЕСКД), в этом разделе должно быть указано: {body.gost_hint}")
    if body.question:
        ctx.append(body.question)
    context_block = "\n".join(ctx)

    if body.mode == "draft" or not body.text.strip():
        system = """Ты — помощник по составлению технической документации по стандартам ЕСПД (ГОСТ 19) и ЕСКД (ГОСТ 2).
Напиши содержательный черновик указанного раздела документа в официально-деловом стиле.
СТРОГО опирайся на предмет документа («О чём документ») из контекста — пиши именно про эту систему/программу, НЕ придумывай другую предметную область.
Опирайся на требования стандарта к разделу. Пиши по существу, без «воды» и без пояснений о том, что ты делаешь.
Используй обычный текст и, где уместно, маркированные списки (с тире). Конкретные факты, которых нет в контексте, не выдумывай — используй обобщённые формулировки или оставляй [в квадратных скобках] для уточнения автором."""
        user_message = f"{context_block}\n\nНапиши черновик этого раздела."
        if body.text.strip():
            user_message += f"\n\nЧерновик/заметки автора (учти их):\n{body.text}"
    else:
        system = """Ты — помощник по составлению технической документации по стандартам ЕСПД (ГОСТ 19) и ЕСКД (ГОСТ 2).
Улучши текст автора: сделай его профессиональным, чётким и соответствующим официально-деловому стилю технического документа.
Сохрани смысл и все факты автора. Приведи к требованиям стандарта к разделу, если они указаны.
Отвечай только улучшенным текстом, без пояснений."""
        user_message = f"{context_block}\n\nТекст автора:\n{body.text}\n\nНапиши улучшенный вариант."

    try:
        result = await ai_chat([{"role": "user", "content": user_message}], system=system, temperature=0.4)
        return {"original": body.text, "improved": result.strip()}
    except Exception as e:
        raise HTTPException(500, f"Ошибка: {str(e)}")
